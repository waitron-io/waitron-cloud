import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const load = () => import('../../scripts/complete-test-cloud-receipt.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/complete-test-cloud-receipt.mjs')) return {};
  throw error;
});
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const head = 'a'.repeat(40), tree = 'b'.repeat(40), hash = 'c'.repeat(64), image = 'sha256:' + hash;
const installation = {organisationId: uuid(5), venueId: uuid(6), installationId: uuid(7)};
const refusal = {status: 'proved', httpStatus: 403, error: 'permission_denied', grantIssued: false};

// Synthetic observations test the publication boundary, never an executed integration.
function fixture() {
  const quarantined = ['waitron-app-1', 'waitron-print-agent-1', 'waitron-mailpit-1'].map((name, i) =>
    ({name, id: String(i + 1).repeat(64), state: 'running', health: 'healthy'}));
  const identity = {project: 'waitron-cloud-test', image, schema: head, caSha256: hash, volumes: ['test-config', 'test-postgres', 'test-storage']};
  const owned = {kind: 'container', id: 'd'.repeat(64), owner: uuid(1)};
  return structuredClone({
    receipt: {
      version: 1, kind: 'test-cloud-integration', runId: uuid(1), environment: 'lan-test-box', origin: 'https://waitron.local:3000',
      cloud: {head, tree, image, dirty: false}, waitron: {head, tree, image, dirty: false},
      organisations: [
        {plan: 'free', organisationId: uuid(2), venueId: uuid(3), installationId: uuid(4), stateSha256: hash},
        {plan: 'paid', ...installation, stateSha256: 'e'.repeat(64)},
      ],
      accountMail: {free: 'proved', paid: 'proved', transport: 'mailpit'},
      clients: {status: 'proved', waitronHead: head, origin: 'https://waitron.local:3000', actions: ['pair', 'renew', 'configuration']},
      snapshots: {status: 'proved', free: refusal, paid: {archiveSha256: hash, upload: 'proved', verification: 'proved', restore: 'proved', activation: 'not-performed'}},
      continuous: {status: 'proved', capture: 'proved', restore: 'proved', snapshotFallback: 'proved', streamAbsentForFallback: true, activation: 'not-performed'},
      remote: {status: 'proved', freeProvision: refusal, freeCertificate: refusal, staffIsolation: 'proved', publicIsolation: 'proved', downgrade: 'proved', restart: 'proved',
        withdrawal: {streamMs: 3400, gatewayMs: 3100, snapshotStsMs: 602000}},
      fixtures: {address: 'unavailable', relay: 'local-proof', translation: 'fake-loopback', deployedTranslation: 'off', waitronRelay: 'unavailable', waitronTranslation: 'unavailable'},
      resources: {baseline: {availableMiB: 4096, freeGiB: 20, quarantined}, after: {availableMiB: 3000, freeGiB: 18, quarantined},
        samples: Array.from({length: 17}, (_, i) => ({elapsedMs: i * 5000, phase: i < 2 ? 'startup' : i < 15 ? 'settled' : i === 15 ? 'verification' : 'integration',
          availableMiB: 3000, freeGiB: 18, cloudMiB: 1800, verifierMiB: i === 15 ? 1000 : 0, verifierCount: i === 15 ? 1 : 0,
          scratchMiB: i === 15 ? 240 : 0, fixtureBytes: 1234, oom: false, quarantined}))},
      rollback: {status: 'proved', before: identity, after: identity, oldBinaryOnNewSchema: false},
      cleanup: {created: [owned], removed: [owned], remaining: []},
    },
    withdrawal: {version: 1, kind: 'test-cloud-withdrawal', runId: uuid(1),
      cloud: {head, tree, image, dirty: false, files: 1694, runtimeSha256: hash}, installation,
      stream: {...installation, before: {writeStatus: 200, readStatus: 200, outsidePrefixRefused: true, neighbourRefused: true},
        after: {writeStatus: 403, readStatus: 403, durationMs: 3400}, restartObserved: true, retainedData: true, readerPreserved: true, installationPreserved: true, plan: 'free'},
      gateway: {...installation, staffRefused: true, publicRefused: true, peerRemoved: true, cachedConfigurationMasked: true,
        installationPreserved: true, restartObserved: true, plan: 'free', durationMs: 3100},
      snapshot: {...installation, pointId: uuid(8), requestedAt: 1000, acceptedAt: 2000, expiresAt: '1970-01-01T00:15:01.000Z',
        downgradedAt: 300000, observedAt: 902000, remainingMs: 0, writeStatus: 403, expiryObserved: true, newGrantRefused: true, status: 'expired'}},
  });
}
async function complete(value) {
  const api = await load();
  assert.equal(typeof api.completeTestCloudReceipt, 'function', 'The final complete-receipt producer is missing');
  return api.completeTestCloudReceipt(value);
}

