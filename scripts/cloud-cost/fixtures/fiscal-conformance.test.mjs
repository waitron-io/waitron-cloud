// Explicit local PostgreSQL integration; all authority, venue and session state is generated here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fiscalHttpFixture } from '../../../packages/account-http/test/fiscal-http-fixture.ts';
import { openFiscalMeasurement } from '../local.mjs';

test('genuineFiscalHttpScenarioCountsReserveReplayConsumeStatusListAndSignedReport', async t => {
  const s = await fiscalHttpFixture();
  let run;
  try {
    run = await openFiscalMeasurement({ target: `http://127.0.0.1:${s.port}`, clock: () => performance.now() / 1000,
      credentials: { cookie: `cloud_session=${s.v.session.token}`, csrfToken: s.v.session.csrfToken } });
    let bytesOut = 0, bytesIn = 0;
    const call = async (action, body, expectedStatus = 200) => {
      bytesOut += Buffer.byteLength(JSON.stringify(body));
      const response = await run.request(action, body);
      assert.equal(response.statusCode, expectedStatus); bytesIn += response.body.length;
      return JSON.parse(response.body);
    };
    const reserved = await call('reserve', s.v.input);
    assert.equal(reserved.payload.state, 'reserved');
    assert.equal(JSON.stringify(await call('reserve', s.v.input)) === JSON.stringify(reserved), true, 'idempotent replay retains its exact signed receipt');
    const consume = { version: 1, operationId: randomUUID(), allocationId: reserved.payload.allocation.allocationId,
      binding: s.v.input.binding, oldMachineOffline: true, oldMachineAbsent: false, noParallelRecovery: true,
      confirmedAt: new Date().toISOString() };
    const consumed = await call('consume', consume);
    assert.equal(consumed.payload.state, 'consumed');
    const status = await call('status', { version: 1, venueId: s.v.id, operationId: consume.operationId });
    assert.equal(status.state, 'recorded');
    assert.equal(JSON.stringify(status.receipt) === JSON.stringify(consumed), true);
    const listed = await call('list', { version: 1, venueId: s.v.id, cursor: null, limit: 50 });
    assert.equal(listed.items.length, 1); assert.equal(listed.nextCursor, null);
    assert.equal(JSON.stringify(listed.items[0]) === JSON.stringify(consumed), true);
    const report = await call('report', s.proof({ venueId: s.v.id, scope: s.v.input.scope, receipt: consumed,
      paperHistory: null, activationEvidence: { eventId: s.v.input.binding.eventId, result: 'committed' } }));
    assert.equal(report.state, 'matched'); assert.equal(report.receiptId === consumed.payload.receiptId, true);
    await call('reserve', { unexpected: true }, 400);
    await run.close();
    const snapshot = run.snapshot();
    assert.equal(snapshot.status, 'measured'); assert.equal(snapshot.reconciled, true);
    assert.deepEqual(snapshot.accounting.producer, { attempts: 7, bytesIn, bytesOut });
    assert.deepEqual(snapshot.accounting.observer, snapshot.accounting.producer);
    assert.deepEqual(snapshot.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
    assert.deepEqual(snapshot.accounting.requests.map(r => [r.operation, r.outcome, r.retryOrdinal, r.attempts]),
      [['fiscal', 'success', 0, 6], ['fiscal', 'client-error', 0, 1]]);
    assert.equal(snapshot.billing[0].status, 'unknown');
    const serialized = JSON.stringify(snapshot);
    assert.equal([s.v.id, s.v.account, s.v.session.token, s.v.input.scope.taxpayerId, 'payload', 'signature', '127.0.0.1']
      .filter(value => typeof value === 'string' && value.length > 0).some(value => serialized.includes(value)), false);
    const events = (await s.a.request('history', { scope: s.v.input.scope, afterSequence: '0', nonce: 'test' })).events;
    assert.deepEqual(events.map(event => event.action), ['reserve', 'consume', 'report']);
    assert.equal((await s.f.pool.query('SELECT c_high_water FROM fiscal_registry_scopes')).rows[0].c_high_water, 1,
      'replaying and inspecting the reservation must not allocate another name');
    t.diagnostic(JSON.stringify({ scope: 'cloud-fiscal-api-http-bodies', snapshot }));
  } finally { await run?.close().catch(() => {}); await s.close(); }
});

test('genuineFiscalHttpRefusedSessionHasMeasuredBytesAndNoAuthorityMutation', async () => {
  const s = await fiscalHttpFixture();
  let run;
  try {
    run = await openFiscalMeasurement({ target: `http://127.0.0.1:${s.port}`, clock: () => performance.now() / 1000 });
    const response = await run.request('reserve', s.v.input);
    assert.equal(response.statusCode, 401);
    assert.equal(JSON.parse(response.body).error, 'unauthenticated');
    await run.close();
    const snapshot = run.snapshot();
    assert.equal(snapshot.reconciled, true);
    assert.equal(snapshot.accounting.producer.attempts, 1);
    assert.equal(snapshot.accounting.producer.bytesOut, Buffer.byteLength(JSON.stringify(s.v.input)));
    assert.equal(snapshot.accounting.producer.bytesIn, response.body.length);
    assert.equal((await s.a.request('history', { scope: s.v.input.scope, afterSequence: '0', nonce: 'test' })).events.length, 0);
  } finally { await run?.close().catch(() => {}); await s.close(); }
});
