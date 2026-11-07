"""Startup must close admission until recorded interrupted work is absent."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

import host
import session

spec = importlib.util.find_spec('startup')
startup = importlib.util.module_from_spec(spec) if spec else None
if spec:
    spec.loader.exec_module(startup)


class Startup(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(startup, 'The server needs boot reconciliation before admitting work')
        self.temporary = tempfile.TemporaryDirectory(prefix='disposable-startup-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.boot = self.root/'boot-id'
        self.boot.write_text('11111111-1111-4111-8111-111111111111\n')
        for module, name, value in [(host, 'ROOT', self.root), (startup, 'BOOT_ID', self.boot),
                                    (session, 'CONTROL', self.root/'control'),
                                    (session, 'OPERATIONS', self.root/'operations')]:
            guard = patch.object(module, name, value)
            guard.start()
            self.addCleanup(guard.stop)
        self.destroyed = []
        self.present = set()

    def recorded(self, resource, *places):
        self.present.add(resource)
        for place in places:
            (self.root/place/resource).mkdir(parents=True, mode=0o700, exist_ok=True)

    def destroy(self, resource):
        self.assertFalse(startup.ready(), 'Admission opened before cleanup finished')
        self.destroyed.append(resource)
        self.present.discard(resource)
        for place in ('control', 'turns'):
            shutil.rmtree(self.root/place/resource, ignore_errors=True)
        if (self.root/'active.json').exists():
            active = json.loads((self.root/'active.json').read_text())
            self.assertEqual(active['resourceId'], resource, 'A stale ID ran ahead of the actual slot owner')
            (self.root/'active.json').unlink()
        return {'resourceId': resource, 'absent': True}

    def reconcile(self):
        # VM/systemd operations need the dedicated host; inventory and the gate
        # use real files here, including an independent absence readback.
        with patch.object(session, 'destroy', side_effect=self.destroy), \
             patch.object(session, 'inspect', side_effect=lambda resource: {
                 'resourceId': resource, 'absent': resource not in self.present}):
            return startup.reconcile()

    def test_cold_start_cleans_active_then_transfer_and_operation_records_before_admission(self):
        self.recorded('dt-startup-0-2', 'turns', 'control', 'operations')
        self.recorded('dt-startup-0-1', 'operations')
        self.recorded('dt-startup-0-3', 'control')
        (self.root/'active.json').write_text(json.dumps({'resourceId': 'dt-startup-0-2'}))
        foreign = self.root/'gateway'; foreign.mkdir(); (foreign/'keep').write_text('neighbor')
        self.assertFalse(startup.ready())
        self.reconcile()
        self.assertEqual(self.destroyed, ['dt-startup-0-2', 'dt-startup-0-1', 'dt-startup-0-3'])
        self.assertTrue(startup.ready())
        self.assertEqual((foreign/'keep').read_text(), 'neighbor')

    def test_restarting_the_startup_service_in_the_same_boot_preserves_live_work(self):
        self.reconcile()
        self.recorded('dt-startup-0-4', 'turns', 'control', 'operations')
        (self.root/'active.json').write_text(json.dumps({'resourceId': 'dt-startup-0-4'}))
        self.reconcile()
        self.assertEqual(self.destroyed, [])
        self.assertTrue((self.root/'turns/dt-startup-0-4').is_dir())
        self.assertTrue(startup.ready())

    def test_a_new_boot_refuses_admission_until_interrupted_work_is_removed(self):
        self.reconcile()
        self.recorded('dt-startup-0-5', 'turns', 'operations')
        self.boot.write_text('22222222-2222-4222-8222-222222222222\n')
        self.assertFalse(startup.ready())
        self.reconcile()
        self.assertEqual(self.destroyed, ['dt-startup-0-5'])
        self.assertTrue(startup.ready())

    def test_failed_or_foreign_independent_absence_keeps_admission_closed(self):
        for observation in [{'resourceId': 'dt-startup-0-1', 'absent': False},
                            {'resourceId': 'dt-neighbor-0-1', 'absent': True}]:
            self.recorded('dt-startup-0-1', 'control')
            with patch.object(session, 'destroy', return_value={'absent': True}), \
                 patch.object(session, 'inspect', return_value=observation):
                with self.assertRaisesRegex(ValueError, 'absence'):
                    startup.reconcile()
            self.assertFalse(startup.ready())
            self.assertTrue((self.root/'control/dt-startup-0-1').exists())

    def test_unknown_or_linked_inventory_is_refused_without_cleaning_anything(self):
        self.recorded('dt-startup-0-1', 'control')
        for name in ['not-a-resource', 'dt-startup-0-9']:
            path = self.root/'control'/name
            if name.startswith('dt-'):
                path.symlink_to(self.root/'control/dt-startup-0-1', target_is_directory=True)
            else:
                path.mkdir()
            with self.assertRaises(ValueError):
                self.reconcile()
            self.assertFalse(startup.ready())
            self.assertEqual(self.destroyed, [])
            if path.is_symlink(): path.unlink()
            else: path.rmdir()

    def test_linked_ready_record_never_qualifies_or_overwrites_a_foreign_file(self):
        outside = self.root/'outside'; outside.write_text('preserve')
        (self.root/'startup.json').symlink_to(outside)
        self.assertFalse(startup.ready())
        with self.assertRaises(ValueError): self.reconcile()
        self.assertEqual(outside.read_text(), 'preserve')

    def test_host_workers_refuse_before_any_remote_stage_when_startup_is_incomplete(self):
        with patch.object(sys, 'argv', ['session.py', '_worker', 'transfer', 'dt-startup-0-1']), \
             patch.object(os, 'geteuid', return_value=0), \
             patch.object(Path, 'is_char_device', return_value=True), \
             patch.object(session, 'stage', side_effect=AssertionError('Unreconciled work started')):
            with self.assertRaisesRegex(ValueError, 'startup'):
                session.main()
        self.assertFalse((self.root/'operations/dt-startup-0-1').exists())

    def test_no_supervisor_starts_and_health_is_false_before_boot_reconciliation(self):
        with patch.object(os, 'geteuid', return_value=0), \
             patch.object(Path, 'is_char_device', return_value=True), \
             patch.object(session, 'supervise', side_effect=AssertionError('Unreconciled supervisor started')):
            for stage in ('transfer', 'prepare', 'execute-v2'):
                with patch.object(sys, 'argv', ['session.py', stage, 'dt-startup-0-1']):
                    with self.assertRaisesRegex(ValueError, 'startup'): session.main()
            import contextlib
            import io
            output = io.StringIO()
            with patch.object(sys, 'argv', ['session.py', 'health']), contextlib.redirect_stdout(output):
                self.assertEqual(session.main(), 0)
            self.assertEqual(json.loads(output.getvalue()), {'healthy': False})

    def test_a_competing_startup_cannot_open_admission_while_cleanup_owns_the_lock(self):
        import fcntl
        import subprocess
        with (self.root/'startup.lock').open('w') as lock:
            os.chmod(self.root/'startup.lock', 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            code = '''import sys
from pathlib import Path
import host,startup
host.ROOT=Path(sys.argv[1]);startup.BOOT_ID=host.ROOT/'boot-id'
try:startup.reconcile()
except BlockingIOError:sys.exit(75)
'''
            result = subprocess.run([sys.executable, '-B', '-c', code, str(self.root)],
                                    cwd=Path(__file__).resolve().parent, text=True, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 75, result.stdout+result.stderr)
            self.assertFalse(startup.ready())
        self.reconcile()
        self.assertTrue(startup.ready())


unittest.main(verbosity=2)
