import assert from 'node:assert/strict';
import {readdirSync, realpathSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// These database-heavy files leave the two slow groups; unlisted files retain
// Node's sorted round-robin allocation, including newly discovered files.
const destinations = new Map([
  ['monitoring.test.ts', 1],
  ['support-grants.test.ts', 2],
  ['venue-service-legacy-schema-guards.test.ts', 1],
]);

export function registrationFiles(shard, files) {
  assert.ok(Number.isSafeInteger(shard) && shard >= 1 && shard <= 6, 'Invalid registration shard');
  return [...files].sort().filter((file, index) => (destinations.get(file) ?? index % 6 + 1) === shard);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/registration');
  const files = readdirSync(resolve(root, 'test')).filter(file => !file.startsWith('.') && file.endsWith('.test.ts'));
  const selected = registrationFiles(Number(process.argv[2]), files);
  assert.ok(selected.length > 0, 'Empty registration shard');
  process.chdir(root);
  process.execve(process.execPath, [process.execPath, '--test', '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=../../scripts/ci-required-cases.mjs', '--test-reporter-destination=stdout', '--test-timeout=30000', ...selected.map(file => `test/${file}`)], process.env);
}
