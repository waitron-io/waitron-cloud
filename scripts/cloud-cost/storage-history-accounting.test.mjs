import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageHistorySnapshot } from './storage-lifetimes.mjs';
import { createMeter } from './meter.mjs';
import { assessAccounting } from './accounting-policy.mjs';

const record = () => ({ scope: 'unversioned-object-history', windowSeconds: 1,
  objects: { class: 'stream', bytes: 1, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
  byteSeconds: { low: 0.25, high: 0.5 } });
const meter = () => createMeter({ phase: 'workload', clock: () => 0 });

// Fractional object bytes are malformed; a valid aggregate exceeding the range is uncertain.
test('fractionalDerivedObjectSizeStillRefusesInsteadOfBecomingMeasuredOrUnknown', () => {
  const input = record(); input.objects.bytes = 0.5;
  assert.throws(() => storageHistorySnapshot(input, meter(), new Set()), /Invalid cloud cost storage lifetimes/);
});

// An unsafe integral, including an infinite aggregate, never becomes published evidence.
for (const [label, values, want, gaps] of [
  ['fractional', { low: 0.25, high: 0.5 }, { low: 0.25, high: 0.5 }, []],
  ['upper', { low: 1, high: Infinity }, { low: 1, high: null }, ['accounting:overflow', 'accounting:incomplete-history']],
  ['both', { low: Infinity, high: Infinity }, { low: null, high: null }, ['accounting:overflow', 'accounting:incomplete-history']],
]) test(`originalLifetimeAssessmentKeepsSupportedBounds_${label}`, () => {
  const input = record(); input.byteSeconds = values;
  const result = storageHistorySnapshot(input, meter(), new Set());
  assert.deepEqual(result.byteSeconds, want);
  const sources = ['requests', 'restore', 'administration'].map(scope => ({ scope, record: meter().snapshot() }));
  sources.push({ scope: 'storage', record: result });
  assert.deepEqual(assessAccounting({ producer: 'local-stream', sources }), {
    status: gaps.length ? 'unknown' : 'measured', gaps: [...gaps].sort(), publicationEligible: gaps.length === 0 });
});

for (const [name, change] of [
  ['negative-bytes', r => { r.objects.bytes = -1; }],
  ['null-bytes', r => { r.objects.bytes = null; }],
  ['nan-bytes', r => { r.objects.bytes = NaN; }],
  ['infinite-bytes', r => { r.objects.bytes = Infinity; }],
  ['negative-bounds', r => { r.byteSeconds = { low: -2, high: -1 }; }],
  ['reversed-bounds', r => { r.byteSeconds = { low: 2, high: 1 }; }],
  ['nan-bounds', r => { r.byteSeconds.low = NaN; }],
  ['null-bounds', r => { r.byteSeconds.low = null; }],
]) test(`invalidLifetimeAggregateStillRefuses_${name}`, () => {
  const input = record(); change(input);
  assert.throws(() => storageHistorySnapshot(input, meter(), new Set()), /Invalid cloud cost storage lifetimes/);
});
