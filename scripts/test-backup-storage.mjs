import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { startBackupStorage } from "./backup-storage-fixture.mjs";
import { BackupObjects, receipt } from "../packages/backups/src/storage.ts";
const require = createRequire(
  new URL("../packages/backups/package.json", import.meta.url),
);
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const store = await startBackupStorage();
try {
  const a = await store.bucket("venue-a"),
    b = await store.bucket("venue-b"),
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
  const capture = await store.authority.grant(
    a,
    { kind: "capture", bucket: a.bucket, scope: "incoming/point-a" },
    store.ca,
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
  if (process.env.CHECK_STORAGE_EXPIRY === "1") {
    console.log(
      "Waiting for provider credential expiry at " + capture.expiresAt,
    );
    while (Date.now() <= Date.parse(capture.expiresAt) + 1000)
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(30000, Date.parse(capture.expiresAt) + 1001 - Date.now()),
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
    console.log("Expired provider credential refused");
  }
  objects.close();
  writer.destroy();
  reader.destroy();
  replicator.destroy();
  console.log(
    JSON.stringify({
      provider: "SeaweedFS 4.47",
      tlsVerified: true,
      encryption: true,
      immutableWrite: true,
      venueIsolation: true,
      kindIsolation: true,
      roleEscalationRefused: true,
      expiredIdentityRefused: true,
      credentialExpiresAt: capture.expiresAt,
    }),
  );
} finally {
  await store.stop();
}
