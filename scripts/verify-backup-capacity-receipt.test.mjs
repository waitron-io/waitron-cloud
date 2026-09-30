import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyBackupTransferReceipt } from './verify-backup-transfer-receipt.mjs';

export const capacityReceipt = () => ({
  version: 2, cloudHead: 'a'.repeat(40), cloudDirty: false,
  profile: 'controlled-tls-capacity', ceilingBytes: 536870912,
  environment: { platform: 'darwin', arch: 'arm64', node: 'v26.0.0', samplingMs: 20 },
  fixtures: [33554432, 134217728, 536870912].map(bytes => ({
    bytes, status: 'ran', preflight: { availableMemoryBytes: 2 ** 32, freeDiskBytes: 2 ** 34 },
    uploadOverlap: 2, downloadOverlap: 2,
    venues: ['a', 'b'].map((venue, i) => ({venue, digest: String(i).repeat(64), uploadedBytes: bytes, downloadedBytes: bytes, uploadMs: 100, downloadMs: 100})),
    peaks: { rssBytes: 1000, arrayBufferBytes: 100, scratchBytes: bytes * 6, diskAllocatedBytes: bytes * 6 },
    baseline: { rssBytes: 900, arrayBufferBytes: 50 },
    failures: { crossedReadDenied: 2, crossedWriteDenied: 2, wrongSecretDenied: true, uploadAttempts: 2, downloadAttempts: 2, interruptedUploadUnpublished: true, cancelledUploadUnpublished: true, cancelledDownloadStages: 0, uploadRecovered: true, downloadRecovered: true, uploadAbortMs: 1, downloadAbortMs: 1, wrongLengthRefused: true, wrongDigestRefused: true },
    cleanup: { remainingFiles: 0, remainingBytes: 0 },
  })),
  cleanup: { rootRemoved: true, sockets: 0, activeRequests: 0 },
});
test('accepts two-venue capacity evidence through the current ceiling', () => {
  const value = capacityReceipt(); assert.equal(verifyBackupTransferReceipt(value), value);
});
test('accepts an explicit resource skip without claiming that size ran', () => {
  const value = capacityReceipt(); value.fixtures[2] = { bytes: 536870912, status: 'skipped', reason: 'insufficient disk', preflight: {availableMemoryBytes: 2 ** 32, freeDiskBytes: 1} };
  assert.equal(verifyBackupTransferReceipt(value), value);
});
for (const [name, change] of [
  ['missing ceiling disposition', r => r.fixtures.pop()],
  ['sequential upload', r => r.fixtures[0].uploadOverlap = 1],
  ['same venue payload', r => r.fixtures[0].venues[1].digest = r.fixtures[0].venues[0].digest],
  ['short download', r => r.fixtures[0].venues[0].downloadedBytes--],
  ['partial publication', r => r.fixtures[0].failures.interruptedUploadUnpublished = false],
  ['crossed credential', r => r.fixtures[0].failures.crossedReadDenied = 1],
  ['failed retry', r => r.fixtures[0].failures.downloadRecovered = false],
  ['scratch residue', r => r.fixtures[0].cleanup.remainingBytes = 1],
  ['unmeasured memory', r => r.fixtures[0].peaks.rssBytes = NaN],
  ['open socket', r => r.cleanup.sockets = 1],
  ['unexpected secret', r => r.secretAccessKey = 'not allowed'],
]) test(`rejects ${name}`, () => {const r = capacityReceipt(); change(r); assert.throws(() => verifyBackupTransferReceipt(r));});
