import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync, spawn} from 'node:child_process';

test('three owned nodes repeat both complete journeys after the manifest host is stopped', {
  skip: process.env.TEST_KUBERNETES_WORKER_LOSS !== '1', timeout: 2700000,
}, () => {
  const run = spawnSync(process.execPath, ['scripts/kubernetes-check.mjs', '--worker-loss'], {encoding: 'utf8', timeout: 2640000});
  if (run.stderr) process.stderr.write(run.stderr);
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.journeys.length, 2);
  for (const reply of result.journeys) {
  assert.match(reply.kubernetes.cluster, /^d620-/);
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
  assert.equal(result.kubernetes.volumeRemoved, true);
  process.stdout.write(JSON.stringify(result) + '\n');
});

// This executes the same observer and native probes before a paid Amazon run.
test('same signed-in clients observe a stopped worker through two genuine backup verifications', {
  skip: process.env.TEST_KUBERNETES_OBSERVER_LOSS !== '1', timeout: 2700000,
}, async () => {
  const run = spawn(process.execPath, ['scripts/kubernetes-check.mjs', '--observer-worker-loss'], {stdio: ['ignore', 'pipe', 'pipe'], timeout: 2640000});
  let stdout = '', stderr = '';
  run.stdout.on('data', part => {stdout += part; if (stdout.length > 2 * 1024 * 1024) run.kill('SIGTERM');});
  run.stderr.on('data', part => {stderr = (stderr + part).slice(-65536); process.stderr.write(part);});
  const code = await new Promise((resolve, reject) => {run.once('error', reject); run.once('close', resolve);});
  assert.equal(code, 0, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.p1.reconciliation, 'unavailable');
  assert.ok(result.p1.offMs >= 900000);
  assert.equal(result.p1.backupsAfterStop, 2);
  for (const name of ['session', 'remote', 'login', 'signup']) assert.ok(result.p1.recovery[name].withinMs <= 90000, name);
  assert.ok(result.p1.recovery.backup.withinMs <= 300000);
  assert.equal(result.paidSnapshot.verification, 'verified');
  assert.equal(result.paidSnapshot.workerVerification.activation, 'not_attempted');
  assert.equal(result.paidSnapshot.workerVerification.cleanupConfirmed, true);
  assert.equal(result.paidSnapshot.workerVerification.childAbsent, true);
  assert.equal(result.paidSnapshot.workerVerification.workerStoppedNaturally, true);
  assert.equal(result.paidRemote.withdrawal.peerRemoved, true);
  assert.equal(result.paidRemote.withdrawal.cachedConfigurationMasked, true);
  assert.equal(result.workerLoss.runningAfterSecond, false);
  assert.equal(result.kubernetes.removed, true);
  assert.equal(result.kubernetes.volumeRemoved, true);
  assert.deepEqual(result.cleanup.remaining, []);
  process.stdout.write(JSON.stringify(result) + '\n');
});
