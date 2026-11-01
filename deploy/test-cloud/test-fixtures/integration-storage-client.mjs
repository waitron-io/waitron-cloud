import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {waitForStorageWithdrawal, checkStorageWithdrawalBucket} from './integration-storage-withdrawal.mjs';

// Keep the original native stream key in its private venue volume across restarts.
export async function probeIntegrationStorage(root, {phase, foreignVenueId, startedAt}) {
  assert.equal(process.env.CLOUD_TEST_STREAM, '1');
  const bucket = JSON.parse(await readFile(root + '/direct-storage.json', 'utf8'));
  const state = JSON.parse(await readFile(root + '/cloud-connection.json', 'utf8'));
  const venueId = state.view.registration.venueId;
  checkStorageWithdrawalBucket(bucket, venueId);
  const {S3Client, PutObjectCommand, GetObjectCommand} = createRequire('/waitron/apps/server/package.json')('@aws-sdk/client-s3');
  const storage = new S3Client({endpoint: bucket.endpoint, region: bucket.region, forcePathStyle: true, maxAttempts: 1,
    credentials: {accessKeyId: bucket.accessKeyId, secretAccessKey: bucket.secretAccessKey},
    requestHandler: {httpsAgent: new Agent({ca: await readFile('/proof/ca.pem')})}});
  const key = bucket.prefix + 'integration-withdrawal', body = 'paired integration retained storage';
  const put = (Bucket = bucket.bucket, Key = key) => storage.send(new PutObjectCommand({Bucket, Key, Body: body}), {abortSignal: AbortSignal.timeout(2000)});
  const get = () => storage.send(new GetObjectCommand({Bucket: bucket.bucket, Key: key}), {abortSignal: AbortSignal.timeout(2000)});
  const denied = error => error?.$metadata?.httpStatusCode === 403;
  try {
    if (phase === 'before') {
      assert.match(foreignVenueId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
      assert.notEqual(foreignVenueId, venueId);
      assert.equal((await put()).$metadata.httpStatusCode, 200);
      const read = await get(); assert.equal(read.$metadata.httpStatusCode, 200);
      assert.equal(await read.Body.transformToString(), body);
      await assert.rejects(put(bucket.bucket, 'incoming/integration-withdrawal'), denied);
      await assert.rejects(put('venue-' + foreignVenueId), denied);
      return {writeStatus: 200, readStatus: 200, outsidePrefixRefused: true, neighbourRefused: true};
    }
    assert.equal(phase, 'after');
    return await waitForStorageWithdrawal({put: () => put(), get, startedAt});
  } finally {storage.destroy();}
}
