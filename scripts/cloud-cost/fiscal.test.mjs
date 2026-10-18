import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import * as local from './local.mjs';

const bad = /Invalid cloud cost fiscal measurement/;
async function fixture(t, handler) {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++; req.resume(); req.on('end', () => handler(req, res, calls));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { target: `http://127.0.0.1:${server.address().port}`, calls: () => calls };
}
async function open(t, args) {
  assert.equal(typeof local.openFiscalMeasurement, 'function', 'measure real local fiscal HTTP independently');
  const run = await local.openFiscalMeasurement({ clock: () => 0, ...args });
  t.after(() => run.close().catch(() => {}));
  return run;
}

// Omitting failed/retried bodies or deriving both channels from the client changes these literal totals.
test('fiscalAttemptsReconcileIndependentBodyCountsIncludingRetryAndDenial', async t => {
  const f = await fixture(t, (req, res, n) => { res.writeHead(n === 1 ? 503 : n === 3 ? 403 : 200); res.end(n === 1 ? 'no' : 'four'); });
  const run = await open(t, { target: f.target });
  const result = await run.request('reserve', { x: 1 });
  assert.equal(result.statusCode, 200); assert.equal(result.body.toString(), 'four');
  assert.equal((await run.request('list', { x: 1 })).statusCode, 403);
  await run.close(); await run.close();
  const snapshot = run.snapshot();
  assert.equal(snapshot.status, 'measured'); assert.equal(snapshot.reconciled, true);
  assert.deepEqual(snapshot.accounting.producer, { attempts: 3, bytesIn: 10, bytesOut: 21 });
  assert.deepEqual(snapshot.accounting.observer, snapshot.accounting.producer);
  assert.deepEqual(snapshot.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.deepEqual(snapshot.accounting.requests.map(r => [r.operation, r.outcome, r.retryOrdinal, r.attempts]),
    [['fiscal', 'server-error', 0, 1], ['fiscal', 'success', 1, 1], ['fiscal', 'client-error', 0, 1]]);
  assert.deepEqual(snapshot.billing, [{ phase: 'workload', requestClass: 'fiscal', quantity: null, status: 'unknown' }]);
  assert.throws(() => run.request('reserve', {}), bad);
  assert.throws(() => run.snapshot(), bad, 'invalid reuse poisons an earlier successful measurement');
});

// A transport may only reach the named local fixture, never an Internet host, redirect or caller path.
test('fiscalAdmissionRejectsExternalEndpointsAndUnrecognisedActionsBeforeProviderAccess', async t => {
  assert.equal(typeof local.openFiscalMeasurement, 'function');
  for (const target of ['https://127.0.0.1:42', 'http://example.test:42', 'http://localhost:42',
    'http://127.0.0.1:42/private', 'http://user:password@127.0.0.1:42', 'http://127.0.0.1:42/?private', 'http://127.0.0.1:42/#private'])
    await assert.rejects(local.openFiscalMeasurement({ target, clock: () => 0 }), bad);
  const f = await fixture(t, (_req, res) => res.end('four'));
  for (const action of ['../reserve', '/reserve', 'reserve?private', 'unknown']) {
    const run = await open(t, { target: f.target });
    assert.throws(() => run.request(action, {}), bad);
    assert.throws(() => run.snapshot(), bad);
  }
  assert.equal(f.calls(), 0);
});

// Private payloads/headers must never enter anonymous counters or errors, including refusal paths.
test('fiscalPayloadAndCredentialsStayPrivateAndNoRedirectIsFollowed', async t => {
  const canary = 'PRIVATE_FISCAL_CANARY';
  const f = await fixture(t, (req, res) => {
    assert.equal(req.headers.host, 'localhost');
    assert.equal(req.headers.origin, 'http://localhost');
    assert.equal(req.headers.cookie, canary);
    res.writeHead(302, { location: 'http://example.test/private' }); res.end(canary);
  });
  const run = await open(t, { target: f.target, credentials: { cookie: canary, csrfToken: canary } });
  assert.equal((await run.request('reserve', { canary })).statusCode, 302);
  await run.close();
  assert.equal(f.calls(), 1); assert.equal(JSON.stringify(run.snapshot()).includes(canary), false);
  const other = await open(t, { target: f.target });
  assert.throws(() => other.request('reserve', { toJSON() { throw Error(canary); } }), error => bad.test(error.message) && !error.message.includes(canary));
});

// Unbounded retries, payloads and deadlines must be refused before a request leaves the client.
test('fiscalBoundsAndHeaderAdmissionFailBeforeOpeningTheProxy', async () => {
  assert.equal(typeof local.openFiscalMeasurement, 'function');
  const args = { target: 'http://127.0.0.1:42', clock: () => 0 };
  for (const change of [{ maxAttempts: 0 }, { maxAttempts: 4 }, { maxAttempts: 1.5 }, { timeoutMs: 0 },
    { timeoutMs: 30001 }, { timeoutMs: 0.5 }, { credentials: { cookie: 'x', csrfToken: 'x', host: 'example.test' } },
    { credentials: { cookie: 'x\r\nother: raw', csrfToken: 'x' } }, { credentials: { cookie: 'x'.repeat(8193), csrfToken: 'x' } },
    { clock: null }, { clock: () => NaN }])
    await assert.rejects(local.openFiscalMeasurement({ ...args, ...change }), bad);
});

// A retry ceiling is counted physically, never one logical call or an unbounded retry loop.
test('fiscalRetryCeilingCountsEveryFailedPhysicalAttempt', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(503); res.end('four'); });
  const run = await open(t, { target: f.target, maxAttempts: 3 });
  assert.equal((await run.request('status', {})).statusCode, 503);
  await run.close();
  assert.deepEqual(run.snapshot().accounting.producer, { attempts: 3, bytesIn: 12, bytesOut: 6 });
  assert.deepEqual(run.snapshot().accounting.requests.map(r => r.retryOrdinal), [0, 1, 2]);
});

