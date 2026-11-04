import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const hash = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, image = /^sha256:[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const quarantine = ['waitron-app-1', 'waitron-print-agent-1', 'waitron-mailpit-1'];
function exact(value, fields) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), fields.split(',').sort());
}
function number(value, max = Number.MAX_SAFE_INTEGER) {
  assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max);
}
function source(value) {
  exact(value, 'head,tree,image,dirty');
  assert.match(value.head, commit); assert.match(value.tree, commit); assert.match(value.image, image);
  assert.equal(value.dirty, false);
}
function refused(value) {
  exact(value, 'status,httpStatus,error,grantIssued');
  assert.equal(value.status, 'proved'); assert.equal(value.httpStatus, 403);
  assert.equal(value.error, 'permission_denied'); assert.equal(value.grantIssued, false);
}
function protectedContainers(values) {
  assert.ok(Array.isArray(values)); assert.deepEqual(values.map(v => v.name).sort(), [...quarantine].sort());
  for (const value of values) {
    exact(value, 'name,id,state,health'); assert.match(value.id, hash);
    assert.equal(value.state, 'running'); assert.equal(value.health, 'healthy');
  }
  assert.equal(new Set(values.map(v => v.id)).size, 3);
}
function resources(value) {
  exact(value, 'baseline,samples,after'); exact(value.baseline, 'availableMiB,freeGiB,quarantined');
  number(value.baseline.availableMiB); number(value.baseline.freeGiB);
  assert.ok(value.baseline.availableMiB >= 4096 && value.baseline.freeGiB >= 20);
  protectedContainers(value.baseline.quarantined);
  assert.ok(Array.isArray(value.samples) && value.samples.length > 0);
  let elapsed = -1, below = 0;
  const phases = new Map();
  for (const sample of value.samples) {
    exact(sample, 'elapsedMs,phase,availableMiB,freeGiB,cloudMiB,verifierMiB,verifierCount,scratchMiB,fixtureBytes,oom,quarantined');
    number(sample.elapsedMs); assert.ok(Number.isSafeInteger(sample.elapsedMs));
    assert.ok(sample.elapsedMs > elapsed && sample.elapsedMs - Math.max(0, elapsed) <= 5000);
    elapsed = sample.elapsedMs;
    assert.ok(['startup', 'settled', 'verification', 'integration'].includes(sample.phase));
    if (!phases.has(sample.phase)) phases.set(sample.phase, []);
    phases.get(sample.phase).push(sample.elapsedMs);
    number(sample.availableMiB); number(sample.freeGiB); number(sample.cloudMiB, 2048);
    number(sample.verifierMiB, 1024); number(sample.scratchMiB, 256); number(sample.fixtureBytes, 1073741824);
    assert.ok(sample.verifierCount === 0 || sample.verifierCount === 1);
    if (sample.verifierCount === 0) assert.ok(sample.verifierMiB === 0 && sample.scratchMiB === 0);
    assert.ok(sample.scratchMiB <= sample.verifierMiB);
    assert.equal(sample.oom, false);
    protectedContainers(sample.quarantined);
    assert.deepEqual([...sample.quarantined].sort((a, b) => a.name.localeCompare(b.name)), [...value.baseline.quarantined].sort((a, b) => a.name.localeCompare(b.name)));
    below = sample.availableMiB < 2048 || sample.freeGiB < 15 ? below + 1 : 0;
    assert.ok(below < 3);
  }
  assert.ok(phases.has('startup') && phases.has('verification') && phases.has('integration'));
  exact(value.after, 'availableMiB,freeGiB,quarantined');
  number(value.after.availableMiB); number(value.after.freeGiB);
  assert.ok(value.after.availableMiB >= 2048 && value.after.freeGiB >= 15);
  protectedContainers(value.after.quarantined);
  assert.deepEqual([...value.after.quarantined].sort((a, b) => a.name.localeCompare(b.name)), [...value.baseline.quarantined].sort((a, b) => a.name.localeCompare(b.name)));
  const settled = phases.get('settled');
  assert.ok(settled && settled.at(-1) - settled[0] >= 60000);
  for (let i = 1; i < settled.length; i++) assert.ok(settled[i] - settled[i - 1] <= 5000);
  assert.ok(value.samples.some(sample => sample.phase === 'verification' && sample.verifierCount === 1 && sample.verifierMiB > 0));
}
function deploymentIdentity(value) {
  exact(value, 'project,image,schema,caSha256,volumes'); assert.equal(value.project, 'waitron-cloud-test');
  assert.match(value.image, image); assert.match(value.schema, commit); assert.match(value.caSha256, hash);
  assert.ok(Array.isArray(value.volumes) && value.volumes.length >= 3);
  for (const id of value.volumes) assert.match(id, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
  assert.equal(new Set(value.volumes).size, value.volumes.length);
}
function cleanup(value, quarantined, runId) {
  exact(value, 'created,removed,remaining'); assert.deepEqual(value.remaining, []);
  const identities = values => {
    assert.ok(Array.isArray(values));
    const result = values.map(resource => {
      exact(resource, 'kind,id,owner'); assert.equal(resource.owner, runId); assert.ok(['container', 'network', 'volume', 'image'].includes(resource.kind));
      if (resource.kind === 'container') {assert.match(resource.id, hash); assert.ok(!quarantined.some(c => c.id === resource.id));}
      else if (resource.kind === 'image') assert.match(resource.id, image);
      else assert.match(resource.id, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
      return `${resource.kind}:${resource.id}`;
    });
    assert.equal(new Set(result).size, result.length); return result.sort();
  };
  assert.ok(value.created.length > 0);
  assert.deepEqual(identities(value.removed), identities(value.created));
}

// A schema check rejects incomplete claims; the producing run supplies the evidence.
export function verifyTestCloudReceipt(value) {
  exact(value, 'version,kind,runId,environment,origin,cloud,waitron,organisations,accountMail,clients,snapshots,continuous,remote,fixtures,resources,rollback,cleanup');
  assert.equal(value.version, 1); assert.equal(value.kind, 'test-cloud-integration'); assert.match(value.runId, uuid);
  assert.ok(['mac-disposable', 'lan-test-box'].includes(value.environment));
  assert.equal(value.origin, 'https://waitron.local:3000'); source(value.cloud); source(value.waitron);
  assert.ok(Array.isArray(value.organisations) && value.organisations.length === 2);
  assert.deepEqual(value.organisations.map(v => v.plan).sort(), ['free', 'paid']);
  for (const organisation of value.organisations) {
    exact(organisation, 'plan,organisationId,venueId,installationId,stateSha256');
    for (const key of ['organisationId', 'venueId', 'installationId']) assert.match(organisation[key], uuid);
    assert.match(organisation.stateSha256, hash);
  }
  for (const key of ['organisationId', 'venueId', 'installationId', 'stateSha256']) assert.equal(new Set(value.organisations.map(v => v[key])).size, 2);
  exact(value.accountMail, 'free,paid,transport'); assert.deepEqual(value.accountMail, {free: 'proved', paid: 'proved', transport: 'mailpit'});
  exact(value.clients, 'status,waitronHead,origin,actions'); assert.equal(value.clients.status, 'proved');
  assert.equal(value.clients.waitronHead, value.waitron.head); assert.equal(value.clients.origin, value.origin);
  assert.deepEqual(value.clients.actions, ['pair', 'renew', 'configuration']);
  exact(value.snapshots, 'status,free,paid'); assert.equal(value.snapshots.status, 'proved'); refused(value.snapshots.free);
  exact(value.snapshots.paid, 'archiveSha256,upload,verification,restore,activation'); assert.match(value.snapshots.paid.archiveSha256, hash);
  for (const key of ['upload', 'verification', 'restore']) assert.equal(value.snapshots.paid[key], 'proved');
  assert.equal(value.snapshots.paid.activation, 'not-performed');
  exact(value.continuous, 'status,capture,restore,snapshotFallback,streamAbsentForFallback,activation');
  for (const key of ['status', 'capture', 'restore', 'snapshotFallback']) assert.equal(value.continuous[key], 'proved');
  assert.equal(value.continuous.streamAbsentForFallback, true); assert.equal(value.continuous.activation, 'not-performed');
  exact(value.remote, 'status,freeProvision,freeCertificate,staffIsolation,publicIsolation,downgrade,restart,withdrawal');
  for (const key of ['status', 'staffIsolation', 'publicIsolation', 'downgrade', 'restart']) assert.equal(value.remote[key], 'proved');
  refused(value.remote.freeProvision); refused(value.remote.freeCertificate);
  exact(value.remote.withdrawal, 'streamMs,gatewayMs,snapshotStsMs');
  number(value.remote.withdrawal.streamMs); number(value.remote.withdrawal.gatewayMs, 600000); number(value.remote.withdrawal.snapshotStsMs, 901000);
  exact(value.fixtures, 'address,relay,translation,deployedTranslation,waitronRelay,waitronTranslation');
  assert.deepEqual(value.fixtures, {address: 'unavailable', relay: 'local-proof', translation: 'fake-loopback', deployedTranslation: 'off', waitronRelay: 'unavailable', waitronTranslation: 'unavailable'});
  resources(value.resources);
  exact(value.rollback, 'status,before,after,oldBinaryOnNewSchema'); assert.equal(value.rollback.status, 'proved');
  deploymentIdentity(value.rollback.before); deploymentIdentity(value.rollback.after);
  assert.deepEqual(value.rollback.after, value.rollback.before); assert.equal(value.rollback.oldBinaryOnNewSchema, false);
  assert.equal(value.rollback.before.image, value.cloud.image);
  cleanup(value.cleanup, value.resources.baseline.quarantined, value.runId);
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 3);
    const contents = await readFile(process.argv[2]); assert.ok(contents.length <= 2 * 1024 * 1024);
    verifyTestCloudReceipt(JSON.parse(contents));
    process.stdout.write('Test Cloud integration receipt verified\n');
  } catch {process.stderr.write('Test Cloud integration receipt refused\n'); process.exitCode = 1;}
}
