import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createLitestreamAfterStop, createLitestreamRequestAudit, createLitestreamTransport, litestreamAfterStopOutput } from './litestream.mjs';
import { createMeter, createMeteringProxy, correlatedStorageAttempt, classifyStorageOperation, instrumentStorageClient } from './meter.mjs';
import { openLitestreamLifetimes, openLitestreamHistories } from './storage-lifetimes.mjs';
import { openLitestreamVersionHistories } from './stream-versions.mjs';

const bad = /Invalid cloud cost Litestream audit/;
const id = '11111111-2222-4333-8444-555555555555';
const headers = { 'amz-sdk-invocation-id': id, 'amz-sdk-request': 'attempt=1; max=3' };
const row = (operation = 'put', invocation = id) => ({ invocation, ordinal: 0, operation });
const admission = (hop, operation = 'put') => ({ ...row(operation), hop, phase: 'workload' });
const completion = () => ({ statusCode: 200, bytesOut: 4, interrupted: false, responseHeaders: {} });
const commit = () => ({ token: id + ':1', statusCode: 200, bytesOut: 4, expectedBytesOut: 4,
  requestComplete: true, versionId: null, deleteMarker: null });
const event = (channel, operation = 'put') => ({ token: id + ':1', channel, phase: 'workload', operation, retryOrdinal: 0,
  outcome: 'success', statusCode: 200, errorCode: null, sameAccount: null,
  bytesIn: 0, bytesOut: 4, attemptedBytesIn: 0, attemptedBytesOut: 4 });
const stop = ledger => ledger.acknowledgeStop({ statusCode: 200, ownedPath: '/PRIVATE_CANARY',
  body: Buffer.from('{"status":"stopped","path":"/PRIVATE_CANARY","txid":0}') });
const lifetime = (ledger, operation = 'put', versioned = false) => ledger.beginLifetime({ headers, operation, versioned });

// Restoring any missing-callback forwarding gate, inventing its event, or erasing its gap fails these cases.
for (const operation of ['put', 'get', 'head', 'list', 'delete', 'delete-many', 'multipart-create',
  'multipart-upload', 'multipart-complete', 'multipart-abort']) for (const stopped of [false, true]) {
  test(`lifetime ${operation} without request history collects as unknown, stopped=${stopped}`, () => {
    const ledger = createLitestreamAfterStop({ clock: () => 0 }); if (stopped) stop(ledger);
    let finish;
    assert.doesNotThrow(() => { finish = lifetime(ledger, operation); });
    assert.deepEqual(collect(finish), completionProjection());
    const result = ledger.snapshot();
    assert.equal(result.status, 'unknown'); assert.equal(result.requestsReconciled, false);
    assert.deepEqual(result.gaps, [...(stopped ? ['after-stop:body-bytes-unpaired'] : []), 'accounting:incomplete-history']);
    assert.equal(result.used, Number(stopped));
    assert.equal(result.producer.attempts, 0); assert.equal(result.observer.attempts, 0);
    assert.deepEqual(result.requests, []);
    assert.deepEqual(litestreamAfterStopOutput(result).afterStop, result);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|11111111/);
  });
}

for (const missing of ['all', 'producer', 'observer']) test(`real commit witness without ${missing} admission never invents request counts`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 });
  if (missing !== 'all') {
    ledger.issue(row()); ledger.admit(admission(missing === 'producer' ? 'observer' : 'producer'));
  }
  stop(ledger);
  assert.doesNotThrow(() => ledger.commit(commit()));
  const finish = lifetime(ledger);
  assert.deepEqual(collect(finish), completionProjection());
  const result = ledger.snapshot();
  assert.equal(result.used, 1); assert.equal(result.status, 'unknown');
  assert.deepEqual(result.gaps, ['after-stop:body-bytes-unpaired', 'accounting:incomplete-history']);
  assert.deepEqual(result.requests, []);
  assert.equal(result.producer.attempts, 0); assert.equal(result.observer.attempts, 0);
});

