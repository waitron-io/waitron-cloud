import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, Server } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';
import { checkpointTransportDiagnostic, workerFailureTrace } from './worker-diagnostic.mjs';

// Dropping the first HTTP failure at worker admission hides whether shutdown cancelled a LIST.
test('cancelled list keeps its first HTTP event through checkpoint and worker admission', { timeout: 5000 }, async t => {
  let arrived, reply, observed, clientClosed;
  const admitted = new Promise(resolve => { arrived = resolve; });
  const settled = new Promise(resolve => { observed = resolve; });
  const destinationClosed = new Promise(resolve => { clientClosed = resolve; });
  const backend = createServer((req, res) => {
    req.resume(); req.on('end', () => { reply = () => res.end('PRIVATE_BODY'); arrived(); });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0 });
  const front = await createLitestreamTransport({ target: `http://127.0.0.1:${backend.address().port}`, phase: 'workload',
    meter: { observeAttempt: (...args) => { try { return meter.observeAttempt(...args); } finally { observed(); } }, invalidate: meter.invalidate } });
  t.after(() => front.close().catch(() => {}));
  const emit = Server.prototype.emit;
  t.mock.method(Server.prototype, 'emit', function (event, ...args) {
    if (event === 'request' && args[0].socket.localPort === Number(new URL(front.url).port))
      args[1].once('close', clientClosed);
    return emit.call(this, event, ...args);
  });
  await front.whenIdle(() => {});
  const caller = request(front.url + '/PRIVATE_BUCKET?list-type=2', { agent: false, headers: {
    'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=3',
  } });
  caller.on('error', () => {}); t.after(() => caller.destroy());
  const closed = new Promise(resolve => caller.once('close', resolve)); caller.end();
  await admitted; caller.destroy(); await closed; await destinationClosed; reply(); await settled;
  const event = checkpointTransportDiagnostic(front.checkpoint());
  assert.deepEqual(event, {
    kind: 'checkpoint-transport', reason: 'transfer-interrupted', validationStage: 'none', pending: 0, completed: 1,
    ioEvent: 'response-pipeline', code: 'ERR_STREAM_UNABLE_TO_PIPE', operation: 'list',
    idleActionsAtAdmission: 1, clientClosed: true, responseHeadersSeen: true,
  });
  const admittedTrace = workerFailureTrace([event]);
  assert.deepEqual(admittedTrace, [event]);
  assert.doesNotMatch(JSON.stringify(admittedTrace), /PRIVATE|127\.0\.0\.1|11111111|amz-sdk/);
  await front.close();
  assert.equal(meter.snapshot().status, 'unknown');
  assert.ok(meter.snapshot().gaps.includes('accounting:request-cutoff'));
});

const base = { kind: 'checkpoint-transport', reason: 'transfer-interrupted', validationStage: 'none', pending: 0, completed: 1 };
const details = { code: 'ECONNRESET', ioEvent: 'response-aborted', operation: 'get',
  idleActionsAtAdmission: 0, clientClosed: false, responseHeadersSeen: true };

test('checkpoint accepts the inclusive idle callback count limit', () => {
  const event = { ...base, idleActionsAtAdmission: 1000000000 };
  assert.deepEqual(checkpointTransportDiagnostic(event), event);
  assert.deepEqual(workerFailureTrace([event]), [event]);
});

// A stale host validator would erase the whole trace even if the worker writes the new details.
test('checkpoint HTTP evidence survives worker serialization and is copied', () => {
  const trace = [{ ...base, ...details }];
  const result = workerFailureTrace(JSON.parse(JSON.stringify(trace)));
  assert.deepEqual(result, [{ ...base, ...details }]);
  trace[0].operation = 'PRIVATE_LATER';
  assert.equal(result[0].operation, 'get');
});

// Unknown codes, private text and executable values must never become published diagnostics.
for (const [key, value] of [
  ['code', 'PRIVATE_CODE'], ['ioEvent', 'PRIVATE_EVENT'], ['operation', 'PRIVATE_PATH'],
  ['idleActionsAtAdmission', -1], ['idleActionsAtAdmission', 1e20], ['idleActionsAtAdmission', 1.5],
  ['idleActionsAtAdmission', 1000000001],
  ['clientClosed', 'PRIVATE_STATE'], ['responseHeadersSeen', 'PRIVATE_HEADERS'],
]) test(`checkpoint filters and worker refuses invalid HTTP detail ${key}=${value}`, () => {
  assert.deepEqual(checkpointTransportDiagnostic({ ...base, [key]: value, path: 'PRIVATE_PATH' }), base);
  assert.throws(() => workerFailureTrace([{ ...base, [key]: value }]), { message: 'Invalid cloud cost worker diagnostic' });
});

test('checkpoint reads only own data HTTP details and worker rejects accessors', () => {
  let reads = 0;
  const snapshot = { ...base };
  Object.defineProperty(snapshot, 'code', { enumerable: true, get() { reads++; throw Error('PRIVATE_GETTER'); } });
  assert.deepEqual(checkpointTransportDiagnostic(snapshot), base);
  assert.throws(() => workerFailureTrace([snapshot]), { message: 'Invalid cloud cost worker diagnostic' });
  assert.equal(reads, 0);
  assert.deepEqual(checkpointTransportDiagnostic(Object.assign(Object.create(details), base)), base);
});