// Removing a binding must let a mismatched observation escape this test.
test('complete publication preserves the strict receipt and does not alias its input', async () => {
  const input = fixture(), before = structuredClone(input);
  const result = await complete(input);
  assert.deepEqual(result, before.receipt);
  assert.deepEqual(input, before);
  result.remote.withdrawal.streamMs = 1;
  assert.equal(input.receipt.remote.withdrawal.streamMs, 3400);
});

const mutations = [
  ['a different run', v => v.withdrawal.runId = uuid(99)],
  ...['head', 'tree', 'image'].map(key => ['a different Cloud ' + key, v => v.withdrawal.cloud[key] = key === 'image' ? 'sha256:' + 'f'.repeat(64) : 'f'.repeat(40)]),
  ...Object.keys(installation).map(key => ['a foreign paid ' + key, v => {
    for (const part of ['installation', 'stream', 'gateway', 'snapshot']) v.withdrawal[part][key] = uuid(99);
  }]),
  ['a stream duration from another run', v => v.receipt.remote.withdrawal.streamMs = 3401],
  ['a gateway duration from another run', v => v.receipt.remote.withdrawal.gatewayMs = 3101],
  ['an advertised lifetime used as withdrawal', v => v.receipt.remote.withdrawal.snapshotStsMs = 900000],
  ['remaining validity used as withdrawal', v => v.receipt.remote.withdrawal.snapshotStsMs = 600000],
  ['a missing withdrawal component', v => delete v.withdrawal],
  ['an incomplete strict receipt', v => v.receipt.continuous.restore = 'unavailable'],
  ['a changed shipping startup floor', v => v.receipt.resources.baseline.freeGiB = 19.99],
  ['a changed shipping running floor', v => v.receipt.resources.after.freeGiB = 14.99],
  ['a dirty withdrawal source', v => v.withdrawal.cloud.dirty = true],
  ['an unobserved stream refusal', v => v.withdrawal.stream.after.writeStatus = 200],
  ['an unobserved gateway refusal', v => v.withdrawal.gateway.staffRefused = false],
  ['an invalid strict receipt kind', v => v.receipt.kind = 'test-cloud-clients'],
  ['a private root extension', v => v.token = 'private-value'],
  ['a private receipt extension', v => v.receipt.cookie = 'private-value'],
  ['a private withdrawal extension', v => v.withdrawal.cookie = 'private-value'],
];
for (const [name, change] of mutations) test('complete publication refuses ' + name, async () => {
  const input = fixture(); change(input);
  await assert.rejects(complete(input));
});

test('a live paired snapshot cannot borrow a separate native provider expiry proof', async () => {
  const input = fixture();
  Object.assign(input.withdrawal.snapshot, {observedAt: 301000, remainingMs: 600000, writeStatus: 200, expiryObserved: false, status: 'residual-access'});
  input.receipt.remote.withdrawal.snapshotStsMs = 1000;
  await assert.rejects(complete(input), /completion.snapshot_expiry_unobserved/);
  input.providerLifetime = {purpose: 'provider-lifetime', requestedSeconds: 900, elapsedMs: 900464, after: {status: 403, error: 'InvalidAccessKeyId'}};
  await assert.rejects(complete(input));
});

test('the CLI emits only a completed receipt and never prints rejected private input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-completion-'));
  try {
    const file = join(directory, 'observations.json');
    await writeFile(file, JSON.stringify(fixture()));
    const run = (...args) => spawnSync(process.execPath, ['scripts/complete-test-cloud-receipt.mjs', ...args], {encoding: 'utf8'});
    const valid = run(file);
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout), fixture().receipt); assert.equal(valid.stderr, '');
    const extra = run(file, 'extra');
    assert.equal(extra.status, 1); assert.equal(extra.stdout, '');
    assert.equal(extra.stderr, 'Test Cloud completion refused\n');
    const input = fixture(); input.receipt.token = 'private-action-link';
    await writeFile(file, JSON.stringify(input));
    for (const result of [run(file), run(file, 'extra')]) {
      assert.equal(result.status, 1); assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'Test Cloud completion refused\n');
    }
    await writeFile(file, JSON.stringify(fixture()) + ' '.repeat(2 * 1024 * 1024));
    const excessive = run(file);
    assert.equal(excessive.status, 1); assert.equal(excessive.stdout, '');
    assert.equal(excessive.stderr, 'Test Cloud completion refused\n');
  } finally {await rm(directory, {recursive: true, force: true});}
});
