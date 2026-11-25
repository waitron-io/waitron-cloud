import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';

test('a test venue owner saves SQLite, opens the backup offline, and all three downloads close at the deadline', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300_000,
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
  const window = snapshot.exitRecovery;
  assert.ok(window?.retainedSnapshotUnchanged);
  assert.equal(Date.parse(window.deadlineAt) - Date.parse(window.effectiveEndAt), 90 * 24 * 60 * 60 * 1000);
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  console.log('EXIT_DOWNLOAD_RECEIPT=' + JSON.stringify({cloudImage:receipt.image, waitronHead:receipt.waitronHead, verifierImage:receipt.waitronImage,
    ...snapshot.exitDownload, exitRecovery:window}));
});
