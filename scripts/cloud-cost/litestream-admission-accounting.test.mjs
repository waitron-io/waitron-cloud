import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter, createMeteringProxy, classifyStorageOperation } from './meter.mjs';
import { createLitestreamAfterStop, createLitestreamRequestAudit, createLitestreamTransport, litestreamAfterStopOutput } from './litestream.mjs';

const id = '11111111-2222-4333-8444-555555555555';
const bad = /Invalid cloud cost Litestream audit/;
const names = ['put', 'get', 'head', 'list', 'delete', 'delete-many', 'multipart-create', 'multipart-upload', 'multipart-complete', 'multipart-abort'];
const row = (operation, ordinal = 0) => ({ invocation: id, operation, ordinal });
const headers = ordinal => ({ 'amz-sdk-invocation-id': id, 'amz-sdk-request': `attempt=${ordinal + 1}; max=10` });
const stop = ledger => ledger.acknowledgeStop({ statusCode: 200, ownedPath: '/PRIVATE_CANARY',
  body: Buffer.from(JSON.stringify({ status: 'stopped', path: '/PRIVATE_CANARY', txid: 0 })) });
const admit = (ledger, operation, ordinal) => {
  ledger.issue(row(operation, ordinal));
  for (const hop of ['producer', 'observer']) ledger.admit({ ...row(operation, ordinal), hop, phase: 'workload' });
};
const settle = (ledger, operation, ordinal, statusCode = 200) => {
  for (const channel of ['producer', 'observer']) assert.doesNotThrow(() => ledger.settle({ token: `${id}:${ordinal + 1}`, channel, phase: 'workload',
    operation, retryOrdinal: ordinal, outcome: statusCode === 200 ? 'success' : 'server-error', statusCode,
    errorCode: null, sameAccount: null, bytesIn: 0, bytesOut: 0, attemptedBytesIn: 0, attemptedBytesOut: 0 }));
};

// Reinstating an operation/initial-only stop gate or counting two hops twice breaks these cases.
for (const operation of names) for (const ordinal of [0, 1]) {
  test(`bounded after-stop ${operation} attempt ${ordinal} retains actual work`, () => {
    const ledger = createLitestreamAfterStop({ clock: () => 0 });
    if (ordinal) { admit(ledger, operation, 0); settle(ledger, operation, 0, 503); }
    stop(ledger);
    assert.doesNotThrow(() => admit(ledger, operation, ordinal));
    settle(ledger, operation, ordinal);
    const result = ledger.snapshot();
    assert.equal(result.used, 1); assert.equal(result.lateAdmissions, 1); assert.equal(result.lateSettlements, operation === 'list' ? 0 : 1);
    assert.equal(result.requestsReconciled, true); assert.equal(result.bodiesReconciled, true);
    assert.equal(result.status, 'measured'); assert.deepEqual(result.gaps, []);
    assert.equal(result.producer.attempts, 1); assert.equal(result.observer.attempts, 1);
    assert.deepEqual(litestreamAfterStopOutput(result).afterStop, result);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY|11111111|invocation/);
  });
}

// Dropped earlier telemetry cannot prevent a later valid attempt or invent its missing requests.
for (const missing of ['none', 'issue', 'producer', 'observer']) test(`retry gaps in ${missing} retain unknown history`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 });
  if (missing !== 'issue') ledger.issue(row('put'));
  for (const hop of ['producer', 'observer']) if (missing !== hop) ledger.admit({ ...row('put'), hop, phase: 'workload' });
  settle(ledger, 'put', 0, 503); stop(ledger);
  assert.doesNotThrow(() => admit(ledger, 'put', 2)); settle(ledger, 'put', 2);
  const result = ledger.snapshot();
  assert.equal(result.used, 1); assert.equal(result.status, 'unknown');
  assert.deepEqual(result.gaps, ['accounting:incomplete-history']);
  assert.deepEqual(result.requests.map(r => [r.hop, r.retryOrdinal, r.attempts]), [['producer', 2, 1], ['observer', 2, 1]]);
  assert.deepEqual(litestreamAfterStopOutput(result).afterStop, result);
});

for (const operation of ['put', 'list']) test(`late ${operation} retries cannot bypass the three-request cap`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger);
  for (let ordinal = 0; ordinal < 3; ordinal++) { admit(ledger, operation, ordinal); settle(ledger, operation, ordinal); }
  assert.equal(ledger.snapshot().used, 3);
  assert.throws(() => admit(ledger, operation, 3), bad); assert.throws(() => ledger.snapshot(), bad);
});

