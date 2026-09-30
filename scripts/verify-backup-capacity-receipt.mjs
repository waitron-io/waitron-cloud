import assert from 'node:assert/strict';
const exact = (v, keys) => assert.deepEqual(Object.keys(v).sort(), keys.split(' ').sort());
const number = v => assert(Number.isFinite(v) && v >= 0);
const integer = v => assert(Number.isSafeInteger(v) && v >= 0);
export function verifyBackupCapacityReceipt(r) {
  exact(r, 'version cloudHead cloudDirty profile ceilingBytes environment fixtures cleanup');
  assert.equal(r.version, 2);
  assert.match(r.cloudHead, /^[a-f0-9]{40}$/);
  assert.equal(typeof r.cloudDirty, 'boolean');
  assert.equal(r.profile, 'controlled-tls-capacity');
  assert.equal(r.ceilingBytes, 536870912);
  exact(r.environment, 'platform arch node samplingMs');
  for (const k of ['platform', 'arch', 'node']) assert.equal(typeof r.environment[k], 'string');
  assert.equal(r.environment.samplingMs, 20);
  assert.deepEqual(r.fixtures.map(f => f.bytes), [33554432, 134217728, 536870912]);
  for (const f of r.fixtures) {
    exact(f.preflight, 'availableMemoryBytes freeDiskBytes');
    integer(f.preflight.availableMemoryBytes); integer(f.preflight.freeDiskBytes);
    if (f.status === 'skipped') {
      exact(f, 'bytes status reason preflight');
      assert(['insufficient disk', 'insufficient memory'].includes(f.reason));
      assert(f.reason === 'insufficient disk' ? f.preflight.freeDiskBytes < 8 * f.bytes + 268435456 : f.preflight.availableMemoryBytes < 1073741824);
      continue;
    }
    exact(f, 'bytes status preflight uploadOverlap downloadOverlap venues peaks baseline failures cleanup');
    assert.equal(f.status, 'ran');
    assert(f.preflight.freeDiskBytes >= 8 * f.bytes + 268435456);
    assert(f.preflight.availableMemoryBytes >= 1073741824);
    assert.equal(f.uploadOverlap, 2); assert.equal(f.downloadOverlap, 2);
    assert.deepEqual(f.venues.map(v => v.venue), ['a', 'b']);
    assert.notEqual(f.venues[0].digest, f.venues[1].digest);
    for (const v of f.venues) {
      exact(v, 'venue digest uploadedBytes downloadedBytes uploadMs downloadMs');
      assert.match(v.digest, /^[a-f0-9]{64}$/);
      assert.equal(v.uploadedBytes, f.bytes); assert.equal(v.downloadedBytes, f.bytes);
      number(v.uploadMs); number(v.downloadMs);
    }
    exact(f.baseline, 'rssBytes arrayBufferBytes');
    exact(f.peaks, 'rssBytes arrayBufferBytes scratchBytes diskAllocatedBytes');
    for (const v of [...Object.values(f.baseline), ...Object.values(f.peaks)]) integer(v);
    assert(f.peaks.rssBytes >= f.baseline.rssBytes);
    assert(f.peaks.arrayBufferBytes >= f.baseline.arrayBufferBytes);
    assert(f.peaks.scratchBytes >= f.bytes * 4);
    exact(f.failures, 'crossedReadDenied crossedWriteDenied wrongSecretDenied uploadAttempts downloadAttempts interruptedUploadUnpublished cancelledUploadUnpublished cancelledDownloadStages uploadRecovered downloadRecovered uploadAbortMs downloadAbortMs wrongLengthRefused wrongDigestRefused');
    for (const k of ['crossedReadDenied', 'crossedWriteDenied', 'uploadAttempts', 'downloadAttempts']) assert.equal(f.failures[k], 2);
    for (const k of ['wrongSecretDenied', 'interruptedUploadUnpublished', 'cancelledUploadUnpublished', 'uploadRecovered', 'downloadRecovered', 'wrongLengthRefused', 'wrongDigestRefused']) assert.equal(f.failures[k], true);
    assert.equal(f.failures.cancelledDownloadStages, 0);
    number(f.failures.uploadAbortMs); number(f.failures.downloadAbortMs);
    assert.deepEqual(f.cleanup, {remainingFiles: 0, remainingBytes: 0});
  }
  assert.deepEqual(r.cleanup, {rootRemoved: true, sockets: 0, activeRequests: 0});
  return r;
}
