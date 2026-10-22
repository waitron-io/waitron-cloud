import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
const require = createRequire(new URL('../../packages/backups/package.json', import.meta.url));
const sdk = require('@aws-sdk/client-s3');
const module = await import('./replay-stream.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./replay-stream.mjs', import.meta.url).href) return {};
  throw error;
});
const bad = { message: 'Invalid cloud cost replay stream' };

// The child performs real HTTP/SQLite I/O; the separate storage endpoint inventories its bytes.
async function fixture(t, mode = 'normal') {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cost-replay-stream-')));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  for (const path of [source, root]) mkdirSync(path, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { token, path: join(root, 'journal.json') };
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  writeFileSync(join(root, 'unrelated'), 'keep', { mode: 0o600 });
  const database = join(root, 'venue.db'); const db = new DatabaseSync(database);
  db.exec('CREATE TABLE sales(id INTEGER PRIMARY KEY CHECK(id>0)); INSERT INTO sales VALUES(1)');
  if (mode === 'empty') db.exec('DELETE FROM sales'); db.close();
  let stored, uploaded = 0, releaseUpload, heldResponse, releaseInventory, inventoryHeld;
  const heldUpload = new Promise(resolve => { heldResponse = resolve; });
  const heldInventory = new Promise(resolve => { inventoryHeld = resolve; });
  let readCompleted; const firstRead = new Promise(resolve => { readCompleted = resolve; });
  const provider = createServer((req, res) => {
    const url = new URL(req.url, 'http://local'), parts = [];
    req.on('data', chunk => parts.push(chunk)); req.on('end', () => {
      if (req.method === 'PUT') {
        stored = Buffer.concat(parts); uploaded++;
        if (['held-upload','held-fast-stop','held-invalid'].includes(mode) && uploaded === 2) {
          releaseUpload = () => mode === 'held-invalid' ? res.destroy() : res.end(); heldResponse();
        } else res.end();
      }
      else if (url.searchParams.has('versioning')) {
        if (mode === 'held-opening') {
          releaseInventory = () => res.end('<VersioningConfiguration/>'); inventoryHeld();
        } else res.end('<VersioningConfiguration/>');
      }
      else if (url.searchParams.has('uploads')) res.end('<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>');
      else if (url.searchParams.get('list-type') === '2') res.end('<ListBucketResult><IsTruncated>false</IsTruncated>'
        + (stored ? `<Contents><Key>stream.ltx</Key><Size>${stored.length}</Size></Contents>` : '') + '</ListBucketResult>');
      else {
        if (mode === 'read-before-upload' && req.method === 'GET')
          res.once('finish', () => readCompleted(performance.now()));
        res.end(stored ?? Buffer.alloc(0));
      }
    });
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  t.after(() => { provider.closeAllConnections(); return new Promise(resolve => provider.close(resolve)); });
  const binary = join(root, 'synthetic-writer');
  const text = `#!${process.execPath}
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const mode = ${JSON.stringify(mode)};
if (process.argv[2] === 'version') { process.stdout.write(mode === 'version' ? 'OTHER' : '0.5.17'); process.exit(0); }
console.log('PRIVATE_CHILD_STDOUT_CANARY'); console.error('PRIVATE_CHILD_STDERR_CANARY');
if (process.env.PRIVATE_STREAM_ENV) process.exit(73);
const c = JSON.parse(readFileSync(process.argv[process.argv.indexOf('-config') + 1], 'utf8')).dbs[0];
let serial = Promise.resolve(), stopping = false;
const send = (method, bytes) => new Promise((resolve, reject) => {
  const r = request(c.replica.endpoint + '/' + c.replica.bucket + '/stream.ltx', { method, agent: false, headers: {
    'content-length': bytes.length, 'amz-sdk-invocation-id': randomUUID(), 'amz-sdk-request': 'attempt=1; max=1',
  } }, res => { const chunks=[]; res.on('data', b=>chunks.push(b)); res.on('end',()=>resolve(Buffer.concat(chunks))); });
  r.on('error', reject); r.end(bytes);
});
if (process.argv[2] === 'restore') {
  const bytes = await send('GET', Buffer.alloc(0));
  const output = process.argv[process.argv.indexOf('-o')+1];
  writeFileSync(output, mode === 'corrupt' ? 'not sqlite' : bytes);
  if(mode === 'integrity') { const db=new DatabaseSync(output); db.exec('PRAGMA ignore_check_constraints=ON; UPDATE sales SET id=-1'); db.close(); }
  process.exit(mode === 'restore' ? 17 : 0);
}
if (mode === 'exit') process.exit(19);
if (mode === 'hangup') process.kill(process.pid, 'SIGHUP');
const upload = () => { if (!stopping) serial = serial.then(()=>send('PUT',readFileSync(c.path))).catch(()=>process.exit(18)); };
if (mode === 'read-then-exit') { await send('GET', Buffer.alloc(0)); process.exit(19); }
if (mode === 'read-before-upload') {
  await send('GET', Buffer.alloc(0));
  writeFileSync(c.path + '.read-complete', 'ready');
  while (!existsSync(c.path + '.allow-upload')) await new Promise(resolve => setTimeout(resolve, 10));
}
upload(); const timer=setInterval(upload,50);
process.once('SIGTERM',()=>{
  if(mode === 'hang') return;
  if(mode === 'held-fast-stop') process.exit(0);
  stopping=true; clearInterval(timer); serial.then(()=>process.exit(mode === 'stop' ? 23 : 0));
});
`;
  writeFileSync(binary, text, { mode: 0o700 });
  t.after(async () => {
    // Fault experiments may omit collection; recover only recorded children with this fixture's executable.
    const entries = JSON.parse(readFileSync(journal.path, 'utf8')).localResources ?? [];
    for (const entry of entries.filter(e => e.kind === 'stream-process' && e.state === 'started')) {
      if (entries.some(e => e.kind === 'stream-process' && e.state === 'collected' && e.pid === entry.pid)) continue;
      let args;
      try { args = execFileSync('ps', ['-p', String(entry.pid), '-o', 'args='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { continue; }
      if (args.includes(binary)) {
        process.kill(entry.pid, 'SIGKILL');
        for (let n = 0; n < 100; n++) { try { process.kill(entry.pid, 0); } catch { break; } await wait(10); }
      }
    }
    rmSync(parent, { recursive: true });
  });
  return { source, root, journal, database, binary, binarySha256: createHash('sha256').update(text).digest('hex'),
    target: `http://127.0.0.1:${provider.address().port}`, sdk, bucket: 'synthetic-replay-stream', versioned: false,
    uploaded: () => uploaded, stored: () => stored, heldUpload, releaseUpload: () => releaseUpload(),
    heldInventory, releaseInventory: () => releaseInventory(), firstRead };
}
async function open(t, f) {
  assert.equal(typeof module.openReplayStream, 'function', 'run and collect the native writer around phase measurements');
  const run = await module.openReplayStream(f);
  t.after(() => run.close().catch(error => assert.equal(error.message, bad.message))); return run;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function upload(f) { for (let i = 0; i < 100 && !f.uploaded(); i++) await wait(20); assert.ok(f.uploaded() > 0); }
function clean(f) {
  assert.equal(existsSync(join(f.root, 'native-stream')), false);
  assert.equal(existsSync(f.database), true); assert.equal(readFileSync(join(f.root, 'unrelated'), 'utf8'), 'keep');
  const entries = JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources;
  for (const e of entries?.filter(e => e.kind === 'stream-process' && e.state === 'started') ?? []) {
    assert.throws(() => process.kill(e.pid, 0), { code: 'ESRCH' }, 'collect exact native children');
    assert.ok(entries.some(done => done.kind === 'stream-process' && done.state === 'collected' && done.pid === e.pid));
  }
}

// Dropping phase transitions, inventory checks, restore counts or child collection breaks this journey.
test('replayStreamKeepsOneWriterAcrossPhasesAndRestoresAllExpectedSales', async t => {
  const f = await fixture(t); process.env.PRIVATE_STREAM_ENV = 'PRIVATE_ENV_CANARY';
  t.after(() => { delete process.env.PRIVATE_STREAM_ENV; });
  const run = await open(t, f); await upload(f);
  const startup = await run.setPhase('workload'); assert.deepEqual(startup, { phase: 'workload' });
  const db = new DatabaseSync(f.database); db.exec('INSERT INTO sales VALUES(2)'); db.close();
  await wait(150); await run.setPhase('idle'); await wait(100);
  await run.setPhase('verification'); await wait(100);
  const result = await run.finish({ expectedSales: 2 });
  assert.deepEqual(result.restored, { sales: 2, integrity: true });
  assert.equal(result.stream.status, 'measured'); assert.equal(result.stream.requests.reconciled, true);
  assert.equal(result.stream.storage.objects.bytes, 8192);
  for (const phase of ['startup', 'workload', 'idle', 'verification', 'restore']) {
    assert.ok(result.stream.phases.some(row => row.phase === phase && row.elapsedSeconds > 0));
    assert.ok(result.stream.requests.accounting.requests.some(row => row.phase === phase));
  }
  assert.deepEqual(result.native, { version: '0.5.17', writerStarts: 1, phaseRestarts: 0 });
  assert.deepEqual(result.cleanup, { processes: 0, privateRoots: 0 });
  assert.equal(/PRIVATE_|\/|stream\.ltx|synthetic-/.test(JSON.stringify(result)), false);
  assert.deepEqual(await run.finish({ expectedSales: 2 }), result); await run.close(); clean(f);
});

for (const mode of ['restore', 'corrupt', 'integrity', 'stop', 'exit', 'hang']) test(`replayStreamRefusesNativeFailureAndCollectsOnlyOwnedState_${mode}`, async t => {
  const f = await fixture(t, mode);
  if (mode === 'exit') {
    let unexpected;
    try { await assert.rejects(async () => { unexpected = await module.openReplayStream(f); }, bad); }
    finally { await unexpected?.close(); }
    clean(f); return;
  }
  const run = await open(t, f); await upload(f);
  await assert.rejects(run.finish({ expectedSales: 1 }), bad);
  await run.close(); clean(f);
});

test('replayStreamRefusesMissingSalesInAnOtherwiseValidRestoredDatabase', async t => {
  const f = await fixture(t), run = await open(t, f); await upload(f);
  await assert.rejects(run.finish({ expectedSales: 2 }), bad); clean(f);
});

test('replayStreamCancellationClosesNativeChildrenAndListeners', async t => {
  const f = await fixture(t), abort = new AbortController(), run = await open(t, { ...f, signal: abort.signal });
  await upload(f); abort.abort(); await run.close(); clean(f);
  await assert.rejects(run.finish({ expectedSales: 1 }), bad);
});

// Binary integrity, local destination and fresh owned state must be checked before child launch.
for (const change of ['hash', 'version', 'endpoint', 'database', 'occupied', 'symlink', 'aborted'])
  test(`replayStreamRefusesUnsafeAdmission_${change}`, async t => {
    const f = await fixture(t, change === 'version' ? 'version' : 'normal');
    if (change === 'hash') f.binarySha256 = '0'.repeat(64);
    if (change === 'endpoint') f.target = 'https://s3.amazonaws.com';
    if (change === 'database') f.database = join(f.source, 'missing.db');
    if (change === 'occupied') mkdirSync(join(f.root, 'native-stream'), { mode: 0o700 });
    if (change === 'symlink') symlinkSync(f.source, join(f.root, 'native-stream'));
    if (change === 'aborted') { const abort = new AbortController(); abort.abort(); f.signal = abort.signal; }
    assert.equal(typeof module.openReplayStream, 'function');
    let unexpected;
    try { await assert.rejects(async () => { unexpected = await module.openReplayStream(f); }, bad); }
    finally { await unexpected?.close(); }
    if (['hash', 'database', 'endpoint', 'aborted'].includes(change))
      assert.equal(JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources, undefined, 'unsafe input cannot launch a child');
    assert.equal(readFileSync(join(f.root, 'unrelated'), 'utf8'), 'keep');
    if (['occupied', 'symlink'].includes(change)) assert.equal(existsSync(join(f.root, 'native-stream')), true);
  });

test('replayStreamSuppressesNativeOutputAndPrivateInheritedEnvironment', async () => {
  const child = spawn(process.execPath, ['--test', '--test-name-pattern=^replayStreamKeepsOneWriterAcrossPhasesAndRestoresAllExpectedSales$',
    new URL(import.meta.url).pathname], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
  const parts = []; child.stdout.on('data', b => parts.push(b)); child.stderr.on('data', b => parts.push(b));
  const [code] = await once(child, 'close');
  assert.equal(code, 0, Buffer.concat(parts).toString());
  assert.match(Buffer.concat(parts).toString(), /[ℹ#] tests 1\b/);
  assert.match(Buffer.concat(parts).toString(), /[ℹ#] pass 1\b/);
  assert.equal(/PRIVATE_(CHILD|ENV)/.test(Buffer.concat(parts).toString()), false);
});

for (const next of ['startup', 'restore', 'cleanup', 'unknown']) test(`replayStreamRefusesOutOfOrderPhase_${next}`, async t => {
  const f = await fixture(t), run = await open(t, f); await upload(f);
  await assert.rejects(run.setPhase(next), bad); clean(f);
});

for (const expectedSales of [0, -1, 1.5, 100001, '1']) test(`replayStreamRefusesInvalidExpectedSales_${expectedSales}`, async t => {
  const f = await fixture(t), run = await open(t, f); await upload(f);
  await assert.rejects(run.finish({ expectedSales }), bad); clean(f);
});

test('replayStreamRefusesChangedExecutableBeforeTheNextLaunch', async t => {
  const f = await fixture(t), run = await open(t, f); await upload(f);
  writeFileSync(f.binary, readFileSync(f.binary, 'utf8') + '\n// changed executable, still valid\n');
  await assert.rejects(run.finish({ expectedSales: 1 }), bad); clean(f);
});

test('replayStreamRefusesAnEmptyReplayEvenWhenRestoreAlsoContainsZeroSales', async t => {
  const f = await fixture(t, 'empty'), run = await open(t, f); await upload(f);
  await assert.rejects(run.finish({ expectedSales: 0 }), bad); clean(f);
});

// A deadline covers the whole measurement, rather than restarting for each native child.
test('replayStreamDeadlineStopsTheWriterBeforeACompleteLookingResultCanEscape', async t => {
  const f = await fixture(t), run = await open(t, { ...f, windowSeconds: 0.7 });
  await upload(f); await wait(800);
  await assert.rejects(run.finish({ expectedSales: 1 }), bad); await run.close(); clean(f);
});

test('replayStreamCleanupRefusesAReplacedScratchDirectory', async t => {
  const f = await fixture(t), run = await open(t, f); await upload(f);
  const scratch = join(f.root, 'native-stream'); renameSync(scratch, join(f.root, 'saved-stream'));
  mkdirSync(scratch, { mode: 0o700 }); writeFileSync(join(scratch, 'unrelated'), 'keep replacement', { mode: 0o600 });
  await assert.rejects(run.close(), bad);
  assert.equal(readFileSync(join(scratch, 'unrelated'), 'utf8'), 'keep replacement');
  const entries = JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources;
  for (const e of entries.filter(e => e.kind === 'stream-process' && e.state === 'started'))
    assert.throws(() => process.kill(e.pid, 0), { code: 'ESRCH' });
});

// Closing the measurement listener before the signalled writer drains its upload breaks collection.
for (const reason of ['cancel', 'deadline']) test(`replayStreamDrainsAnAdmittedUploadBeforeCollectingTheSession_${reason}`, { timeout: 10000 }, async t => {
  const f = await fixture(t, 'held-upload'), controller = new AbortController();
  const began = performance.now();
  const run = await open(t, { ...f, signal: controller.signal, windowSeconds: 5 });
  const endpoint = JSON.parse(readFileSync(join(f.root, 'native-stream/stream.json'), 'utf8')).dbs[0].replica.endpoint;
  await f.heldUpload;
  if (reason === 'cancel') controller.abort();
  else await wait(Math.max(0, 5100 - (performance.now() - began)));
  f.releaseUpload();
  await assert.rejects(run.finish({ expectedSales: 1 }), bad);
  await run.close(); await run.close(); clean(f);
  await assert.rejects(fetch(endpoint), error => error.cause?.code === 'ECONNREFUSED');
});

// A session acquired after cancellation must still be closed by the replay that owns it.
for (const reason of ['cancel', 'deadline']) test(`replayStreamCollectsASessionStillOpeningAt_${reason}`, { timeout: 10000 }, async t => {
  const f = await fixture(t, 'held-opening'), controller = new AbortController();
  let adminUrl;
  const observedSdk = { ...sdk, S3Client: class extends sdk.S3Client {
    constructor(options) { super(options); adminUrl = options.endpoint; }
  } };
  const opening = module.openReplayStream({ ...f, sdk: observedSdk, signal: controller.signal,
    windowSeconds: reason === 'deadline' ? 0.7 : 5 });
  const refused = assert.rejects(opening, bad);
  await f.heldInventory;
  if (reason === 'cancel') controller.abort();
  else await wait(800);
  f.releaseInventory();
  await refused;
  await assert.rejects(fetch(adminUrl), error => error.cause?.code === 'ECONNREFUSED', 'collect the real session listener even when it opens after cancellation');
  clean(f);
  assert.equal(JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources, undefined, 'never admit a native child after cancellation');
});


// A native child may exit immediately on SIGTERM while its admitted HTTP request is still active.
test('cancellationDrainsAnAdmittedUploadBeforeSignallingAFastExitingWriter',async t=>{
  const f=await fixture(t,'held-fast-stop'),abort=new AbortController();
  const run=await open(t,{...f,signal:abort.signal});
  await f.heldUpload;abort.abort();
  const closed=run.close().then(()=>true,()=>false);
  await wait(150);f.releaseUpload();
  assert.equal(await closed,true,'collect the writer after its admitted request finishes');
  clean(f);
});


// Bad accounting must refuse publication while still reporting independently completed resource cleanup.
test('invalidTransferStillReportsCollectedOwnedResourcesWithoutQualifyingEvidence',async t=>{
  const f=await fixture(t,'held-invalid'),run=await open(t,f);
  await f.heldUpload;f.releaseUpload();await wait(100);
  assert.equal(typeof run.closeResources,'function','resource collection must be distinct from valid measurement');
  assert.deepEqual(await run.closeResources(),{measurementValid:false});
  await assert.rejects(run.close(),bad);
  clean(f);
});

test('resourceCollectionCannotReportSuccessForAReplacedStreamRoot',async t=>{
  const f=await fixture(t),run=await open(t,f);await upload(f);
  const scratch=join(f.root,'native-stream');renameSync(scratch,join(f.root,'saved-stream'));
  mkdirSync(scratch,{mode:0o700});writeFileSync(join(scratch,'sentinel'),'keep',{mode:0o600});
  assert.equal(typeof run.closeResources,'function');
  await assert.rejects(run.closeResources(),bad);
  assert.equal(readFileSync(join(scratch,'sentinel'),'utf8'),'keep');
});

// Losing native exit evidence or the refusing stage makes the next paced failure untraceable.
for (const [mode, stage, code] of [['restore', 'restore', 17], ['integrity', 'restore-integrity', 0]])
  test('replayStreamReportsSanitisedNativeFailureBeforeCleanup_' + mode, async t => {
    const f = await fixture(t, mode), trace = [];
    const run = await open(t, { ...f, onDiagnostic: event => trace.push(event) });
    await upload(f);
    await assert.rejects(run.finish({ expectedSales: 1 }), bad);
    clean(f);
    assert.ok(trace.some(event => event.kind === 'stream-refusal' && event.stage === stage), JSON.stringify(trace));
    assert.ok(trace.some(event => event.kind === 'native' && event.operation === 'restore'
      && event.code === code && event.signal === null && event.stderrBytes > 0), JSON.stringify(trace));
    assert.equal(JSON.stringify(trace).includes('PRIVATE_'), false);
  });

// An observer must never interrupt collection or replace the measurement's refusal.
test('replayStreamCollectsResourcesWhenTheDiagnosticObserverThrows', async t => {
  const f = await fixture(t, 'restore');
  const run = await open(t, { ...f, onDiagnostic: event => {
    if (event.kind === 'stream-refusal') throw Error('PRIVATE_OBSERVER_CANARY');
  } });
  await upload(f);
  await assert.rejects(run.finish({ expectedSales: 1 }), bad);
  clean(f);
});

test('replayStreamPreservesTraceForAnUnlistedNativeSignal', async t => {
  const f = await fixture(t, 'hangup'), trace = [];
  await assert.rejects(module.openReplayStream({ ...f, onDiagnostic: event => trace.push(event) }), bad);
  clean(f);
  assert.ok(trace.some(event => event.kind === 'native' && event.operation === 'replicate' && event.signal === 'other'), JSON.stringify(trace));
  const { workerFailureTrace } = await import('./worker-diagnostic.mjs');
  assert.deepEqual(workerFailureTrace(trace), trace);
});

test('replayStreamContainsAsynchronousDiagnosticObserverRejections', async t => {
  const f = await fixture(t, 'restore');
  const run = await open(t, { ...f, onDiagnostic: async () => { throw Error('PRIVATE_ASYNC_CANARY'); } });
  await upload(f); await assert.rejects(run.finish({ expectedSales: 1 }), bad); clean(f);
});

// A completed read must not admit workload before any startup upload has succeeded.
test('replayStreamReadinessWaitsForAnUploadAfterAnInitialRead', { timeout: 10000 }, async t => {
  const f = await fixture(t, 'read-before-upload');
  let run;
  const opening = module.openReplayStream(f).then(value => { run = value; return value; });
  try {
    for (let i = 0; i < 200 && !existsSync(f.database + '.read-complete'); i++) await wait(10);
    assert.equal(existsSync(f.database + '.read-complete'), true, 'complete the child read before testing readiness');
    await wait(50);
    assert.equal(run, undefined, 'a read alone cannot prove the startup upload required by admission');
    writeFileSync(f.database + '.allow-upload', 'ready');
    await opening;
    await run.setPhase('workload'); await run.setPhase('idle'); await run.setPhase('verification');
    const result = await run.finish({ expectedSales: 1 });
    assert.ok(result.stream.requests.accounting.requests.some(row => row.phase === 'startup'
      && row.operation === 'put' && row.successful > 0));
    assert.deepEqual(result.restored, { sales: 1, integrity: true });
  } finally {
    writeFileSync(f.database + '.allow-upload', 'ready');
    await (await opening).close();
  }
  clean(f);
});

// Cancellation while waiting for the first upload still collects the recorded writer.
test('replayStreamCancellationCollectsAWriterThatOnlyCompletedARead', { timeout: 10000 }, async t => {
  const f = await fixture(t, 'read-before-upload'), controller = new AbortController();
  const opening = module.openReplayStream({ ...f, signal: controller.signal });
  const refused = assert.rejects(opening, bad);
  try {
    for (let i = 0; i < 200 && !existsSync(f.database + '.read-complete'); i++) await wait(10);
    assert.equal(existsSync(f.database + '.read-complete'), true);
  } finally { controller.abort(); await refused; }
  clean(f);
});

// Upload readiness and the minimum startup observation must share the first-transfer clock.
test('replayStreamOverlapsTheStartupObservationWithWaitingForItsFirstUpload', { timeout: 10000 }, async t => {
  const f = await fixture(t, 'read-before-upload');
  const opening = module.openReplayStream({ ...f, startupSeconds: 2, windowSeconds: 3.2 });
  let release;
  try {
    const firstReadAt = await f.firstRead;
    release = setTimeout(() => writeFileSync(f.database + '.allow-upload', 'ready'), 1500);
    const run = await opening;
    assert.ok(performance.now() - firstReadAt >= 2000, 'observe the full startup minimum after a completed native transfer');
    const result = await run.finish({ expectedSales: 1 });
    assert.deepEqual(result.restored, { sales: 1, integrity: true });
    assert.ok(result.stream.phases[0].elapsedSeconds >= 2);
  } finally {
    clearTimeout(release); writeFileSync(f.database + '.allow-upload', 'ready');
    await opening.then(run => run.close(), () => {});
  }
  clean(f);
});

for (const startupSeconds of [-1, NaN, 301, '2'])
  test('replayStreamRefusesInvalidStartupObservation_' + startupSeconds, async t => {
    const f = await fixture(t, 'read-then-exit'); let run;
    try {
      await assert.rejects(async () => { run = await module.openReplayStream({ ...f, startupSeconds }); }, bad);
      assert.equal(JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources, undefined);
    } finally { await run?.close(); }
  });

// Early native exit must cancel the concurrent observation, not leave its timer alive.
test('replayStreamEarlyExitCollectsItsStartupObservation', async t => {
  const f = await fixture(t, 'read-then-exit');
  await assert.rejects(module.openReplayStream({ ...f, startupSeconds: 30, windowSeconds: 2 }), bad);
  clean(f);
});

test('replayStreamEarlyExitLeavesNoStartupTimerKeepingTheProcessAlive', () => {
  const child = spawnSync(process.execPath, ['--test',
    '--test-name-pattern=^replayStreamEarlyExitCollectsItsStartupObservation$', new URL(import.meta.url).pathname],
    { env: { PATH: process.env.PATH }, timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(child.status, 0, child.stderr + child.stdout);
  assert.match(child.stdout, /[ℹ#] tests 1\b/);
  assert.match(child.stdout, /[ℹ#] pass 1\b/);
});
