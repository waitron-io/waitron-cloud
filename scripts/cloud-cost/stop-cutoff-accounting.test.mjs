import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLitestreamAfterStop, litestreamAfterStopOutput } from './litestream.mjs';
import { createMeter } from './meter.mjs';

const invocation = '11111111-2222-4333-8444-555555555555';
const operations = ['put', 'get', 'head', 'list', 'delete', 'delete-many', 'multipart-create',
  'multipart-upload', 'multipart-complete', 'multipart-abort'];
const ack = s => s.acknowledgeStop({ statusCode: 200, ownedPath: '/PRIVATE.db',
  body: Buffer.from('{"status":"stopped","path":"/PRIVATE.db","txid":0}') });
const interruption = () => ({ reason: 'transfer-interrupted', ioEvent: 'response-aborted',
  code: 'ECONNRESET', clientClosed: false, responseHeadersSeen: true });
function start(s, operation, id = invocation) {
  s.issue({ invocation: id, ordinal: 0, operation });
  for (const hop of ['producer', 'observer']) s.admit({ invocation: id, ordinal: 0, operation, hop, phase: 'workload' });
}
const event = (operation, channel, outcome, changes = {}) => ({ token: invocation + ':1', channel,
  phase: 'workload', operation, retryOrdinal: 0, outcome, statusCode: 200, errorCode: null, sameAccount: null,
  bytesIn: 2, bytesOut: 0, attemptedBytesIn: 8, attemptedBytesOut: 0, ...changes });

// A missing reply cannot become either a forwarding failure or a successful mutation witness.
for (const operation of operations) for (const stopped of [false, true]) for (const hop of ['producer', 'observer']) {
  test(`optional stop ledger collects ${operation} cutoff on ${hop}, stopped=${stopped}`, () => {
    const s = createLitestreamAfterStop({ clock: () => 0 }); start(s, operation); if (stopped) ack(s);
    for (const channel of ['observer', 'producer']) {
      const cutoff = channel === hop;
      assert.equal(s.settle(event(operation, channel, cutoff ? 'transport-error' : 'success'),
        cutoff && channel === 'producer' ? interruption() : null), cutoff);
    }
    const result = s.snapshot();
    assert.equal(result.status, 'unknown');
    assert.equal(result.used, stopped ? 1 : 0);
    assert.ok(result.gaps.length > 0);
    assert.deepEqual(litestreamAfterStopOutput(result).afterStop, result);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|11111111/);
  });
}

test('equal cutoff observations stay unknown in the enclosing request meter', () => {
  const afterStop = createLitestreamAfterStop({ clock: () => 0 }); start(afterStop, 'list');
  const meter = createMeter({ clock: () => 0, phase: 'workload', afterStop });
  meter.observeAttempt(event('list', 'producer', 'transport-error'), interruption());
  meter.observeAttempt(event('list', 'observer', 'transport-error'));
  const result = meter.snapshot();
  assert.equal(result.reconciled, true);
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.ok(result.gaps.includes('accounting:request-cutoff'));
  assert.equal(result.billing[0].quantity, null);
});

for (const operation of ['put', 'get', 'list', 'delete']) test(`four late ${operation} cutoffs still exceed the real stop bound`, () => {
  const s = createLitestreamAfterStop({ clock: () => 0 });
  const ids = [1, 2, 3, 4].map(n => `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`);
  for (const id of ids) start(s, operation, id);
  ack(s);
  for (const [i, id] of ids.entries()) {
    const finish = () => s.settle(event(operation, 'producer', 'transport-error', { token: id + ':1' }), interruption());
    if (i < 3) { assert.equal(finish(), true); s.settle(event(operation, 'observer', 'success', { token: id + ':1' })); }
    else { assert.throws(finish, /Invalid cloud cost Litestream audit/); assert.throws(() => s.snapshot()); }
  }
});

for (const [name, change] of [
  ['private-field', x => { x.path = 'PRIVATE'; }],
  ['unknown-event', x => { x.ioEvent = 'PRIVATE'; }],
  ['unknown-code', x => { x.code = 'PRIVATE'; }],
  ['unknown-reason', x => { x.reason = 'PRIVATE'; }],
  ['invalid-closed', x => { x.clientClosed = 'yes'; }],
  ['invalid-headers', x => { x.responseHeadersSeen = 1; }],
]) test(`optional stop cutoff still refuses malformed ${name}`, () => {
  const s = createLitestreamAfterStop({ clock: () => 0 }); start(s, 'get');
  const metadata = interruption(); change(metadata);
  assert.throws(() => s.settle(event('get', 'producer', 'transport-error'), metadata), /Invalid cloud cost Litestream audit/);
  assert.throws(() => s.snapshot());
});

test('missing commit witness never turns an interrupted PUT into a successful lifetime reply', () => {
  const s = createLitestreamAfterStop({ clock: () => 0 }); start(s, 'put');
  const finish = s.beginLifetime({ headers: { 'amz-sdk-invocation-id': invocation, 'amz-sdk-request': 'attempt=1; max=3' },
    operation: 'put', versioned: false });
  ack(s);
  s.settle(event('put', 'observer', 'success'));
  s.settle(event('put', 'producer', 'transport-error'), interruption());
  assert.deepEqual(finish({ statusCode: 200, bytesOut: 0, interrupted: true, responseHeaders: {} }),
    { statusCode: 200, responseHeaders: {}, interrupted: true });
  assert.equal(s.snapshot().status, 'unknown');
});

test('closed stop output pairs each retry with its own observed bytes', () => {
  const requests = [];
  for (const hop of ['producer', 'observer']) for (const [retryOrdinal, bytesIn] of [[0, 2], [1, 3]]) {
    requests.push({ hop, phase: 'workload', operation: 'list', retryOrdinal, outcome: 'success', attempts: 1,
      bytesIn, bytesOut: 0, attemptedBytesIn: bytesIn, attemptedBytesOut: 0 });
  }
  const record = { cap: 3, used: 2, lateAdmissions: 2, lateSettlements: 0, requests,
    producer: { attempts: 2, bytesIn: 5, bytesOut: 0 }, observer: { attempts: 2, bytesIn: 5, bytesOut: 0 },
    requestsReconciled: true, bodiesReconciled: true, status: 'measured', gaps: [] };
  assert.deepEqual(litestreamAfterStopOutput(record).afterStop, record);
});
