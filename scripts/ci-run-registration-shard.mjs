import assert from 'node:assert/strict';
import {measuredShards} from './ci-measured-shards.mjs';
import {readdirSync, realpathSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const measuredDurations = JSON.parse(readFileSync(new URL('./ci-registration-durations.json', import.meta.url), 'utf8'));

export function registrationFiles(shard, files, durations = measuredDurations) {
  assert.ok(Number.isSafeInteger(shard) && shard >= 1 && shard <= 7, 'Invalid registration shard');
  return measuredShards(files, durations, 7, 'registration')[shard - 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/registration');
  const files = readdirSync(resolve(root, 'test')).filter(file => !file.startsWith('.') && file.endsWith('.test.ts'));
  const selected = registrationFiles(Number(process.argv[2]), files);
  assert.ok(selected.length > 0, 'Empty registration shard');
  process.chdir(root);
  process.execve(process.execPath, [process.execPath, '--test', '--test-concurrency=6', '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=../../scripts/ci-required-cases.mjs', '--test-reporter-destination=stdout', '--test-timeout=30000', ...selected.map(file => `test/${file}`)], process.env);
}
