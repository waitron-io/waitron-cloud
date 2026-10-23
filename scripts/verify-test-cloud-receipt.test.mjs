import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const api = () => import('./verify-test-cloud-receipt.mjs');
const digest = 'a'.repeat(64), image = 'sha256:' + digest, head = 'b'.repeat(40);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const refusal = () => ({status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false});
function fixture() {
  const quarantined = ['waitron-app-1', 'waitron-print-agent-1', 'waitron-mailpit-1'].map((name, i) => ({name, id: String(i + 1).repeat(64), state: 'running', health: 'healthy'}));
  const identity = {project: 'waitron-cloud-test', image, schema: head, caSha256: digest, volumes: ['test-cloud-config', 'test-cloud-postgres', 'test-cloud-storage']};
  return {
    version: 1, kind: 'test-cloud-integration', runId: uuid(1), environment: 'mac-disposable', origin: 'https://waitron.local:3000',
    cloud: {head, tree: head, image, dirty: false}, waitron: {head, tree: head, image, dirty: false},
    organisations: [
      {plan: 'free', organisationId: uuid(2), venueId: uuid(3), installationId: uuid(4), stateSha256: digest},
      {plan: 'paid', organisationId: uuid(5), venueId: uuid(6), installationId: uuid(7), stateSha256: 'c'.repeat(64)},
    ],
    accountMail: {free: 'proved', paid: 'proved', transport: 'mailpit'},
    clients: {status: 'proved', waitronHead: head, origin: 'https://waitron.local:3000', actions: ['pair', 'renew', 'configuration']},
    snapshots: {status: 'proved', free: refusal(), paid: {archiveSha256: digest, upload: 'proved', verification: 'proved', restore: 'proved', activation: 'not-performed'}},
    continuous: {status: 'proved', capture: 'proved', restore: 'proved', snapshotFallback: 'proved', streamAbsentForFallback: true, activation: 'not-performed'},
    remote: {status: 'proved', freeProvision: refusal(), freeCertificate: refusal(), staffIsolation: 'proved', publicIsolation: 'proved', downgrade: 'proved', restart: 'proved', withdrawal: {streamMs: 1000, gatewayMs: 5000, snapshotStsMs: 900001}},
    fixtures: {address: 'unavailable', relay: 'local-proof', translation: 'fake-loopback', deployedTranslation: 'off', waitronRelay: 'unavailable', waitronTranslation: 'unavailable'},
    resources: {
      baseline: {availableMiB: 4096, freeGiB: 20, quarantined},
      after: {availableMiB: 4096, freeGiB: 20, quarantined: structuredClone(quarantined)},
      samples: Array.from({length: 17}, (_, i) => ({elapsedMs: i * 5000, phase: i < 2 ? 'startup' : i < 15 ? 'settled' : i === 15 ? 'verification' : 'integration', availableMiB: 3000, freeGiB: 18, cloudMiB: 1800, verifierMiB: i === 15 ? 1000 : 0, verifierCount: i === 15 ? 1 : 0, scratchMiB: i === 15 ? 240 : 0, fixtureBytes: 1234, oom: false, quarantined: structuredClone(quarantined)})),
    },
    rollback: {status: 'proved', before: structuredClone(identity), after: structuredClone(identity), oldBinaryOnNewSchema: false},
    cleanup: {created: [{kind: 'container', id: 'd'.repeat(64), owner: uuid(1)}], removed: [{kind: 'container', id: 'd'.repeat(64), owner: uuid(1)}], remaining: []},
  };
}
const change = (fn) => {const value = fixture(); fn(value); return value;};

test('complete synthetic receipt exercises validation without claiming a genuine proof', async () => {
  const {verifyTestCloudReceipt} = await api();
  assert.equal(verifyTestCloudReceipt(fixture()), true);
});

test('receipt_rejects_missing_real_client_or_missing_denial', async () => {
  const {verifyTestCloudReceipt} = await api();
  for (const value of [
    change(v => delete v.clients), change(v => v.clients.status = 'not-run'),
    change(v => v.clients.waitronHead = 'c'.repeat(40)), change(v => v.clients.actions.pop()),
    change(v => v.clients.origin = 'http://localhost:3000'),
    change(v => delete v.snapshots.free), change(v => v.snapshots.free.httpStatus = 200),
    change(v => v.snapshots.free.grantIssued = true), change(v => v.remote.freeCertificate.error = 'unavailable'),
    change(v => v.organisations[1].organisationId = v.organisations[0].organisationId),
    change(v => v.organisations[1].venueId = v.organisations[0].venueId),
    change(v => v.organisations[1].installationId = v.organisations[0].installationId),
    change(v => v.organisations[1].stateSha256 = v.organisations[0].stateSha256),
    change(v => v.accountMail.paid = 'not-run'),
  ]) assert.throws(() => verifyTestCloudReceipt(value));
});

