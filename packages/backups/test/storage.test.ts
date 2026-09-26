import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { bufferObject } from "../src/object-transfer.ts";
import {
  BackupObjects,
  StorageAuthority,
  validateLocation,
} from "../src/storage.ts";

const location = {
    endpoint: "https://storage.test",
    bucket: "venue-one",
    region: "local",
  },
  credentials = { accessKeyId: "access", secretAccessKey: "secret" };

async function fakeS3(
  send: (command: { constructor: { name: string }; input: Record<string, unknown> }, options?: { abortSignal?: AbortSignal }) => Promise<Record<string, unknown>>,
  run: () => Promise<void>,
) {
  const original = S3Client.prototype.send;
  S3Client.prototype.send = send as typeof original;
  try {
    await run();
  } finally {
    S3Client.prototype.send = original;
  }
}

test("storage tokens bind the server-selected bucket, object scope, audience and short lifetime", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const authority = new StorageAuthority({
    issuer: "https://cloud.test/storage",
    audience: "cloud-storage",
    keyId: "one",
    privateKey: keys.privateKey,
    roles: {
      capture: "arn:capture",
      stream: "arn:stream",
      restore: "arn:restore",
    },
  });
  const token = authority.token(
    { kind: "capture", bucket: "venue-a", scope: "incoming/point-a" },
    100000,
  );
  const [header, body, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header!, "base64url").toString()), {
    alg: "RS256",
    kid: "one",
    typ: "JWT",
  });
  const claims = JSON.parse(Buffer.from(body!, "base64url").toString());
  assert.deepEqual(claims, {
    iss: "https://cloud.test/storage",
    aud: "cloud-storage",
    sub: "capture:venue-a:incoming/point-a",
    iat: 100,
    exp: 160,
    bucket: "venue-a",
    scope: "incoming/point-a",
    kind: "capture",
  });
  assert(
    verify(
      "RSA-SHA256",
      Buffer.from(header + "." + body),
      keys.publicKey,
      Buffer.from(signature!, "base64url"),
    ),
  );
  assert.deepEqual(authority.jwks(), {
    keys: [
      {
        ...keys.publicKey.export({ format: "jwk" }),
        kid: "one",
        alg: "RS256",
        use: "sig",
      },
    ],
  });
});
test("storage locations and scopes refuse insecure and ambiguous destinations", () => {
  for (const endpoint of [
    "http://example.com",
    "https://u:p@example.com",
    "https://example.com/path",
    "https://example.com?x=1",
  ])
    assert.throws(
      () =>
        validateLocation({ endpoint, bucket: "venue-a", region: "eu-south-2" }),
      /backup.storage_configuration/,
    );
  assert.doesNotThrow(() =>
    validateLocation({
      endpoint: "https://127.0.0.1:8443",
      bucket: "venue-a",
      region: "local",
    }),
  );
  const privateKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey;
  const authority = new StorageAuthority({
    issuer: "https://cloud.test",
    audience: "storage",
    keyId: "one",
    privateKey,
    roles: { capture: "a", stream: "b", restore: "c" },
  });
  for (const scope of [
    "../snapshots/a",
    "incoming/*",
    "incoming/a/b",
    "snapshots/a",
    "incoming/a?x",
  ])
    assert.throws(
      () => authority.token({ kind: "capture", bucket: "venue-a", scope }),
      /backup.storage_scope/,
    );
  assert.throws(
    () =>
      authority.token({
        kind: "stream",
        bucket: "../other",
        scope: "streams/a/",
      }),
    /backup.storage_scope/,
  );
  assert.doesNotThrow(() =>
    authority.token({ kind: "stream", bucket: "venue-a", scope: "streams/a/" }),
  );
  assert.doesNotThrow(() =>
    authority.token({
      kind: "restore",
      bucket: "venue-a",
      scope: "snapshots/a",
    }),
  );
});

