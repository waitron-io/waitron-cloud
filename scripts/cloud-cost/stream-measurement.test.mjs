import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const module = await import('./stream-measurement.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./stream-measurement.mjs', import.meta.url).href) return {};
  throw error;
});
const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const key = 'PRIVATE_SESSION_CANARY', bucket = 'synthetic-session';
const bad = { message: 'Invalid cloud cost stream measurement' };

async function fixture(t, versioned = false) {
  let time = 0, number = 0;
  const rows = [], state = { requests: 0, versioned, failedWrites: 0, extra: false };
  const provider = createServer((req, res) => {
    state.requests++;
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://local'), bytes = Buffer.concat(chunks);
      if (req.method === 'PUT') {
        if (!versioned) rows.length = 0;
        const row = { version: 'v' + ++number, bytes: bytes.length, marker: false }; rows.push(row);
        if (versioned) res.setHeader('x-amz-version-id', row.version);
        if (state.failedWrites-- > 0) { res.writeHead(503); res.end('no'); } else res.end();
      } else if (req.method === 'DELETE') {
        const version = url.searchParams.get('versionId');
        if (!versioned) rows.length = 0;
        else if (version) rows.splice(rows.findIndex(row => row.version === version), 1);
        else {
          const row = { version: 'v' + ++number, bytes: Buffer.byteLength(key), marker: true }; rows.push(row);
          res.setHeader('x-amz-version-id', row.version); res.setHeader('x-amz-delete-marker', 'true');
        }
        res.writeHead(204); res.end();
      } else if (url.searchParams.has('versioning')) {
        res.end(`<VersioningConfiguration>${state.versioned ? '<Status>Enabled</Status>' : ''}</VersioningConfiguration>`);
      } else if (url.searchParams.has('uploads')) {
        res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
      } else if (url.searchParams.has('versions')) {
        const entries = rows.map((row, i) => {
          const type = row.marker ? 'DeleteMarker' : 'Version';
          return `<${type}><Key>${key}</Key><VersionId>${row.version}</VersionId><IsLatest>${i === rows.length - 1}</IsLatest>${row.marker ? '' : `<Size>${row.bytes}</Size>`}</${type}>`;
        }).join('');
        res.end(`<ListVersionsResult><IsTruncated>false</IsTruncated>${entries}</ListVersionsResult>`);
      } else if (url.searchParams.get('list-type') === '2') {
        const entries = [...rows, ...(state.extra ? [{ bytes: 99 }] : [])].map((row, i) =>
          `<Contents><Key>${i === 0 ? key : 'UNOBSERVED_CANARY'}</Key><Size>${row.bytes}</Size></Contents>`).join('');
        const respond = () => res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${entries}</ListBucketResult>`);
        if (state.holdList) { const hold = state.holdList; state.holdList = null; hold(respond); }
        else respond();
      } else {
        res.end(Buffer.alloc(rows.at(-1)?.bytes ?? 0));
      }
    });
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  t.after(() => { provider.closeAllConnections(); return new Promise(resolve => provider.close(resolve)); });
  return { rows, state, time: n => { time = n; }, args: {
    target: `http://127.0.0.1:${provider.address().port}`, sdk, bucket, versioned, clock: () => time,
  } };
}
async function open(t, f, options = {}) {
  assert.equal(typeof module.openStreamMeasurement, 'function', 'join physical requests and independently inventoried lifetimes');
  const session = await module.openStreamMeasurement({ ...f.args, ...options });
  t.after(() => session.close().catch(error => assert.equal(error.message, bad.message))); return session;
}
async function send(url, method, bytes, invocation, attempt = 1) {
  return new Promise((resolve, reject) => {
    const req = request(url + '/' + bucket + '/' + key, { method, agent: false, headers: {
      'content-length': bytes, 'amz-sdk-invocation-id': `11111111-2222-4333-8444-${String(invocation).padStart(12, '0')}`,
      'amz-sdk-request': `attempt=${attempt}; max=2`,
    } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); res.on('error', reject); });
    req.on('error', reject); req.end(Buffer.alloc(bytes));
  });
}
async function stopped(url) {
  await assert.rejects(send(url, 'GET', 0, 99), /ECONNREFUSED|ECONNRESET|socket hang up/);
}

