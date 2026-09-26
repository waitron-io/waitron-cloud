import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const commit = /^[0-9a-f]{40}$/;
const requiredChecks = [
  "controlled-https-storage",
  "postgresql-catalogue",
  "waitron-snapshot-worker",
  "no-production-resources",
];
const exact = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
function fail() {
  throw new Error("backup transfer receipt is invalid");
}

export function verifyBackupTransferReceipt(value) {
  if (
    !exact(value, [
      "version",
      "cloudHead",
      "cloudDirty",
      "waitronHead",
      "waitronDirty",
      "fixture",
      "transfers",
      "lifecycle",
      "shutdown",
      "checks",
    ]) ||
    value.version !== 1 ||
    !commit.test(value.cloudHead) ||
    !commit.test(value.waitronHead) ||
    typeof value.cloudDirty !== "boolean" ||
    typeof value.waitronDirty !== "boolean" ||
    JSON.stringify(value.checks) !== JSON.stringify(requiredChecks)
  )
    fail();

  const fixture = value.fixture;
  if (
    !exact(fixture, ["bytes", "chunkBytes", "chunkDelayMs", "deadlineMs"]) ||
    !positiveInteger(fixture.bytes) ||
    !positiveInteger(fixture.chunkBytes) ||
    fixture.bytes % fixture.chunkBytes !== 0 ||
    !positiveInteger(fixture.chunkDelayMs) ||
    !positiveInteger(fixture.deadlineMs)
  )
    fail();

  const transfers = value.transfers;
  if (
    !exact(transfers, ["upload", "download", "deadline", "missingObjectRefused"]) ||
    !exact(transfers.upload, ["elapsedMs", "bytesPerSecond", "attempts", "committedBytes"]) ||
    !finite(transfers.upload.elapsedMs) ||
    !finite(transfers.upload.bytesPerSecond) ||
    transfers.upload.attempts !== 2 ||
    transfers.upload.committedBytes !== fixture.bytes ||
    !exact(transfers.download, ["elapsedMs", "bytesPerSecond", "attempts", "receivedBytes"]) ||
    !finite(transfers.download.elapsedMs) ||
    !finite(transfers.download.bytesPerSecond) ||
    transfers.download.attempts !== 2 ||
    transfers.download.receivedBytes !== fixture.bytes ||
    !exact(transfers.deadline, [
      "uploadRefused",
      "uploadElapsedMs",
      "downloadRefused",
      "downloadElapsedMs",
      "partialStages",
    ]) ||
    transfers.deadline.uploadRefused !== true ||
    !finite(transfers.deadline.uploadElapsedMs) ||
    transfers.deadline.downloadRefused !== true ||
    !finite(transfers.deadline.downloadElapsedMs) ||
    transfers.deadline.partialStages !== 0 ||
    transfers.missingObjectRefused !== true
  )
    fail();

  const lifecycle = value.lifecycle;
  if (
    !exact(lifecycle, [
      "acknowledgedUploadResumed",
      "uploads",
      "publications",
      "credentialRenewalReusedArchive",
      "archives",
      "expiredOperationRefused",
      "operationExpiryHours",
    ]) ||
    lifecycle.acknowledgedUploadResumed !== true ||
    lifecycle.uploads !== 1 ||
    lifecycle.publications !== 1 ||
    lifecycle.credentialRenewalReusedArchive !== true ||
    lifecycle.archives !== 1 ||
    lifecycle.expiredOperationRefused !== true ||
    lifecycle.operationExpiryHours !== 24
  )
    fail();

  const shutdown = value.shutdown;
  if (
    !exact(shutdown, [
      "cloudDownloadCancelled",
      "cloudAbortToSettleMs",
      "cloudFailures",
      "cloudAttempts",
      "waitronArchiveAbortToSettleMs",
      "waitronUploads",
      "waitronPublications",
    ]) ||
    shutdown.cloudDownloadCancelled !== true ||
    !finite(shutdown.cloudAbortToSettleMs) ||
    shutdown.cloudFailures !== 0 ||
    shutdown.cloudAttempts !== 0 ||
    !finite(shutdown.waitronArchiveAbortToSettleMs) ||
    shutdown.waitronUploads !== 0 ||
    shutdown.waitronPublications !== 0
  )
    fail();
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3)
    throw new Error("usage: verify-backup-transfer-receipt.mjs RECEIPT.json");
  const receipt = verifyBackupTransferReceipt(
    JSON.parse(await readFile(process.argv[2], "utf8")),
  );
  console.log(`verified backup transfer receipt for ${receipt.fixture.bytes} bytes`);
}
