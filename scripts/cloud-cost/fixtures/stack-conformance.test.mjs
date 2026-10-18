// Explicit local integration: prepared public dependencies and generated venue state only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as local from '../local.mjs';
const prepared = JSON.parse(readFileSync(process.env.COST_STACK_FIXTURE, 'utf8'));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'd68-stack-proof-'))), source = join(parent, 'source'), root = join(parent, 'private');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const codeRoot = join(root, 'code'), stateRoot = join(root, 'state');
  cpSync(prepared.codeCache, codeRoot, { recursive: true });
  mkdirSync(stateRoot, { mode: 0o700 });
  cpSync(new URL('./stack-smoke.mjs', import.meta.url), join(codeRoot, 'cost-stack-smoke.mjs'));
  writeFileSync(join(stateRoot, 'replay-config.json'), JSON.stringify({
    initial: {
      taxpayer: { country: 'ES', taxId: '12345678Z', legalName: 'Synthetic SL' },
      location: { name: 'Synthetic venue', invoiceLocales: ['es'], operationDescription: 'Servicio',
        timeZone: 'Europe/Madrid', dayCutover: '06:00:00' },
      nodeName: 'Synthetic node', seriesCode: 'R', fullSeriesCode: 'F', idSistemaInformatico: 'WR',
    },
    config: {
      localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/postgres',
        smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:8443' },
      senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' },
    },
  }), { mode: 0o600 });
  const token = randomBytes(32).toString('hex'), path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  let cleanup;
  t.after(async () => {
    writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
    await cleanup?.();
    rmSync(parent, { recursive: true, force: true });
  });
  return { source, root, codeRoot, stateRoot, journal: { path, token }, image: prepared.image,
    onCleanup: action => { cleanup = action; } };
}
// A missing service, broken real runtime, external route or incomplete cleanup fails this journey.
test('completeSyntheticStackRunsRealServicesAndCleansOnlyItsOwnedResources', async t => {
  assert.equal(typeof local.startIsolatedStack, 'function', 'start and audit the complete prepared stack');
  const f = fixture(t);
  const plan = local.prepareIsolatedStack(f);
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  const controller = new AbortController();
  stack = await local.startIsolatedStack({ ...f, prepared: plan, signal: controller.signal });
  assert.deepEqual(stack.ready, { postgres: true, s3: true, mailpit: true, fiscal: true, waitron: true, gateway: true });
  assert.deepEqual(stack.isolation, { isolated: true, containers: 6, blockedConnections: 18, blockedDns: 12, localControl: true });
  const ids = docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`).split('\n');
  assert.equal(ids.length, 6);
  const waitron = ids.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 'waitron');
  const smoke = JSON.parse(docker('exec', waitron, 'node', '/code/cost-stack-smoke.mjs'));
  assert.deepEqual(smoke, { postgres: 42, storageRoundTrip: true, capturedMail: 1, fiscalCalls: 1,
    sales: { attempted: 1, successful: 1, failed: 0 }, integrity: { ok: true, issues: 0 } });
  const entries = JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources;
  assert.ok(entries.some(v => v.kind === 'stack' && v.state === 'intent'));
  for (const id of stack.containerIds) assert.ok(entries.some(v => v.kind === 'container' && v.state === 'started' && v.id === id));
  const networkId = stack.networkId;
  writeFileSync(join(f.root, '.cloud-cost-owner'), '0'.repeat(64));
  await assert.rejects(stack.close(), /Invalid cloud cost evidence/);
  assert.equal(docker('ps', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`).split('\n').length, 6);
  writeFileSync(join(f.root, '.cloud-cost-owner'), f.journal.token);
  controller.abort();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '', 'cancellation must remove the owned services before returning');
  await stack.close(); await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.throws(() => docker('network', 'inspect', networkId));
});
test('tamperedPlanIsRefusedBeforeDockerCreatesResources', async t => {
  assert.equal(typeof local.startIsolatedStack, 'function', 'bind startup to the journalled plan');
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  const changed = JSON.parse(readFileSync(plan.file, 'utf8'));
  changed.services.waitron.command = ['node', '-e', 'process.exit(1)'];
  writeFileSync(plan.file, JSON.stringify(changed), { mode: 0o600 });
  await assert.rejects(local.startIsolatedStack({ ...f, prepared: plan }), /Invalid cloud cost local run/);
  assert.equal(existsSync(join(f.codeRoot, 'cost-stack-runtime.mjs')), false, 'reject tampering before preparing or starting a runtime');
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Reusing a recorded name must not turn a refused start into permission to delete an earlier resource.
test('refusedStartPreservesResourcesThatAlreadyExisted', async t => {
  const f = fixture(t), preparedPlan = local.prepareIsolatedStack(f);
  const plan = JSON.parse(readFileSync(preparedPlan.file, 'utf8'));
  const owner = `io.waitron.cloud-cost.owner=${f.journal.token}`;
  const project = `com.docker.compose.project=${preparedPlan.project}`;
  const networkId = docker('network', 'create', '--internal', '--label', owner, '--label', project, preparedPlan.project);
  let containerId;
  t.after(() => { if (containerId) { try { docker('rm', '-f', containerId); } catch {} } try { docker('network', 'rm', networkId); } catch {} });
  containerId = docker('run', '-d', '--network', preparedPlan.project, '--name', plan.services.waitron.container_name,
    '--label', owner, '--label', project, '--label', 'io.waitron.cloud-cost.role=waitron',
    f.image, 'node', '-e', 'setInterval(()=>{},1000)');
  await assert.rejects(local.startIsolatedStack({ ...f, prepared: preparedPlan }), /Invalid cloud cost local run/);
  assert.equal(docker('ps', '-q', '--no-trunc', '--filter', 'id=' + containerId), containerId, 'a refused start must preserve the earlier running container');
  assert.equal(docker('network', 'inspect', '--format', '{{.Id}}', networkId), networkId);
});

test('stackRefusesConfigurationThatDoesNotNameItsInternalServices', async t => {
  const f = fixture(t), preparedPlan = local.prepareIsolatedStack(f);
  const path = join(f.stateRoot, 'replay-config.json'), config = JSON.parse(readFileSync(path, 'utf8'));
  config.config.localEndpoints.s3 = 'http://127.0.0.1:8333';
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  let stack;
  try {
    await assert.rejects(async () => { stack = await local.startIsolatedStack({ ...f, prepared: preparedPlan }); }, /Invalid cloud cost local run/);
    assert.equal(existsSync(join(f.codeRoot, 'cost-stack-runtime.mjs')), false, 'do not run a stack that would ignore its configured endpoint');
  } finally { await stack?.close(); }
});

test('stackDoesNotOverwriteAnExistingPrivateKeyOnARefusedStart', async t => {
  const f = fixture(t), preparedPlan = local.prepareIsolatedStack(f);
  writeFileSync(join(f.stateRoot, 'gateway-key.pem'), 'earlier private key sentinel', { mode: 0o600 });
  writeFileSync(join(f.stateRoot, 'gateway.pem'), 'earlier combined certificate sentinel', { mode: 0o600 });
  await assert.rejects(local.startIsolatedStack({ ...f, prepared: preparedPlan }), /Invalid cloud cost local run/);
  assert.equal(readFileSync(join(f.stateRoot, 'gateway-key.pem'), 'utf8') === 'earlier private key sentinel', true, 'preserve the existing key without printing key bytes');
  assert.equal(readFileSync(join(f.stateRoot, 'gateway.pem'), 'utf8') === 'earlier combined certificate sentinel', true);
});

test('stackRefusesExtraPrivateConfigurationBeforePreparingRuntimeFiles', async t => {
  const f = fixture(t), preparedPlan = local.prepareIsolatedStack(f);
  const path = join(f.stateRoot, 'replay-config.json'), config = JSON.parse(readFileSync(path, 'utf8'));
  config.stateRoot = '/state/replay';
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  await assert.rejects(async () => { stack = await local.startIsolatedStack({ ...f, prepared: preparedPlan }); }, /Invalid cloud cost local run/);
  assert.equal(existsSync(join(f.codeRoot, 'cost-stack-runtime.mjs')), false);
});

test('genuineStorageTrafficIsPassivelyCountedWithoutInventingReconciliation', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(new URL('./storage-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-storage-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(docker('exec', s3, 'node', '/code/cost-storage-smoke.mjs'));
  assert.equal(result.ready, true, 'the actual storage service must expose anonymous passive accounting');
  assert.equal(result.producer.attempts, 11);
  assert.equal(result.producer.bytesOut, 10);
  assert.ok(result.producer.bytesIn > 6);
  assert.deepEqual(result.observer, result.producer, 'independent client body-byte and attempt counts must agree');
  assert.equal(result.status, 'unknown'); assert.equal(result.reconciled, false);
  assert.equal(result.refusedPhase, 400); assert.equal(result.leaked, false);
  assert.equal(result.refusedExtraPhase, 400);
  assert.equal(result.refusedOperation, 400); assert.equal(result.invalidSnapshot, 400);
  assert.deepEqual(result.observed.map(r => [r.operation, r.attempts]), [
    ['bucket-create', 1], ['put', 1], ['get', 1], ['head', 1], ['list', 2],
    ['multipart-create', 1], ['multipart-upload', 1], ['multipart-abort', 1], ['delete', 1], ['bucket-delete', 1],
  ]);
  const head = result.observed.find(r => r.operation === 'head');
  assert.equal(head.bytesIn, 0); assert.equal(head.attemptedBytesIn, 0);
  const waitron = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 'waitron');
  const privateSockets = JSON.parse(docker('exec', waitron, 'node', '-e', `
    const net=require('node:net');
    const blocked=port=>new Promise(resolve=>{const s=net.connect(port,'s3');s.setTimeout(1000,()=>s.destroy());
      let connected=false;s.on('connect',()=>{connected=true;s.destroy()});s.on('error',()=>{});s.on('close',()=>resolve(!connected));});
    Promise.all([blocked(8334),blocked(8335)]).then(v=>process.stdout.write(JSON.stringify(v)));
  `));
  assert.deepEqual(privateSockets, [true, true], 'peers cannot bypass storage accounting or access its control socket');
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// A real signed archive/read/restore and abandoned multipart must agree across two independent meters.
test('genuineArchiveAndSignedSdkTrafficReconcileThroughRealStorage', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(new URL('./archive-storage-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-archive-storage-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(docker('exec', s3, 'node', '/code/cost-archive-storage-smoke.mjs'));
  assert.equal(result.accounting.reconciled, true);
  assert.equal(result.accounting.status, 'measured');
  assert.equal(result.accounting.accounting.producer.attempts, 11);
  assert.deepEqual(result.accounting.accounting.producer, result.accounting.accounting.observer);
  const phaseBytes = Object.fromEntries(['setup', 'workload', 'cleanup'].map(phase => [phase,
    result.accounting.accounting.requests.filter(r => r.phase === phase).reduce((sum, r) => sum + r.bytesOut, 0)]));
  t.diagnostic(JSON.stringify({ attempts: result.accounting.accounting.producer.attempts, capturedBytes: result.capturedBytes, phaseBytes }));
  assert.deepEqual(phaseBytes, { setup: 192, workload: result.capturedBytes + 4, cleanup: 0 });
  assert.equal(result.accounting.accounting.producer.bytesOut, result.capturedBytes + 4 + 192);
  assert.ok(result.capturedBytes > 1000);
  assert.equal(result.headBytes, result.capturedBytes); assert.equal(result.downloadedBytes, result.capturedBytes);
  assert.equal(result.rangeBytes, 11); assert.equal(result.parts, 1); assert.equal(result.leaked, false);
  assert.deepEqual(result.restored, { ok: true, issues: 0, sales: 1 });
  assert.deepEqual(result.integrity, { ok: true, issues: 0 });
  assert.deepEqual(result.sales, { attempted: 1, successful: 1, failed: 0 });
  assert.deepEqual(result.accounting.accounting.requests.map(r => [r.phase, r.operation, r.attempts]), [
    ['setup', 'bucket-create', 1], ['workload', 'put', 1], ['workload', 'head', 1], ['workload', 'get', 2],
    ['workload', 'multipart-create', 1], ['workload', 'multipart-upload', 1], ['workload', 'list', 1],
    ['cleanup', 'multipart-abort', 1], ['cleanup', 'delete', 1], ['cleanup', 'bucket-delete', 1],
  ]);
  assert.equal(result.accounting.billing.find(r => r.requestClass === 's3-control').status, 'unknown');
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Wrong overwrite, marker promotion, replacement part size or completion size changes the literal integral.
test('genuineVersionAndMultipartLifetimesMatchMeteredStorageInventories', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(new URL('./lifetime-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-lifetime-smoke.mjs'));
  cpSync(new URL('./lifetime-replacement-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-lifetime-replacement-smoke.mjs'));
  cpSync(new URL('../storage-lifetimes.mjs', import.meta.url), join(f.codeRoot, 'storage-lifetimes.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(docker('exec', s3, 'node', '/code/cost-lifetime-smoke.mjs'));
  assert.equal(result.ready, true, 'track real successful SDK mutations and independently verify retained state');
  assert.deepEqual(result.checks.map(rows => rows.map(r => [r.bytes, r.currentVersions, r.noncurrentVersions, r.deleteMarkers, r.unfinishedMultipart])),
    [[[8, 1, 1, 0, 0]], [[10, 0, 2, 1, 0]], [[8, 1, 1, 0, 0]], [[12, 1, 0, 0, 1]], [[9, 2, 0, 0, 0]]]);
  assert.deepEqual(result.result.accounting.objects, [{ class: 'stream', bytes: 0, byteSeconds: 134,
    currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }]);
  assert.deepEqual(result.plainRetained.find(row => row.class === 'scratch'), { class: 'scratch', bytes: 5, byteSeconds: 6,
    currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.plainResult.accounting.objects.find(row => row.class === 'scratch'), { class: 'scratch', bytes: 0, byteSeconds: 19,
    currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.equal(result.plainResult.reconciled, true);
  assert.equal(result.result.reconciled, true); assert.equal(result.result.status, 'measured');
  assert.deepEqual(result.result.accounting.producer, result.result.accounting.observer);
  assert.ok(result.result.accounting.requests.some(r => r.phase === 'observer' && r.operation === 'list'));
  assert.equal(result.leaked, false);
  const replacement = JSON.parse(docker('exec', s3, 'node', '/code/cost-lifetime-replacement-smoke.mjs'));
  assert.deepEqual(replacement, { ready: true, refused: true, invalid: true }, 'SeaweedFS duplicate overwritten parts cannot qualify retained storage evidence');
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// The unmodified pinned Go binary must emit its own attempts, survive a real retry, and restore real sale writes.
test('genuineLitestreamRequestLogsIndependentlyMatchReplicationRetryAndRestore', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(prepared.litestreamBinary, join(f.codeRoot, 'litestream'));
  cpSync(new URL('../litestream.mjs', import.meta.url), join(f.codeRoot, 'litestream.mjs'));
  cpSync(new URL('./litestream-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-litestream-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', s3, 'node', '/code/cost-litestream-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 95000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(result.version, '0.5.17'); assert.equal(result.injectedFailures, 1);
  assert.equal(result.restoredSales, 2); assert.equal(result.integrity, 'ok');
  assert.deepEqual(result.sales, { attempted: 2, successful: 2, failed: 0 });
  assert.deepEqual(result.fiscal, { ok: true, issues: 0 });
  assert.equal(result.replication.requestsReconciled, true); assert.equal(result.restore.requestsReconciled, true);
  assert.equal(result.replication.status, 'unknown'); assert.equal(result.restore.status, 'unknown');
  assert.ok(result.replication.requests.some(r => r.operation === 'put' && r.retryOrdinal === 1));
  assert.ok(result.replication.requests.some(r => r.operation === 'list'));
  assert.ok(result.restore.requests.some(r => r.operation === 'get'));
  assert.equal(result.observed.reconciled, false, 'header evidence must not invent producer byte measurements');
  assert.ok(result.observed.accounting.observer.bytesOut > 1000);
  assert.equal(result.administration.reconciled, true, 'setup, inventory and cleanup calls need their own independent accounting');
  assert.equal(result.cleanedObjects, true); assert.equal(result.leaked, false);
  t.diagnostic(JSON.stringify({ replication: result.replication.producerAttempts, restore: result.restore.producerAttempts,
    observerBytes: result.observed.accounting.observer, saleWrites: result.restoredSales }));
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// A second independent counter must qualify actual body transfers, including the binary's failed upload and retry.
test('genuineLitestreamTransportBodyBytesAgreeWithSeparateStorageObserver', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(prepared.litestreamBinary, join(f.codeRoot, 'litestream'));
  cpSync(new URL('../litestream.mjs', import.meta.url), join(f.codeRoot, 'litestream.mjs'));
  cpSync(new URL('./litestream-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-litestream-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', '-e', 'COST_LITESTREAM_TRANSPORT=1', s3, 'node', '/code/cost-litestream-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 95000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(result.version, '0.5.17'); assert.equal(result.injectedFailures, 1);
  assert.equal(result.restoredSales, 2); assert.equal(result.integrity, 'ok');
  assert.deepEqual(result.sales, { attempted: 2, successful: 2, failed: 0 });
  assert.deepEqual(result.fiscal, { ok: true, issues: 0 });
  assert.equal(result.replication.requestsReconciled, true); assert.equal(result.restore.requestsReconciled, true);
  assert.ok(result.transport, 'require first-hop body evidence independent of header logs and storage observer');
  for (const [name, requestProof] of [['replication', result.replication], ['restore', result.restore]]) {
    const proof = result.transport[name];
    assert.equal(proof.reconciled, true);
    assert.deepEqual(proof.accounting.producer, proof.accounting.observer);
    assert.equal(proof.accounting.producer.attempts, requestProof.producerAttempts);
    assert.ok(proof.accounting.producer.bytesIn > 0);
    assert.equal(requestProof.status, 'unknown', 'body transfers do not fill the separate retained-object lifetime gap');
  }
  assert.ok(result.transport.replication.accounting.producer.bytesOut > 1000);
  assert.ok(result.transport.replication.accounting.requests.some(r => r.operation === 'put' && r.outcome === 'server-error'));
  assert.ok(result.transport.replication.accounting.requests.some(r => r.operation === 'put' && r.retryOrdinal === 1 && r.outcome === 'success'));
  assert.ok(result.transport.restore.accounting.requests.some(r => r.operation === 'get' && r.bytesIn > 1000));
  assert.equal(result.administration.reconciled, true);
  assert.equal(result.cleanedObjects, true); assert.equal(result.leaked, false);
  t.diagnostic(JSON.stringify({ replication: result.transport.replication.accounting.producer,
    restore: result.transport.restore.accounting.producer, saleWrites: result.restoredSales }));
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Request completion cannot stand in for provider commit time or independent retained-object evidence.
test('genuineLitestreamStorageLifetimesAgreeWithIndependentInventoriesAndBoundCommitTime', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(prepared.litestreamBinary, join(f.codeRoot, 'litestream'));
  cpSync(new URL('../litestream.mjs', import.meta.url), join(f.codeRoot, 'litestream.mjs'));
  cpSync(new URL('../storage-lifetimes.mjs', import.meta.url), join(f.codeRoot, 'storage-lifetimes.mjs'));
  cpSync(new URL('./litestream-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-litestream-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', '-e', 'COST_LITESTREAM_TRANSPORT=1', '-e', 'COST_LITESTREAM_LIFETIMES=1',
    s3, 'node', '/code/cost-litestream-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 95000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.ok(result.lifetimes, 'the native binary needs independently verified retained-object evidence');
  assert.equal(result.version, '0.5.17'); assert.equal(result.injectedFailures, 1);
  assert.equal(result.restoredSales, 2); assert.equal(result.integrity, 'ok');
  assert.deepEqual(result.sales, { attempted: 2, successful: 2, failed: 0 });
  assert.deepEqual(result.fiscal, { ok: true, issues: 0 });
  const proof = result.lifetimes;
  assert.equal(proof.status, 'measured'); assert.equal(proof.scope, 'unversioned-put-only');
  assert.equal(proof.objects.bytes, result.inventoryBytes); assert.ok(proof.objects.bytes > 1000);
  assert.equal(proof.objects.currentVersions, result.inventoryObjects); assert.ok(proof.objects.currentVersions >= 2);
  assert.equal(proof.objects.noncurrentVersions, 0); assert.equal(proof.objects.unfinishedMultipart, 0);
  assert.ok(proof.byteSeconds.low > 0); assert.ok(proof.byteSeconds.high > proof.byteSeconds.low);
  assert.ok(proof.byteSeconds.high <= proof.objects.bytes * proof.windowSeconds);
  assert.equal(result.transport.replication.reconciled, true); assert.equal(result.transport.restore.reconciled, true);
  assert.equal(result.replication.requestsReconciled, true); assert.equal(result.restore.requestsReconciled, true);
  assert.equal(result.replication.status, 'unknown', 'bounded storage alone does not qualify the full scenario');
  assert.equal(result.administration.reconciled, true); assert.equal(result.cleanedObjects, true); assert.equal(result.leaked, false);
  t.diagnostic(JSON.stringify({ lifetimes: proof, inventoryBytes: result.inventoryBytes,
    replication: result.transport.replication.accounting.producer, restore: result.transport.restore.accounting.producer }));
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});
