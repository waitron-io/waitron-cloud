"""Exercise the trusted transfer boundary without requiring a VM host."""
import hashlib
import base64
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('session', Path(__file__).with_name('session.py'))
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)


class Transfer(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='disposable-session-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.resource = 'dt-transfer-0-1'
        self.source = b'candidate bytes; never executed on host'
        self.request = {'resourceId': self.resource, 'snapshot': hashlib.sha256(self.source).hexdigest(),
                        'argv': ['node', '-e', 'process.exit(3)'], 'deadline': int(time.time()*1000)+600000}

    def archive(self, request=None, source=None, extras=None):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            entries = {'request.json': json.dumps(self.request if request is None else request).encode(),
                       'source.tar': self.source if source is None else source}
            entries.update(extras or {})
            for name, data in entries.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        output.seek(0)
        return output

    # Ignoring the snapshot digest would run different bytes from the reserved lease.
    def test_transfer_binds_exact_request_and_snapshot_without_extracting_source(self):
        result = session.receive(self.root, self.resource, self.archive())
        self.assertEqual(result, self.request)
        self.assertEqual((self.root/self.resource/'source.tar').read_bytes(), self.source)
        self.assertEqual(json.loads((self.root/self.resource/'request.json').read_text()), self.request)
        self.assertEqual(sorted(p.name for p in (self.root/self.resource).iterdir()), ['request.json', 'source.tar'])
        with self.assertRaisesRegex(ValueError, 'already'):
            session.receive(self.root, self.resource, self.archive())

    def test_wrong_snapshot_and_unknown_files_leave_no_transfer(self):
        for stream in [self.archive(source=b'changed source'),
                       self.archive(extras={'../escape': b'unexpected'}),
                       self.archive(extras={'host.py': b'candidate host code'}),
                       self.archive(extras={'.npmrc': b'must not copy credentials'})]:
            with self.assertRaises(ValueError):
                session.receive(self.root, self.resource, stream)
            self.assertFalse((self.root/self.resource).exists())
            self.assertFalse((self.root/'escape').exists())

    def test_invalid_or_stale_command_request_never_becomes_a_host_turn(self):
        for changes in [{'resourceId': 'dt-peer-0-1'}, {'deadline': 0}, {'argv': []},
                        {'argv': ['node', '\0']}, {'shell': True}, {'snapshot': 'invalid'}]:
            with self.assertRaises(ValueError):
                session.receive(self.root, self.resource, self.archive(request={**self.request, **changes}))
            self.assertFalse((self.root/self.resource).exists())

    def test_links_duplicate_members_and_truncated_input_are_refused(self):
        for kind in ['link', 'duplicate', 'truncated']:
            stream = self.archive()
            if kind == 'truncated':
                stream = io.BytesIO(stream.getvalue()[:600])
            else:
                with tarfile.open(fileobj=stream, mode='a') as archive:
                    info = tarfile.TarInfo('source.tar')
                    if kind == 'link':
                        info.type = tarfile.SYMTYPE
                        info.linkname = '/etc/shadow'
                    archive.addfile(info)
                stream.seek(0)
            with self.assertRaises(ValueError):
                session.receive(self.root, self.resource, stream)
            self.assertFalse((self.root/self.resource).exists())

    def test_private_package_bytes_require_the_reviewed_integrity(self):
        package = b'reviewed private package fixture'
        original = getattr(session, 'PACKAGE_SHA512', None)
        session.PACKAGE_SHA512 = {hashlib.sha512(package).digest()}
        self.addCleanup(setattr, session, 'PACKAGE_SHA512', original)
        result = session.receive(self.root, self.resource, self.archive(extras={'ui.tgz': package}))
        self.assertEqual(result, self.request)
        self.assertEqual((self.root/self.resource/'ui.tgz').read_bytes(), package)
        resource2 = 'dt-transfer-0-2'
        with self.assertRaisesRegex(ValueError, 'integrity'):
            session.receive(self.root, resource2, self.archive(request={**self.request, 'resourceId': resource2}, extras={'ui.tgz': b'altered'}))
        self.assertFalse((self.root/resource2).exists())


    def test_only_receive_tolerates_skew_and_persists_one_strict_server_deadline(self):
        from unittest.mock import patch
        now=2000000000000
        raw={**self.request,'deadline':now+3301500}
        with patch.object(session.time,'time',return_value=now/1000):
            with self.assertRaises(ValueError):session.request_identity(raw,self.resource)
            try:result=session.receive(self.root,self.resource,self.archive(request=raw))
            except ValueError as error:self.fail('A bounded skew request was refused instead of clamped: '+str(error))
            self.assertEqual(result['deadline'],now+3300000)
            self.assertEqual(json.loads((self.root/self.resource/'request.json').read_text()),result)
            self.assertEqual(session.request_identity(result,self.resource),result)
        resource2='dt-transfer-0-3'
        with patch.object(session.time,'time',return_value=now/1000):
            with self.assertRaises(ValueError):session.receive(self.root,resource2,self.archive(request={**raw,'resourceId':resource2,'deadline':now+3305001}))
            self.assertFalse((self.root/resource2).exists())


    def test_every_reviewed_package_digest_is_consumed_by_the_actual_host_transfer(self):
        from unittest.mock import patch
        packages_spec=importlib.util.spec_from_file_location('packages',Path(__file__).resolve().parents[2]/'scripts/disposable-tests/private-packages.py')
        packages=importlib.util.module_from_spec(packages_spec);packages_spec.loader.exec_module(packages)
        original=session.hashlib.file_digest
        for index,package in enumerate(packages.PACKAGES,10):
            expected=base64.b64decode(package['integrity'][7:]);resource=f'dt-transfer-0-{index}'
            def digest(source,algorithm):
                if Path(source.name).name=='ui.tgz':
                    class CheckedBytes:
                        def digest(self):return expected
                    return CheckedBytes()
                return original(source,algorithm)
            with patch.object(session.hashlib,'file_digest',digest):
                try:result=session.receive(self.root,resource,self.archive(request={**self.request,'resourceId':resource},extras={'ui.tgz':b'synthetic crypto-provider input'}))
                except ValueError as error:self.fail('A reviewed package was refused: '+str(error))
            self.assertEqual(result['resourceId'],resource)
            self.assertTrue((self.root/resource/'ui.tgz').is_file())

unittest.main(verbosity=2)
