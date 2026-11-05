import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runSuite } from './check.mjs';

const execute = promisify(execFile);

// Removing a root's platform checksum must change its lock or refuse initialization.
test('account root installs the pinned provider without rewriting its committed lock', async () => {
  const output = await runSuite('accounts', { execute: async (file, args, options) => {
    if (args[0] === 'run' && args.at(-1) === '/candidate/run.py') {
      const observe = `import subprocess, runpy
from pathlib import Path
original = subprocess.run
def observe(command, **options):
    root = Path(options['cwd'])
    lock = root / '.terraform.lock.hcl'
    checking = root.parts[-2:] == ('roots', 'accounts') and command[1] == 'init'
    before = lock.read_bytes() if checking and lock.exists() else None
    result = original(command, **options)
    if checking:
        print('ACCOUNT_LOCK_UNCHANGED=' + str(before is not None and before == lock.read_bytes()), flush=True)
    return result
subprocess.run = observe
runpy.run_path('/candidate/run.py', run_name='__main__')
`;
      args = [...args.slice(0, -3), 'python', '-I', '-c', observe];
    }
    return execute(file, args, options);
  } });
  assert.match(output, /Success! 10 passed, 0 failed/);
  assert.match(output, /Success! 2 passed, 0 failed/);
  assert.match(output, /ACCOUNT_LOCK_UNCHANGED=True/);
});
