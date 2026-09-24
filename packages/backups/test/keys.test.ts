import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { BackupKeyVault } from "../src/keys.ts";

test("key versions are random, sealed and bound to venue and version", () => {
  const master = randomBytes(32),
    vault = new BackupKeyVault(master),
    venue = randomUUID();
  const one = vault.create(venue, 1),
    two = vault.create(venue, 2);
  const keys = vault.open(venue, 1, one);
  assert.equal(Buffer.from(keys.streamKey, "base64").length, 32);
  assert.equal(Buffer.from(keys.recoveryKey, "base64url").length, 32);
  assert.notEqual(keys.recoveryKey, vault.open(venue, 2, two).recoveryKey);
  assert(!one.includes(keys.recoveryKey));
  assert(!one.includes(keys.streamKey));
  assert.deepEqual(new BackupKeyVault(master).open(venue, 1, one), keys);
  for (const attempt of [
    () => vault.open(randomUUID(), 1, one),
    () => vault.open(venue, 2, one),
    () => new BackupKeyVault(randomBytes(32)).open(venue, 1, one),
    () => vault.open(venue, 1, one.slice(0, -3) + "AAA"),
  ])
    assert.throws(attempt, /backup.key_unavailable/);
});
test("malformed master keys, contexts and ciphertext are refused", () => {
  assert.throws(
    () => new BackupKeyVault(Buffer.alloc(1)),
    /backup.key_configuration/,
  );
  const vault = new BackupKeyVault(randomBytes(32));
  for (const [venue, version] of [
    ["12345678" + "-".repeat(28), 1],
    ["other", 1],
    [randomUUID(), 0],
    [randomUUID(), 1.5],
  ] as const)
    assert.throws(() => vault.create(venue, version), /backup.key_context/);
  for (const value of ["", "x".repeat(5000), "v2.aaa", "v1.!!!"])
    assert.throws(
      () => vault.open(randomUUID(), 1, value),
      /backup.key_unavailable/,
    );
});
