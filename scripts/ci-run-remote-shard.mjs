import assert from 'node:assert/strict';
import {readdirSync, realpathSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Pin the long omission guard to job four to avoid stacking it onto job two.
// Other files, including new tests, retain Node's sorted round-robin allocation.
export function remoteFiles(shard, files) {
  assert.ok(Number.isSafeInteger(shard) && shard >= 1 && shard <= 4, 'Invalid remote shard');
  return [...files].sort().filter((file, index) =>
    (file === 'venue-service-remote-guards.test.ts' ? 4 : index % 4 + 1) === shard);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/remote-access');
  const files = readdirSync(resolve(root, 'test')).filter(file => !file.startsWith('.') && file.endsWith('.test.ts'));
  const selected = remoteFiles(Number(process.argv[2]), files);
  assert.ok(selected.length > 0, 'Empty remote shard');
  process.chdir(root);
  process.execve(process.execPath, [process.execPath, '--test', '--test-timeout=30000', ...selected.map(file => `test/${file}`)], process.env);
}