for (const versioned of [false, true]) test(`missing producer settlement does not hide real late commit, versioned=${versioned}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row());
  for (const hop of ['producer', 'observer']) ledger.admit(admission(hop));
  const finish = lifetime(ledger, 'put', versioned);
  ledger.commit({ ...commit(), versionId: versioned ? 'PRIVATE_VERSION' : null }); stop(ledger);
  ledger.settle(event('observer'));
  assert.deepEqual(collect(finish, { ...completion(), interrupted: true, responseHeaders: {} }), {
    statusCode: 200, responseHeaders: versioned ? { 'x-amz-version-id': 'PRIVATE_VERSION' } : {}, interrupted: false,
  });
  const result = ledger.snapshot();
  assert.equal(result.status, 'unknown'); assert.equal(result.requestsReconciled, false);
  assert.equal(result.producer.attempts, 0); assert.equal(result.observer.attempts, 1);
  assert.ok(result.gaps.includes('accounting:incomplete-history'));
});

test('a late lifetime without a commit preserves its actual interrupted reply', () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger);
  const finish = lifetime(ledger);
  assert.deepEqual(collect(finish, { statusCode: null, bytesOut: 2, interrupted: true, responseHeaders: {} }), {
    statusCode: null, responseHeaders: {}, interrupted: true,
  });
  assert.equal(ledger.snapshot().status, 'unknown');
  assert.equal(ledger.snapshot().producer.attempts, 0);
});

test('later telemetry cannot erase a missing lifetime history gap', () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 });
  const finish = lifetime(ledger); collect(finish); ledger.issue(row());
  for (const hop of ['producer', 'observer']) { ledger.admit(admission(hop)); ledger.settle(event(hop)); }
  const result = ledger.snapshot();
  assert.equal(result.requestsReconciled, true); assert.equal(result.status, 'unknown');
  assert.deepEqual(result.gaps, ['accounting:incomplete-history']);
});

test('complete request records cannot make an unfinished lifetime measured', () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row());
  for (const hop of ['producer', 'observer']) ledger.admit(admission(hop));
  const finish = lifetime(ledger);
  for (const channel of ['producer', 'observer']) ledger.settle(event(channel));
  const result = ledger.snapshot();
  assert.equal(result.requestsReconciled, true); assert.equal(result.status, 'unknown');
  assert.deepEqual(result.gaps, ['accounting:incomplete-history']);
  collect(finish);
  assert.equal(ledger.snapshot().status, 'unknown');
  assert.deepEqual(ledger.snapshot().gaps, ['accounting:incomplete-history']);
});

test('a clean after-stop LIST lifetime preserves the original observed admission and settlement counts', () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row('list')); stop(ledger);
  for (const hop of ['producer', 'observer']) ledger.admit(admission(hop, 'list'));
  const finish = lifetime(ledger, 'list');
  for (const channel of ['producer', 'observer']) ledger.settle(event(channel, 'list'));
  collect(finish);
  const result = ledger.snapshot();
  assert.equal(result.status, 'measured'); assert.equal(result.used, 1);
  assert.equal(result.lateAdmissions, 1); assert.equal(result.lateSettlements, 0);
  assert.equal(result.producer.attempts, 1); assert.equal(result.observer.attempts, 1);
});

for (const first of ['lifetime', 'commit']) test(`${first} evidence without admissions cannot bypass the stop cap`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); stop(ledger);
  for (let n = 1; n <= 4; n++) {
    const invocation = `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`;
    const record = () => first === 'commit' ? ledger.commit({ ...commit(), token: invocation + ':1' })
      : ledger.beginLifetime({ headers: { ...headers, 'amz-sdk-invocation-id': invocation }, operation: 'put', versioned: false });
    if (n <= 3) assert.doesNotThrow(record);
    else { assert.equal(ledger.snapshot().used, 3); assert.throws(record, bad); assert.throws(() => ledger.snapshot(), bad); }
  }
});

for (const [label, change] of [
  ['negative bytes', e => e.bytesOut = -1], ['unsafe bytes', e => e.bytesOut = Number.MAX_SAFE_INTEGER + 1],
  ['invalid status', e => e.statusCode = 99], ['missing status', e => e.statusCode = null],
  ['nonboolean cutoff', e => e.interrupted = 'yes'],
]) test(`missing producer telemetry cannot hide malformed lifetime ${label}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row()); ledger.admit(admission('producer'));
  const finish = lifetime(ledger), e = completion(); change(e);
  assert.throws(() => finish(e), bad); assert.throws(() => ledger.snapshot(), bad);
});

for (const mode of ['duplicate-lifetime', 'duplicate-completion', 'changed-operation', 'late-producer-status', 'clock']) {
  test(`missing lifetime history keeps ${mode} control fatal`, () => {
    let time = 1; const ledger = createLitestreamAfterStop({ clock: () => time });
    ledger.issue(row()); ledger.admit(admission('producer')); const finish = lifetime(ledger);
    if (mode === 'duplicate-lifetime') assert.throws(() => lifetime(ledger), bad);
    else if (mode === 'changed-operation') assert.throws(() => lifetime(ledger, 'list'), bad);
    else {
      collect(finish);
      if (mode === 'duplicate-completion') assert.throws(() => finish(completion()), bad);
      else if (mode === 'late-producer-status') assert.throws(() => ledger.settle({ ...event('producer'), statusCode: 201 }), bad);
      else { time = 0; assert.throws(() => ledger.snapshot(), bad); }
    }
    assert.throws(() => ledger.snapshot(), bad);
  });
}