for (const guard of ['duplicate', 'backwards', 'changed operation', 'decreased ordinal']) test(`retry history still refuses ${guard}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 });
  admit(ledger, 'put', 0); settle(ledger, 'put', 0, 503);
  if (guard === 'backwards') { admit(ledger, 'put', 1); settle(ledger, 'put', 1, 503); }
  if (guard === 'decreased ordinal') { admit(ledger, 'put', 2); settle(ledger, 'put', 2, 503); }
  assert.throws(() => ledger.issue(row(guard === 'changed operation' ? 'delete' : 'put', ['changed operation', 'decreased ordinal'].includes(guard) ? 1 : 0)), bad);
  assert.throws(() => ledger.snapshot(), bad);
});

for (const versioned of [false, true]) test(`actual late PUT commit remains independent storage evidence versioned=${versioned}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger); admit(ledger, 'put', 0);
  const finish = ledger.beginLifetime({ headers: headers(0), operation: 'put', versioned });
  assert.doesNotThrow(() => ledger.commit({ token: `${id}:1`, statusCode: 200, bytesOut: 0, expectedBytesOut: 0,
    requestComplete: true, versionId: versioned ? 'owned-version' : null, deleteMarker: null }));
  settle(ledger, 'put', 0);
  assert.deepEqual(finish({ statusCode: 200, bytesOut: 0, interrupted: false, responseHeaders: {} }),
    { statusCode: 200, interrupted: false, responseHeaders: versioned ? { 'x-amz-version-id': 'owned-version' } : {} });
  assert.equal(ledger.snapshot().used, 1); assert.equal(ledger.snapshot().status, 'measured');
});

const log = (method, path, ordinal) => Buffer.from(`SDK 2026/11/06 DEBUG Request\n${method} ${path} HTTP/1.1\namz-sdk-invocation-id: ${id}\namz-sdk-request: attempt=${ordinal + 1}; max=10\n\n`);
for (const stopped of [false, true]) for (const gap of [false, true]) for (const withLedger of [false, true]) {
  test(`real HTTP PUT forwards retry history stopped=${stopped} gap=${gap} ledger=${withLedger}`, { timeout: 3000 }, async t => {
    const ledger = withLedger ? createLitestreamAfterStop({ clock: () => 0 }) : undefined;
    const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop: ledger });
    const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop: ledger });
    const received = [];
    const backend = createServer((req, res) => {
      let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { received.push(body); res.end('four'); });
    });
    backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
    t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
    const observer = await createMeteringProxy({ target: `http://127.0.0.1:${backend.address().port}`, meter,
      classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
    t.after(() => observer.close().catch(() => {}));
    const front = await createLitestreamTransport({ target: observer.url, meter, phase: 'workload', afterStop: ledger });
    t.after(() => front.close().catch(() => {}));
    if (stopped && ledger) stop(ledger);
    const ordinal = gap ? 2 : 0;
    audit.write(log('PUT', '/bucket/object', ordinal));
    const result = await new Promise((resolve, reject) => {
      const req = request(front.url + '/bucket/object', { method: 'PUT', headers: { ...headers(ordinal), 'content-length': '4' } }, res => {
        let body = ''; res.on('data', chunk => body += chunk); res.on('error', reject); res.on('end', () => resolve([res.statusCode, body]));
      }); req.on('error', reject); req.end('data');
    });
    assert.deepEqual(result, [200, 'four']); await front.whenIdle(() => {});
    audit.end(); await front.close(); await observer.close();
    assert.deepEqual(received, ['data']); assert.equal(front.checkpoint().pending, 0);
    const snapshot = meter.snapshot();
    assert.equal(snapshot.status, gap ? 'unknown' : 'measured');
    assert.equal(snapshot.reconciled, true);
    assert.deepEqual(snapshot.accounting.producer, { attempts: 1, bytesIn: 4, bytesOut: 4 });
    assert.deepEqual(snapshot.accounting.observer, { attempts: 1, bytesIn: 4, bytesOut: 4 });
    assert.equal(snapshot.gaps.includes('accounting:incomplete-history'), gap);
    assert.equal(audit.snapshot().gaps.includes('accounting:incomplete-history'), gap);
    if (ledger) { assert.equal(ledger.snapshot().used, Number(stopped)); assert.deepEqual(litestreamAfterStopOutput(ledger.snapshot()).afterStop, ledger.snapshot()); }
  });
}
