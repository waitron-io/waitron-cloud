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
let stage = 'prepare', checkpoint, diagnostic, writer, listEvidence;

async function run() {
  const root = mkdtempSync(join(tmpdir(), 'cost-native-list-')), path = join(root, 'venue.db');
  const binary = process.argv[2] ?? '/code/litestream';
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE example(id INTEGER PRIMARY KEY); INSERT INTO example VALUES(1)");
  const afterStop = createLitestreamAfterStop({ clock: () => performance.now() / 1000 });
  const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
  const meter = createMeter({ phase: 'workload', clock: () => performance.now() / 1000, afterStop });
  let uploaded;
  const initialUpload = new Promise(resolve => { uploaded = resolve; });
  const counter = { ...meter, observeAttempt(...args) {
    const [row] = args, list = listAttempts.get(row.token);
    if (list && ['producer', 'observer'].includes(row.channel)
      && ['success', 'transport-error', 'server-error', 'client-error'].includes(row.outcome)) {
      list[row.channel + 'Outcome'] ??= row.outcome; mark(list, row.channel + 'Settled');
    }
    const accepted = meter.observeAttempt(...args);
    if (row.channel === 'producer' && row.operation === 'put' && row.outcome === 'success') uploaded();
    return accepted;
  } };
  let release, held, child, ended, control, front, proxy, timer, invalid = false;
  const objects = new Map();
  // Fixed categories and bounded event numbers retain ordering without storage paths or SDK identities.
  const evidence = { lists: [], truncated: false, lastEvent: 0 }, listAttempts = new Map();
  const mark = (row, key) => {
    if (!row || Object.hasOwn(row, key)) return;
    row[key] = ++evidence.lastEvent;
  };
  const captureLists = () => ({ ...evidence, lists: evidence.lists.map(row => ({ ...row })) });
  const waiting = new Promise(resolve => { held = resolve; });
  const backend = createServer((req, res) => {
    const url = new URL(req.url, 'http://local'), key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    const chunks = []; req.on('data', bytes => chunks.push(bytes));
    req.on('end', () => {
      if (req.method === 'PUT') {
        if (key) objects.set(key, { body: Buffer.concat(chunks), modified: new Date().toISOString() });
        res.writeHead(200, { 'content-length': '0', etag: '"synthetic"' }); res.end(); return;
      }
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); res.end(); return; }
      if (!key) {
        const prefix = url.searchParams.get('prefix') ?? '', rows = [...objects].filter(([name]) => name.startsWith(prefix));
        const xml = '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>synthetic</Name><Prefix>' + prefix
          + '</Prefix><KeyCount>' + rows.length + '</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>'
          + rows.map(([name, object]) => '<Contents><Key>' + name + '</Key><Size>' + object.body.length
            + '</Size><LastModified>' + object.modified + '</LastModified><ETag>"synthetic"</ETag><StorageClass>STANDARD</StorageClass></Contents>').join('')
          + '</ListBucketResult>';
        res.writeHead(200, { 'content-type': 'application/xml', 'content-length': Buffer.byteLength(xml) }); res.end(xml); return;
      }
      const body = objects.get(key)?.body;
      if (!body) { res.writeHead(404); res.end('<Error><Code>NoSuchKey</Code></Error>'); return; }
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      let output = body;
      if (range) {
        const start = Number(range[1]), end = range[2] ? Number(range[2]) : body.length - 1;
        output = body.subarray(start, end + 1); res.setHeader('content-range', `bytes ${start}-${end}/${body.length}`);
      }
      res.writeHead(range ? 206 : 200, { 'content-length': output.length, etag: '"synthetic"' });
      res.end(req.method === 'HEAD' ? undefined : output);
    });
  });
  const gate = createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    const isList = req.method === 'GET' && url.searchParams.get('list-type') === '2';
    let row;
    if (isList) {
      if (evidence.lists.length < 16) {
        row = { category: !release && url.searchParams.get('prefix') === 'stream/0009/'
          ? 'held-retention-list' : evidence.lists.length === 0 ? 'initial-list' : 'other-list' };
        evidence.lists.push(row); mark(row, 'arrived');
        const attempt = /^attempt=([1-9]\d*); max=[1-9]\d*$/.exec(req.headers['amz-sdk-request'] ?? '');
        if (attempt) listAttempts.set(req.headers['amz-sdk-invocation-id'] + ':' + attempt[1], row);
        req.on('aborted', () => mark(row, 'requestAborted'));
        res.on('close', () => { mark(row, 'clientClosed'); row.responseFinished = res.writableFinished; });
      } else evidence.truncated = true;
    }
    const forward = () => {
      mark(row, 'forwarded');
      const upstream = request(proxy.url + req.url, { method: req.method, headers: req.headers }, incoming => {
        mark(row, 'responseHeaders');
        incoming.on('end', () => mark(row, 'responseEnd'));
        incoming.on('aborted', () => mark(row, 'responseAborted'));
        incoming.on('error', () => { mark(row, 'responseError'); res.destroy(); }); res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
      });
      upstream.on('error', () => { mark(row, 'upstreamError'); res.destroy(); });
      res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
      req.pipe(upstream);
    };
    // Hold the observed snapshot-retention list; initialization must remain able to read its committed uploads.
    if (!release && req.method === 'GET' && url.searchParams.get('list-type') === '2' && url.searchParams.get('prefix') === 'stream/0009/') {
      release = forward; held({ method: req.method, list: true });
    }
    else forward();
  });
  try {
    backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
    proxy = await createMeteringProxy({ target: 'http://127.0.0.1:' + backend.address().port, meter: counter,
      classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
    gate.listen(0, '127.0.0.1'); await once(gate, 'listening');
    front = await createLitestreamTransport({ target: 'http://127.0.0.1:' + gate.address().port, meter: counter, phase: 'workload', afterStop });
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
      stage = 'initial-upload';
      await Promise.race([initialUpload, ended.then(() => assert.fail('writer ended before initial upload'))]);
      await Promise.race([
        (async () => {
          stage = 'stop-control'; mark(evidence, 'stopRequested');
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
          mark(evidence, 'stopReplyReceived');
          stage = 'stop-acknowledgement'; afterStop.acknowledgeStop(acknowledgement);
          mark(evidence, 'stopAcknowledged');
          stage = 'exit';
          mark(evidence, 'heldReleased'); release();
          mark(evidence, 'signalSent'); child.kill('SIGTERM');
          const [code] = await ended; mark(evidence, 'writerExited'); assert.equal(code, 0); assert.equal(invalid, false);
          stage = 'idle'; await front.whenIdle(() => {});
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('native stop deadline')), 2000); }),
      ]);
      stage = 'audit'; audit.end(); await front.close(); await proxy.close();
      stage = 'snapshot';
      const subset = afterStop.snapshot();
      assert.equal(subset.used, 1); assert.equal(subset.lateAdmissions, 1);
      return { version, initialUploadComplete: true, replication: audit.snapshot(), observed: meter.snapshot(), ...litestreamAfterStopOutput(subset) };
    } finally { clearTimeout(watchdog); clearTimeout(timer); control?.destroy(); }
  } catch (error) {
    diagnostic = checkpoint?.(); listEvidence = captureLists();
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
    ...(listEvidence ? { listEvidence } : {}),
    ...(writer ? { writer: { exited: writer.exitCode !== null || writer.signalCode !== null,
      code: writer.exitCode, signal: writer.signalCode } } : {}) }));
  console.error('Official Litestream list control failed'); process.exitCode = 1;
});