// A hanging or interrupted request must not turn into a complete measured transfer.
test('fiscalTimeoutCancellationAndOversizedResponsesPoisonMeasurement', async t => {
  for (const mode of ['timeout', 'signal', 'close', 'oversize', 'interrupted']) {
    let admitted;
    const ready = new Promise(resolve => { admitted = resolve; });
    const f = await fixture(t, (_req, res) => {
      admitted();
      if (mode === 'oversize') res.end(Buffer.alloc(1048577));
      if (mode === 'interrupted') { res.writeHead(200, { 'content-length': 100 }); res.write('four'); setImmediate(() => res.destroy()); }
    });
    const controller = new AbortController();
    const run = await open(t, { target: f.target, timeoutMs: 50, signal: controller.signal });
    const pending = assert.rejects(run.request('reserve', {}), bad);
    await ready;
    assert.throws(() => run.snapshot(), bad);
    if (mode === 'signal') controller.abort();
    if (mode === 'close') await run.close().catch(() => {});
    await pending;
    await assert.rejects(run.close(), bad);
    assert.throws(() => run.snapshot(), bad);
  }
});

// An unclassified request through the observer must be refused before touching the provider.
test('fiscalObserverRefusesUnpairedTrafficAndInvalidatesTheWholeMeasurement', async t => {
  const f = await fixture(t, (_req, res) => res.end('four'));
  const run = await open(t, { target: f.target });
  const status = await new Promise((resolve, reject) => {
    const req = request(run.url + '/api/account/fiscal-allocations/reserve', { method: 'POST' }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject); req.end('{}');
  });
  assert.equal(status, 400); assert.equal(f.calls(), 0);
  await assert.rejects(run.close(), bad); assert.throws(() => run.snapshot(), bad);
});

// Overlapping calls cannot hide unfinished work behind a successful snapshot.
test('fiscalPendingCallsAndOversizedPayloadsCannotProduceEvidence', async t => {
  const f = await fixture(t, (_req, res) => res.end('four'));
  const run = await open(t, { target: f.target });
  assert.throws(() => run.snapshot(), bad, 'only a closed transport qualifies');
  assert.throws(() => run.request('reserve', { raw: 'x'.repeat(16384) }), bad);
  assert.equal(f.calls(), 0); assert.throws(() => run.snapshot(), bad);
});

// Adding browser credentials to a signed machine report changes the real route's security semantics.
test('fiscalMachineReportOmitsBrowserOriginSessionAndCsrfHeaders', async t => {
  const f = await fixture(t, (req, res) => {
    const machine = req.url === '/api/installations/fiscal-allocations/report';
    const valid = machine ? ['origin', 'cookie', 'x-csrf-token'].every(k => req.headers[k] === undefined)
      : req.headers.origin === 'http://localhost' && req.headers.cookie === 'SYNTHETIC' && req.headers['x-csrf-token'] === 'SYNTHETIC';
    res.writeHead(valid ? 200 : 403); res.end('four');
  });
  const run = await open(t, { target: f.target, credentials: { cookie: 'SYNTHETIC', csrfToken: 'SYNTHETIC' } });
  assert.equal((await run.request('report', {})).statusCode, 200);
  assert.equal((await run.request('reserve', {})).statusCode, 200);
  await run.close(); assert.equal(run.snapshot().accounting.producer.attempts, 2);
});

// A measurement without any completed fiscal operation cannot establish a zero-cost scenario.
test('fiscalEmptyTransportCannotQualifyAMeasurement', async t => {
  const f = await fixture(t, (_req, res) => res.end('four'));
  const run = await open(t, { target: f.target });
  await assert.rejects(run.close(), bad); assert.throws(() => run.snapshot(), bad);
});

// Caller cancellation and concurrent reuse must not produce a partially measured scenario.
test('fiscalPreAbortedAndOverlappingCallsAreRefused', async t => {
  const f = await fixture(t, (_req, res) => res.end('four'));
  assert.equal(typeof local.openFiscalMeasurement, 'function');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(local.openFiscalMeasurement({ target: f.target, clock: () => 0, signal: controller.signal }), bad);
  const run = await open(t, { target: f.target });
  const pending = assert.rejects(run.request('reserve', {}), bad);
  assert.throws(() => run.request('list', {}), bad);
  await assert.rejects(run.close(), bad); await pending;
  assert.throws(() => run.snapshot(), bad);
});

// Cancellation must stop the current owned HTTP request rather than waiting for its ordinary deadline.
test('fiscalCancellationAndClosePromptlySettleTheOwnedRequest', async t => {
  for (const mode of ['signal', 'close']) {
    let entered, respond, timer, closing;
    const ready = new Promise(resolve => { entered = resolve; });
    const f = await fixture(t, (_req, res) => { respond = () => res.end('four'); entered(); });
    const controller = new AbortController();
    const run = await open(t, { target: f.target, signal: controller.signal, timeoutMs: 30000 });
    const outcome = run.request('reserve', {}).then(() => 'success', () => 'refused');
    try {
      await ready;
      if (mode === 'signal') controller.abort();
      else closing = run.close().catch(() => {});
      const result = await Promise.race([outcome, new Promise(resolve => { timer = setTimeout(() => resolve('still-running'), 500); })]);
      assert.equal(result, 'refused');
    } finally {
      clearTimeout(timer); respond(); await outcome; await closing; await run.close().catch(() => {});
    }
    assert.throws(() => run.snapshot(), bad);
  }
});
