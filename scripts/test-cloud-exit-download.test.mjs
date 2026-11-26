import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';

test('a test venue owner saves SQLite, opens the backup offline, and all three downloads close at the deadline', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 360_000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE, paidVerification: true, paidExitDownload: true,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]')});
  const {paidSnapshot: snapshot} = receipt;
  assert.ok(snapshot?.exitDownload);
  const {database, ...archive} = snapshot.exitDownload;
  assert.deepEqual(archive, {sha256: snapshot.sha256, bytes: snapshot.bytes, offline: true, boxOnline: true});
  assert.equal(database.sqliteIntegrity, 'ok');
  assert.ok(database.bytes >= 4096);
  assert.match(database.sha256, /^[a-f0-9]{64}$/);
  const large = snapshot.largeExitDownload;
  assert.ok(large?.bytes > 16 * 1024 ** 2 && large.bytes < 24 * 1024 ** 2);
  assert.equal(large.offline, true);
  assert.equal(large.boxOnline, true);
  assert.equal(large.database.sqliteIntegrity, 'ok');
  for (const route of [large.rangeTransfer, large.database.rangeTransfer]) {
    assert.ok(route.stageMs > 0 && route.stageMs < 10_000);
    assert.ok(route.longestReplyMs > 0 && route.longestReplyMs < 30_000);
    assert.ok(route.downloadMs >= route.transferMs);
  }
  const window = snapshot.exitRecovery;
  assert.ok(window?.retainedSnapshotUnchanged);
  assert.equal(Date.parse(window.deadlineAt) - Date.parse(window.effectiveEndAt), 90 * 24 * 60 * 60 * 1000);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  console.log('EXIT_DOWNLOAD_RECEIPT=' + JSON.stringify({cloudImage:receipt.image, waitronHead:receipt.waitronHead, verifierImage:receipt.waitronImage,
    ...snapshot.exitDownload, largeExitDownload:large, exitRecovery:window}));
});
