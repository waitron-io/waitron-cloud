import assert from "node:assert/strict";
import test from "node:test";
import { verifyBackupTransferReceipt } from "./verify-backup-transfer-receipt.mjs";

const valid = () => ({
  version: 1,
  cloudHead: "a".repeat(40),
  cloudDirty: false,
  waitronHead: "b".repeat(40),
  waitronDirty: false,
  fixture: { bytes: 4194304, chunkBytes: 65536, chunkDelayMs: 4, deadlineMs: 120 },
  transfers: {
    upload: {
      elapsedMs: 300,
      bytesPerSecond: 13981013,
      attempts: 2,
      committedBytes: 4194304,
    },
    download: {
      elapsedMs: 280,
      bytesPerSecond: 14979657,
      attempts: 2,
      receivedBytes: 4194304,
    },
    deadline: {
      uploadRefused: true,
      uploadElapsedMs: 110,
      downloadRefused: true,
      downloadElapsedMs: 120,
      partialStages: 0,
    },
    missingObjectRefused: true,
  },
  lifecycle: {
    acknowledgedUploadResumed: true,
    uploads: 1,
    publications: 1,
    credentialRenewalReusedArchive: true,
    archives: 1,
    expiredOperationRefused: true,
    operationExpiryHours: 24,
  },
  shutdown: {
    cloudDownloadCancelled: true,
    cloudAbortToSettleMs: 8,
    cloudFailures: 0,
    cloudAttempts: 0,
    waitronArchiveAbortToSettleMs: 160,
    waitronUploads: 0,
    waitronPublications: 0,
  },
  checks: [
    "controlled-https-storage",
    "postgresql-catalogue",
    "waitron-snapshot-worker",
    "no-production-resources",
  ],
});

test("accepts bounded transfer, lifecycle and shutdown evidence", () => {
  assert.deepEqual(verifyBackupTransferReceipt(valid()), valid());
});

for (const [name, mutate] of [
  ["duplicate publication", (r) => (r.lifecycle.publications = 2)],
  ["shutdown failure", (r) => (r.shutdown.cloudFailures = 1)],
  ["post-shutdown upload", (r) => (r.shutdown.waitronUploads = 1)],
  ["partial stage", (r) => (r.transfers.deadline.partialStages = 1)],
  ["missing Waitron evidence", (r) => r.checks.splice(2, 1)],
])
  test(`rejects ${name}`, () => {
    const receipt = valid();
    mutate(receipt);
    assert.throws(() => verifyBackupTransferReceipt(receipt), /backup transfer receipt is invalid/);
  });
