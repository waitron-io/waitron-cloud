import {mkdir, rmdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';

// Both drivers address one Docker project, regardless of checkout or temporary directory.
export async function withTestCloudProjectLock(run, lock = join(homedir(), '.local', 'state', 'waitron-cloud', 'test-project.lock')) {
  await mkdir(dirname(lock), {recursive: true, mode: 0o700});
  await mkdir(lock, {mode: 0o700});
  try {return await run();} finally {await rmdir(lock);}
}