test('receipt_cannot_call_fake_translation_live', async () => {
  const {verifyTestCloudReceipt} = await api();
  for (const [key, value] of [['translation', 'live'], ['deployedTranslation', 'on'], ['waitronTranslation', 'proved'], ['waitronRelay', 'proved'], ['relay', 'live'], ['address', 'proved']]) {
    assert.throws(() => verifyTestCloudReceipt(change(v => v.fixtures[key] = value)));
  }
});

test('receipt_requires_unchanged_quarantined_ids_and_capacity_samples', async () => {
  const {verifyTestCloudReceipt} = await api();
  for (const value of [
    change(v => v.resources.baseline.quarantined.pop()),
    change(v => v.resources.baseline.quarantined[0].health = 'unhealthy'),
    change(v => v.resources.baseline.availableMiB = 4095), change(v => v.resources.baseline.freeGiB = 19),
    change(v => v.resources.samples = []), change(v => v.resources.samples[3].elapsedMs += 5001),
    change(v => v.resources.samples[3].quarantined[0].id = 'f'.repeat(64)),
    change(v => v.resources.samples[3].quarantined[0].state = 'exited'),
    change(v => v.resources.samples[3].quarantined[0].health = 'unhealthy'),
    change(v => v.resources.samples[3].oom = true), change(v => v.resources.samples[3].cloudMiB = 2049),
    change(v => v.resources.samples[15].verifierMiB = 1025), change(v => v.resources.samples[15].verifierCount = 2),
    change(v => v.resources.samples[15].scratchMiB = 257), change(v => v.resources.samples[3].fixtureBytes = 1073741825),
    change(v => v.resources.samples.forEach(s => s.phase = 'startup')),
    change(v => v.resources.samples.forEach(s => {if (s.phase === 'verification') s.phase = 'settled';})),
    change(v => v.resources.samples.splice(8, 1)),
    change(v => v.resources.samples.forEach((s, i) => {if (i >= 3 && i <= 5) s.availableMiB = 2047;})),
    change(v => v.resources.samples.forEach((s, i) => {if (i >= 3 && i <= 5) s.freeGiB = 14;})),
    change(v => v.resources.samples[15].verifierCount = 0),
  ]) assert.throws(() => verifyTestCloudReceipt(value));
  assert.equal(verifyTestCloudReceipt(change(v => {v.resources.samples[3].availableMiB = 2000; v.resources.samples[4].availableMiB = 2000;})), true, 'two transient low samples preserve the existing three-sample stop rule');
});

test('rollback_preserves_project_identity', async () => {
  const {verifyTestCloudReceipt} = await api();
  for (const value of [
    change(v => v.rollback.after.project = 'waitron'), change(v => v.rollback.after.caSha256 = 'f'.repeat(64)),
    change(v => v.rollback.after.volumes.pop()), change(v => v.rollback.after.schema = 'f'.repeat(40)),
    change(v => v.rollback.oldBinaryOnNewSchema = true), change(v => v.rollback.status = 'not-run'),
    change(v => v.cleanup.removed = []), change(v => v.cleanup.remaining = v.cleanup.created),
    change(v => v.cleanup.removed.push({kind: 'container', id: '1'.repeat(64)})),
    change(v => v.cleanup.created.push(v.cleanup.created[0])),
  ]) assert.throws(() => verifyTestCloudReceipt(value));
});

test('paid evidence cannot skip independent recovery or issue trading authority', async () => {
  const {verifyTestCloudReceipt} = await api();
  for (const value of [
    change(v => v.snapshots.paid.verification = 'not-run'), change(v => v.snapshots.paid.activation = 'performed'),
    change(v => v.continuous.streamAbsentForFallback = false), change(v => v.continuous.restore = 'unavailable'),
    change(v => v.remote.withdrawal.gatewayMs = 600001), change(v => v.remote.withdrawal.snapshotStsMs = 901001),
    change(v => v.remote.withdrawal.streamMs = -1), change(v => v.remote.restart = 'not-run'),
  ]) assert.throws(() => verifyTestCloudReceipt(value));
});

