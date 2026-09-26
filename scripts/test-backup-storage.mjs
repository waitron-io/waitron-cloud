import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { startBackupStorage } from "./backup-storage-fixture.mjs";
import { BackupObjects, receipt } from "../packages/backups/src/storage.ts";
import { stageReadable } from "../packages/backups/src/object-transfer.ts";
const require = createRequire(
  new URL("../packages/backups/package.json", import.meta.url),
);
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutBucketVersioningCommand,
} = require("@aws-sdk/client-s3");
const store = await startBackupStorage({ tokenDuration: "12s" });
try {
  const a = await store.bucket("venue-a"),
    b = await store.bucket("venue-b"),
    contracts = await store.bucket("storage-contracts"),
    bytes = Buffer.from("encrypted storage proof"),
    key = randomBytes(32).toString("base64");
  const objects = new BackupObjects(a, store.admin, store.ca);
  const item = await objects.put("streams/gen-a/encrypted", bytes, key);
  assert.deepEqual(item, receipt(bytes));
  assert.deepEqual(await objects.read("streams/gen-a/encrypted", key), bytes);
  await assert.rejects(objects.read("streams/gen-a/encrypted"));
  await assert.rejects(
    objects.read("streams/gen-a/encrypted", randomBytes(32).toString("base64")),
  );
  await assert.rejects(
    objects.put("streams/gen-a/encrypted", Buffer.from("changed"), key),
    /backup.object_conflict/,
  );
  const conflictingBodies = Array.from({ length: 8 }, (_, index) =>
      Buffer.from(`immutable-racer-${index}`),
    ),
    conflictingWrites = await Promise.allSettled(
      conflictingBodies.map((body) => objects.put("snapshots/conflicting", body)),
    ),
    immutableWinners = conflictingWrites.flatMap((result, index) =>
      result.status === "fulfilled" ? [index] : [],
    );
  assert.equal(immutableWinners.length, 1);
  assert.equal(
    conflictingWrites.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason?.message === "backup.object_conflict",
    ).length,
    7,
  );
  assert.deepEqual(
    await objects.read("snapshots/conflicting"),
    conflictingBodies[immutableWinners[0]],
  );
  const interruptedBytes = Buffer.from("complete bytes that must not be published"),
    interruptedSource = {
      receipt: receipt(interruptedBytes),
      open() {
        return Readable.from(
          (async function* () {
            yield interruptedBytes.subarray(0, 8);
            throw new Error("fixture upload interrupted");
          })(),
        );
      },
      async dispose() {},
    };
  await assert.rejects(
    objects.putStaged("snapshots/interrupted", interruptedSource),
    /fixture upload interrupted/,
  );
  await assert.rejects(objects.read("snapshots/interrupted"));
  const largeSize = 32 * 1024 * 1024,
    largeChunk = Buffer.alloc(64 * 1024, 0x64),
    expectedLarge = {
      digest: "be222b5d7bb1ea5b7fd408c2540b5e0ab79940821519d3ce059877409609cf88",
      size: largeSize,
    },
    baselineMemory = process.memoryUsage();
  let peakArrayBuffers = baselineMemory.arrayBuffers,
    peakRss = baselineMemory.rss;
  const sampler = setInterval(() => {
    const usage = process.memoryUsage();
    peakArrayBuffers = Math.max(peakArrayBuffers, usage.arrayBuffers);
    peakRss = Math.max(peakRss, usage.rss);
  }, 1);
  const generated = await stageReadable(
      Readable.from(
        (async function* () {
          for (let sent = 0; sent < largeSize; sent += largeChunk.length)
            yield largeChunk;
        })(),
      ),
      largeSize,
    ),
    largeKey = "snapshots/large-streamed-object";
  try {
    assert.deepEqual(generated.receipt, expectedLarge);
    assert.deepEqual(await objects.putStaged(largeKey, generated), expectedLarge);
    const downloaded = await objects.stage(largeKey);
    try {
      assert.deepEqual(downloaded.receipt, expectedLarge);
    } finally {
      await downloaded.dispose();
    }
  } finally {
    clearInterval(sampler);
    await generated.dispose();
    await objects.remove(largeKey);
  }
  const arrayBufferGrowth = peakArrayBuffers - baselineMemory.arrayBuffers,
    rssGrowth = peakRss - baselineMemory.rss;
  assert(
    arrayBufferGrowth < 16 * 1024 * 1024,
    `streaming retained ${arrayBufferGrowth} bytes of ArrayBuffers`,
  );
  const grantStartedAt = Date.now(),
    capture = await store.authority.grant(
    a,
    { kind: "capture", bucket: a.bucket, scope: "incoming/point-a" },
    store.ca,
  );
  assert(
    Date.parse(capture.expiresAt) <= grantStartedAt + 13000,
    "the local fixture must issue a short-lived credential for the expiry contract",
  );
  const make = (c) =>
    new S3Client({
      endpoint: a.endpoint,
      region: a.region,
      forcePathStyle: true,
      credentials: c,
      requestHandler: { httpsAgent: store.agent() },
      maxAttempts: 1,
    });
  const contractClient = new S3Client({
    endpoint: contracts.endpoint,
    region: contracts.region,
    forcePathStyle: true,
    credentials: store.admin,
    requestHandler: { httpsAgent: store.agent() },
    maxAttempts: 1,
  });
  await contractClient.send(
    new PutBucketVersioningCommand({
      Bucket: contracts.bucket,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  assert.equal(
    (
      await contractClient.send(
        new GetBucketVersioningCommand({ Bucket: contracts.bucket }),
      )
    ).Status,
    "Enabled",
  );
  const conditionalKey = "conditional/current.json",
    created = await contractClient.send(
      new PutObjectCommand({
        Bucket: contracts.bucket,
        Key: conditionalKey,
        Body: "generation-one",
        IfNoneMatch: "*",
      }),
    );
  assert(created.ETag);
  await assert.rejects(
    contractClient.send(
      new PutObjectCommand({
        Bucket: contracts.bucket,
        Key: conditionalKey,
        Body: "duplicate-create",
        IfNoneMatch: "*",
      }),
    ),
    (error) => error?.$metadata?.httpStatusCode === 412,
  );
  const replaced = await contractClient.send(
    new PutObjectCommand({
      Bucket: contracts.bucket,
      Key: conditionalKey,
      Body: "generation-two",
      IfMatch: created.ETag,
    }),
  );
  assert(replaced.ETag);
  await assert.rejects(
    contractClient.send(
      new PutObjectCommand({
        Bucket: contracts.bucket,
        Key: conditionalKey,
        Body: "stale-replacement",
        IfMatch: created.ETag,
      }),
    ),
    (error) => error?.$metadata?.httpStatusCode === 412,
  );
  const replacements = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        contractClient.send(
          new PutObjectCommand({
            Bucket: contracts.bucket,
            Key: conditionalKey,
            Body: `replacement-racer-${index}`,
            IfMatch: replaced.ETag,
          }),
        ),
      ),
    ),
    replacementWinners = replacements.filter(
      (result) => result.status === "fulfilled",
    ).length;
  assert.equal(replacementWinners, 1);
  assert.equal(
    replacements.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason?.$metadata?.httpStatusCode === 412,
    ).length,
    7,
  );
  const versions = await contractClient.send(
    new ListObjectVersionsCommand({
      Bucket: contracts.bucket,
      Prefix: conditionalKey,
    }),
  );
  assert.equal(versions.Versions?.length, 3);
  assert.equal(new Set(versions.Versions?.map((version) => version.VersionId)).size, 3);
  const rotatingCredentials = await store.createCredentials("venue-a-rotating-writer", [
      `Read:${a.bucket}/rotation/*`,
      `Write:${a.bucket}/rotation/*`,
    ]),
    rotatingWriter = make(rotatingCredentials);
  await rotatingWriter.send(
    new PutObjectCommand({ Bucket: a.bucket, Key: "rotation/before", Body: bytes }),
  );
  await assert.rejects(
    rotatingWriter.send(
      new PutObjectCommand({ Bucket: b.bucket, Key: "rotation/cross-venue", Body: bytes }),
    ),
  );
  const replacementCredentials = await store.rotateCredentials(
      "venue-a-rotating-writer",
    ),
    replacementWriter = make(replacementCredentials);
  await replacementWriter.send(
    new PutObjectCommand({ Bucket: a.bucket, Key: "rotation/after", Body: bytes }),
  );
  await assert.rejects(
    rotatingWriter.send(
      new PutObjectCommand({ Bucket: a.bucket, Key: "rotation/old-key", Body: bytes }),
    ),
  );
  const writer = make(capture.credentials);
  await writer.send(
    new PutObjectCommand({
      Bucket: a.bucket,
      Key: "incoming/point-a",
      Body: bytes,
    }),
  );
  for (const command of [
    new PutObjectCommand({
      Bucket: b.bucket,
      Key: "incoming/point-a",
      Body: bytes,
    }),
    new PutObjectCommand({
      Bucket: a.bucket,
      Key: "snapshots/point-a",
      Body: bytes,
    }),
    new GetObjectCommand({ Bucket: a.bucket, Key: "incoming/point-a" }),
    new DeleteObjectCommand({ Bucket: a.bucket, Key: "incoming/point-a" }),
    new ListObjectsV2Command({ Bucket: a.bucket }),
  ])
    await assert.rejects(writer.send(command));
  await objects.put("snapshots/point-a", bytes);
  const restore = await store.authority.grant(
      a,
      { kind: "restore", bucket: a.bucket, scope: "snapshots/point-a" },
      store.ca,
    ),
    reader = make(restore.credentials);
  assert.equal(
    await (
      await reader.send(
        new GetObjectCommand({ Bucket: a.bucket, Key: "snapshots/point-a" }),
      )
    ).Body.transformToString(),
    bytes.toString(),
  );
  await assert.rejects(
    reader.send(
      new PutObjectCommand({
        Bucket: a.bucket,
        Key: "snapshots/point-a",
        Body: bytes,
      }),
    ),
  );
  await assert.rejects(
    reader.send(
      new GetObjectCommand({ Bucket: b.bucket, Key: "snapshots/point-a" }),
    ),
  );
  const stream = await store.authority.grant(
      a,
      { kind: "stream", bucket: a.bucket, scope: "streams/gen-a/" },
      store.ca,
    ),
    replicator = make(stream.credentials);
  await replicator.send(
    new PutObjectCommand({
      Bucket: a.bucket,
      Key: "streams/gen-a/test",
      Body: bytes,
    }),
  );
  await replicator.send(
    new ListObjectsV2Command({ Bucket: a.bucket, Prefix: "streams/gen-a/" }),
  );
  await assert.rejects(
    replicator.send(
      new GetObjectCommand({ Bucket: a.bucket, Key: "snapshots/point-a" }),
    ),
  );
  await assert.rejects(
    replicator.send(
      new ListObjectsV2Command({ Bucket: a.bucket, Prefix: "streams/gen-b/" }),
    ),
  );
  await assert.rejects(
    store.assumeOtherRole(
      { kind: "capture", bucket: a.bucket, scope: "incoming/point-a" },
      "restore",
    ),
  );
  await assert.rejects(
    store.assumeExpired({
      kind: "capture",
      bucket: a.bucket,
      scope: "incoming/point-a",
    }),
  );
  while (Date.now() <= Date.parse(capture.expiresAt) + 1000)
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(1000, Date.parse(capture.expiresAt) + 1001 - Date.now()),
      ),
    );
  await assert.rejects(
    writer.send(
      new PutObjectCommand({
        Bucket: a.bucket,
        Key: "incoming/point-a",
        Body: bytes,
      }),
    ),
  );
  objects.close();
  writer.destroy();
  reader.destroy();
  replicator.destroy();
  rotatingWriter.destroy();
  replacementWriter.destroy();
  contractClient.destroy();
  console.log(
    JSON.stringify({
      provider: "SeaweedFS 4.47",
      tlsVerified: true,
      encryption: true,
      immutableWrite: true,
      immutableRaceWinners: immutableWinners.length,
      interruptedUploadCommitted: false,
      conditionalCreate: true,
      conditionalReplace: "refuses-stale",
      conditionalReplaceRaceWinners: replacementWinners,
      versioning: "enabled",
      venueIsolation: true,
      kindIsolation: true,
      credentialRotation: "old-refused-new-accepted",
      issuedCredentialExpiry: "refused-after-expiry",
      roleEscalationRefused: true,
      expiredIdentityRefused: true,
      credentialExpiresAt: capture.expiresAt,
      streamedFixtureBytes: largeSize,
      peakArrayBufferGrowthBytes: arrayBufferGrowth,
      peakRssGrowthBytes: rssGrowth,
    }),
  );
} finally {
  await store.stop();
}
