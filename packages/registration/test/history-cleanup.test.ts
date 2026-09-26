import assert from 'node:assert/strict';
import test from 'node:test';
import {parseHistoryCleanupPolicy} from '../src/history-cleanup.ts';

test('history cleanup policy accepts only explicit timezone-bearing category cutoffs', () => {
  const policy = parseHistoryCleanupPolicy({
    cutoffs: {
      sessions: '2026-01-02T03:04:05.000Z',
      backupTombstones: '2025-12-01T00:00:00+01:00',
    },
    chunkSize: 37,
  });
  assert.deepEqual(policy, {
    cutoffs: {
      sessions: '2026-01-02T03:04:05.000Z',
      backupTombstones: '2025-11-30T23:00:00.000Z',
    },
    chunkSize: 37,
  });
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.cutoffs), true);
  assert.equal('signupRequests' in policy.cutoffs, false);
});

test('history cleanup policy rejects ambiguous, unknown and unbounded input', () => {
  for (const value of [
    null, [], {}, {cutoffs: null}, {cutoffs: {}, extra: true},
    {cutoffs: {unknown: '2026-01-01T00:00:00Z'}},
    {cutoffs: {sessions: 1}},
    {cutoffs: {sessions: '2026-01-01'}},
    {cutoffs: {sessions: '2026-01-01T00:00:00'}},
    {cutoffs: {sessions: 'not-a-date'}},
    {cutoffs: {}, chunkSize: 0},
    {cutoffs: {}, chunkSize: 1001},
    {cutoffs: {}, chunkSize: 1.5},
  ]) assert.throws(() => parseHistoryCleanupPolicy(value), /Invalid history cleanup policy/);
});
