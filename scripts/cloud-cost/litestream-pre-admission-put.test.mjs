import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter, createMeteringProxy, classifyStorageOperation } from './meter.mjs';
import { createLitestreamAfterStop, createLitestreamRequestAudit, createLitestreamTransport } from './litestream.mjs';

const invocation = '11111111-2222-4333-8444-555555555555';

// Removing the post-stop PUT admission guard must forward the held upload and fail this refusal.
for (const completeBeforeStop of [false, true]) {
  test(`an SDK-issued PUT held before admission: completeBeforeStop=${completeBeforeStop}`, { timeout: 3000 }, async t => {
    const afterStop = createLitestreamAfterStop({ clock: () => performance.now() / 1000 });
    const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
    const meter = createMeter({ phase: 'workload', clock: () => performance.now() / 1000, afterStop });
    const events = [];
    let backendPuts = 0, body = '', release, held;
    const waiting = new Promise(resolve => { held = resolve; });
    const backend = createServer((req, res) => {
      backendPuts++;
      req.on('data', bytes => { body += bytes; });
      req.on('end', () => { res.writeHead(200, { 'content-length': '0' }); res.end(); });
    });
    const servers = [backend];
    let proxy, transport;
    t.after(async () => {
      await transport?.close().catch(() => {});
      await proxy?.close().catch(() => {});
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    });
    backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
    proxy = await createMeteringProxy({ target: 'http://127.0.0.1:' + backend.address().port, meter,
      classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
    transport = await createLitestreamTransport({ target: proxy.url, meter, phase: 'workload', afterStop });
    const relay = createServer((req, res) => {
      events.push('relay-arrival');
      release = () => {
        events.push('relay-forward');
        const upstream = request(transport.url + req.url, { method: req.method, headers: req.headers }, incoming => {
          incoming.on('error', () => res.destroy());
          res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
        });
        upstream.on('error', () => res.destroy());
        res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
        req.pipe(upstream);
      };
      held();
    });
    servers.push(relay);
    relay.listen(0, '127.0.0.1'); await once(relay, 'listening');
    const path = '/synthetic/stream/0009/0000000000000001-0000000000000001.ltx';
    audit.write(Buffer.from(`SDK 2026/10/28 05:00:00 DEBUG Request\nPUT ${path} HTTP/1.1\r\nAmz-Sdk-Invocation-Id: ${invocation}\r\nAmz-Sdk-Request: attempt=1; max=3\r\n\r\n`));
    events.push('sdk-issued');
    const reply = new Promise((resolve, reject) => {
      const writer = request('http://127.0.0.1:' + relay.address().port + path, { method: 'PUT', headers: {
        'amz-sdk-invocation-id': invocation, 'amz-sdk-request': 'attempt=1; max=3', 'content-length': '4',
      } }, res => { res.on('error', reject); res.resume(); res.on('end', () => resolve(res.statusCode)); });
      writer.on('error', reject); t.after(() => writer.destroy()); writer.end('four');
    });
    await waiting;
    assert.equal(transport.checkpoint().pending, 0);
    assert.equal(transport.checkpoint().completed, 0);
    assert.equal(audit.checkpoint().producerAttempts, 1);
    assert.equal(audit.checkpoint().observerAttempts, 0);
    if (completeBeforeStop) { release(); assert.equal(await reply, 200); await transport.whenIdle(() => {}); }
    afterStop.acknowledgeStop({ statusCode: 200, ownedPath: '/synthetic.db',
      body: Buffer.from('{"status":"stopped","path":"/synthetic.db","txid":2}') });
    events.push('validated-stop');
    if (!completeBeforeStop) {
      release(); assert.equal(await reply, 400);
      const diagnostic = transport.checkpoint();
      assert.equal(diagnostic.reason, 'request-validation');
      assert.equal(diagnostic.validationStage, 'after-stop-admission');
      assert.equal(diagnostic.afterStopAdmissionGuard, 'post-stop-operation');
      assert.equal(diagnostic.afterStopAdmissionOperation, 'put');
      assert.equal(diagnostic.afterStopAdmissionAttemptClass, 'initial');
      assert.equal(backendPuts, 0, 'an issued request is not permission to admit a late upload');
      assert.equal(body, '');
      await assert.rejects(transport.close(), /Invalid cloud cost Litestream audit/);
      assert.throws(() => afterStop.snapshot(), /Invalid cloud cost Litestream audit/);
    } else {
      audit.end(); await transport.close(); await proxy.close();
      assert.equal(backendPuts, 1); assert.equal(body, 'four');
      assert.equal(audit.snapshot().requestsReconciled, true);
      assert.equal(meter.snapshot().accounting.producer.attempts, 1);
      assert.equal(meter.snapshot().accounting.observer.attempts, 1);
      assert.equal(afterStop.snapshot().used, 0);
    }
    assert.deepEqual(events, completeBeforeStop
      ? ['sdk-issued', 'relay-arrival', 'relay-forward', 'validated-stop']
      : ['sdk-issued', 'relay-arrival', 'validated-stop', 'relay-forward']);
  });
}
