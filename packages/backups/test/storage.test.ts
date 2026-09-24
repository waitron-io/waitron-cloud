import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { StorageAuthority, validateLocation } from "../src/storage.ts";

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
