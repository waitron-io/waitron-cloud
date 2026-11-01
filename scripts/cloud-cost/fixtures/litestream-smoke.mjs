let stage = 'prepare';
// Synthetic venue only. SDK log lines are consumed in memory and never written or returned.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { openReplay } from '/code/cost-waitron-adapter.mjs';
import { createLitestreamAfterStop, litestreamAfterStopOutput, createLitestreamRequestAudit, createLitestreamTransport, withLitestreamCloseDiagnostics } from '/code/litestream.mjs';

import { createMeter, createMeteringProxy, classifyStorageOperation, instrumentStorageClient, correlatedStorageAttempt } from '/code/meter.mjs';
const require = createRequire('/app/packages/backups/package.json');
const sdk = require('@aws-sdk/client-s3');
const { S3Client, CreateBucketCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteBucketCommand } = sdk;
const fail = () => { throw Error('Synthetic Litestream check failed'); };
async function smoke() {
  const stateRoot = '/state/synthetic-litestream-proof', Bucket = 'synthetic-litestream';
  mkdirSync(stateRoot, { mode: 0o700 });
  const { config, initial } = JSON.parse(readFileSync('/state/replay-config.json', 'utf8'));
  const replay = await openReplay({ codeRoot: '/code', stateRoot, config, initial });
  const database = stateRoot + '/venue/venue.db', output = stateRoot + '/restored.db';
  const children = new Set(); let injectedFailures = 0, failedUploadInvocation, retryAcknowledged = false;
  const afterStop = createLitestreamAfterStop({ clock: () => performance.now() / 1000 });
  const controlSocket = stateRoot + '/control.sock';
  const fault = createServer((req, res) => {
    let requestBytes = 0; req.on('data', bytes => { requestBytes += bytes.length; });
    if (req.method === 'PUT' && injectedFailures === 0) {
      failedUploadInvocation = req.headers['amz-sdk-invocation-id'];
      injectedFailures++; req.resume(); req.on('end', () => { res.writeHead(503, { 'content-length': '0' }); res.end(); }); return;
    }
    const upstream = request('http://127.0.0.1:8333', { method: req.method, path: req.url, headers: req.headers }, incoming => {
      if (req.method === 'PUT' && incoming.statusCode >= 200 && incoming.statusCode < 300) {
        incoming.once('end', () => {
          try {
            const ordinal = /^attempt=([1-9]\d*); max=[1-9]\d*$/.exec(req.headers['amz-sdk-request']);
            if (!ordinal) fail();
            afterStop.commit({ token: req.headers['amz-sdk-invocation-id'] + ':' + ordinal[1], statusCode: incoming.statusCode,
              bytesOut: requestBytes, expectedBytesOut: Number(req.headers['content-length'] ?? 0),
              requestComplete: req.complete && incoming.complete,
              versionId: incoming.headers['x-amz-version-id'] ?? null, deleteMarker: incoming.headers['x-amz-delete-marker'] ?? null });
            if (req.headers['amz-sdk-invocation-id'] === failedUploadInvocation && ordinal[1] === '2') retryAcknowledged = true;
          } catch { afterStop.invalidate(); res.destroy(); }
        });
      }
      res.writeHead(incoming.statusCode, incoming.headers); incoming.on('error', () => res.destroy()); incoming.pipe(res);
    });
    upstream.on('error', () => res.destroy()); req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  });
  fault.listen(0, '127.0.0.1'); await once(fault, 'listening');
  let lifetimes, replication, restore;
  const phase = async name => {
    const session = name === 'workload' ? afterStop : undefined;
    const audit = createLitestreamRequestAudit({ phase: name, afterStop: session });
    const meter = createMeter({ phase: name, clock: () => performance.now() / 1000, afterStop: session });
    const proxy = await createMeteringProxy({ target: `http://127.0.0.1:${fault.address().port}`, meter,
      classify: input => audit.observe({ headers: input.headers, operation: classifyStorageOperation(input) }) });
    const transport = await createLitestreamTransport({ target: proxy.url, meter, phase: name, lifetimes: name === 'restore' && lifetimes?.afterStop ? lifetimes.strictReads : lifetimes, afterStop: session });
    return { audit, meter, proxy, transport, endpoint: transport?.url ?? proxy.url };
  };
  const adminMeter = createMeter({ phase: 'observer', clock: () => performance.now() / 1000 });
  const adminProxy = await createMeteringProxy({ target: 'http://127.0.0.1:8333', meter: adminMeter, classify: correlatedStorageAttempt });
  const clients = ['setup', 'observer', 'cleanup'].map(phase => {
    const client = new S3Client({ endpoint: adminProxy.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    instrumentStorageClient({ client, meter: adminMeter, phase, endpoint: adminProxy.url }); return client;
  });
  const env = { PATH: process.env.PATH, HOME: stateRoot, AWS_ACCESS_KEY_ID: 'SYNTHETIC', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC',
    AWS_EC2_METADATA_DISABLED: 'true', LITESTREAM_S3_DEBUG: 'request,retries' };
  const version = spawnSync('/code/litestream', ['version'], { env, encoding: 'utf8', timeout: 2000 }).stdout.trim();
  const launch = (args, audit) => {
    const child = spawn('/code/litestream', args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    children.add(child); let invalid = false;
    child.stderr.on('data', bytes => { try { audit.write(bytes); } catch { invalid = true; child.kill('SIGTERM'); } });
    const timer = setTimeout(() => child.kill('SIGKILL'), 80000);
    const done = new Promise(resolve => {
      child.once('error', () => { invalid = true; });
      child.once('close', (code, signal) => { clearTimeout(timer); children.delete(child); resolve({ code, signal: signal ?? null, invalid }); });
    });
    return { child, done };
  };
  const stop = process => process.stopping ??= (async () => {
    if (!children.has(process.child)) return process.done;
    process.child.kill('SIGTERM'); const force = setTimeout(() => process.child.kill('SIGKILL'), 2000);
    try { return await process.done; } finally { clearTimeout(force); }
  })();
  const configFile = (name, endpoint) => {
    const file = stateRoot + '/' + name + '.json';
    writeFileSync(file, JSON.stringify({ ...(name === 'replicate' ? { socket: { enabled: true, path: controlSocket } } : {}), snapshot: { interval: '24h', retention: '168h' },
      dbs: [{ path: database, 'monitor-interval': '1s', replica: { type: 's3', bucket: Bucket, path: 'stream', endpoint,
        region: 'eu-north-1', 'force-path-style': true, 'sync-interval': '1s' } }] }), { mode: 0o600 });
    return file;
  };
  const sale = async number => {
    const instant = new Date(`2026-01-01T12:00:0${number}Z`);
    await replay.recordSale({ origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'],
      total: '12.10', lines: [{ lineNo: 1, name: 'Synthetic item', descriptions: { es: 'Synthetic item' }, quantity: '1',
        unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
      clock: { now: () => ({ instant, offsetMinutes: 60, confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
      settlement: { kind: 'immediate', tenders: [{ method: 'cash', amount: '12.10', tipAmount: '0', settledAt: instant }] } });
  };
  let replicator;
  const list = async () => {
    const result = await clients[1].send(new ListObjectsV2Command({ Bucket }));
    if (result.IsTruncated) fail(); return result.Contents ?? [];
  };
  try {
    stage = 'bucket'; await clients[0].send(new CreateBucketCommand({ Bucket }));
    const versioned = process.env.COST_LITESTREAM_VERSIONS === '1';
    if (versioned) await clients[0].send(new sdk.PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    if (versioned || process.env.COST_LITESTREAM_LIFETIMES === '1' || process.env.COST_LITESTREAM_HISTORIES === '1') {
      const storage = await import(versioned ? '/code/stream-versions.mjs' : '/code/storage-lifetimes.mjs');
      const open = versioned ? storage.openLitestreamVersionHistories
        : process.env.COST_LITESTREAM_HISTORIES === '1' ? storage.openLitestreamHistories : storage.openLitestreamLifetimes;
      lifetimes = await open({ client: clients[1], sdk, meter: adminMeter, bucket: Bucket, clock: () => performance.now() / 1000,
        afterStop });
    }
    replication = await phase('workload'); restore = await phase('restore'); await sale(1);
    stage = 'replicate'; replicator = launch(['replicate', '-config', configFile('replicate', replication.endpoint)], replication.audit);
    let uploaded = false;
    for (let n = 0; n < 40; n++) {
      if (!children.has(replicator.child)) fail();
      // An idle transfer counter excludes SDK backoff; require the injected upload's retry as well as its reply.
      if ((await list()).some(r => r.Key.endsWith('.ltx')) && replication.transport.checkpoint().pending === 0
        && (injectedFailures === 0 || retryAcknowledged)) { uploaded = true; break; }
      await delay(500);
    }
    if (!uploaded) fail(); stage = 'second-sale'; await sale(2);
    stage = 'stop';
    let drainTimer, control, stopStep = 'control', controlMs, exitMs, stopOutcome, beforeSignal;
    const stopStarted = performance.now(), stopElapsed = () => Math.max(0, Math.round(performance.now() - stopStarted));
    try {
      await Promise.race([
        (async () => {
          if (!children.has(replicator.child)) fail();
          await Promise.race([
            new Promise((resolve, reject) => {
              control = request({ socketPath: controlSocket, method: 'POST', path: '/stop',
                headers: { 'content-type': 'application/json' } }, response => {
                let size = 0; const chunks = [];
                response.on('error', reject);
                response.on('data', bytes => {
                  size += bytes.length;
                  if (size > 1024) { response.destroy(); reject(Error('Synthetic Litestream stop reply refused')); }
                  else chunks.push(bytes);
                });
                response.once('end', () => {
                  try {
                    if (!children.has(replicator.child)) fail();
                    afterStop.acknowledgeStop({ statusCode: response.statusCode, ownedPath: database, body: Buffer.concat(chunks) });
                    resolve();
                  } catch (error) { reject(error); }
                });
              });
              control.on('error', reject);
              control.end(JSON.stringify({ path: database, timeout: 2 }));
            }),
            replicator.done.then(() => fail()),
          ]);
          controlMs = stopElapsed();
          stopStep = 'exit';
          // A later idle refusal may have lost transfers cancelled by the signal.
          beforeSignal = { unavailable: true };
          try {
            const transfers = replication.transport?.pendingTransfers?.();
            if (transfers) beforeSignal = { pending: transfers.length, truncated: transfers.length > 16, transfers: transfers.slice(0, 16) };
          } catch {}
          const ended = stopOutcome = await stop(replicator);
          if (ended.invalid || ended.code !== 0) fail();
          exitMs = stopElapsed();
          stopStep = 'idle';
          await replication.transport?.whenIdle(() => {});
        })(),
        new Promise((_, reject) => { drainTimer = setTimeout(() => reject(Error('Synthetic Litestream stop timed out')), 2000); }),
      ]);
    } catch (error) {
      // Keep the thrown error intact; arbitrary transport text and stack frames can contain SDK metadata.
      const read = field => { try { return error?.[field]; } catch { return undefined; } };
      const message = read('message');
      const known = ['Synthetic Litestream check failed', 'Synthetic Litestream stop timed out',
        'Synthetic Litestream stop reply refused', 'Invalid cloud cost Litestream audit'].includes(message);
      const rawStack = known ? read('stack') : undefined;
      const stack = typeof rawStack === 'string' ? ['Error: ' + message, ...rawStack.split('\n').flatMap(line => {
        const frame = /\/litestream-smoke\.mjs:(\d+):(\d+)\)?$/.exec(line);
        return frame ? [`    at litestream-smoke.mjs:${frame[1]}:${frame[2]}`] : [];
      })].join('\n') : undefined;
      let pendingTransfers;
      try { pendingTransfers = replication.transport?.pendingTransfers?.(); } catch {}
      try { console.error(JSON.stringify({ kind: 'litestream-stop', status: 'rejected', step: stopStep,
        error: { name: 'Error', message: known ? message : 'Unclassified Litestream stop error', ...(typeof stack === 'string' ? { stack } : {}) },
        ...(stopOutcome ? { process: stopOutcome } : {}),
        ...(beforeSignal ? { beforeSignal } : {}),
        ...(replication.audit.checkpoint ? { audit: replication.audit.checkpoint() } : {}),
        timing: { elapsedMs: stopElapsed(), controlMs, exitMs },
        ...(pendingTransfers ? { pendingTransfers } : {}),
        ...(replication.transport?.checkpoint ? { diagnostic: replication.transport.checkpoint() } : {}) })); } catch {}
      throw error;
    } finally { clearTimeout(drainTimer); control?.destroy(); }
    stage = 'restore'; let restoredSales = 0, integrity;
    for (let n = 0; n < 12; n++) {
      rmSync(output, { force: true });
      const run = launch(['restore', '-config', configFile('restore', restore.endpoint), '-o', output, database], restore.audit);
      const result = await run.done;
      if (result.invalid) fail();
      if (result.code === 0) {
        const db = new DatabaseSync(output, { readOnly: true });
        try { integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
          restoredSales = Number(db.prepare('SELECT count(*) AS n FROM sales').get().n); }
        finally { db.close(); }
        if (restoredSales === 2) break;
      }
      await delay(1000);
    }
    if (restoredSales !== 2 || integrity !== 'ok') fail();
    stage = 'audit-end'; replication.audit.end(); restore.audit.end();
    await delay(20);
    stage = 'replication-transport-close';
    await withLitestreamCloseDiagnostics({ stage: 'replication-transport', close: () => replication.transport?.close() });
    stage = 'restore-transport-close';
    await withLitestreamCloseDiagnostics({ stage: 'restore-transport', close: () => restore.transport?.close() });
    const result = { version, injectedFailures, restoredSales, integrity };
    try {
      stage = 'result-counts'; result.sales = replay.counts();
      stage = 'replay-verification'; result.fiscal = await replay.verify();
      stage = 'replication-audit-snapshot'; result.replication = replication.audit.snapshot();
      stage = 'restore-audit-snapshot'; result.restore = restore.audit.snapshot();
      stage = 'replication-meter-snapshot'; result.observed = replication.meter.snapshot();
      stage = 'after-stop-snapshot'; Object.assign(result, litestreamAfterStopOutput(afterStop.snapshot()));
      if (replication.transport) {
        stage = 'replication-transport-snapshot'; const replicationSnapshot = replication.transport.snapshot();
        stage = 'restore-transport-snapshot'; const restoreSnapshot = restore.transport.snapshot();
        result.transport = { replication: replicationSnapshot, restore: restoreSnapshot };
      }
    } catch (error) {
      // Result errors belong to the synthetic replay; report before cleanup can replace the rejection.
      const text = read => { try { const value = read(); return value === undefined ? undefined : String(value); } catch { return undefined; } };
      let meter;
      try { if (stage === 'replication-meter-snapshot') meter = JSON.parse(JSON.stringify(replication.meter.diagnostics?.())); } catch {}
      try { console.error(JSON.stringify({ kind: 'litestream-result', stage,
        ...(meter ? { meter } : {}),
        error: { name: text(() => error?.name) ?? (error === null ? 'null' : typeof error),
          message: text(() => error?.message) ?? text(() => error), stack: text(() => error?.stack) } })); } catch {}
      throw error;
    }
    if (lifetimes) {
      stage = 'lifetimes'; await lifetimes.verify();
      const inventory = await list();
      result.lifetimes = lifetimes.snapshot();
      result.inventoryBytes = inventory.reduce((sum, row) => sum + row.Size, 0); result.inventoryObjects = inventory.length;
    }
    stage = 'delete';
    if (versioned) {
      const history = await clients[1].send(new sdk.ListObjectVersionsCommand({ Bucket }));
      if (history.IsTruncated) fail();
      for (const row of [...(history.Versions ?? []), ...(history.DeleteMarkers ?? [])])
        await clients[2].send(new DeleteObjectCommand({ Bucket, Key: row.Key, VersionId: row.VersionId }));
    } else for (const row of await list()) await clients[2].send(new DeleteObjectCommand({ Bucket, Key: row.Key }));
    result.cleanedObjects = (await list()).length === 0;
    await clients[2].send(new DeleteBucketCommand({ Bucket }));
    result.administration = adminMeter.snapshot();
    result.leaked = /synthetic-litestream|Authorization|Invocation|127\.0\.0\.1|\/state\/|\.ltx/.test(JSON.stringify(result));
    return result;
  } finally {
    if (replicator) await stop(replicator);
    for (const child of children) child.kill('SIGKILL');
    if (children.size) await Promise.all([...children].map(child => once(child, 'close')));
    for (const client of clients) client.destroy();
    const close = (stage, operation) => withLitestreamCloseDiagnostics({ stage, close: operation });
    const transports = await Promise.allSettled([
      close('cleanup-replication-transport', () => replication?.transport?.close()),
      close('cleanup-restore-transport', () => restore?.transport?.close())]);
    const closed = await Promise.allSettled([
      close('cleanup-replication-proxy', () => replication?.proxy.close()),
      close('cleanup-restore-proxy', () => restore?.proxy.close()),
      close('cleanup-admin-proxy', () => adminProxy.close())]);
    fault.closeAllConnections(); await new Promise(resolve => fault.close(resolve));
    await replay.close(); rmSync(stateRoot, { recursive: true, force: true });
    if ([...transports, ...closed].some(result => result.status === 'rejected')) fail();
  }
}
smoke().then(result => process.stdout.write(JSON.stringify(result)), () => { console.error('Synthetic Litestream phase: ' + stage); process.exitCode = 1; });
