import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {verifyTestCloudWithdrawalReceipt} from './integration-withdrawal-receipt.mjs';

// Wall time alone cannot prove that this run waited out its original grant.
export async function observePairedSnapshotExpiry({withdrawal, observe, now = Date.now, elapsed = () => performance.now(), wait = delay}) {
  verifyTestCloudWithdrawalReceipt(withdrawal);
  const result = structuredClone(withdrawal), initial = result.snapshot;
  assert.equal(initial.expiryObserved, false);
  const startedAt = now(), startedElapsed = elapsed(), expires = Date.parse(initial.expiresAt);
  assert.ok(Number.isSafeInteger(startedAt) && startedAt >= initial.observedAt && startedAt - initial.observedAt <= 10000);
  assert.ok(Number.isFinite(startedElapsed) && startedElapsed >= 0);
  assert.ok(startedAt < expires);
  await wait(expires - startedAt + 1000);
  const checkClock = () => {
    const wall = now(), duration = elapsed() - startedElapsed;
    assert.ok(Number.isSafeInteger(wall) && wall >= expires && wall <= expires + 10000);
    assert.ok(Number.isFinite(duration) && duration >= expires - startedAt && duration <= expires - startedAt + 10000);
    assert.ok(Math.abs(wall - startedAt - duration) <= 5000);
    return wall;
  };
  const probeStartedAt = checkClock();
  result.snapshot = await observe();
  const finishedAt = checkClock();
  verifyTestCloudWithdrawalReceipt(result);
  for (const key of ['organisationId', 'venueId', 'installationId', 'pointId', 'requestedAt', 'acceptedAt', 'expiresAt', 'downgradedAt', 'newGrantRefused']) {
    assert.equal(result.snapshot[key], initial[key], 'integration.paired_snapshot_changed:' + key);
  }
  assert.equal(result.snapshot.expiryObserved, true);
  assert.ok(result.snapshot.observedAt >= probeStartedAt && result.snapshot.observedAt <= finishedAt);
  return structuredClone(result);
}
