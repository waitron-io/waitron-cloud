import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';

test('three owned nodes repeat both complete journeys after the manifest host is stopped', {
  skip: process.env.TEST_KUBERNETES_WORKER_LOSS !== '1', timeout: 2700000,
}, () => {
  const run = spawnSync(process.execPath, ['scripts/kubernetes-check.mjs', '--worker-loss'], {encoding: 'utf8', timeout: 2640000});
  if (run.stderr) process.stderr.write(run.stderr);
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.journeys.length, 2);
  for (const reply of result.journeys) {
  assert.equal(reply.accountMail.free, 'proved'); assert.equal(reply.accountMail.paid, 'proved');
  assert.equal(reply.clients.demoVenues, 2); assert.equal(reply.clients.restartIdentity, 'proved');
  assert.deepEqual(reply.freeRemote.submit, {status: 403, error: 'permission_denied'});
  assert.deepEqual(reply.freeRemote.invalidProof, {status: 401, error: 'invalid_proof'});
  assert.equal(reply.paidRemote.routes.staffAvailability, 200);
  assert.equal(reply.paidRemote.routes.publicAfterChallenge, 200);
  assert.equal(reply.paidRemote.withdrawal.peerRemoved, true);
  assert.ok(reply.paidSnapshot, 'the native client must publish a captured backup');
  assert.equal(reply.paidSnapshot.verification, 'verified');
  const verification = reply.paidSnapshot.workerVerification;
  for (const key of ['pointId', 'sha256', 'bytes']) assert.equal(verification[key], reply.paidSnapshot[key]);
  assert.equal(verification.modules, 15); assert.equal(verification.status, 'passed');
  assert.equal(verification.activation, 'not_attempted'); assert.equal(verification.noSupersession, true);
  assert.equal(verification.cleanupConfirmed, true); assert.equal(verification.childAbsent, true);
  assert.equal(verification.workerStoppedNaturally, true);
  assert.deepEqual(reply.cleanup.remaining, []);
  }
  assert.ok(result.workerLoss.stopped.endsWith('-worker2'));
  assert.ok(result.workerLoss.replacement.endsWith('-worker'));
  assert.ok(result.workerLoss.offBeforeSecondMs >= 900000);
  assert.equal(result.workerLoss.runningAfterSecond, false);
  assert.equal(result.kubernetes.removed, true);
});
