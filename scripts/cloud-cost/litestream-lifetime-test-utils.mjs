import assert from 'node:assert/strict';
import { createServer, request, Server } from 'node:http';
import { once } from 'node:events';
import { createLitestreamAfterStop, createLitestreamRequestAudit, createLitestreamTransport } from './litestream.mjs';
import { createMeter, createMeteringProxy, classifyStorageOperation } from './meter.mjs';

export const acknowledge = afterStop => afterStop.acknowledgeStop({ statusCode: 200, ownedPath: '/owned/PRIVATE_CANARY.db',
  body: Buffer.from('{"status":"stopped","path":"/owned/PRIVATE_CANARY.db","txid":0}') });

// The backend commits, then a real forwarding hop holds its reply until the test releases it.
export async function lifetimeExchange(t, { open, input, versionId = null, commit = () => {}, stopped = true,
  interrupted = true, witness = true, statusCode = 200, witnessChange = x => x }) {
  const afterStop = createLitestreamAfterStop({ clock: () => 0 });
  const lifetimes = await open(afterStop);
  const headers = { ...input.headers, 'amz-sdk-invocation-id': '11111111-2222-4333-8444-555555555555', 'amz-sdk-request': 'attempt=1; max=3' };
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
  audit.write(Buffer.from(`SDK 2026/10/25 03:00:00 DEBUG Request\n${input.method} ${input.path} HTTP/1.1\r\nAmz-Sdk-Invocation-Id: ${headers['amz-sdk-invocation-id']}\r\nAmz-Sdk-Request: attempt=1; max=3\r\n\r\n`));
  let release, arrived, settled, clientClosed, faultFailure;
  const ready = new Promise(resolve => { arrived = resolve; });
  const completed = new Promise(resolve => { settled = resolve; });
  const destinationClosed = new Promise(resolve => { clientClosed = resolve; });
  const backend = createServer((req, res) => {
    req.resume(); req.once('end', () => {
      if (statusCode < 300 && req.method === 'PUT') commit();
      res.writeHead(statusCode, versionId === null ? {} : { 'x-amz-version-id': versionId });
      res.end(req.method === 'PUT' ? '' : 'metadata');
    });
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const fault = createServer((req, res) => {
    let bytes = 0; req.on('data', b => { bytes += b.length; });
    const upstream = request(`http://127.0.0.1:${backend.address().port}`, { method: req.method, path: req.url, headers: req.headers }, incoming => {
      const chunks = []; incoming.on('data', b => chunks.push(b));
      incoming.once('end', () => {
        try {
          if (witness && req.method === 'PUT') afterStop.commit(witnessChange({ token: headers['amz-sdk-invocation-id'] + ':1',
            statusCode: incoming.statusCode, bytesOut: bytes, expectedBytesOut: Number(req.headers['content-length']),
            requestComplete: req.complete, versionId: incoming.headers['x-amz-version-id'] ?? null,
            deleteMarker: incoming.headers['x-amz-delete-marker'] ?? null }));
        } catch (error) { faultFailure = error; }
        release = () => { res.writeHead(incoming.statusCode, incoming.headers); res.end(Buffer.concat(chunks)); }; arrived();
      });
    });
    upstream.on('error', () => res.destroy()); req.pipe(upstream);
  });
  fault.listen(0, '127.0.0.1'); await once(fault, 'listening');
  t.after(() => { fault.closeAllConnections(); return new Promise(resolve => fault.close(resolve)); });
  const meter = createMeter({ phase: 'workload', clock: () => 0, afterStop });
  const observer = await createMeteringProxy({ target: `http://127.0.0.1:${fault.address().port}`, meter,
    classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
  t.after(() => observer.close().catch(() => {}));
  const transport = await createLitestreamTransport({ target: observer.url, phase: 'workload', afterStop, lifetimes,
    meter: { ...meter, observeAttempt: (...args) => { try { return meter.observeAttempt(...args); } finally { settled(); } } } });
  t.after(() => transport.close().catch(() => {}));
  const emit = Server.prototype.emit;
  t.mock.method(Server.prototype, 'emit', function (event, ...args) {
    if (event === 'request' && args[0].socket.localPort === Number(new URL(transport.url).port)) args[1].once('close', clientClosed);
    return emit.call(this, event, ...args);
  });
  const caller = request(transport.url + input.path, { method: input.method, headers }, res => res.resume());
  caller.on('error', () => {}); const closed = new Promise(resolve => caller.once('close', resolve));
  caller.end(input.method === 'PUT' ? 'four' : undefined);
  await ready;
  if (faultFailure) { caller.destroy(); await closed; await destinationClosed; release(); await completed; throw faultFailure; }
  if (stopped) acknowledge(afterStop);
  if (interrupted) { caller.destroy(); await closed; await destinationClosed; }
  release(); await completed;
  if (!interrupted) await closed;
  audit.end();
  return { afterStop, lifetimes, meter, transport };
}

export async function assertIncompleteList(f, exchange) {
  await exchange.transport.close(); await exchange.lifetimes.verify();
  assert.equal(exchange.lifetimes.snapshot().objects.bytes, 0);
  assert.equal(exchange.afterStop.snapshot().used, 1);
  assert.equal(exchange.afterStop.snapshot().lateSettlements, 1);
  assert.equal(exchange.meter.snapshot().status, 'unknown');
  assert.equal(exchange.meter.snapshot().reconciled, false);
  assert.equal(exchange.meter.snapshot().accounting.producer.bytesIn, 0);
  assert.equal(exchange.meter.snapshot().accounting.observer.bytesIn, 8);
  assert.ok(exchange.meter.snapshot().billing.every(r => r.quantity === null && r.status === 'unknown'));
  assert.equal(JSON.stringify(exchange.afterStop.snapshot()).includes('PRIVATE_CANARY'), false);
}
