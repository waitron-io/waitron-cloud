import assert from 'node:assert/strict';
import {measuredShards} from './ci-measured-shards.mjs';
import {readdirSync, realpathSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const measuredDurations = JSON.parse(readFileSync(new URL('./ci-portal-durations.json', import.meta.url), 'utf8'));

export function portalFiles(shard, files, durations = measuredDurations) {
  assert.ok(Number.isSafeInteger(shard) && shard >= 1 && shard <= 6, 'Invalid portal shard');
  return measuredShards(files, durations, 6, 'portal')[shard - 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/portal');
  const files = readdirSync(resolve(root, 'test')).filter(file => !file.startsWith('.') && file.endsWith('.test.ts'));
  const selected = portalFiles(Number(process.argv[2]), files);
  assert.ok(selected.length > 0, 'Empty portal shard');
  process.chdir(root);
  process.execve(process.execPath, [process.execPath, '--test', '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=../../scripts/ci-required-cases.mjs', '--test-reporter-destination=stdout', '--test-timeout=120000', ...selected.map(file => `test/${file}`)], process.env);
}
