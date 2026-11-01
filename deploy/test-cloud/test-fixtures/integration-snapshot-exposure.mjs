import assert from 'node:assert/strict';

// A live pre-existing snapshot grant is residual access, never completed withdrawal.
export async function observeSnapshotExposure({saved, selected, downgradedAt, put, now = Date.now}) {
  for (const key of ['venueId', 'installationId', 'identitySha256', 'archiveSha256']) assert.equal(saved[key], selected[key]);
  assert.match(saved.id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.equal(saved.incomingKey, 'incoming/' + saved.id);
  assert.deepEqual(saved.location, {endpoint: 'https://waitron.local:8333', bucket: 'venue-' + selected.venueId, region: 'local'});
  const expires = Date.parse(saved.expiresAt);
  assert.ok(Number.isSafeInteger(saved.requestedAt) && saved.requestedAt >= 0);
  assert.ok(Number.isSafeInteger(saved.acceptedAt) && saved.acceptedAt >= saved.requestedAt);
  assert.equal(saved.writeStatus, 200);
  assert.ok(Number.isSafeInteger(expires) && expires > saved.acceptedAt && expires <= saved.requestedAt + 901000);
  const startedAt = now();
  assert.ok(Number.isSafeInteger(downgradedAt) && downgradedAt >= saved.acceptedAt && downgradedAt <= startedAt);
  let writeStatus;
  try {writeStatus = (await put()).$metadata.httpStatusCode; assert.equal(writeStatus, 200);}
  catch (error) {
    assert.equal(error?.$metadata?.httpStatusCode, 403);
    assert.equal(error?.name, 'InvalidAccessKeyId');
    assert.ok(startedAt >= expires);
    writeStatus = 403;
  }
  const observedAt = now();
  assert.ok(Number.isSafeInteger(observedAt) && observedAt >= startedAt);
  if (writeStatus === 200) assert.ok(observedAt < expires);
  return {requestedAt: saved.requestedAt, acceptedAt: saved.acceptedAt, expiresAt: saved.expiresAt,
    downgradedAt, observedAt, remainingMs: Math.max(0, expires - observedAt), writeStatus, expiryObserved: writeStatus === 403};
}
