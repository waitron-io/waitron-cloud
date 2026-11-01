// Explicit local integration: prepared public dependencies and generated venue state only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as local from '../local.mjs';
import { assertSmokeAccounting, prepareDelayedLitestreamStop, prepareDelayedLitestreamDiagnostics } from '../litestream-smoke-test-utils.mjs';
import { cleanupRecordedStack } from './stack-parent-cleanup.mjs';
const prepared = JSON.parse(readFileSync(process.env.COST_STACK_FIXTURE, 'utf8'));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'd68-stack-proof-'))), source = join(parent, 'source'), root = join(parent, 'private');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const codeRoot = join(root, 'code'), stateRoot = join(root, 'state');
  cpSync(prepared.codeCache, codeRoot, { recursive: true });
  cpSync(new URL('../s3-deletion.mjs', import.meta.url), join(codeRoot, 's3-deletion.mjs'));
  cpSync(new URL('../storage-lifetimes.mjs', import.meta.url), join(codeRoot, 'storage-lifetimes.mjs'));
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
  assertSmokeAccounting(result);
  t.diagnostic(JSON.stringify({ afterStop: result.afterStop, ...(result.costAccuracy ? { costAccuracy: result.costAccuracy } : {}) }));
  assert.equal(result.version, '0.5.17'); assert.equal(result.injectedFailures, 1);
  assert.equal(result.restoredSales, 2); assert.equal(result.integrity, 'ok');
  assert.deepEqual(result.sales, { attempted: 2, successful: 2, failed: 0 });
  assert.deepEqual(result.fiscal, { ok: true, issues: 0 });
  assert.equal(result.replication.requestsReconciled, true); assert.equal(result.restore.requestsReconciled, true);
  assert.equal(result.replication.status, 'unknown'); assert.equal(result.restore.status, 'unknown');
  assert.ok(result.replication.requests.some(r => r.operation === 'put' && r.retryOrdinal === 1));
  assert.ok(result.replication.requests.some(r => r.operation === 'list'));
  assert.ok(result.restore.requests.some(r => r.operation === 'get'));
  assert.equal(result.observed.reconciled, result.afterStop.bodiesReconciled);
  assert.ok(result.observed.accounting.producer.bytesOut > 1000, 'basic smoke also independently counts first-hop bodies');
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
  assertSmokeAccounting(result);
  t.diagnostic(JSON.stringify({ afterStop: result.afterStop, ...(result.costAccuracy ? { costAccuracy: result.costAccuracy } : {}) }));
  assert.equal(result.version, '0.5.17'); assert.equal(result.injectedFailures, 1);
  assert.equal(result.restoredSales, 2); assert.equal(result.integrity, 'ok');
  assert.deepEqual(result.sales, { attempted: 2, successful: 2, failed: 0 });
  assert.deepEqual(result.fiscal, { ok: true, issues: 0 });
  assert.equal(result.replication.requestsReconciled, true); assert.equal(result.restore.requestsReconciled, true);
  assert.ok(result.transport, 'require first-hop body evidence independent of header logs and storage observer');
  for (const [name, requestProof] of [['replication', result.replication], ['restore', result.restore]]) {
    const proof = result.transport[name];
    assert.equal(proof.reconciled, name === 'replication' ? result.afterStop.bodiesReconciled : true);
    if (name === 'restore' || result.afterStop.bodiesReconciled) assert.deepEqual(proof.accounting.producer, proof.accounting.observer);
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
  assertSmokeAccounting(result);
  t.diagnostic(JSON.stringify({ afterStop: result.afterStop, ...(result.costAccuracy ? { costAccuracy: result.costAccuracy } : {}) }));
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
  assert.equal(result.transport.replication.reconciled, result.afterStop.bodiesReconciled); assert.equal(result.transport.restore.reconciled, true);
  assert.equal(result.replication.requestsReconciled, true); assert.equal(result.restore.requestsReconciled, true);
  assert.equal(result.replication.status, 'unknown', 'bounded storage alone does not qualify the full scenario');
  assert.equal(result.administration.reconciled, true); assert.equal(result.cleanedObjects, true); assert.equal(result.leaked, false);
  t.diagnostic(JSON.stringify({ lifetimes: proof, inventoryBytes: result.inventoryBytes,
    replication: result.transport.replication.accounting.producer, restore: result.transport.restore.accounting.producer }));
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Discarding replaced/deleted objects loses earlier storage even though the final bucket is empty.
test('genuineStorageReplacementAndDeletionKeepRetiredStreamHistoryAndPairedTraffic', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  for (const name of ['litestream.mjs', 'storage-lifetimes.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./stream-history-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-stream-history-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(docker('exec', s3, 'node', '/code/cost-stream-history-smoke.mjs'));
  assert.equal(result.retained.scope, 'unversioned-object-history');
  assert.equal(result.retained.objects.bytes, 6); assert.equal(result.retained.objects.currentVersions, 1);
  assert.deepEqual(result.retained.byteSeconds, { low: 30, high: 30 });
  assert.equal(result.final.objects.bytes, 0); assert.equal(result.final.objects.currentVersions, 0);
  assert.deepEqual(result.final.byteSeconds, { low: 50, high: 50 });
  assert.equal(result.workload.reconciled, true);
  assert.deepEqual(result.workload.accounting.producer, result.workload.accounting.observer);
  assert.equal(result.workload.accounting.producer.attempts, 5); assert.equal(result.workload.accounting.producer.bytesOut, 12);
  assert.equal(result.workload.accounting.requests.find(r => r.operation === 'delete').attempts, 2);
  assert.equal(result.administration.reconciled, true); assert.equal(result.leaked, false);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// The history mode must consume the actual pinned binary's failed upload/retry, not only fixture requests.
test('genuineNativeStreamHistoriesPairBinaryRetriesWithIndependentStorageBounds', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(prepared.litestreamBinary, join(f.codeRoot, 'litestream'));
  for (const name of ['litestream.mjs', 'storage-lifetimes.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./litestream-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-litestream-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', '-e', 'COST_LITESTREAM_TRANSPORT=1', '-e', 'COST_LITESTREAM_HISTORIES=1',
    s3, 'node', '/code/cost-litestream-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 95000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assertSmokeAccounting(result);
  t.diagnostic(JSON.stringify({ afterStop: result.afterStop, ...(result.costAccuracy ? { costAccuracy: result.costAccuracy } : {}) }));
  assert.ok(result.lifetimes, 'use the history mode for genuine native requests');
  assert.equal(result.lifetimes.scope, 'unversioned-object-history');
  assert.equal(result.version, '0.5.17'); assert.equal(result.injectedFailures, 1);
  assert.equal(result.restoredSales, 2); assert.equal(result.integrity, 'ok');
  assert.deepEqual(result.fiscal, { ok: true, issues: 0 });
  assert.deepEqual(result.sales, { attempted: 2, successful: 2, failed: 0 });
  assert.equal(result.lifetimes.objects.bytes, result.inventoryBytes);
  assert.equal(result.lifetimes.objects.currentVersions, result.inventoryObjects);
  assert.ok(result.lifetimes.byteSeconds.low > 0); assert.ok(result.lifetimes.byteSeconds.high > result.lifetimes.byteSeconds.low);
  assert.equal(result.replication.requestsReconciled, true); assert.equal(result.restore.requestsReconciled, true);
  assert.equal(result.transport.replication.reconciled, result.afterStop.bodiesReconciled); assert.equal(result.transport.restore.reconciled, true);
  assert.equal(result.administration.reconciled, true); assert.equal(result.cleanedObjects, true); assert.equal(result.leaked, false);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Final empty buckets must retain earlier storage and every batch's independent wire accounting.
test('genuineSdkBulkDeletionRetainsVersionsMarkersAndHistoricalStorage', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(new URL('../storage-lifetimes.mjs', import.meta.url), join(f.codeRoot, 'storage-lifetimes.mjs'));
  cpSync(new URL('./bulk-lifetime-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-bulk-lifetime-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', s3, 'node', '/code/cost-bulk-lifetime-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }));
  for (const [name, seconds, batches] of [['plain', 16, 1], ['versioned', 58, 3]]) {
    const proof = result[name];
    assert.deepEqual(proof.final.accounting.objects, [{ class: 'stream', bytes: 0, byteSeconds: seconds,
      currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 }]);
    assert.equal(proof.final.reconciled, true); assert.equal(proof.complete.reconciled, true);
    assert.deepEqual(proof.complete.accounting.producer, proof.complete.accounting.observer);
    const requests = proof.complete.accounting.requests.filter(r => r.operation === 'delete-many');
    assert.equal(requests.reduce((n, r) => n + r.attempts, 0), batches);
    assert.ok(requests.every(r => r.bytesIn > 0 && r.bytesOut > 0));
    assert.equal(proof.leaked, false);
  }
  assert.deepEqual(result.versioned.afterDelete.map(r => [r.bytes, r.currentVersions, r.noncurrentVersions, r.deleteMarkers]), [[10, 0, 2, 1]]);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Lost replies can leave a stored version; final empty inventories must retain its earlier storage.
test('genuineNativeVersionHistoriesRetainLostWritesMarkersAndPromotedVersions', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  for (const name of ['litestream.mjs', 'stream-versions.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./stream-versions-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-stream-versions-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', s3, 'node', '/code/cost-stream-versions-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.deepEqual(result.retained.objects, { class: 'stream', bytes: 12, currentVersions: 0, noncurrentVersions: 2, deleteMarkers: 1, unfinishedMultipart: 0 });
  assert.deepEqual(result.promoted.objects, { class: 'stream', bytes: 10, currentVersions: 1, noncurrentVersions: 1, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.promoted.byteSeconds, { low: 60, high: 84 });
  assert.deepEqual(result.final.objects, { class: 'stream', bytes: 0, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.final.byteSeconds, { low: 82, high: 106 });
  assert.equal(result.lostReplies, 1); assert.equal(result.leaked, false);
  for (const evidence of [result.workload, result.administration]) {
    assert.equal(evidence.reconciled, true); assert.deepEqual(evidence.accounting.producer, evidence.accounting.observer);
  }
  assert.equal(result.workload.accounting.producer.attempts, 6); assert.equal(result.workload.accounting.producer.bytesOut, 10);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

test('genuinePinnedLitestreamRetainsVersionedStorageWithNativeRetryAndRestore', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(prepared.litestreamBinary, join(f.codeRoot, 'litestream'));
  for (const name of ['litestream.mjs', 'stream-versions.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./litestream-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-litestream-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', '-e', 'COST_LITESTREAM_TRANSPORT=1', '-e', 'COST_LITESTREAM_VERSIONS=1',
    s3, 'node', '/code/cost-litestream-smoke.mjs'], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 110000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assertSmokeAccounting(result);
  t.diagnostic(JSON.stringify({ afterStop: result.afterStop, ...(result.costAccuracy ? { costAccuracy: result.costAccuracy } : {}) }));
  assert.equal(result.injectedFailures, 1); assert.equal(result.restoredSales, 2); assert.equal(result.integrity, 'ok');
  assert.deepEqual(result.fiscal, { ok: true, issues: 0 });
  assert.equal(result.replication.requestsReconciled, true); assert.equal(result.restore.requestsReconciled, true);
  assert.equal(result.transport.replication.reconciled, result.afterStop.bodiesReconciled); assert.equal(result.transport.restore.reconciled, true);
  assert.equal(result.lifetimes.scope, 'versioned-object-history'); assert.equal(result.lifetimes.status, 'measured');
  assert.ok(result.lifetimes.objects.bytes >= result.inventoryBytes); assert.ok(result.lifetimes.objects.currentVersions === result.inventoryObjects);
  assert.ok(result.lifetimes.byteSeconds.low > 0); assert.ok(result.lifetimes.byteSeconds.high >= result.lifetimes.byteSeconds.low);
  assert.equal(result.cleanedObjects, true); assert.equal(result.leaked, false); assert.equal(result.administration.reconciled, true);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

test('genuinePinnedLitestreamDrainsCommittedPutRepliesBeforeShutdown', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(prepared.litestreamBinary, join(f.codeRoot, 'litestream'));
  for (const name of ['litestream.mjs', 'stream-versions.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./litestream-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-litestream-smoke.mjs'));
  // Delay the reply after the real storage backend commits; restore can already see that object.
  const smokePath = join(f.codeRoot, 'cost-litestream-smoke.mjs');
  const originalSmoke = readFileSync(smokePath, 'utf8');
  writeFileSync(smokePath, prepareDelayedLitestreamDiagnostics(prepareDelayedLitestreamStop(originalSmoke)));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', '-e', 'COST_LITESTREAM_TRANSPORT=1', '-e', 'COST_LITESTREAM_VERSIONS=1',
    s3, 'node', '/code/cost-litestream-smoke.mjs'], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 110000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assertSmokeAccounting(result);
  t.diagnostic(JSON.stringify({ afterStop: result.afterStop, ...(result.costAccuracy ? { costAccuracy: result.costAccuracy } : {}) }));
  assert.ok(result.delayedPutReplies > 0);
  assert.equal(result.injectedFailures, 1); assert.equal(result.restoredSales, 2); assert.equal(result.integrity, 'ok');
  assert.deepEqual(result.fiscal, { ok: true, issues: 0 });
  assert.equal(result.replication.requestsReconciled, true); assert.equal(result.restore.requestsReconciled, true);
  assert.equal(result.transport.replication.reconciled, result.afterStop.bodiesReconciled); assert.equal(result.transport.restore.reconciled, true);
  assert.equal(result.lifetimes.scope, 'versioned-object-history'); assert.equal(result.lifetimes.status, 'measured');
  assert.ok(result.lifetimes.objects.bytes >= result.inventoryBytes); assert.ok(result.lifetimes.objects.currentVersions === result.inventoryObjects);
  assert.ok(result.lifetimes.byteSeconds.low > 0); assert.ok(result.lifetimes.byteSeconds.high >= result.lifetimes.byteSeconds.low);
  assert.equal(result.cleanedObjects, true); assert.equal(result.leaked, false); assert.equal(result.administration.reconciled, true);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

test('genuinePinnedLitestreamCountsHeldMetadataAfterValidatedRuntimeStop', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(prepared.litestreamBinary, join(f.codeRoot, 'litestream'));
  cpSync(new URL('../litestream.mjs', import.meta.url), join(f.codeRoot, 'litestream.mjs'));
  cpSync(new URL('./litestream-list-control.mjs', import.meta.url), join(f.codeRoot, 'cost-litestream-list-control.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', s3, 'node', '/code/cost-litestream-list-control.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(result.version, '0.5.17'); assert.equal(result.afterStop.used, 1); assert.equal(result.afterStop.lateAdmissions, 1);
  assert.equal(result.initialUploadComplete, true);
  assert.ok(result.observed.accounting.requests.some(r => r.operation === 'put' && r.outcome === 'success' && r.bytesOut > 0));
  assertSmokeAccounting(result);
  assert.equal(/synthetic|Authorization|Invocation|127\.0\.0\.1|\/state\/|\.ltx/.test(JSON.stringify(result)), false);
  t.diagnostic(JSON.stringify(result));
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

test('genuineNativeBatchListenerRetainsCommittedLostRepliesAndEveryVersionLifetime', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  for (const name of ['litestream.mjs', 'stream-versions.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./native-batch-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-native-batch-smoke.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', '-e', 'COST_NATIVE_BATCH_DIAGNOSTIC=1', s3, 'node', '/code/cost-native-batch-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(result.lostReplies, 1); assert.equal(result.leaked, false);
  assert.deepEqual(result.retained.objects, { class: 'stream', bytes: 14, currentVersions: 0, noncurrentVersions: 2, deleteMarkers: 2, unfinishedMultipart: 0 });
  assert.deepEqual(result.promoted.objects, { class: 'stream', bytes: 10, currentVersions: 1, noncurrentVersions: 1, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.final.objects, { class: 'stream', bytes: 0, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.final.byteSeconds, { low: 150, high: 160 });
  assert.equal(result.workload.reconciled, true); assert.equal(result.administration.reconciled, true);
  assert.deepEqual(result.workload.accounting.producer, result.workload.accounting.observer);
  assert.equal(result.workload.accounting.producer.attempts, 8); assert.ok(result.workload.accounting.producer.bytesOut > 10);
  assert.equal(result.workload.accounting.requests.filter(r => r.operation === 'delete-many').reduce((n, r) => n + r.attempts, 0), 6);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// A lost batch reply must retain earlier unversioned storage after the final bucket becomes empty.
test('genuineUnversionedNativeBatchesRetainLostDeletesRetriesAndRecreation', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  for (const name of ['litestream.mjs', 'storage-lifetimes.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./native-unversioned-batch-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-native-unversioned-batch-smoke.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', s3, 'node', '/code/cost-native-unversioned-batch-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(result.lostReplies, 1); assert.equal(result.leaked, false);
  assert.deepEqual(result.retained.objects, { class: 'stream', bytes: 6, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.retained.byteSeconds, { low: 46, high: 58 });
  assert.deepEqual(result.final.objects, { class: 'stream', bytes: 0, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.final.byteSeconds, { low: 68, high: 80 });
  assert.equal(result.workload.reconciled, true); assert.equal(result.administration.reconciled, true);
  assert.deepEqual(result.workload.accounting.producer, result.workload.accounting.observer);
  assert.equal(result.workload.accounting.producer.attempts, 7);
  assert.ok(result.workload.accounting.producer.bytesOut > 12);
  assert.equal(result.workload.accounting.requests.filter(r => r.operation === 'delete-many').reduce((n, r) => n + r.attempts, 0), 4);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Dropping incomplete/unused parts or double-counting completion breaks this literal integral.
test('genuineNativeMultipartHistoriesKeepUnfinishedCompletedAndAbortedStorage', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  for (const name of ['litestream.mjs', 'storage-lifetimes.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./native-multipart-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-native-multipart-smoke.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', s3, 'node', '/code/cost-native-multipart-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(result.leaked, false);
  assert.deepEqual(result.retained.objects, { class: 'stream', bytes: 4, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 1 });
  assert.deepEqual(result.retained.byteSeconds, { low: 8, high: 8 });
  assert.deepEqual(result.completed.objects, { class: 'stream', bytes: 4, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.completed.byteSeconds, { low: 40, high: 40 });
  assert.deepEqual(result.unfinished.objects, { class: 'stream', bytes: 7, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 1 });
  assert.deepEqual(result.unfinished.byteSeconds, { low: 62, high: 62 });
  assert.deepEqual(result.final.objects, { class: 'stream', bytes: 0, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.final.byteSeconds, { low: 84, high: 84 });
  assert.equal(result.workload.reconciled, true); assert.equal(result.administration.reconciled, true);
  assert.deepEqual(result.workload.accounting.producer, result.workload.accounting.observer);
  assert.equal(result.workload.accounting.producer.attempts, 8); assert.ok(result.workload.accounting.producer.bytesOut > 13);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Earlier versions and replaced/discarded parts remain in the integral after the bucket is empty.
test('genuineVersionedNativeMultipartRetainsVersionsPartsAndPromotion', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  for (const name of ['litestream.mjs', 'stream-versions.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./native-versioned-multipart-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-native-versioned-multipart-smoke.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', s3, 'node', '/code/cost-native-versioned-multipart-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(result.leaked, false);
  assert.deepEqual(result.retained.objects, { class: 'stream', bytes: 6, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 1 });
  assert.deepEqual(result.retained.byteSeconds, { low: 16, high: 16 });
  assert.deepEqual(result.completed.objects, { class: 'stream', bytes: 10, currentVersions: 1, noncurrentVersions: 1, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.completed.byteSeconds, { low: 70, high: 70 });
  assert.deepEqual(result.unfinished.objects, { class: 'stream', bytes: 13, currentVersions: 1, noncurrentVersions: 1, deleteMarkers: 0, unfinishedMultipart: 1 });
  assert.deepEqual(result.unfinished.byteSeconds, { low: 116, high: 116 });
  assert.deepEqual(result.promoted.objects, { class: 'stream', bytes: 2, currentVersions: 1, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.promoted.byteSeconds, { low: 166, high: 166 });
  assert.deepEqual(result.final.objects, { class: 'stream', bytes: 0, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.final.byteSeconds, { low: 168, high: 168 });
  assert.equal(result.workload.reconciled, true); assert.equal(result.administration.reconciled, true);
  assert.deepEqual(result.workload.accounting.producer, result.workload.accounting.observer);
  assert.equal(result.workload.accounting.producer.attempts, 11); assert.ok(result.workload.accounting.producer.bytesOut > 23);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Backend commits whose success replies become HTTP 503 must remain in both independent counters.
for (const versioned of [false, true]) test(`genuineAmbiguousMultipartRepliesReconcileEveryCommittedStage_${versioned}`, async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  for (const name of ['litestream.mjs', 'stream-versions.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./ambiguous-multipart-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-ambiguous-multipart-smoke.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', '-e', 'COST_MULTIPART_DIAGNOSTIC=1', '-e', 'COST_VERSIONED=' + Number(versioned), s3, 'node', '/code/cost-ambiguous-multipart-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(result.leaked, false); assert.equal(result.lostReplies, 6);
  assert.deepEqual(result.completed.objects, { class: 'stream', bytes: versioned ? 8 : 6, currentVersions: 1,
    noncurrentVersions: versioned ? 1 : 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.completed.byteSeconds, versioned ? { low: 52, high: 104 } : { low: 46, high: 102 });
  assert.deepEqual(result.aborted.byteSeconds, versioned ? { low: 122, high: 180 } : { low: 100, high: 162 });
  assert.deepEqual(result.final.objects, { class: 'stream', bytes: 0, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 });
  assert.deepEqual(result.final.byteSeconds, versioned ? { low: 134, high: 192 } : { low: 106, high: 168 });
  assert.equal(result.workload.reconciled, true); assert.equal(result.administration.reconciled, true);
  assert.deepEqual(result.workload.accounting.producer, result.workload.accounting.observer);
  assert.equal(result.workload.accounting.producer.attempts, versioned ? 10 : 9);
  assert.equal(result.workload.accounting.requests.filter(r => r.outcome === 'server-error').reduce((n, r) => n + r.attempts, 0), 6);
  assert.ok(result.workload.accounting.producer.bytesOut > 15);
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Duplicate part numbers prevent the inventory from identifying the retained data.
test('genuineAmbiguousMultipartReplacementKeepsDuplicateInventoryRefused', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  for (const name of ['litestream.mjs', 'stream-versions.mjs']) cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./ambiguous-multipart-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-ambiguous-multipart-smoke.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(execFileSync('docker', ['exec', '-e', 'COST_MULTIPART_REPLACEMENT=1', s3, 'node', '/code/cost-ambiguous-multipart-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.deepEqual(result, { refused: true, invalid: true, parts: 2, duplicateNumbers: 1, listedBytes: 10, lostReplies: 3 });
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// The composed session must agree with a real backend, not just a generated HTTP inventory.
test('genuineStreamMeasurementJoinsPhasesInventoriesAndIndependentRequestCounters', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  for (const name of ['litestream.mjs', 'storage-lifetimes.mjs', 'stream-versions.mjs', 's3-deletion.mjs', 'stream-measurement.mjs', 'worker-diagnostic.mjs'])
    cpSync(new URL('../' + name, import.meta.url), join(f.codeRoot, name));
  cpSync(new URL('./stream-measurement-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-stream-measurement-smoke.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const results = JSON.parse(execFileSync('docker', ['exec', s3, 'node', '/code/cost-stream-measurement-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(results.length, 2);
  for (const [i, { versioned, intermediate, result, administration, leaked }] of results.entries()) {
    assert.equal(versioned, i === 1); assert.equal(leaked, false);
    assert.equal(intermediate.requests.reconciled, true); assert.equal(result.requests.reconciled, true);
    assert.equal(administration.reconciled, true);
    assert.deepEqual(result.requests.accounting.producer, result.requests.accounting.observer);
    assert.equal(result.requests.accounting.producer.attempts, 13);
    assert.deepEqual(result.requests.accounting.requests.filter(r => r.phase !== 'observer').map(r => [r.phase, r.operation, r.bytesOut, r.bytesIn]),
      [['startup', 'put', 4, 0], ['workload', 'put', 6, 0], ['idle', 'get', 0, 6], ['restore', 'delete', 0, 0]]);
    assert.deepEqual(intermediate.storage.byteSeconds, versioned ? { low: 32, high: 32 } : { low: 24, high: 24 });
    assert.deepEqual(result.storage.byteSeconds, versioned ? { low: 126, high: 126 } : { low: 42, high: 42 });
    assert.deepEqual(result.storage.objects, { class: 'stream', bytes: versioned ? 32 : 0, currentVersions: 0,
      noncurrentVersions: versioned ? 2 : 0, deleteMarkers: versioned ? 1 : 0, unfinishedMultipart: 0 });
    assert.deepEqual(result.cleanup, { listeners: 0, clients: 0 });
  }
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// Ignoring stream options, missing the final sale or early database cleanup fails here.
test('genuinePrivateDayStreamsEverySelectedSaleAndRestoresBeforeRemovingReplayState', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  const { createHash } = await import('node:crypto');
  // Expose the pinned clock definitions already in the public bundle; retain every function body.
  const runtime = readFileSync(join(f.codeRoot, 'runtime.mjs'), 'utf8') + '\nexport { businessDayAt, businessDayBounds };\n';
  writeFileSync(join(f.codeRoot, 'runtime.mjs'), runtime);
  const manifest = JSON.parse(readFileSync(join(f.codeRoot, 'runtime-manifest.json'), 'utf8'));
  manifest.sha256 = createHash('sha256').update(runtime).digest('hex');
  writeFileSync(join(f.codeRoot, 'runtime-manifest.json'), JSON.stringify(manifest));
  cpSync(prepared.litestreamBinary, join(f.codeRoot, 'litestream'));
  const harness = join(f.codeRoot, 'cloud-cost-runner'); mkdirSync(harness, { mode: 0o700 });
  const { readdirSync } = await import('node:fs');
  for (const name of readdirSync(new URL('..', import.meta.url))) if (name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    cpSync(new URL('../' + name, import.meta.url), join(harness, name));

  cpSync(new URL('./streamed-day-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-streamed-day-smoke.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const { runStreamedDayFixture } = await import('../streamed-day-diagnostics.mjs');
  const proof = JSON.parse(runStreamedDayFixture('docker', ['exec', s3, 'node', '/code/cost-streamed-day-smoke.mjs'],
    { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.deepEqual(proof.result.replay.counts, { expected: 3, attempted: 3, successful: 3, failed: 0 });
  assert.deepEqual(proof.result.stream?.restored, { sales: 3, integrity: true });
  assert.deepEqual(proof.result.integrity, { ok: true, issues: 0 });
  assert.equal(proof.result.stream.stream.requests.reconciled, true);
  assert.equal(proof.result.stream.stream.storage.objects.bytes, proof.inventoryBytes); assert.ok(proof.inventoryBytes > 0);
  assert.deepEqual(proof.result.stream.native, { version: '0.5.17', writerStarts: 1, phaseRestarts: 0 });
  assert.deepEqual(proof.result.stream.stream.phases.map(p => p.phase), ['startup', 'workload', 'idle', 'verification', 'restore']);
  for (const phase of ['startup', 'idle']) assert.ok(proof.result.stream.stream.phases.find(p => p.phase === phase).elapsedSeconds >= 2);
  assert.equal(proof.sourceUnchanged, true); assert.equal(proof.collected, true); assert.equal(proof.clean, true); assert.equal(proof.leaked, false);
  const { exportAggregate } = await import('../schema.mjs');
  assert.throws(() => exportAggregate(proof.result), /Invalid cloud cost evidence/);
  for (const mode of ['cancel', 'deadline']) {
    const refused = JSON.parse(runStreamedDayFixture('docker', ['exec', s3, 'node', '/code/cost-streamed-day-smoke.mjs', mode],
      { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.equal(refused.result, null); assert.equal(refused.refused, true);
    assert.equal(refused.sourceUnchanged, true); assert.equal(refused.collected, true); assert.equal(refused.clean, true); assert.equal(refused.leaked, false);
  }

});

// Publishing is allowed only after the real archive journey and owned cleanup agree.
test('generatedArchiveStoragePublishesACompleteAnonymousReceiptAfterCleanup', async t => {
  const { buildArchiveStorageReceipt } = await import('../archive-storage-receipt.mjs');
  const startedAt = new Date().toISOString(), f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(new URL('./archive-storage-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-archive-storage-smoke.mjs'));
  let stack;
  f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const s3 = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 's3');
  const result = JSON.parse(docker('exec', s3, 'node', '/code/cost-archive-storage-smoke.mjs'));
  await stack.close();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  const endedAt = new Date().toISOString();
  const cloudRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../../..', import.meta.url), encoding: 'utf8' }).trim();
  const receipt = buildArchiveStorageReceipt({ metadata: { runId: crypto.randomUUID(), cloudRevision,
    waitronRevision: 'fbadd15785464e59747e697c11048bfbc6e4938f',
    window: { startedAt, endedAt, elapsedSeconds: (Date.parse(endedAt) - Date.parse(startedAt)) / 1000 } }, result,
    cleanup: { ownedProcesses: 0, ownedContainers: 0, ownedNetworks: 0, ownedVolumes: 0, ownedObjects: 0, residualKinds: [] } });
  assert.equal(receipt.accounting.producer.attempts, 11);
  assert.equal(receipt.inputs.find(row => row.id === 'archive-bytes').value, result.capturedBytes);
  assert.equal(receipt.inputs.find(row => row.id === 'successful-sales').value, 1);
  assert.equal(receipt.accounting.requests.find(row => row.operation === 'put').bytesOut, result.capturedBytes);
  assert.equal(receipt.accounting.requests.find(row => row.operation === 'get').bytesIn, result.capturedBytes + 11);
  assert.equal(/PRIVATE_SYNTHETIC_CANARY|private-part|UploadId|SYNTHETIC_PRIVATE_STATE/.test(JSON.stringify(receipt)), false);
  if (process.env.COST_ARCHIVE_STORAGE_OUTPUT) writeFileSync(process.env.COST_ARCHIVE_STORAGE_OUTPUT, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
});

import { readdirSync } from 'node:fs';

test('stackGatewaySelectionStartsItsBackendBeforeNameResolution', t => {
  const f = fixture(t), preparedPlan = local.prepareIsolatedStack(f);
  f.onCleanup(() => cleanupRecordedStack(f, preparedPlan.project, docker));
  const probeConfig = join(f.root, 'gateway-order-probe.json');
  writeFileSync(probeConfig, JSON.stringify({ ...f, prepared: preparedPlan }), { mode: 0o600, flag: 'wx' });
  const result = JSON.parse(execFileSync(process.execPath,
    [new URL('./gateway-startup-order-probe.mjs', import.meta.url).pathname, probeConfig],
    // Both bounded Compose calls must finish before a timeout can start the parent's cleanup.
    { encoding: 'utf8', timeout: 360000, stdio: ['ignore', 'pipe', 'inherit'] }));
  assert.deepEqual(result.ready, { postgres: true, s3: true, mailpit: true, fiscal: true, waitron: true, gateway: true });
  assert.deepEqual(result.isolation, { isolated: true, containers: 6, blockedConnections: 18, blockedDns: 12, localControl: true });
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

// A real HAProxy name-resolution refusal must survive its stopped container and owned cleanup.
test('stackReportsGatewayBinaryFailureBeforeRemovingItsResources', async t => {
  const f = fixture(t), preparedPlan = local.prepareIsolatedStack(f);
  f.onCleanup(() => cleanupRecordedStack(f, preparedPlan.project, docker));
  const probeConfig = join(f.root, 'gateway-diagnostic-probe.json');
  writeFileSync(probeConfig, JSON.stringify({ ...f, prepared: preparedPlan }), { mode: 0o600, flag: 'wx' });
  const diagnostic = JSON.parse(execFileSync(process.execPath,
    [new URL('./gateway-isolation-diagnostic-probe.mjs', import.meta.url).pathname, probeConfig],
    { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(diagnostic.stage, 'isolation');
  assert.equal(diagnostic.command, 'outbound-canary');
  assert.equal(diagnostic.exitCode, 1);
  assert.equal(diagnostic.container.role, 'gateway');
  assert.equal(diagnostic.container.status, 'exited');
  assert.equal(diagnostic.container.oomKilled, false);
  assert.deepEqual(diagnostic.container.runtime, { stage: 'binary', reason: 'dns-resolution', exitCode: 1 });
  assert.equal(JSON.stringify(diagnostic).includes('missing-backend'), false);
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});

function assertStableHostFiles(stateRoot) {
  assert.deepEqual(readdirSync(stateRoot).sort(), [
    'gateway-cert.pem', 'gateway-key.pem', 'gateway.pem', 'haproxy.cfg',
    'postgres-password', 'replay-config.json',
  ], 'only fixed service configuration may remain on the scanned host mount');
}

// SQLite removes migration journals while the host audits ownership of mounted files.
test('generatedVenueKeepsItsMutableDatabaseOffTheScannedHostTree', async t => {
  const f = fixture(t), plan = local.prepareIsolatedStack(f);
  cpSync(new URL('./stack-smoke.mjs', import.meta.url), join(f.codeRoot, 'cost-stack-smoke.mjs'));
  let stack; f.onCleanup(async () => { await stack?.close(); });
  stack = await local.startIsolatedStack({ ...f, prepared: plan });
  const waitron = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 'waitron');
  const result = JSON.parse(docker('exec', waitron, 'node', '/code/cost-stack-smoke.mjs'));
  assert.deepEqual(result.sales, { attempted: 1, successful: 1, failed: 0 });
  assert.deepEqual(result.integrity, { ok: true, issues: 0 });
  assert.equal(existsSync(join(f.stateRoot, 'replay')), false,
    'the generated database and its transient migration journals must stay outside the scanned host mount');
  assertStableHostFiles(f.stateRoot);
  const scratch = JSON.parse(docker('exec', waitron, 'node', '--input-type=module', '-e',
    "import {statSync} from 'node:fs'; process.stdout.write(JSON.stringify({venue:statSync('/tmp/replay/venue').isDirectory()}));"));
  assert.deepEqual(scratch, { venue: true });
});

for (const [role, name, directory] of [['mailpit', 'mail.db', false], ['s3', 'storage', true]]) {
  test(`generatedServiceKeepsItsMutableFilesOffTheScannedHostTree_${role}`, async t => {
    const f = fixture(t), plan = local.prepareIsolatedStack(f);
    let stack; f.onCleanup(async () => { await stack?.close(); });
    stack = await local.startIsolatedStack({ ...f, prepared: plan });
    const waitron = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === 'waitron');
    const result = JSON.parse(docker('exec', waitron, 'node', '/code/cost-stack-smoke.mjs'));
    assert.equal(result.capturedMail, 1); assert.equal(result.storageRoundTrip, true);
    assert.equal(existsSync(join(f.stateRoot, name)), false,
      'mutable service files must stay outside the scanned host mount');
    assertStableHostFiles(f.stateRoot);
    const service = stack.containerIds.find(id => docker('inspect', '--format', '{{index .Config.Labels "io.waitron.cloud-cost.role"}}', id) === role);
    const scratch = JSON.parse(docker('exec', service, 'node', '--input-type=module', '-e',
      "import {statSync} from 'node:fs'; const stat=statSync(process.argv[1]); process.stdout.write(JSON.stringify({file:stat.isFile(),directory:stat.isDirectory()}));", '/tmp/' + name));
    assert.deepEqual(scratch, { file: !directory, directory });
  });
}


// A real service exit must refuse admission and retain its state before owned cleanup removes it.
test('stackReportsStoppedIsolationServiceBeforeRemovingItsResources', async t => {
  const f = fixture(t), preparedPlan = local.prepareIsolatedStack(f);
  f.onCleanup(() => cleanupRecordedStack(f, preparedPlan.project, docker));
  const probeConfig = join(f.root, 'isolation-state-probe.json');
  writeFileSync(probeConfig, JSON.stringify({...f, prepared:preparedPlan}), {mode:0o600,flag:'wx'});
  const output = JSON.parse(execFileSync(process.execPath,
    [new URL('./stack-isolation-state-probe.mjs', import.meta.url).pathname, probeConfig],
    {encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}));
  assert.equal(output.interrupted, true);
  assert.equal(output.diagnostic.stage, 'isolation');
  assert.equal(output.diagnostic.command, 'outbound-canary');
  assert.equal(output.diagnostic.reason, 'command-exit');
  assert.equal(output.diagnostic.exitCode, 1);
  assert.equal(output.diagnostic.stderr, 'container-state');
  assert.ok(output.diagnostic.container, 'retain fresh container state before cleanup');
  assert.equal(output.diagnostic.container.role, 's3');
  assert.equal(output.diagnostic.container.status, 'exited');
  assert.equal(output.diagnostic.container.running, false);
  assert.equal(output.diagnostic.container.oomKilled, false);
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '', 'refused startup removes every owned container');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '', 'refused startup removes its owned network');
});


// A child's abrupt exit must leave enough private creation evidence for independent parent teardown.
test('stackParentRemovesItsRecordedResourcesAfterIsolationChildExits', async t => {
  const f = fixture(t), preparedPlan = local.prepareIsolatedStack(f);
  const cleanup = () => cleanupRecordedStack(f, preparedPlan.project, docker);
  f.onCleanup(cleanup);
  const probeConfig = join(f.root, 'isolation-state-probe.json');
  writeFileSync(probeConfig, JSON.stringify({...f, prepared:preparedPlan}), {mode:0o600,flag:'wx'});
  assert.throws(() => execFileSync(process.execPath,
    [new URL('./stack-isolation-state-probe.mjs', import.meta.url).pathname, probeConfig, 'abrupt'],
    {encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}), error => error.status === 75);
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`).split('\n').length, 6);
  cleanup();
  assert.equal(docker('ps', '-aq', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=io.waitron.cloud-cost.owner=${f.journal.token}`), '');
});
