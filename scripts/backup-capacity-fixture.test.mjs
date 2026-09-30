import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { runCapacityFixture } from './backup-capacity-fixture.mjs';

test('real TLS clients isolate two venues, retry interrupted bodies, cancel and clean their exact fixture', {timeout:60000}, async () => {
  let root;
  const {fixture:f,cleanup} = await runCapacityFixture(1024*1024,{onRoot:value=>root=value});
  assert.equal(f.uploadOverlap,2); assert.equal(f.downloadOverlap,2);
  for(const [i,venue] of f.venues.entries()) {
    assert.equal(venue.digest,createHash('sha256').update(Buffer.alloc(1024*1024,0x61+i)).digest('hex'));
    assert.equal(venue.uploadedBytes,1024*1024); assert.equal(venue.downloadedBytes,1024*1024);
  }
  assert.equal(f.failures.crossedReadDenied,2); assert.equal(f.failures.crossedWriteDenied,2);
  assert.equal(f.failures.wrongSecretDenied,true);
  assert.equal(f.failures.uploadAttempts,2); assert.equal(f.failures.downloadAttempts,2);
  for(const key of ['interruptedUploadUnpublished','cancelledUploadUnpublished','uploadRecovered','downloadRecovered','wrongLengthRefused','wrongDigestRefused']) assert.equal(f.failures[key],true,key);
  assert.equal(f.failures.cancelledDownloadStages,0);
  assert.deepEqual(cleanup,{rootRemoved:true,sockets:0,activeRequests:0});
  await assert.rejects(access(root),{code:'ENOENT'});
});
