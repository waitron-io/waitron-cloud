import assert from 'node:assert/strict';

export function measuredShards(files, durations, count, name) {
  assert.ok(durations && typeof durations === 'object' && !Array.isArray(durations) && Object.values(durations).every(value => Number.isFinite(value) && value >= 0), `Invalid ${name} duration`);
  const known = files.filter(file => Object.hasOwn(durations, file));
  const mean = known.length ? known.reduce((sum, file) => sum + durations[file], 0) / known.length : 1;
  const estimate = file => durations[file] ?? mean;
  const ordered = [...files].sort((a, b) => estimate(b) - estimate(a) || (a < b ? -1 : a > b ? 1 : 0));
  const groups = Array.from({length: count}, () => []);
  const totals = Array(count).fill(0);
  for (const file of ordered) {
    let lightest = 0;
    for (let index = 1; index < count; index++) if (totals[index] < totals[lightest]) lightest = index;
    groups[lightest].push(file);
    totals[lightest] += estimate(file);
  }
  return groups;
}
