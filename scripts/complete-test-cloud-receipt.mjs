import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {verifyTestCloudReceipt} from './verify-test-cloud-receipt.mjs';
import {verifyTestCloudWithdrawalReceipt} from '../deploy/test-cloud/test-fixtures/integration-withdrawal-receipt.mjs';

// A separate provider lifetime never observes withdrawal of this run's paired grant.
export function completeTestCloudReceipt(input) {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input));
  assert.deepEqual(Object.keys(input).sort(), ['receipt', 'withdrawal']);
  const {receipt, withdrawal} = input;
  verifyTestCloudReceipt(receipt);
  verifyTestCloudWithdrawalReceipt(withdrawal);
  assert.equal(withdrawal.runId, receipt.runId, 'completion.run_mismatch');
  for (const key of ['head', 'tree', 'image']) {
    assert.equal(withdrawal.cloud[key], receipt.cloud[key], 'completion.source_mismatch');
  }
  const paid = receipt.organisations.find(value => value.plan === 'paid');
  for (const key of ['organisationId', 'venueId', 'installationId']) {
    assert.equal(withdrawal.installation[key], paid[key], 'completion.installation_mismatch');
  }
  assert.equal(withdrawal.snapshot.expiryObserved, true, 'completion.snapshot_expiry_unobserved');
  assert.deepEqual(receipt.remote.withdrawal, {
    streamMs: withdrawal.stream.after.durationMs,
    gatewayMs: withdrawal.gateway.durationMs,
    snapshotStsMs: withdrawal.snapshot.observedAt - withdrawal.snapshot.downgradedAt,
  }, 'completion.withdrawal_mismatch');
  return structuredClone(receipt);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 3);
    const file = await open(process.argv[2], 'r');
    let contents;
    try {
      assert.ok((await file.stat()).size <= 2 * 1024 * 1024);
      contents = await file.readFile();
      assert.ok(contents.length <= 2 * 1024 * 1024);
    } finally {await file.close();}
    const receipt = completeTestCloudReceipt(JSON.parse(contents));
    process.stdout.write(JSON.stringify(receipt) + '\n');
  } catch {process.stderr.write('Test Cloud completion refused\n'); process.exitCode = 1;}
}
