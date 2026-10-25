// Official native writer against controlled loopback storage; no venue or fiscal claims.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLitestreamAfterStop, litestreamAfterStopOutput, createLitestreamRequestAudit, createLitestreamTransport } from '/code/litestream.mjs';
import { createMeter, createMeteringProxy, classifyStorageOperation } from '/code/meter.mjs';
let stage = 'prepare', checkpoint, diagnostic, writer;

async function run() {
  const root = mkdtempSync(join(tmpdir(), 'cost-native-list-')), path = join(root, 'venue.db');
  const binary = process.argv[2] ?? '/code/litestream';
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE example(id INTEGER PRIMARY KEY); INSERT INTO example VALUES(1)");
  const afterStop = createLitestreamAfterStop({ clock: () => performance.now() / 1000 });
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
  const meter = createMeter({ phase: 'workload', clock: () => performance.now() / 1000, afterStop });
  let release, held, child, ended, control, front, proxy, timer, invalid = false;
  const waiting = new Promise(resolve => { held = resolve; });
  const backend = createServer((req, res) => {
    req.resume(); req.on('end', () => {
      const xml = '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>synthetic</Name><Prefix></Prefix><KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>';
      res.writeHead(200, { 'content-type': 'application/xml', 'content-length': Buffer.byteLength(xml) }); res.end(xml);
    });
  });
  const gate = createServer((req, res) => {
    const forward = () => {
      const upstream = request(proxy.url + req.url, { method: req.method, headers: req.headers }, incoming => {
        incoming.on('error', () => res.destroy()); res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
      });
      upstream.on('error', () => res.destroy());
      res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
      req.pipe(upstream);
    };
    if (!release) { release = forward; held({ method: req.method, list: req.url.includes('list-type=2') }); }
    else forward();
  });
  try {
    backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
    proxy = await createMeteringProxy({ target: 'http://127.0.0.1:' + backend.address().port, meter,
      classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
    gate.listen(0, '127.0.0.1'); await once(gate, 'listening');
    front = await createLitestreamTransport({ target: 'http://127.0.0.1:' + gate.address().port, meter, phase: 'workload', afterStop });
    checkpoint = () => front.checkpoint();
    const file = join(root, 'config.json'), socketPath = join(root, 'control.sock');
    writeFileSync(file, JSON.stringify({ socket: { enabled: true, path: socketPath }, dbs: [{ path, 'monitor-interval': '10ms',
      replica: { type: 's3', bucket: 'synthetic', path: 'stream', endpoint: front.url, region: 'eu-north-1',
        'force-path-style': true, 'sync-interval': '10ms' } }] }), { mode: 0o600 });
    const env = { PATH: process.env.PATH, HOME: root, AWS_ACCESS_KEY_ID: 'SYNTHETIC', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC',
      AWS_EC2_METADATA_DISABLED: 'true', LITESTREAM_S3_DEBUG: 'request,retries' };
    stage = 'version';
    const version = spawnSync(binary, ['version'], { env, encoding: 'utf8', timeout: 2000 }).stdout.trim();
    assert.equal(version, '0.5.17');
    child = spawn(binary, ['replicate', '-config', file], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    writer = child;
    ended = once(child, 'close');
    child.stderr.on('data', bytes => { try { audit.write(bytes); } catch { invalid = true; child.kill('SIGTERM'); } });
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 7500);
    try {
      stage = 'held-list';
      assert.deepEqual(await Promise.race([waiting, ended.then(() => assert.fail('writer ended before held list'))]), { method: 'GET', list: true });
      await Promise.race([
        (async () => {
          stage = 'stop-control';
          const acknowledgement = await new Promise((resolve, reject) => {
            control = request({ socketPath, path: '/stop', method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
              const chunks = []; let size = 0;
              res.on('error', reject); res.on('data', bytes => {
                size += bytes.length; if (size > 1024) { res.destroy(); reject(Error('oversized control reply')); } else chunks.push(bytes);
              });
              res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks), ownedPath: path }));
            });
            control.on('error', reject); control.end(JSON.stringify({ path, timeout: 2 }));
          });
          stage = 'stop-acknowledgement'; afterStop.acknowledgeStop(acknowledgement);
          stage = 'exit';
          release(); child.kill('SIGTERM');
          const [code] = await ended; assert.equal(code, 0); assert.equal(invalid, false);
          stage = 'idle'; await front.whenIdle(() => {});
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('native stop deadline')), 2000); }),
      ]);
      stage = 'audit'; audit.end(); await front.close(); await proxy.close();
      stage = 'snapshot';
      const subset = afterStop.snapshot();
      assert.equal(subset.used, 1); assert.equal(subset.lateAdmissions, 1);
      return { version, replication: audit.snapshot(), observed: meter.snapshot(), ...litestreamAfterStopOutput(subset) };
    } finally { clearTimeout(watchdog); clearTimeout(timer); control?.destroy(); }
  } catch (error) {
    diagnostic = checkpoint?.();
    throw error;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await ended; }
    await front?.close().catch(() => {}); await proxy?.close().catch(() => {});
    for (const server of [gate, backend]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    db.close(); rmSync(root, { recursive: true, force: true });
  }
}
await run().then(result => process.stdout.write(JSON.stringify(result)), () => {
  console.error(JSON.stringify({ kind: 'litestream-native-control', stage, status: 'rejected',
    ...(diagnostic ? { diagnostic } : {}),
    ...(writer ? { writer: { exited: writer.exitCode !== null || writer.signalCode !== null,
      code: writer.exitCode, signal: writer.signalCode } } : {}) }));
  console.error('Official Litestream list control failed'); process.exitCode = 1;
});
