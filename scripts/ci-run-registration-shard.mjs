import assert from 'node:assert/strict';
import {readdirSync, realpathSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const measuredDurations = JSON.parse(readFileSync(new URL('./ci-registration-durations.json', import.meta.url), 'utf8'));

export function registrationFiles(shard, files, durations = measuredDurations) {
  assert.ok(Number.isSafeInteger(shard) && shard >= 1 && shard <= 6, 'Invalid registration shard');
  assert.ok(durations && typeof durations === 'object' && !Array.isArray(durations) && Object.values(durations).every(value => Number.isFinite(value) && value >= 0), 'Invalid registration duration');
  const known = files.filter(file => Object.hasOwn(durations, file));
  const mean = known.length ? known.reduce((sum, file) => sum + durations[file], 0) / known.length : 1;
  const estimate = file => durations[file] ?? mean;
  const ordered = [...files].sort((a, b) => estimate(b) - estimate(a) || (a < b ? -1 : a > b ? 1 : 0));
  const groups = Array.from({length: 6}, () => []);
  const totals = Array(6).fill(0);
  for (const file of ordered) {
    let lightest = 0;
    for (let index = 1; index < 6; index++) if (totals[index] < totals[lightest]) lightest = index;
    groups[lightest].push(file);
    totals[lightest] += estimate(file);
  }
  return groups[shard - 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/registration');
  const files = readdirSync(resolve(root, 'test')).filter(file => !file.startsWith('.') && file.endsWith('.test.ts'));
  const selected = registrationFiles(Number(process.argv[2]), files);
  assert.ok(selected.length > 0, 'Empty registration shard');
  process.chdir(root);
  process.execve(process.execPath, [process.execPath, '--test', '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=../../scripts/ci-required-cases.mjs', '--test-reporter-destination=stdout', '--test-timeout=30000', ...selected.map(file => `test/${file}`)], process.env);
}
