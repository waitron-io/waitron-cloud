import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter, createMeteringProxy } from './meter.mjs';
import { assessAccounting } from './accounting-policy.mjs';

const attempt = (token, changes = {}) => ({ token, channel: 'producer', phase: 'workload', operation: 'put',
  retryOrdinal: 0, outcome: 'success', statusCode: 200, errorCode: null, sameAccount: true,
  bytesIn: 0, bytesOut: 4, attemptedBytesIn: 0, attemptedBytesOut: 4, ...changes });
const paired = (meter, event) => {
  meter.observeAttempt(event); meter.observeAttempt({ ...event, channel: 'observer' });
};
const fresh = () => createMeter({ phase: 'workload', clock: () => 0 });
const phases = ['setup', 'startup', 'workload', 'idle', 'verification', 'restore', 'observer', 'cleanup'];

// Agreement on the same partial observation is not proof of a complete transfer.
for (const [index, operation] of ['put', 'get', 'head', 'list', 'delete', 'delete-many',
  'bucket-create', 'bucket-delete', 'bucket-inspect', 'bucket-configure', 'multipart-create',
  'multipart-upload', 'multipart-complete', 'multipart-abort', 'remote', 'email', 'fiscal', 'kms'].entries()) {
  test(`paired cutoff remains unknown for ${operation} in ${phases[index % phases.length]}`, () => {
    const meter = fresh(), phase = phases[index % phases.length];
    paired(meter, attempt('PRIVATE_CUTOFF', { phase, operation, outcome: 'transport-error', bytesOut: 2 }));
    const result = meter.snapshot();
    assert.equal(result.status, 'unknown');
    assert.equal(result.reconciled, true, 'the diagnostic ledgers really do agree');
    assert.deepEqual(result.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
    assert.deepEqual(result.gaps, ['accounting:request-cutoff', 'request-billing:unknown']);
    assert.deepEqual(result.billing, [{ phase, requestClass: result.accounting.requests[0].requestClass,
      quantity: null, status: 'unknown' }]);
    assert.equal(result.accounting.producer.bytesOut, 2, 'retain the actual observation');
    assert.equal(result.accounting.requests[0].attemptedBytesOut, 4);
    assert.equal(result.accounting.requests[0].outcome, 'transport-error');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  });
}

for (const channel of ['producer', 'observer']) test(`a cutoff on the ${channel} cannot borrow another request's billing`, () => {
  const meter = fresh(), event = attempt('cutoff', { phase: 'startup' });
  meter.observeAttempt({ ...event, outcome: channel === 'producer' ? 'transport-error' : 'success' });
  meter.observeAttempt({ ...event, channel: 'observer', outcome: channel === 'observer' ? 'transport-error' : 'success' });
  paired(meter, attempt('same-class', { phase: 'startup' }));
  paired(meter, attempt('independent', { phase: 'restore', operation: 'get' }));
  const result = meter.snapshot();
  assert.ok(result.gaps.includes('accounting:request-cutoff'));
  assert.equal(result.reconciled, false);
  assert.deepEqual(result.billing, [
    { phase: 'startup', requestClass: 's3-write', quantity: null, status: 'unknown' },
    { phase: 'restore', requestClass: 's3-read', quantity: 1, status: 'measured' }]);
  assert.equal(result.accounting.producer.attempts, 3);
  assert.equal(result.accounting.observer.attempts, 3);
  assert.equal(meter.diagnostics().firstInvalidation, null);
});

for (const statusCode of [null, 200, 403, 503]) test(`a cutoff status ${statusCode} cannot certify a billing quantity`, () => {
  const meter = fresh();
  paired(meter, attempt('cutoff', { outcome: 'transport-error', statusCode }));
  assert.equal(meter.snapshot().billing[0].quantity, null);
  assert.equal(meter.snapshot().status, 'unknown');
  assert.ok(meter.snapshot().gaps.includes('accounting:request-cutoff'));
});

test('later valid requests and detached snapshots cannot erase an original cutoff', () => {
  const meter = fresh();
  paired(meter, attempt('cutoff', { outcome: 'transport-error' }));
  const before = meter.snapshot(); before.gaps.length = 0; before.accounting.requests[0].outcome = 'success';
  paired(meter, attempt('valid', { operation: 'get' }));
  const result = meter.snapshot();
  assert.equal(result.status, 'unknown');
  assert.equal(result.accounting.requests[0].outcome, 'transport-error');
  assert.ok(result.gaps.includes('accounting:request-cutoff'));
  assert.deepEqual(result.billing, [
    { phase: 'workload', requestClass: 's3-write', quantity: null, status: 'unknown' },
    { phase: 'workload', requestClass: 's3-read', quantity: 1, status: 'measured' }]);
});

// Removing labels or changing a top-level status must not fool the independent export assessor.
for (const scope of ['requests', 'restore', 'administration', 'storage', 'fiscal']) {
  test(`original ${scope} cutoff outcomes independently prevent publication after summary labels are erased`, () => {
    const sources = ['requests', 'restore', 'administration', 'storage'].map(scope => {
      const meter = fresh(); paired(meter, attempt('clean')); return { scope, record: meter.snapshot() };
    });
    const fiscal = scope === 'fiscal';
    if (fiscal) {
      const meter = fresh(); paired(meter, attempt('fiscal', { operation: 'fiscal' }));
      sources.push({ scope: 'fiscal', record: meter.snapshot() });
      sources.push({ scope: 'mail', record: { status: 'measured', scope: 'captured-mail-operations', reconciled: true,
        producer: { attempts: 0, accepted: 0, refused: 0, retried: 0 },
        observer: { attempts: 0, accepted: 0, refused: 0 },
        discrepancy: { attempts: 0, accepted: 0, refused: 0 }, operations: [],
        billing: { quantity: null, status: 'unknown' } } });
    }
    const record = sources.find(source => source.scope === scope).record;
    for (const rows of [record.accounting.requests, record.observedRequests]) {
      rows[0].outcome = 'transport-error'; rows[0].successful = 0; rows[0].failed = 1;
    }
    record.gaps = [];
    assert.equal(record.status, 'measured'); assert.deepEqual(record.gaps, []);
    const result = assessAccounting({ producer: fiscal ? 'service' : 'local-stream', sources });
    assert.deepEqual(result, { status: 'unknown',
      gaps: ['accounting:request-cutoff', 'request-billing:unknown'], publicationEligible: false });
  });
}

for (const side of ['request', 'response']) test(`a real ${side} body cutoff records a nonfatal gap and collects its proxy`, async t => {
  let entered, observed;
  const active = new Promise(resolve => { entered = resolve; });
  const settled = new Promise(resolve => { observed = resolve; });
  const backend = createServer((req, res) => {
    req.on('error', () => {}); req.resume();
    if (side === 'request') entered();
    else { res.writeHead(200, { 'content-length': '20' }); res.write('partial'); entered(); }
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = fresh(), events = [];
  const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`,
    meter: { ...meter, observeAttempt: event => { meter.observeAttempt(event); events.push(event); observed(); } },
    classify: () => ({ token: 'PRIVATE_CUTOFF', phase: 'workload', operation: side === 'request' ? 'put' : 'get',
      retryOrdinal: 0, errorCode: null, sameAccount: null }) });
  t.after(() => proxy.close());
  const caller = request(proxy.url + '/PRIVATE_CANARY', { method: side === 'request' ? 'PUT' : 'GET',
    headers: side === 'request' ? { 'content-length': '20' } : {} });
  caller.on('error', () => {}); caller.on('response', response => { response.on('error', () => {}); response.resume(); });
  const closed = new Promise(resolve => caller.once('close', resolve));
  if (side === 'request') caller.write('partial'); else caller.end();
  await active;
  if (side === 'request') caller.destroy(); else backend.closeAllConnections();
  await settled; await closed; await proxy.close();
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'transport-error');
  const result = meter.snapshot();
  assert.equal(result.status, 'unknown');
  assert.ok(result.gaps.includes('accounting:request-cutoff'));
  assert.equal(meter.diagnostics().pendingAttempts, 0);
  assert.equal(meter.diagnostics().firstInvalidation, null);
  assert.equal(result.accounting.observer.attempts, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