test("staged uploads pass the exact length and reopen byte zero for a transient retry", async () => {
  const bytes = Buffer.from("replayable encrypted archive"),
    source = bufferObject(bytes);
  let opens = 0,
    attempts = 0;
  const replayable = {
    receipt: source.receipt,
    open() {
      opens++;
      return source.open();
    },
    dispose: source.dispose,
  };
  await fakeS3(async (command) => {
    assert.equal(command.constructor.name, "PutObjectCommand");
    assert.equal(command.input.ContentLength, bytes.length);
    assert.equal(command.input.IfNoneMatch, "*");
    const received: Buffer[] = [];
    for await (const chunk of command.input.Body as Readable)
      received.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(received), bytes);
    if (attempts++ === 0)
      throw Object.assign(new Error("temporary"), {
        $metadata: { httpStatusCode: 503 },
      });
    return { $metadata: { httpStatusCode: 200 }, ETag: "one" };
  }, async () => {
    const objects = new BackupObjects(location, credentials);
    try {
      assert.deepEqual(await objects.putStaged("snapshots/one", replayable), source.receipt);
    } finally {
      objects.close();
    }
  });
  assert.equal(attempts, 2);
  assert.equal(opens, 2);
});

test("staged downloads hash provider bytes and compose caller cancellation", async () => {
  const bytes = Buffer.from("downloaded encrypted archive");
  await fakeS3(async (command, options) => {
    assert.equal(command.constructor.name, "GetObjectCommand");
    assert(options?.abortSignal);
    return {
      $metadata: { httpStatusCode: 200 },
      Body: Readable.from([bytes]),
      ContentLength: bytes.length,
      ETag: "download",
    };
  }, async () => {
    const objects = new BackupObjects(location, credentials),
      staged = await objects.stage("snapshots/one");
    try {
      assert.deepEqual(staged.receipt, {
        digest: "484cf5cc4b1f6b60fb234c5105c8fc931b5ca9c9774218b5e8689cff7dd7cc6b",
        size: 28,
      });
    } finally {
      await staged.dispose();
      objects.close();
    }
  });

  const controller = new AbortController();
  controller.abort();
  await fakeS3(async (_command, options) => {
    assert.equal(options?.abortSignal?.aborted, true);
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }, async () => {
    const objects = new BackupObjects(location, credentials);
    try {
      await assert.rejects(
        objects.stage("snapshots/cancelled", undefined, { signal: controller.signal }),
        /^Error: backup.cancelled$/,
      );
    } finally {
      objects.close();
    }
  });
});

test("conditional conflicts stream and compare existing bytes", async () => {
  const same = Buffer.from("same encrypted bytes"),
    changed = Buffer.from("other encrypted byte"),
    source = bufferObject(same);
  let existing = same;
  await fakeS3(async (command) => {
    if (command.constructor.name === "PutObjectCommand")
      throw Object.assign(new Error("exists"), {
        $metadata: { httpStatusCode: 412 },
      });
    return {
      $metadata: { httpStatusCode: 200 },
      Body: Readable.from([existing]),
      ContentLength: existing.length,
      ETag: "existing",
    };
  }, async () => {
    const objects = new BackupObjects(location, credentials);
    try {
      assert.deepEqual(await objects.putStaged("snapshots/one", source), source.receipt);
      existing = changed;
      await assert.rejects(
        objects.putStaged("snapshots/one", source),
        /^Error: backup.object_conflict$/,
      );
    } finally {
      objects.close();
    }
  });
});

test("SSE-C staged writes still require provider encryption confirmation", async () => {
  const source = bufferObject(Buffer.from("encrypted archive")),
    streamKey = randomBytes(32).toString("base64");
  await fakeS3(async () => ({ $metadata: { httpStatusCode: 200 } }), async () => {
    const objects = new BackupObjects(location, credentials);
    try {
      await assert.rejects(
        objects.putStaged("streams/one/archive", source, streamKey),
        /^Error: backup.encryption_unconfirmed$/,
      );
    } finally {
      objects.close();
    }
  });
});
