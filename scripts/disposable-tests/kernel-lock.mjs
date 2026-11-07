import assert from 'node:assert/strict';
import {constants, mkdirSync, lstatSync, openSync, fstatSync, closeSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {spawnSync} from 'node:child_process';

const flock = `import fcntl,sys
try: fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: sys.exit(75)
`;

export async function withKernelLock(state, work, {bootstrap = false, deadline = Date.now()+7500} = {}) {
  assert.ok(typeof state === 'string' && isAbsolute(state), 'State needs an absolute path');
  if (bootstrap) mkdirSync(state, {mode:0o700});
  const directory = lstatSync(state);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.getuid() &&
    (directory.mode & 0o077) === 0, 'State must be a private owned directory');
  const path = join(state, 'mac-controller.lock');
  const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW |
    (bootstrap ? constants.O_CREAT | constants.O_EXCL : 0), 0o600);
  try {
    const info = fstatSync(fd);
    assert.ok(info.isFile() && info.uid === process.getuid() && (info.mode & 0o077) === 0,
      'Controller lock must be a private owned file');
    if (Date.now() >= deadline) return {code:75, reason:'admission-budget'};
    // flock belongs to this open file description, retained by Node after the
    // helper exits. Ordinary children receive no copy of the descriptor.
    const result = spawnSync('python3', ['-I', '-B', '-c', flock], {cwd:'/',
      stdio:['ignore', 'ignore', 'pipe', fd], encoding:'utf8',
      timeout:Math.max(1, deadline-Date.now()), killSignal:'SIGKILL'});
    if (result.error?.code === 'ETIMEDOUT') return {code:75, reason:'admission-budget'};
    if (result.error) throw result.error;
    if (result.status === 75) return {code:75, reason:'controller-busy'};
    assert.equal(result.status, 0, 'Controller lock helper failed: '+result.stderr);
    return await work();
  } finally { closeSync(fd); }
}