// Freezing phases, forgetting observer traffic, or replacing lifetime totals with final size breaks these values.
for (const versioned of [false, true]) test(`streamMeasurementJoinsPhaseRequestsAndRetiredStorage_${versioned}`, async t => {
  const f = await fixture(t, versioned), session = await open(t, f);
  f.time(2); assert.equal(await send(session.url, 'PUT', 4, 1), 200);
  f.time(3); session.setPhase('workload');
  f.time(5); assert.equal(await send(session.url, 'PUT', 6, 2), 200);
  f.time(7); session.setPhase('idle');
  f.time(8); assert.equal(await send(session.url, 'GET', 0, 3), 200);
  f.time(9); session.setPhase('restore');
  f.time(10); assert.equal(await send(session.url, 'DELETE', 0, 4), 204);
  f.time(11); session.setPhase('cleanup'); f.time(12);
  const result = await session.finish();
  assert.equal(result.status, 'measured'); assert.equal(result.scope, 'native-stream-session');
  assert.deepEqual(result.phases, [
    { phase: 'startup', elapsedSeconds: 3 }, { phase: 'workload', elapsedSeconds: 4 },
    { phase: 'idle', elapsedSeconds: 2 }, { phase: 'restore', elapsedSeconds: 2 }, { phase: 'cleanup', elapsedSeconds: 1 },
  ]);
  assert.equal(result.requests.reconciled, true);
  assert.deepEqual(result.requests.accounting.producer, result.requests.accounting.observer);
  assert.deepEqual(result.requests.accounting.discrepancy, { attempts: 0, bytesIn: 0, bytesOut: 0 });
  assert.equal(result.requests.accounting.producer.attempts, 10);
  assert.deepEqual(result.requests.accounting.requests.filter(r => r.phase !== 'observer').map(r => [r.phase, r.operation, r.bytesOut, r.bytesIn]),
    [['startup', 'put', 4, 0], ['workload', 'put', 6, 0], ['idle', 'get', 0, 6], ['restore', 'delete', 0, 0]]);
  assert.equal(result.requests.accounting.requests.filter(r => r.phase === 'observer').reduce((n, r) => n + r.attempts, 0), 6);
  assert.deepEqual(result.storage.objects, { class: 'stream', bytes: versioned ? 32 : 0, currentVersions: 0,
    noncurrentVersions: versioned ? 2 : 0, deleteMarkers: versioned ? 1 : 0, unfinishedMultipart: 0 });
  // Plain: 4*(5-2)+6*(10-5)=42. Versioned: 4*(12-2)+6*(12-5)+22*(12-10)=126.
  assert.deepEqual(result.storage.byteSeconds, versioned ? { low: 126, high: 126 } : { low: 42, high: 42 });
  assert.deepEqual(result.cleanup, { listeners: 0, clients: 0 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|CANARY|synthetic-session|127\.0\.0\.1|VersionId|UploadId|11111111/);
  result.storage.objects.bytes = 999;
  const again = await session.finish();
  assert.equal(again.storage.objects.bytes, versioned ? 32 : 0);
  again.storage.objects.bytes = 888;
  assert.equal((await session.finish()).storage.objects.bytes, versioned ? 32 : 0);
  await session.close(); await session.close(); await stopped(session.url);
  assert.throws(() => session.setPhase('workload'), bad);
});

// Omitting failed/retried attempts or resetting the first possible commit loses this storage bound.
test('streamMeasurementRetainsFailedCommitAndRetryAcrossPhases', async t => {
  const f = await fixture(t), session = await open(t, f); f.state.failedWrites = 1;
  f.time(2); assert.equal(await send(session.url, 'PUT', 4, 1), 503);
  f.time(3); session.setPhase('workload');
  f.time(4); assert.equal(await send(session.url, 'PUT', 4, 1, 2), 200);
  f.time(6); const result = await session.finish();
  assert.equal(result.requests.reconciled, true);
  assert.equal(result.requests.accounting.producer.attempts, 8);
  assert.deepEqual(result.requests.accounting.requests.filter(r => r.phase !== 'observer').map(r =>
    [r.phase, r.outcome, r.retryOrdinal, r.attempts, r.bytesOut, r.bytesIn]),
  [['startup', 'server-error', 0, 1, 4, 2], ['workload', 'success', 1, 1, 4, 0]]);
  assert.deepEqual(result.storage.byteSeconds, { low: 8, high: 16 });
});

test('streamMeasurementRefusesUnobservedStorageAndClosesItsListeners', async t => {
  const f = await fixture(t), session = await open(t, f);
  await send(session.url, 'PUT', 4, 1); f.state.extra = true;
  await assert.rejects(session.finish(), bad);
  await stopped(session.url); await session.close();
  await assert.rejects(session.finish(), bad);
});

test('streamMeasurementCloseCannotProduceEvidenceAndIsIdempotent', async t => {
  const f = await fixture(t), session = await open(t, f);
  await session.close(); await session.close(); await stopped(session.url);
  await assert.rejects(session.finish(), bad);
  assert.throws(() => session.setPhase('workload'), bad);
});

test('streamMeasurementCancellationCollectsListenersAndRefusesEvidence', async t => {
  const f = await fixture(t), controller = new AbortController();
  const session = await open(t, f, { signal: controller.signal });
  controller.abort(); await session.close(); await stopped(session.url);
  await assert.rejects(session.finish(), bad);
});

for (const [name, change] of [
  ['provider endpoint', a => { a.target = 'https://s3.amazonaws.com'; }],
  ['provider path', a => { a.target += '/PRIVATE_CANARY'; }],
  ['versioning type', a => { a.versioned = 'true'; }],
  ['bucket', a => { a.bucket = '../PRIVATE_CANARY'; }],
  ['clock', a => { a.clock = () => NaN; }],
  ['bulk option', a => { a.allowBulkDeletes = 'yes'; }],
  ['multipart option', a => { a.allowMultipart = 1; }],
  ['resolution without multipart', a => { a.resolveMultipartReplies = true; }],
  ['cancelled input', a => { a.signal = AbortSignal.abort(); }],
  ['signal type', a => { a.signal = {}; }],
]) test('streamMeasurementRefusesInvalid' + name + 'BeforeStorageAccess', async t => {
  const f = await fixture(t), args = { ...f.args }; change(args);
  assert.equal(typeof module.openStreamMeasurement, 'function');
  await assert.rejects(module.openStreamMeasurement(args), bad);
  assert.equal(f.state.requests, 0);
});

test('streamMeasurementRefusesWrongVersioningBeforeWorkloadAdmission', async t => {
  const f = await fixture(t); f.state.versioned = true;
  assert.equal(typeof module.openStreamMeasurement, 'function');
  await assert.rejects(module.openStreamMeasurement(f.args), bad);
});

test('streamMeasurementUnknownPhasePoisonsSubsequentEvidence', async t => {
  const f = await fixture(t), session = await open(t, f);
  assert.throws(() => session.setPhase('PRIVATE_CANARY'), bad);
  await assert.rejects(session.finish(), bad);
  await session.close(); await stopped(session.url);
});

// An intermediate inventory must allow later writes without discarding earlier retained storage.
test('streamMeasurementCheckpointReconcilesThenKeepsEarlierHistory', async t => {
  const f = await fixture(t), session = await open(t, f);
  assert.equal(typeof session.checkpoint, 'function', 'reconcile failed commits before admitting more mutations');
  f.time(2); await send(session.url, 'PUT', 4, 1);
  f.time(3); const middle = await session.checkpoint();
  assert.equal(middle.requests.reconciled, true);
  assert.equal(middle.requests.accounting.producer.attempts, 7);
  assert.deepEqual(middle.storage.byteSeconds, { low: 4, high: 4 });
  middle.storage.objects.bytes = 999;
  f.time(4); session.setPhase('workload'); await send(session.url, 'PUT', 6, 2);
  f.time(6); const [one, two] = await Promise.all([session.finish(), session.finish()]);
  assert.deepEqual(one, two);
  assert.equal(one.requests.accounting.producer.attempts, 11);
  assert.deepEqual(one.storage.byteSeconds, { low: 20, high: 20 });
  assert.equal(one.storage.objects.bytes, 6);
  await assert.rejects(session.checkpoint(), bad);
});

// Serving requests during inventory can make a complete-looking final size miss a committed write.
test('streamMeasurementCheckpointRejectsRacingMutationsBeforeProviderAccess', async t => {
  const f = await fixture(t), session = await open(t, f);
  assert.equal(typeof session.checkpoint, 'function');
  await send(session.url, 'PUT', 4, 1);
  let entered, release;
  const inventory = new Promise(resolve => { entered = resolve; });
  f.state.holdList = resume => { release = resume; entered(); };
  const checked = session.checkpoint();
  const refusal = assert.rejects(checked, bad);
  await inventory; const before = f.state.requests;
  assert.equal(await send(session.url, 'PUT', 8, 2), 400);
  assert.equal(f.state.requests, before);
  release(); await refusal;
  await session.close().catch(error => assert.deepEqual({ message: error.message }, bad));
  await stopped(session.url); await assert.rejects(session.finish(), bad);
});

test('streamMeasurementIdleWithoutRequestsReportsZeroNativeTraffic', async t => {
  const f = await fixture(t), session = await open(t, f);
  f.time(2); session.setPhase('idle'); f.time(1202);
  const result = await session.finish();
  assert.deepEqual(result.phases, [{ phase: 'startup', elapsedSeconds: 2 }, { phase: 'idle', elapsedSeconds: 1200 }]);
  assert.equal(result.requests.accounting.producer.attempts, 6);
  assert.equal(result.requests.accounting.requests.some(r => r.phase !== 'observer'), false);
  assert.deepEqual(result.storage.byteSeconds, { low: 0, high: 0 });
});

// Cancellation after inventory but before resource collection must still prevent a successful result.
test('streamMeasurementCancellationDuringFinalSnapshotRefusesEvidence', async t => {
  const f = await fixture(t), controller = new AbortController(); let armed = false, snapshots = 0;
  const clock = f.args.clock;
  f.args.clock = () => {
    // Final inventory completion, history snapshot, request snapshot, then the phase end.
    if (armed && f.state.requests === 6 && ++snapshots === 4) controller.abort();
    return clock();
  };
  const session = await open(t, f, { signal: controller.signal });
  armed = true;
  await assert.rejects(session.finish(), bad);
  assert.equal(controller.signal.aborted, true);
  await session.close(); await stopped(session.url);
});

// Native requests cannot be relabelled as the observer traffic used to verify them.
test('streamMeasurementRefusesObserverAsANativePhase', async t => {
  const f = await fixture(t), session = await open(t, f);
  assert.throws(() => session.setPhase('observer'), bad);
  await assert.rejects(session.finish(), bad);
});

for (const versioned of [false, true]) test(`streamMeasurementRefusesPreexistingObjects_${versioned}`, async t => {
  const f = await fixture(t, versioned); f.rows.push({ version: 'v1', bytes: 4, marker: false });
  assert.equal(typeof module.openStreamMeasurement, 'function');
  await assert.rejects(module.openStreamMeasurement(f.args), bad);
});

// Observer inventories cannot make a newly spawned native writer appear ready.
test('streamMeasurementActivityWaitsForACompletedNativeTransfer', async t => {
  const f = await fixture(t), session = await open(t, f);
  assert.equal(typeof session.waitForActivity, 'function'); assert.equal(session.activity(), 0);
  let settled = false; const first = session.waitForActivity(0).then(value => { settled = true; return value; });
  await session.checkpoint(); assert.equal(settled, false); assert.equal(session.activity(), 0);
  assert.equal(await send(session.url, 'PUT', 4, 1), 200); assert.equal(await first, 1);
  assert.equal(session.activity(), 1); assert.equal(await session.waitForActivity(0), 1);
  const second = session.waitForActivity(1);
  assert.equal(await send(session.url, 'GET', 0, 2), 200); assert.equal(await second, 2);
});

test('streamMeasurementClosesAndRejectsItsPendingActivityWaiters', async t => {
  const f = await fixture(t), session = await open(t, f);
  assert.equal(typeof session.waitForActivity, 'function');
  const waiting = assert.rejects(session.waitForActivity(0), bad);
  await session.close(); await waiting;
});

// A phase change must wait for an entire native transfer without stopping its writer.
test('streamMeasurementChangesPhaseOnlyAfterTheActiveNativeBodySettles', async t => {
  const f = await fixture(t), session = await open(t, f), before = f.state.requests;
  assert.equal(typeof session.whenIdle, 'function'); assert.equal(typeof session.changePhase, 'function');
  const pending = new Promise((resolve, reject) => {
    const req = request(session.url + '/' + bucket + '/' + key, { method: 'PUT', agent: false, headers: {
      'content-length': 4, 'amz-sdk-invocation-id': '11111111-2222-4333-8444-000000000001', 'amz-sdk-request': 'attempt=1; max=2',
    } }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject); req.write(Buffer.alloc(2)); f.state.finishBody = () => req.end(Buffer.alloc(2));
  });
  for (let i = 0; i < 100 && f.state.requests === before; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.state.requests > before); let changed = false;
  const switching = session.changePhase('idle').then(() => { changed = true; });
  const idle = session.whenIdle(() => 17);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(changed, false);
  f.state.finishBody(); await pending; await switching; assert.equal(await idle, 17);
  assert.equal(await send(session.url, 'GET', 0, 2), 200);
  const result = await session.finish();
  assert.ok(result.requests.accounting.requests.some(row => row.phase === 'startup' && row.operation === 'put'));
  assert.ok(result.requests.accounting.requests.some(row => row.phase === 'idle' && row.operation === 'get'));
});


// A cleanup handoff must use the storage snapshot clock, not the later phase/report clock.
test('streamMeasurementHandsOffTheExactStorageSnapshotTime', async t => {
  const f = await fixture(t), original = f.args.clock; let tick = 0;
  f.args.clock = () => { original(); return tick++; };
  const session = await open(t, f);
  await send(session.url, 'PUT', 4, 1);
  const result = await session.finish();
  assert.equal(typeof result.storageEndedAt, 'number');
  // The phase clock and request-meter initialization precede the history's start at tick2.
  assert.equal(result.storageEndedAt, result.storage.windowSeconds + 2);
  assert.ok(result.storageEndedAt < result.phases.reduce((n, p) => n + p.elapsedSeconds, 0));
});

// Reads and unsuccessful writes cannot satisfy the native startup-upload requirement.
test('streamMeasurementUploadReadinessRequiresASuccessfullyCompletedPut', async t => {
  const f = await fixture(t), session = await open(t, f);
  assert.equal(typeof session.waitForUpload, 'function');
  let ready = false;
  const waiting = session.waitForUpload().then(() => { ready = true; });
  assert.equal(await send(session.url, 'GET', 0, 1), 200);
  assert.equal(ready, false, 'a completed read is not an upload');
  f.state.failedWrites = 1;
  assert.equal(await send(session.url, 'PUT', 4, 2), 503);
  assert.equal(ready, false, 'a refused upload is not startup readiness');
  assert.equal(await send(session.url, 'PUT', 4, 3), 200);
  await waiting; assert.equal(ready, true);
  await session.waitForUpload();
});

test('streamMeasurementCloseRejectsUploadReadinessWithoutAnySuccessfulWrite', async t => {
  const f = await fixture(t), session = await open(t, f);
  assert.equal(typeof session.waitForUpload, 'function');
  const waiting = assert.rejects(session.waitForUpload(), bad);
  await session.close(); await waiting;
  await assert.rejects(session.waitForUpload(), bad);
});

// Starting to send a body does not prove its upload has completed.
test('streamMeasurementUploadReadinessWaitsForTheCompleteRequestBody', async t => {
  const f = await fixture(t), session = await open(t, f), before = f.state.requests;
  assert.equal(typeof session.waitForUpload, 'function');
  let ready = false;
  const waiting = session.waitForUpload().then(() => { ready = true; });
  let finishBody;
  const sent = new Promise((resolve, reject) => {
    const req = request(session.url + '/' + bucket + '/' + key, { method: 'PUT', agent: false, headers: {
      'content-length': 4, 'amz-sdk-invocation-id': '11111111-2222-4333-8444-000000000001',
      'amz-sdk-request': 'attempt=1; max=2',
    } }, res => { res.resume(); res.on('end', resolve); res.on('error', reject); });
    req.on('error', reject); req.write(Buffer.alloc(2)); finishBody = () => req.end(Buffer.alloc(2));
  });
  try {
    for (let i = 0; i < 100 && f.state.requests === before; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(f.state.requests > before, 'admit the unfinished upload at the backend');
    assert.equal(ready, false);
  } finally { finishBody(); await sent; }
  await waiting; assert.equal(ready, true);
});