for (const statusCode of [201, 503]) test(`missing producer counter cannot normalize a response contradicting its real commit: ${statusCode}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row());
  for (const hop of ['producer', 'observer']) ledger.admit(admission(hop));
  const finish = lifetime(ledger); ledger.commit(commit()); stop(ledger);
  assert.throws(() => finish({ ...completion(), statusCode }), bad);
  assert.throws(() => ledger.snapshot(), bad);
});

test('a real commit can bound a missing reply without inventing its HTTP status or request count', () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row());
  for (const hop of ['producer', 'observer']) ledger.admit(admission(hop));
  const finish = lifetime(ledger); ledger.commit(commit()); stop(ledger);
  assert.deepEqual(collect(finish, { ...completion(), statusCode: null, interrupted: true }), completionProjection());
  const result = ledger.snapshot();
  assert.equal(result.producer.attempts, 0); assert.equal(result.observer.attempts, 0);
  assert.equal(result.status, 'unknown'); assert.ok(result.gaps.includes('accounting:request-cutoff'));
  assert.ok(result.gaps.includes('accounting:incomplete-history'));
  assert.deepEqual(litestreamAfterStopOutput(result).afterStop, result);
});

for (const missingAt of ['commit', 'lifetime-begin', 'lifetime-completion']) {
  test(`later complete request telemetry cannot erase the event-time gap at ${missingAt}`, () => {
    const ledger = createLitestreamAfterStop({ clock: () => 0 }); let finish;
    if (missingAt === 'commit') ledger.commit(commit());
    else if (missingAt === 'lifetime-begin') finish = lifetime(ledger);
    ledger.issue(row()); for (const hop of ['producer', 'observer']) ledger.admit(admission(hop));
    if (missingAt === 'lifetime-completion') { finish = lifetime(ledger); collect(finish); }
    for (const channel of ['producer', 'observer']) ledger.settle(event(channel));
    if (missingAt === 'lifetime-begin') collect(finish);
    const result = ledger.snapshot();
    assert.equal(result.requestsReconciled, true); assert.equal(result.status, 'unknown');
    assert.deepEqual(result.gaps, ['accounting:incomplete-history']);
  });
}

for (const stage of ['lifetime-begin', 'lifetime-completion']) test(`missing history cannot hide a backwards clock at ${stage}`, () => {
  let time = 2; const ledger = createLitestreamAfterStop({ clock: () => time }); ledger.issue(row());
  if (stage === 'lifetime-begin') { time = 1; assert.throws(() => lifetime(ledger), bad); }
  else { const finish = lifetime(ledger); time = 1; assert.throws(() => finish(completion()), bad); }
  assert.throws(() => ledger.snapshot(), bad);
});

for (const [label, change] of [
  ['incomplete body', e => e.requestComplete = false], ['partial body', e => e.bytesOut = 3],
  ['unsafe size', e => e.bytesOut = e.expectedBytesOut = Number.MAX_SAFE_INTEGER + 1],
  ['failed backend', e => e.statusCode = 503], ['delete marker', e => e.deleteMarker = 'true'],
  ['empty version', e => e.versionId = ''], ['private field', e => e.private = 'PRIVATE_CANARY'],
  ['malformed identity', e => e.token = 'PRIVATE_CANARY'],
]) test(`missing request records cannot forgive malformed commit ${label}`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }), e = commit(); change(e);
  assert.throws(() => ledger.commit(e), bad); assert.throws(() => ledger.snapshot(), bad);
});

for (const source of ['commit', 'lifetime']) test(`a ${source} cannot change an already known request operation`, () => {
  const ledger = createLitestreamAfterStop({ clock: () => 0 }); ledger.issue(row('list'));
  assert.throws(() => source === 'commit' ? ledger.commit(commit()) : lifetime(ledger), bad);
  assert.throws(() => ledger.snapshot(), bad);
});

// These three real storage histories share the optional callback ledger; inventories use the actual stored bytes.
const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const models = [['put-only', openLitestreamLifetimes], ['unversioned', openLitestreamHistories], ['versioned', openLitestreamVersionHistories]];
for (const [name, open] of models) for (const missing of ['producer-admission', 'observer-admission', 'producer-settlement', 'all']) {
  test(`${name} real PUT with missing ${missing} forwards, verifies inventory and closes`, { timeout: 5000 }, async t => {
    let time = 0, stored = false, puts = 0;
    const key = 'PRIVATE_OBJECT', versioned = name === 'versioned';
    const ledger = createLitestreamAfterStop({ clock: () => time });
    const afterStop = { ...ledger, issue: x => { if (missing !== 'all') ledger.issue(x); },
      admit: x => { if (missing !== 'all' && missing !== `${x.hop}-admission`) ledger.admit(x); },
      settle: (x, interruption) => { if (missing !== 'all' && missing !== `${x.channel}-settlement`) return ledger.settle(x, interruption); return false; } };
    const backend = createServer((req, res) => {
      let bytes = 0; req.on('data', b => bytes += b.length);
      req.on('end', () => {
        if (req.method === 'PUT') {
          puts++; stored = true;
          try {
            ledger.commit({ token: id + ':1', statusCode: 200, bytesOut: bytes, expectedBytesOut: 4,
              requestComplete: req.complete, versionId: versioned ? 'v1' : null, deleteMarker: null });
          } catch { res.writeHead(500); res.end(); return; }
          time = 3; res.writeHead(200, versioned ? { 'x-amz-version-id': 'v1' } : {}); res.end();
        } else if (req.url.includes('versioning')) res.end(`<VersioningConfiguration>${versioned ? '<Status>Enabled</Status>' : ''}</VersioningConfiguration>`);
        else if (req.url.includes('uploads')) res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
        else if (req.url.includes('versions')) res.end(`<ListVersionsResult><IsTruncated>false</IsTruncated>${stored ? `<Version><Key>${key}</Key><VersionId>v1</VersionId><IsLatest>true</IsLatest><Size>4</Size></Version>` : ''}</ListVersionsResult>`);
        else res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${stored ? `<Contents><Key>${key}</Key><Size>4</Size></Contents>` : ''}</ListBucketResult>`);
      });
    });
    backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
    t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
    const target = `http://127.0.0.1:${backend.address().port}`;
    const inventoryMeter = createMeter({ phase: 'observer', clock: () => time });
    const inventory = await createMeteringProxy({ target, meter: inventoryMeter, classify: correlatedStorageAttempt });
    t.after(() => inventory.close());
    const client = new sdk.S3Client({ endpoint: inventory.url, region: 'eu-north-1', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: 'SYNTHETIC', secretAccessKey: 'SYNTHETIC' } });
    instrumentStorageClient({ client, meter: inventoryMeter, phase: 'observer', endpoint: inventory.url }); t.after(() => client.destroy());
    const lifetimes = await open({ client, sdk, bucket: 'synthetic', clock: () => time, meter: inventoryMeter, afterStop });
    const meter = createMeter({ phase: 'workload', clock: () => time, afterStop });
    const audit = createLitestreamRequestAudit({ phase: 'workload', afterStop });
    const observer = await createMeteringProxy({ target, meter,
      classify: x => audit.observe({ headers: x.headers, operation: classifyStorageOperation(x) }) });
    t.after(() => observer.close().catch(() => {}));
    const front = await createLitestreamTransport({ target: observer.url, meter, phase: 'workload', afterStop, lifetimes });
    t.after(() => front.close().catch(() => {}));
    audit.write(Buffer.from(`SDK 2026/11/06 DEBUG Request\nPUT /synthetic/${key} HTTP/1.1\namz-sdk-invocation-id: ${id}\namz-sdk-request: attempt=1; max=3\n\n`));
    time = 2; stop(ledger);
    assert.equal(await new Promise((resolve, reject) => {
      const req = request(`${front.url}/synthetic/${key}`, { method: 'PUT', headers: { ...headers, 'content-length': '4' } }, res => {
        res.resume(); res.on('error', reject); res.on('end', () => resolve(res.statusCode));
      }); req.on('error', reject); req.end('four');
    }), 200);
    await assert.doesNotReject(() => front.whenIdle(() => {})); audit.end(); await front.close(); await observer.close();
    time = 5; await lifetimes.verify(); time = 10;
    assert.equal(puts, 1); assert.equal(front.checkpoint().pending, 0); assert.equal(front.checkpoint().connections, 0);
    const storage = lifetimes.snapshot();
    assert.equal(storage.objects.bytes, 4); assert.deepEqual(storage.byteSeconds, { low: 28, high: 32 });
    const original = meter.snapshot();
    assert.equal(original.status, 'unknown'); assert.ok(original.gaps.includes('accounting:incomplete-history'));
    assert.deepEqual(original.accounting.producer, { attempts: 1, bytesIn: 0, bytesOut: 4 });
    assert.deepEqual(original.accounting.observer, { attempts: 1, bytesIn: 0, bytesOut: 4 });
    const result = ledger.snapshot(); assert.equal(result.status, 'unknown'); assert.equal(result.used, 1);
    assert.equal(result.producer.attempts, ['all', 'producer-settlement'].includes(missing) ? 0 : 1);
    assert.equal(result.observer.attempts, missing === 'all' ? 0 : 1);
    assert.deepEqual(litestreamAfterStopOutput(result).afterStop, result);
    assert.doesNotMatch(JSON.stringify({ original, storage, result }), /PRIVATE|11111111|v1/);
  });
}

function completionProjection() { return { statusCode: 200, responseHeaders: {}, interrupted: false }; }

function collect(finish, input = completion()) {
  let result; assert.doesNotThrow(() => { result = finish(input); }); return result;
}
