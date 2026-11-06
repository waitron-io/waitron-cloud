"""Opt-in dedicated-host cancellation proof; never imported by ordinary CI."""
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest

RECIPE = Path(sys.argv.pop(1)).resolve()
RESOURCE = sys.argv.pop(1)
BUNDLE = Path(sys.argv.pop(1)) if len(sys.argv)>1 and not sys.argv[1].startswith('-') else None


class Cancellation(unittest.TestCase):
    def call(self, mode, resource=RESOURCE, **kwargs):
        return subprocess.run(['python3', '-B', str(RECIPE/'session.py'), mode, resource],
                              capture_output=True, timeout=120, **kwargs)

    # Killing just the SSH/transfer client leaves a remote reader racing deletion.
    def test_blocked_transfer_is_stopped_before_owned_cleanup(self):
        child = subprocess.Popen(['python3', '-B', str(RECIPE/'session.py'), 'transfer', RESOURCE],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            end = time.monotonic()+10
            target = Path('/var/lib/waitron-disposable/control')/RESOURCE/'bundle.tar'
            while not target.exists() and child.poll() is None and time.monotonic() < end:
                time.sleep(0.05)
            self.assertTrue(target.exists(), 'The real transfer must be blocked reading input')
            before = time.monotonic()
            destroyed = self.call('destroy')
            self.assertEqual(destroyed.returncode, 0, destroyed.stderr)
            self.assertTrue(json.loads(destroyed.stdout)['absent'])
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.fail('Cleanup returned while the remote transfer still runs')
            self.assertLess(time.monotonic()-before, 120)
            self.assertFalse(target.parent.exists())
            late = self.call('transfer', input=b'')
            self.assertNotEqual(late.returncode, 0, 'A delayed transfer recreated closed work')
            self.assertFalse(target.parent.exists())
            observed = self.call('inspect')
            self.assertTrue(json.loads(observed.stdout)['absent'])
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            child.communicate(timeout=5)
            self.call('destroy')


    # A killed create must not leave a permanent mkdir lock blocking cleanup.
    def test_host_lock_is_released_when_its_recorded_owner_dies(self):
        import tempfile
        import selectors
        sys.path.insert(0,str(RECIPE))
        import host
        with tempfile.TemporaryDirectory(prefix='owned-host-lock-') as temporary:
            program="import host,sys,time;from pathlib import Path;host.ROOT=Path(sys.argv[1]);\nwith host.locked():\n print('LOCK-READY',flush=True);time.sleep(60)"
            child=subprocess.Popen(['python3','-B','-c',program,temporary],cwd=RECIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                selector=selectors.DefaultSelector();selector.register(child.stdout,selectors.EVENT_READ)
                try:self.assertTrue(selector.select(5),'Lock owner must start')
                finally:selector.close()
                self.assertEqual(child.stdout.readline(),b'LOCK-READY\n')
                competitor=subprocess.run(['python3','-B','-c',program.replace("print('LOCK-READY',flush=True);time.sleep(60)","print('COMPETING-ENTRY',flush=True)"),temporary],cwd=RECIPE,
                                          capture_output=True,timeout=5)
                self.assertNotEqual(competitor.returncode,0,'A live owner lost host exclusion')
                self.assertIn(b'BlockingIOError',competitor.stderr)
                child.kill();child.wait(timeout=5)
                previous=host.ROOT;host.ROOT=Path(temporary)
                try:
                    try:
                        with host.locked():pass
                    except BlockingIOError:self.fail('Dead owner left host cleanup permanently locked')
                finally:host.ROOT=previous
            finally:
                if child.poll() is None:child.kill();child.wait(timeout=5)
                child.communicate(timeout=5)

    def load_bundle(self, resource, duration=900000):
        self.assertIsNotNone(BUNDLE, 'This proof requires a real source/package bundle')
        import io
        import tarfile
        with tarfile.open(BUNDLE) as archive:
            request = json.load(archive.extractfile('request.json'))
            request['resourceId'] = resource
            request['argv'] = ['node', '-e', "console.log('CANCELLATION-COMMAND-READY');setInterval(()=>{},1000)"]
            request['deadline'] = int(time.time()*1000)+duration
            output = io.BytesIO()
            with tarfile.open(fileobj=output,mode='w',format=tarfile.USTAR_FORMAT) as result:
                for entry in archive:
                    data = json.dumps(request).encode() if entry.name=='request.json' else archive.extractfile(entry).read()
                    info=tarfile.TarInfo(entry.name);info.size=len(data)
                    result.addfile(info,io.BytesIO(data))
        transferred=self.call('transfer',resource,input=output.getvalue())
        self.assertEqual(transferred.returncode,0,transferred.stderr)

    # Without a host expiry watchdog, controller death strands transferred work.
    def test_server_deadline_removes_work_without_a_controller_cleanup_call(self):
        resource=RESOURCE.rsplit('-',1)[0]+'-103'
        self.load_bundle(resource,duration=4000)
        try:
            self.assertFalse(json.loads(self.call('inspect',resource).stdout)['absent'])
            end=time.monotonic()+12
            while time.monotonic()<end:
                observed=self.call('inspect',resource)
                self.assertEqual(observed.returncode,0,observed.stderr)
                if json.loads(observed.stdout)['absent']:break
                time.sleep(.2)
            else:self.fail('The server deadline left abandoned transfer data present')
            late=self.call('transfer',resource,input=b'')
            self.assertNotEqual(late.returncode,0)
            self.assertTrue(json.loads(self.call('inspect',resource).stdout)['absent'])
        finally:self.call('destroy',resource)

    def cancel_stage(self, stage):
        import selectors
        resource=RESOURCE.rsplit('-',1)[0]+('-101' if stage=='prepare' else '-102')
        self.load_bundle(resource)
        if stage=='execute':
            prepared=self.call('prepare',resource)
            self.assertEqual(prepared.returncode,0,prepared.stdout+prepared.stderr)
        child=subprocess.Popen(['python3','-B',str(RECIPE/'session.py'),('execute-v2' if stage=='execute' else stage),resource],
                               stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        selector=selectors.DefaultSelector()
        selector.register(child.stdout,selectors.EVENT_READ)
        marker=b'Setting up' if stage=='prepare' else b'CANCELLATION-COMMAND-READY'
        output=b''
        try:
            end=time.monotonic()+180
            while marker not in output and child.poll() is None and time.monotonic()<end:
                for key,_ in selector.select(.25):
                    import os
                    data=os.read(key.fileobj.fileno(),65536)
                    output+=data
                    sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
                    if not data:selector.unregister(key.fileobj)
            self.assertIn(marker,output,'Must cancel during actual '+stage)
            before=time.monotonic()
            destroyed=self.call('destroy',resource)
            self.assertEqual(destroyed.returncode,0,destroyed.stderr)
            self.assertTrue(json.loads(destroyed.stdout)['absent'])
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:self.fail('Cleanup returned with a live '+stage+' process')
            self.assertLess(time.monotonic()-before,120)
            for delayed in ('prepare','execute-v2'):
                refused=self.call(delayed,resource)
                self.assertNotEqual(refused.returncode,0,'Closed turn resumed '+delayed)
            self.assertTrue(json.loads(self.call('inspect',resource).stdout)['absent'])
        finally:
            selector.close()
            if child.poll() is None:
                child.terminate()
                try:child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill();child.wait(timeout=5)
            child.communicate(timeout=5)
            self.call('destroy',resource)

    def test_preparation_cancellation_stops_all_host_children_before_cleanup(self):
        self.cancel_stage('prepare')

    def test_execution_cancellation_destroys_the_exact_guest_before_returning(self):
        self.cancel_stage('execute')


unittest.main(verbosity=2)
