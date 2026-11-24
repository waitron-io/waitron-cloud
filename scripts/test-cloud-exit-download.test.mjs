import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestCloudClients} from './test-cloud-integration.mjs';

test('a test venue owner saves a verified backup and opens it offline while the box stays online', {
  skip: !process.env.TEST_CLOUD_INTEGRATION_IMAGE || !process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE,
  timeout: 300_000,
}, async () => {
  const receipt = await runTestCloudClients({image: process.env.TEST_CLOUD_INTEGRATION_IMAGE,
    waitronImage: process.env.TEST_CLOUD_INTEGRATION_WAITRON_IMAGE, paidVerification: true, paidExitDownload: true,
    protectedContainerIds: JSON.parse(process.env.TEST_CLOUD_PROTECTED_CONTAINER_IDS ?? '[]')});
  const {paidSnapshot: snapshot} = receipt;
  assert.ok(snapshot?.exitDownload);
  assert.deepEqual(snapshot.exitDownload, {sha256: snapshot.sha256, bytes: snapshot.bytes, offline: true, boxOnline: true});
  assert.deepEqual(receipt.cleanup.remaining, []);
  assert.equal(receipt.protectedContainersUnchanged, true);
  console.log('EXIT_DOWNLOAD_RECEIPT=' + JSON.stringify({waitronHead:receipt.waitronHead, verifierImage:receipt.waitronImage,
    ...snapshot.exitDownload}));
});
