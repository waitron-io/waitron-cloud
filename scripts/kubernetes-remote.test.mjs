import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runKubernetesCheck} from './kubernetes-check.mjs';

test('the paired venue keeps its endpoint through an elected gateway handover', {
  skip: process.env.TEST_KUBERNETES_REMOTE !== '1', timeout: 35 * 60 * 1000,
}, async () => {
  const {remote} = await runKubernetesCheck('kind-remote');
  assert.equal(remote.pairing.persistedRenewal, true);
  for (const key of ['staffHttps', 'publicHttps', 'unknownNameRefused', 'wrongCertificateRefused', 'privatePathRefused']) {
    assert.equal(remote[key], true, key);
  }
  assert.equal(remote.handover.interfaceWithdrawn, true);
  assert.equal(remote.handover.handshake, true);
  assert.ok(remote.handover.durationMs <= 90000);
  assert.ok(remote.certificateReplacementMs <= 180000);
  assert.ok(remote.withdrawalMs <= 180000);
  assert.deepEqual(remote.cleanup.remaining, []);
  console.log('D621 gateway timings (ms)', {handover: remote.handover.durationMs,
    certificateReplacement: remote.certificateReplacementMs, withdrawal: remote.withdrawalMs});
});
