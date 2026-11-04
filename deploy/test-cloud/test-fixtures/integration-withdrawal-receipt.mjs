import assert from 'node:assert/strict';

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const bindingKeys = ['organisationId', 'venueId', 'installationId'];
function exact(value, fields) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), fields.split(',').sort());
}
function integer(value) {assert.ok(Number.isSafeInteger(value) && value >= 0);}
function binding(value, selected) {
  for (const key of bindingKeys) {assert.match(value[key], uuid); assert.equal(value[key], selected[key]);}
}
function duration(value) {integer(value); assert.ok(value < 30000);}

// Advertised validity remaining is residual access; only a storage refusal observes expiry.
export function verifyTestCloudWithdrawalReceipt(value) {
  exact(value, 'version,kind,runId,cloud,installation,stream,gateway,snapshot');
  assert.equal(value.version, 1); assert.equal(value.kind, 'test-cloud-withdrawal'); assert.match(value.runId, uuid);
  exact(value.cloud, 'head,tree,image,dirty,files,runtimeSha256');
  assert.match(value.cloud.head, /^[a-f0-9]{40}$/); assert.match(value.cloud.tree, /^[a-f0-9]{40}$/);
  assert.match(value.cloud.image, /^sha256:[a-f0-9]{64}$/); assert.equal(value.cloud.dirty, false);
  integer(value.cloud.files); assert.ok(value.cloud.files > 1000); assert.match(value.cloud.runtimeSha256, /^[a-f0-9]{64}$/);
  exact(value.installation, 'organisationId,venueId,installationId'); binding(value.installation, value.installation);
  const {stream, gateway, snapshot} = value;
  exact(stream, 'organisationId,venueId,installationId,before,after,restartObserved,retainedData,readerPreserved,installationPreserved,plan');
  binding(stream, value.installation);
  assert.deepEqual(stream.before, {writeStatus: 200, readStatus: 200, outsidePrefixRefused: true, neighbourRefused: true});
  exact(stream.after, 'writeStatus,readStatus,durationMs');
  assert.equal(stream.after.writeStatus, 403); assert.equal(stream.after.readStatus, 403); duration(stream.after.durationMs);
  for (const key of ['restartObserved', 'retainedData', 'readerPreserved', 'installationPreserved']) assert.equal(stream[key], true);
  assert.equal(stream.plan, 'free');
  exact(gateway, 'organisationId,venueId,installationId,staffRefused,publicRefused,peerRemoved,cachedConfigurationMasked,installationPreserved,restartObserved,plan,durationMs');
  binding(gateway, value.installation);
  for (const key of ['staffRefused', 'publicRefused', 'peerRemoved', 'cachedConfigurationMasked', 'installationPreserved', 'restartObserved']) assert.equal(gateway[key], true);
  assert.equal(gateway.plan, 'free'); duration(gateway.durationMs);
  exact(snapshot, 'organisationId,venueId,installationId,pointId,requestedAt,acceptedAt,expiresAt,downgradedAt,observedAt,remainingMs,writeStatus,expiryObserved,newGrantRefused,status');
  binding(snapshot, value.installation); assert.match(snapshot.pointId, uuid); assert.equal(snapshot.newGrantRefused, true);
  for (const key of ['requestedAt', 'acceptedAt', 'downgradedAt', 'observedAt', 'remainingMs']) integer(snapshot[key]);
  assert.ok(snapshot.requestedAt <= snapshot.acceptedAt && snapshot.acceptedAt <= snapshot.downgradedAt && snapshot.downgradedAt <= snapshot.observedAt);
  assert.equal(typeof snapshot.expiresAt, 'string');
  const expires = Date.parse(snapshot.expiresAt); integer(expires);
  assert.ok(expires > snapshot.acceptedAt && expires <= snapshot.requestedAt + 901000);
  assert.equal(snapshot.remainingMs, Math.max(0, expires - snapshot.observedAt));
  assert.equal(typeof snapshot.expiryObserved, 'boolean');
  if (snapshot.expiryObserved) {
    assert.equal(snapshot.writeStatus, 403); assert.ok(snapshot.observedAt >= expires); assert.equal(snapshot.status, 'expired');
  } else {
    assert.equal(snapshot.writeStatus, 200); assert.ok(snapshot.observedAt < expires); assert.equal(snapshot.status, 'residual-access');
  }
  return true;
}

export function createTestCloudWithdrawalReceipt(raw) {
  assert.equal(raw.version, 1); assert.equal(raw.kind, 'test-cloud-clients'); assert.equal(raw.completeIntegration, false);
  assert.ok(Array.isArray(raw.organisations) && raw.organisations.length === 2);
  assert.deepEqual(raw.organisations.map(value => value.plan).sort(), ['free', 'paid']);
  assert.equal(raw.cloudSource.image, raw.image);
  const paid = raw.organisations.find(value => value.plan === 'paid');
  const installation = Object.fromEntries(bindingKeys.map(key => [key, paid[key]]));
  binding(raw.paidSnapshot, installation); binding(raw.paidRemote, installation);
  assert.equal(raw.paidSnapshotExposure.pointId, raw.paidSnapshot.pointId);
  const receipt = {version: 1, kind: 'test-cloud-withdrawal', runId: raw.runId, cloud: raw.cloudSource, installation,
    stream: raw.paidStorageWithdrawal, gateway: {...raw.paidRemote.withdrawal, ...installation},
    snapshot: {...raw.paidSnapshotExposure, status: raw.paidSnapshotExposure.expiryObserved ? 'expired' : 'residual-access'}};
  verifyTestCloudWithdrawalReceipt(receipt);
  return structuredClone(receipt);
}
