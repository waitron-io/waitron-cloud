import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {verifySnapshotLifetimeReceipt} from './test-fixtures/integration-lifetime-receipt.mjs';

// Dropping the real provider observation must leave no accepted lifetime report.
test('the native short diagnostic produces a verified separately classified lifetime report', {
  skip: process.env.TEST_CLOUD_LIFETIME_PRODUCER !== '1', timeout: 60000,
}, () => {
  const env = {...process.env, TEST_CLOUD_REAL_STS_EXPIRY: '1', TEST_CLOUD_STS_EXPIRY_SECONDS: '12'};
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'deploy/test-cloud/storage-expiry-proof.test.mjs'], {
    env,
    encoding: 'utf8', timeout: 55000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, 'The native expiry diagnostic failed');
  const reports = [...result.stdout.matchAll(/SNAPSHOT_LIFETIME_RECEIPT=(\{[^\n]+\})/g)];
  assert.equal(reports.length, 1, 'The native provider-lifetime receipt is missing');
  const receipt = JSON.parse(reports[0][1]);
  assert.equal(verifySnapshotLifetimeReceipt(receipt), true);
  assert.equal(receipt.purpose, 'short-diagnostic'); assert.equal(receipt.requestedSeconds, 12);
  assert.equal(receipt.completeIntegration, false); assert.equal(receipt.shippingQualification, false);
  console.log('SHORT_LIFETIME_RECEIPT=' + JSON.stringify(receipt));
});