test('closed receipt rejects secret-bearing extensions, dirty sources and mutable image references', async () => {
  const {verifyTestCloudReceipt} = await api();
  for (const value of [
    change(v => v.token = 'fixture-secret'), change(v => v.clients.privateKey = 'fixture-secret'),
    change(v => v.snapshots.free.payload = 'fixture-secret'), change(v => v.resources.samples[0].raw = 'fixture-secret'),
    change(v => v.cloud.dirty = true), change(v => v.waitron.dirty = true),
    change(v => v.cloud.image = 'cloud:latest'), change(v => v.waitron.head = 'main'),
    change(v => v.runId = '../private'), change(v => v.origin = 'https://customer.example'),
  ]) assert.throws(() => verifyTestCloudReceipt(value));
});

test('receipt CLI rejects incomplete evidence without echoing private input', async () => {
  const path = await mkdtemp(join(tmpdir(), 'cloud-integration-receipt-'));
  try {
    const file = join(path, 'receipt.json');
    const value = fixture(); value.clients.status = 'not-run'; value.token = 'private-fixture-value';
    await writeFile(file, JSON.stringify(value));
    const result = spawnSync(process.execPath, ['scripts/verify-test-cloud-receipt.mjs', file], {encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Test Cloud integration receipt refused\n');
    await writeFile(file, JSON.stringify(fixture()));
    const valid = spawnSync(process.execPath, ['scripts/verify-test-cloud-receipt.mjs', file], {encoding: 'utf8'});
    assert.equal(valid.status, 0); assert.equal(valid.stdout, 'Test Cloud integration receipt verified\n');
  } finally {await rm(path, {recursive: true, force: true});}
});

test('resource evidence covers integration and final quarantine after owned cleanup', async () => {
  const {verifyTestCloudReceipt} = await api();
  for (const value of [
    change(v => v.resources.samples.forEach(s => {if (s.phase === 'integration') s.phase = 'verification';})),
    change(v => delete v.resources.after),
    change(v => v.resources.after.quarantined[1].id = 'f'.repeat(64)),
    change(v => v.resources.after.quarantined[1].state = 'exited'),
    change(v => v.resources.after.availableMiB = 2047),
    change(v => v.resources.after.freeGiB = 14),
    change(v => v.resources.samples.reverse()),
  ]) assert.throws(() => verifyTestCloudReceipt(value));
});

test('non-finite, wrongly typed or unsampled measurements cannot certify capacity', async () => {
  const {verifyTestCloudReceipt} = await api();
  for (const value of [
    change(v => v.resources.samples[3].availableMiB = NaN),
    change(v => v.resources.samples[3].freeGiB = '18'),
    change(v => v.resources.samples[3].cloudMiB = -1),
    change(v => v.resources.samples[3].elapsedMs = 15000.5),
    change(v => v.resources.samples[15].verifierMiB = 0),
    change(v => v.resources.samples[15].scratchMiB = 1001),
    change(v => v.cleanup.created = v.cleanup.removed = []),
    change(v => v.rollback.before.volumes = v.rollback.after.volumes = []),
  ]) assert.throws(() => verifyTestCloudReceipt(value));
});

test('cleanup records exact run ownership for every recorded resource kind', async () => {
  const {verifyTestCloudReceipt} = await api();
  for (const value of [
    change(v => v.cleanup.created[0].owner = uuid(99)),
    change(v => v.cleanup.removed[0].owner = uuid(99)),
    change(v => delete v.cleanup.created[0].owner),
    change(v => v.cleanup.created[0].id = v.resources.baseline.quarantined[0].id),
  ]) assert.throws(() => verifyTestCloudReceipt(value));
  const value = fixture();
  for (const [kind, id] of [['network', 'cloud-test-network'], ['volume', 'cloud-test-state'], ['image', image]]) {
    const resource = {kind, id, owner: value.runId}; value.cleanup.created.push(resource); value.cleanup.removed.push({...resource});
  }
  assert.equal(verifyTestCloudReceipt(value), true);
});

test('a gap outside the settled window still refuses the receipt', async () => {
  const {verifyTestCloudReceipt} = await api();
  assert.throws(() => verifyTestCloudReceipt(change(v => v.resources.samples.at(-1).elapsedMs = 85001)));
});

test('a second verifier refuses even when another sample records one verifier', async () => {
  const {verifyTestCloudReceipt} = await api();
  assert.throws(() => verifyTestCloudReceipt(change(v => {
    const sample = v.resources.samples.at(-1);
    sample.verifierCount = 2; sample.verifierMiB = 1000; sample.scratchMiB = 240;
  })));
});

test('a fifty-five-second settled window cannot count as sixty seconds', async () => {
  const {verifyTestCloudReceipt} = await api();
  assert.throws(() => verifyTestCloudReceipt(change(v => v.resources.samples[2].phase = 'startup')));
});
