import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ci_status', Path(__file__).with_name('ci-status.py'))
status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status)


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.state = self.home/'state'
        (self.state/'ledger').mkdir(parents=True)
        self.config = self.home/'controller/config.json'
        self.config.parent.mkdir()
        self.config.write_text(json.dumps(dict(state=str(self.state), slots=3, hostGeneration='test', host='fixture.invalid', recipe='/opt/recipe')))
        self.plist = self.home/'Library/LaunchAgents/com.waitron.disposable-recovery.plist'
        self.plist.parent.mkdir(parents=True)
        self.plist.write_bytes(plistlib.dumps(dict(ProgramArguments=['python3', '-I', '-B', '/wrapper', '/node', str(self.config), '--once'], StandardOutPath=str(self.state/'out'), StandardErrorPath=str(self.state/'err'))))
        self.slots = [dict(id=i, generation=1, state='free', lease=None) for i in range(3)]
        self.write_ledger()
        self.calls = []
        self.remote = {}
        self.agent = 'state = not running\nlast exit code = 0\n'

    def write_ledger(self):
        (self.state/'ledger/state.json').write_text(json.dumps(dict(version=1, hostGeneration='test', slots=self.slots, turns={})))

    def invoke(self, args, **kw):
        self.calls.append(args)
        self.assertGreater(kw['timeout'], 0)
        self.assertLessEqual(kw['timeout'], 4.5)
        if args[0] == 'launchctl':
            return subprocess.CompletedProcess(args, 0, self.agent, '')
        self.assertEqual(args[0], 'ssh')
        for option in ['ControlMaster=no', 'ProxyCommand=false', 'ControlPersist=600', 'StrictHostKeyChecking=yes']:
            self.assertIn(option, args)
        self.assertIn('root@fixture.invalid', args)
        self.assertIn('--host', args[-1])
        return subprocess.CompletedProcess(args, 0, json.dumps(self.remote), '')

    def collect(self):
        before = {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.home.rglob('*') if p.is_file()}
        with patch.object(status.subprocess, 'run', self.invoke), patch.object(status.time, 'time', return_value=1000):
            result = status.collect(self.home)
        self.assertEqual(before, {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.home.rglob('*') if p.is_file()})
        self.assertEqual(sum(a[0] == 'ssh' for a in self.calls), 1)
        return result

    def test_busy_counts_preparation_execution_and_pending_intent_separately(self):
        self.slots[0].update(state='running', lease=dict(resourceId='dt-test-0-1', generation=1, createdAt=900000, deadline=1100000, ci=dict(jobId=42, jobKey='test-ui-1')))
        self.slots[1]['ciInvocation'] = dict(jobId=43, createdAt=950000)
        self.write_ledger()
        self.remote = {'dt-test-0-1': dict(state='prepared', workerStart=990000)}
        self.agent = 'state = running\npid = 123\nlast exit code = 0\n'
        r = self.collect()
        self.assertEqual(r['slots'], dict(total=3, busy=2, free=1))
        self.assertEqual(r['jobs'][0]['runtimeSeconds'], 10)
        self.assertEqual(r['jobs'][0]['admissionAgeSeconds'], 100)
        self.assertEqual(r['jobs'][1]['start'], 'unknown')
        self.assertEqual(r['controller']['pid'], 123)
        self.assertTrue(r['controller']['registered'])
        self.assertEqual(r['lastAdmission'], 900000)
        self.assertEqual(r['controller']['version'], str(self.config.parent))

    def test_idle_errors_and_last_admission_read_existing_tails(self):
        (self.state/'out').write_text('not json\n'+json.dumps(dict(code=0, lease=dict(createdAt=800000)))+'\n'+json.dumps(dict(event='automatic-ci-job', at='later'))+'\n')
        (self.state/'err').write_text('error 192.0.2.1:22 and [2001:db8::1] '+ 'x'*250+'\n')
        r = self.collect()
        self.assertEqual(r['slots'], dict(total=3, busy=0, free=3))
        self.assertEqual(r['controller']['state'], 'idle')
        self.assertEqual(r['lastAdmission'], 800000)
        self.assertEqual(r['errors'][0]['time'], 'unknown')
        self.assertNotIn('192.0.2.1', r['errors'][0]['message'])
        self.assertNotIn('2001:db8::1', r['errors'][0]['message'])
        self.assertEqual(len(r['errors'][0]['message']), 200)
        self.assertIsInstance(r['errorsWrittenAt'], int)

    def test_quarantine_and_legacy_gate_are_busy_without_invented_execution(self):
        self.slots[0].update(state='quarantined', lease=dict(resourceId='dt-test-0-1', generation=1, lane='I', turn='manual-check', createdAt=100000, deadline=200000))
        self.slots[1]['orphanRunners'] = [dict(runnerName='retained')]
        self.write_ledger()
        r = self.collect()
        self.assertEqual(r['slots']['busy'], 2)
        self.assertTrue(r['jobs'][0]['expired'])
        self.assertEqual(r['jobs'][0]['job'], dict(lane='I', turn='manual-check'))
        self.assertEqual(r['jobs'][0]['runtimeSeconds'], 'unknown')
        self.assertEqual(r['lastAdmission'], 100000)

    def test_corrupt_ledger_never_reports_free_capacity(self):
        self.slots[0]['lease'] = dict(createdAt=1)
        self.write_ledger()
        r = self.collect()
        self.assertEqual(r['slots']['free'], 'unknown')
        self.assertEqual(r['lastAdmission'], 'unknown')

    def test_missing_lease_or_invalid_generation_reports_unknown_capacity(self):
        for slot in [dict(id=0, generation=-1, state='free', lease=None),
                     dict(id=0, generation=1, state='running', lease=dict(generation=1))]:
            self.slots[0] = slot
            self.write_ledger()
            self.calls = []
            self.assertEqual(self.collect()['slots']['free'], 'unknown')

    def test_expired_connection_returns_partial_status_within_budget(self):
        original = self.invoke
        def unavailable(args, **kw):
            if args[0] == 'ssh':
                self.calls.append(args)
                raise subprocess.TimeoutExpired(args, kw['timeout'])
            return original(args, **kw)
        self.invoke = unavailable
        r = self.collect()
        self.assertEqual(r['host'], 'unknown')
        self.assertEqual(r['slots']['free'], 3)

    def test_invalid_host_reply_stays_unknown(self):
        self.remote = {'broken': 'not an observation'}
        self.assertEqual(self.collect()['host'], 'unknown')

    def test_real_command_timeout_reaps_its_child(self):
        started = time.monotonic()
        self.assertIsNone(status.command([sys.executable, '-c', 'import time; time.sleep(5)'], started + 0.05))
        self.assertLess(time.monotonic() - started, 1)

    def test_missing_installation_cli_prints_one_json_line(self):
        self.plist.unlink()
        result = subprocess.run([sys.executable, '-I', '-B', str(Path(__file__).with_name('ci-status.py'))],
                                env={**os.environ, 'HOME': str(self.home)}, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(result.stdout.splitlines()), 1)
        self.assertEqual(json.loads(result.stdout)['slots']['free'], 'unknown')

    def test_host_observes_worker_names_and_manual_request_without_writing(self):
        root = self.home/'host'; root.mkdir()
        for name in ['ci', 'manual', 'ambiguous']:
            d = root/name; d.mkdir(); (d/'prepared').touch()
        (root/'manual/command.json').write_text('{}'); os.utime(root/'manual/command.json', (980, 980))
        fake = types.SimpleNamespace(CONTROL=root, guest_ssh=lambda d: ['ssh', d.name])
        def read(args, **kw):
            names = ['Worker_19700101-001630-utc.log']
            if args[1] == 'ambiguous': names.append('Worker_19700101-001631-utc.log')
            return subprocess.CompletedProcess(args, 0, json.dumps(names), '')
        with patch.dict('sys.modules', session=fake), patch.object(status.subprocess, 'run', read):
            r = status.host_status(dict(recipe='/fixture', resources=['ci', 'manual', 'ambiguous'], budget=3))
        self.assertEqual(r['ci']['workerStart'], 990000)
        self.assertEqual(r['manual']['executionRequested'], 980000)
        self.assertEqual(r['ambiguous']['workerStart'], 'unknown')
        self.assertEqual(sorted(p.name for p in (root/'ci').iterdir()), ['prepared'])


if __name__ == '__main__':
    unittest.main()
