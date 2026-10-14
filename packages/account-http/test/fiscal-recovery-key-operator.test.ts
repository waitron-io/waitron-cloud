import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fiscalHttpFixture } from './fiscal-http-fixture.ts';
import { decodeReceipt, encodeReceipt } from '../../fiscal-allocation/src/evidence.ts';

for (const form of ['person', 'recovery-key'] as const) test(`real HTTP preserves ${form} operator through reserve, consume and retained list`, async () => {
  const f = await fiscalHttpFixture();
  try {
    const operatorId = form === 'person' ? 'local-administrator' : { kind: 'recovery-key', nodeId: 'replacement-node', eventId: 'restore-event' };
    const binding = { ...f.v.input.binding, targetNodeId: 'replacement-node', eventId: 'restore-event', operatorId };
    const reservedResponse = await f.request('reserve', { ...f.v.input, binding });
    assert.equal(reservedResponse.status, 200);
    const reserved = await reservedResponse.json();
    assert.deepEqual(reserved.payload.binding, binding);
    assert.equal(reserved.payload.cloudAccountId, f.v.account);
    const input = { version: 1, operationId: randomUUID(), allocationId: reserved.payload.allocation.allocationId,
      binding, oldMachineOffline: true, oldMachineAbsent: false, noParallelRecovery: true, confirmedAt: new Date().toISOString() };
    const response = await f.request('consume', input);
    assert.equal(response.status, 200);
    const consumed = await response.json();
    assert.deepEqual(consumed.payload.approval.operatorId, operatorId);
    assert.deepEqual(decodeReceipt(encodeReceipt(consumed), f.options.trust!).payload.binding, binding);
    const page = await (await f.request('list', { version: 1, venueId: f.v.id, cursor: null, limit: 50 })).json();
    assert.deepEqual(page.items[0], consumed);
    const bad = await f.request('reserve', { ...f.v.input, operationId: randomUUID(), binding: { ...binding, operatorId: { kind: 'recovery-key', nodeId: 'replacement-node', eventId: 'restore-event', secret: 'forbidden' } } });
    assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), { error: 'invalid_input' });
    assert.equal((await f.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_allocations')).rows[0].n, 1);
  } finally { await f.close(); }
});
