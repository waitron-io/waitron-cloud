"""Exercise cancellation fencing with actual locks and competing processes."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
spec = importlib.util.find_spec('operations')
operations = importlib.util.module_from_spec(spec) if spec else None
if spec:
    spec.loader.exec_module(operations)


class Operations(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(operations, 'Remote work needs an owned operation and cancellation fence')
        self.temporary = tempfile.TemporaryDirectory(prefix='disposable-operations-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.resource = 'dt-operation-0-1'

    def test_unsafe_operation_root_is_refused_before_creating_a_generation(self):
        outside=self.root/'outside';outside.mkdir()
        link=self.root/'linked';link.symlink_to(outside,target_is_directory=True)
        with self.assertRaises(ValueError):
            operations.fence(link,self.resource)
        self.assertEqual(list(outside.iterdir()),[],'Unsafe root wrote into a foreign directory')

    # Omitting the closed check lets delayed work recreate a destroyed guest.
    def test_closed_generation_refuses_every_late_stage_without_touching_successor(self):
        operations.fence(self.root, self.resource)
        operations.fence(self.root, self.resource)
        for stage in ('transfer', 'prepare', 'execute'):
            with self.assertRaisesRegex(ValueError, 'closed'):
                with operations.owned(self.root, self.resource):
                    self.fail('A cancelled '+stage+' must not run')
        with operations.owned(self.root, 'dt-operation-0-2'):
            (self.root/'successor').write_text('independent')
        self.assertEqual((self.root/'successor').read_text(), 'independent')

    # Omitting the OS lock permits preparation and execution to race on one VM.
    def test_competing_process_cannot_enter_owned_operation(self):
        script = '''import sys
from pathlib import Path
import operations
try:
    with operations.owned(Path(sys.argv[1]),sys.argv[2]):
        print('unexpected entry')
except BlockingIOError:
    sys.exit(75)
'''
        with operations.owned(self.root, self.resource):
            result = subprocess.run([sys.executable, '-B', '-c', script, str(self.root), self.resource],
                                    cwd=Path(__file__).resolve().parent, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 75, result.stdout+result.stderr)
        with operations.owned(self.root, self.resource):
            pass

    # A cancellation marker must be writable even while a stage holds its lock.
    def test_cancellation_fences_an_inflight_operation_before_releasing_its_lock(self):
        with operations.owned(self.root, self.resource):
            operations.fence(self.root, self.resource)
        with self.assertRaisesRegex(ValueError, 'closed'):
            with operations.owned(self.root, self.resource):
                self.fail('Closed work resumed')


unittest.main(verbosity=2)
