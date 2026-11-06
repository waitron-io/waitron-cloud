"""Opt-in proof of the trusted host turn stages, including actual PostgreSQL."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

RECIPE = Path(sys.argv.pop(1)).resolve()
BUNDLE = Path(sys.argv.pop(1)).resolve()
RESOURCE = sys.argv.pop(1)


class LocalTurn(unittest.TestCase):
    def operation(self, mode, data=None, timeout=30):
        result = subprocess.run(['python3', '-B', str(RECIPE/'session.py'), mode, RESOURCE],
                                input=data, timeout=timeout)
        return result.returncode

    def test_real_transfer_prepare_postgres_exit3_and_absence(self):
        try:
            self.assertEqual(self.operation('transfer', BUNDLE.read_bytes()), 0)
            # A no-op stage must fail before candidate execution, not appear ready.
            self.assertTrue((Path('/var/lib/waitron-disposable/control')/RESOURCE/'request.json').is_file())
            self.assertEqual(self.operation('prepare', timeout=600), 0)
            self.assertEqual(self.operation('execute-v2', timeout=180), 0)
            completed = subprocess.run(['python3','-B',str(RECIPE/'session.py'),'result',RESOURCE],capture_output=True,text=True,timeout=30)
            self.assertEqual(completed.returncode,0,completed.stderr)
            self.assertEqual(json.loads(completed.stdout),{'resourceId':RESOURCE,'code':3})
        finally:
            self.assertEqual(self.operation('destroy', timeout=120), 0)
            observed = subprocess.run(['python3', '-B', str(RECIPE/'session.py'), 'inspect', RESOURCE],
                                      capture_output=True, text=True, timeout=30)
            self.assertEqual(observed.returncode, 0, observed.stderr)
            self.assertTrue(observed.stdout.strip(), 'Inspection must return an actual absence receipt')
            self.assertTrue(json.loads(observed.stdout)['absent'])


unittest.main(verbosity=2)
