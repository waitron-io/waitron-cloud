import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { jointFixture } from './fixtures/fiscal-waitron.ts';

let f: Awaited<ReturnType<typeof jointFixture>>;
before(async () => { f = await jointFixture(); }, { timeout: 120000 });
after(async () => { await f?.close(); });

test('pinned Waitron client reads the exact consumed Cloud receipt and all three purposes', async () => {
  const result = await f.call('status', {});
  assert.deepEqual(result, { version: 1, state: 'recorded', receipt: f.receipt });
  assert.deepEqual(f.receipt.payload.allocation.series, [
    { code: 'A-C000001', purpose: 'standard' },
    { code: 'FF-C000001', purpose: 'full' },
    { code: 'R-C000001', purpose: 'rectificative' },
  ]);
});
test('Cloud signed manual packet verifies independently in the pinned Waitron module', async () => {
  const result = await f.call('verify', {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.allocation, f.receipt.payload.allocation);
  assert.deepEqual(result.approval, f.receipt.payload.approval);
});
for (const field of ['sourceId', 'targetNodeId', 'eventId', 'operatorId'] as const)
  test(`Waitron refuses a Cloud packet substituted at its local ${field} boundary`, async () => {
    assert.equal((await f.call('verify', { field })).ok, false);
  });
test('Waitron refuses a consumed Cloud packet when its full-purpose snapshot changes', async () => {
  assert.deepEqual(await f.call('verify', { field: 'requiredBases' }), { ok: false, reason: 'series_mismatch' });
});
test('Waitron refuses a genuine Cloud receipt without independently enrolled signer trust', async () => {
  assert.deepEqual(await f.call('verify', { field: 'trust' }), { ok: false, reason: 'reservation_untrusted' });
});
test('Waitron refuses a reserved Cloud packet as local activation authority', async () => {
  assert.deepEqual(await f.call('verify', { field: 'reserved' }), { ok: false, reason: 'reservation_not_consumed' });
});
test('pinned Waitron client retains read access after entitlement ends', async () => {
  await f.cloud.f.pool.query('UPDATE fiscal_test_authority SET entitlement=false');
  try {
    assert.deepEqual(await f.call('status', {}), { version: 1, state: 'recorded', receipt: f.receipt });
  } finally { await f.cloud.f.pool.query('UPDATE fiscal_test_authority SET entitlement=true'); }
});
test('real Cloud session and CSRF refusals reach the pinned Waitron client', async () => {
  const before = f.responses?.length ?? 0;
  for (const field of ['cookie', 'csrfToken'])
    assert.deepEqual(await f.call('status', { field }), { error: 'cloud.unavailable' });
  assert.deepEqual(f.responses?.slice(before) ?? [], [
    { path: '/api/account/fiscal-allocations/status', status: 401 },
    { path: '/api/account/fiscal-allocations/status', status: 403 },
  ]);
});
test('Cloud receipt activates through Waitron manual preparation and reports its committed result once', async () => {
  const result = await f.call('activate', {});
  assert.deepEqual(result.series, f.receipt.payload.allocation.series);
  assert.deepEqual(result.operatorId, f.receipt.payload.binding.operatorId);
  assert.equal(result.localAllocations, 1);
  assert.deepEqual(result.report, { version: 1, state: 'matched', receiptId: f.receipt.payload.receiptId });
  assert.deepEqual(result.repeated, result.report);
  assert.equal(result.requests, 1);
  assert.equal(result.secretInJournal, false);
  assert.equal((await f.cloud.f.pool.query("SELECT count(*)::int AS n FROM fiscal_registry_events WHERE action='report'")).rows[0].n, 1);
});
test('Waitron journal refuses changed report evidence without replacing the Cloud result', async () => {
  const result = await f.call('conflict', {});
  assert.equal(result.error, 'cloud.binding_conflict');
  assert.deepEqual(result.repeated, { version: 1, state: 'matched', receiptId: f.receipt.payload.receiptId });
  assert.equal(result.requests, 0);
});

test('Waitron refuses an altered signature on an otherwise unchanged genuine Cloud receipt', async () => {
  assert.deepEqual(await f.call('verify', { field: 'signature' }), { ok: false, reason: 'reservation_untrusted' });
});
test('lost real Cloud report reply reuses the same operation with renewed machine authentication', async () => {
  const result = await f.call('lostReport', {});
  assert.equal(result.firstError, 'cloud.unavailable');
  assert.deepEqual(result.recovered, { version: 1, state: 'matched', receiptId: f.receipt.payload.receiptId });
  assert.equal(result.requests, 2);
  assert.equal(result.authentications, 2);
  assert.equal(result.sameOperation, true);
  assert.equal((await f.cloud.f.pool.query("SELECT count(*)::int AS n FROM fiscal_registry_events WHERE action='report'")).rows[0].n, 2);
});
