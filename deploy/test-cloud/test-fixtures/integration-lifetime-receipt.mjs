import assert from 'node:assert/strict';

function exact(value, fields) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), fields.split(',').sort());
}
function timestamp(value) {assert.ok(Number.isSafeInteger(value) && value >= 0);}

// A native provider lifetime cannot certify paired withdrawal or a shipping deployment.
export function verifySnapshotLifetimeReceipt(value) {
  exact(value, 'version,kind,runId,cloud,storage,purpose,requestedSeconds,requestedAt,acceptedAt,expiresAt,refusedAt,elapsedMs,before,after,completeIntegration,shippingQualification');
  assert.equal(value.version, 1); assert.equal(value.kind, 'test-cloud-storage-lifetime');
  assert.match(value.runId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  exact(value.cloud, 'head,tree,dirty,files,runtimeSha256');
  assert.match(value.cloud.head, /^[a-f0-9]{40}$/); assert.match(value.cloud.tree, /^[a-f0-9]{40}$/);
  assert.equal(value.cloud.dirty, false); assert.ok(Number.isSafeInteger(value.cloud.files) && value.cloud.files > 0);
  assert.match(value.cloud.runtimeSha256, /^[a-f0-9]{64}$/);
  exact(value.storage, 'kind,binarySha256'); assert.equal(value.storage.kind, 'native-seaweedfs');
  assert.match(value.storage.binarySha256, /^[a-f0-9]{64}$/);
  assert.ok(value.requestedSeconds === 900 || value.requestedSeconds === 12);
  assert.equal(value.purpose, value.requestedSeconds === 900 ? 'provider-lifetime' : 'short-diagnostic');
  for (const key of ['requestedAt', 'acceptedAt', 'refusedAt']) timestamp(value[key]);
  assert.equal(typeof value.expiresAt, 'string');
  const expires = Date.parse(value.expiresAt); timestamp(expires);
  assert.ok(Math.abs(expires - value.requestedAt - value.requestedSeconds * 1000) <= 1000);
  assert.ok(value.requestedAt <= value.acceptedAt && value.acceptedAt < expires && expires <= value.refusedAt);
  assert.ok(Number.isFinite(value.elapsedMs) && value.elapsedMs >= value.requestedSeconds * 1000 - 1000);
  assert.ok(Math.abs(value.elapsedMs - (value.refusedAt - value.requestedAt)) <= 1000);
  exact(value.before, 'status'); assert.equal(value.before.status, 200);
  exact(value.after, 'status,error'); assert.deepEqual(value.after, {status: 403, error: 'InvalidAccessKeyId'});
  assert.equal(value.completeIntegration, false); assert.equal(value.shippingQualification, false);
  return true;
}

export function createSnapshotLifetimeReceipt(raw) {
  const receipt = {version: 1, kind: 'test-cloud-storage-lifetime', runId: raw.runId, cloud: raw.cloud,
    storage: {kind: 'native-seaweedfs', binarySha256: raw.storageBinarySha256},
    purpose: raw.requestedSeconds === 900 ? 'provider-lifetime' : 'short-diagnostic',
    requestedSeconds: raw.requestedSeconds, requestedAt: raw.requestedAt, acceptedAt: raw.acceptedAt,
    expiresAt: raw.expiresAt, refusedAt: raw.refusedAt, elapsedMs: raw.elapsedMs,
    before: {status: raw.beforeStatus}, after: {status: raw.afterStatus, error: raw.afterError},
    completeIntegration: false, shippingQualification: false};
  verifySnapshotLifetimeReceipt(receipt);
  return structuredClone(receipt);
}
