import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { SignupStore, RegistrationStore } from "@waitron-cloud/registration";
import { database } from "../../account-http/test/fixtures.ts";
import { BackupKeyVault } from "../src/keys.ts";
import { BackupCatalogue } from "../src/catalogue.ts";
import { receipt } from "../src/storage.ts";
let db: Awaited<ReturnType<typeof database>>,
  store: BackupCatalogue,
  other: BackupCatalogue;
let a: { installationId: string; venueId: string }, b: typeof a;
const vault = new BackupKeyVault(randomBytes(32)),
  objects = new Map<string, Buffer>();
let failDelete = false;
const storage = (location: { bucket: string }) => ({
  async read(key: string) {
    const bytes = objects.get(location.bucket + "/" + key);
    if (!bytes) throw Error("NoSuchKey");
    return bytes;
  },
  async put(key: string, bytes: Uint8Array) {
    const k = location.bucket + "/" + key,
      prior = objects.get(k);
    if (prior && receipt(prior).digest !== receipt(bytes).digest)
      throw Error("backup.object_conflict");
    objects.set(k, Buffer.from(bytes));
    return receipt(bytes);
  },
  async remove(key: string) {
    if (failDelete) throw Error("store offline");
    objects.delete(location.bucket + "/" + key);
  },
});
before(async () => {
  db = await database();
  store = new BackupCatalogue(db.pool, vault, storage);
  other = new BackupCatalogue(db.secondPool, vault, storage);
});
after(async () => db?.close());
beforeEach(async () => {
  objects.clear();
  failDelete = false;
  await db.pool.query(
    "TRUNCATE signup_requests,email_outbox,organisations,cloud_accounts CASCADE",
  );
  const signup = new SignupStore(db.pool, db.outbox);
  await signup.request("backup@example.test");
  const mail = db.outbox.open(
    (await db.pool.query("SELECT * FROM email_outbox")).rows[0],
  );
  assert("token" in mail);
  const owner = await signup.complete(mail.token, {
    password: "a long enough test password",
    organisationName: "Backup",
    legalBusinessName: "Backup SL",
    countryCode: "ES",
  });
  const registration = new RegistrationStore(db.pool),
    items = [];
  for (let i = 0; i < 2; i++) {
    const binding = {
      operationId: randomUUID(),
      installationKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "der" })
        .toString("base64url"),
      localVenueId: randomUUID(),
      environment: "test",
      organisationId: owner.organisationId,
      legalBusinessId: owner.legalBusinessId,
    };
    await registration.start(binding);
    await registration.approveCloud(binding, owner.accountId);
    await registration.approveLocal(binding, randomUUID());
    items.push(await registration.complete(binding));
  }
  a = items[0]!;
  b = items[1]!;
  await store.provision(a.installationId, {
    endpoint: "https://store.test",
    bucket: "venue-a",
    region: "local",
  });
  await store.provision(b.installationId, {
    endpoint: "https://store.test",
    bucket: "venue-b",
    region: "local",
  });
});
async function capture(
  target = a,
  days = 0,
  retention: "daily" | "monthly" = "daily",
) {
  const reservation = await store.reserveCapture(
      target.installationId,
      randomUUID(),
    ),
    bytes = Buffer.from("encrypted test archive " + reservation.id);
  objects.set(
    reservation.location.bucket + "/" + reservation.incomingKey,
    bytes,
  );
  const metadata = {
    ...receipt(bytes),
    capturedAt: new Date(Date.now() - days * 86400000).toISOString(),
    retention,
    sourceNodeId: randomUUID(),
    modules: { core: 1 },
  };
  const point = await store.publish(
    target.installationId,
    reservation.id,
    metadata,
  );
  return { reservation, bytes, metadata, point };
}
test("capture retries survive worker restart and key rotation without exposing another venue", async () => {
  const id = randomUUID(),
    [one, two] = await Promise.all([
      store.reserveCapture(a.installationId, id),
      other.reserveCapture(a.installationId, id),
    ]);
  assert.deepEqual(one, two);
  await store.rotate(a.installationId);
  assert.deepEqual(await other.reserveCapture(a.installationId, id), one);
  const fresh = await store.reserveCapture(a.installationId, randomUUID());
  assert.equal(fresh.keyVersion, 2);
  assert.notEqual(fresh.keys.recoveryKey, one.keys.recoveryKey);
  await assert.rejects(
    store.reserveCapture(b.installationId, id),
    /backup.conflict/,
  );
  const rows = await db.pool.query("SELECT sealed FROM backup_key_versions");
  assert(rows.rows.every((r) => !r.sealed.includes(one.keys.recoveryKey)));
  await db.pool.query(
    "UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1",
    [a.installationId],
  );
  await assert.rejects(
    store.reserveCapture(a.installationId, id),
    /backup.revoked/,
  );
});
test("publication verifies bytes, is immutable and starts unverified", async () => {
  const item = await capture();
  assert.equal(item.point.verification, "pending");
  assert.equal(item.point.kind, "snapshot");
  assert.deepEqual(
    await other.publish(a.installationId, item.reservation.id, item.metadata),
    item.point,
  );
  await assert.rejects(
    store.publish(a.installationId, item.reservation.id, {
      ...item.metadata,
      size: item.metadata.size + 1,
    }),
    /backup.conflict/,
  );
  await assert.rejects(
    store.publish(b.installationId, item.reservation.id, item.metadata),
    /backup.unavailable/,
  );
  const pending = await store.reserveCapture(a.installationId, randomUUID());
  objects.set("venue-a/" + pending.incomingKey, Buffer.from("wrong"));
  await assert.rejects(
    store.publish(a.installationId, pending.id, item.metadata),
    /backup.object_mismatch/,
  );
  assert.equal(
    (await db.pool.query("SELECT count(*) FROM backup_points")).rows[0].count,
    "1",
  );
});
test("successful restore verification protects a point; altered storage fails verification", async () => {
  const old = await capture(a, 50);
  let observed = false;
  await store.verify(
    old.point.id,
    "waitron-test",
    async (bytes, keys, point) => {
      assert.deepEqual(bytes, old.bytes);
      assert.equal(keys.recoveryKey, old.reservation.keys.recoveryKey);
      assert.equal(point.digest, receipt(bytes).digest);
      observed = true;
    },
  );
  assert(observed);
  await store.rotate(a.installationId);
  await store.verify(old.point.id, "waitron-retry", async (_, keys) =>
    assert.equal(keys.recoveryKey, old.reservation.keys.recoveryKey),
  );
  const bad = await capture(a, 40);
  await assert.rejects(
    store.verify(bad.point.id, "waitron-test", async () => {
      throw Error("incompatible");
    }),
    /backup.verification_failed/,
  );
  assert.equal(await store.cleanupOne(a.venueId), bad.point.id);
  assert.equal(await store.cleanupOne(a.venueId), null);
  objects.set("venue-a/" + old.point.objectKey, Buffer.from("altered"));
  await assert.rejects(
    store.verify(old.point.id, "waitron-test", async () =>
      assert.fail("must not reach restore"),
    ),
    /backup.verification_failed/,
  );
  const checks = await db.pool.query(
    "SELECT outcome FROM backup_verifications WHERE point_id=$1 ORDER BY checked_at",
    [old.point.id],
  );
  assert.deepEqual(
    checks.rows.map((r) => r.outcome),
    ["verified", "verified", "failed"],
  );
  assert.equal(
    await store.cleanupOne(a.venueId),
    null,
    "a failed recheck must not remove protection from the last successfully verified snapshot",
  );
});
test("cleanup is resumable, serialised and keeps the last verified snapshot and monthly retention", async () => {
  const older = await capture(a, 70),
    protectedPoint = await capture(a, 60),
    monthly = await capture(a, 60, "monthly");
  for (const item of [older, protectedPoint])
    await store.verify(item.point.id, "waitron-test", async () => {});
  failDelete = true;
  await assert.rejects(store.cleanupOne(a.venueId), /store offline/);
  assert.equal(
    (
      await db.pool.query("SELECT deleting FROM backup_points WHERE id=$1", [
        older.point.id,
      ])
    ).rows[0].deleting,
    true,
  );
  failDelete = false;
  const results = await Promise.all([
    store.cleanupOne(a.venueId),
    other.cleanupOne(a.venueId),
  ]);
  assert(results.includes(older.point.id));
  assert(objects.has("venue-a/" + protectedPoint.point.objectKey));
  assert(objects.has("venue-a/" + monthly.point.objectKey));
  assert.equal(await store.cleanupOne(a.venueId), null);
});

test("verification releases the venue while restoring and refuses a point deleted during the restore", async () => {
  const item = await capture(a, 50);
  await capture(a, 40);
  let entered!: () => void, release!: () => void;
  const begun = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const verification = store.verify(item.point.id, "slow-worker", async () => {
    entered();
    await gate;
  });
  const result = verification.then(
    () => null,
    (e) => e,
  );
  await begun;
  try {
    const capture = other.reserveCapture(a.installationId, randomUUID());
    assert.equal(
      await Promise.race([
        capture.then(() => true),
        new Promise((r) => setTimeout(() => r(false), 1000)),
      ]),
      true,
      "restore must not hold the venue lock",
    );
    assert.equal(await other.cleanupOne(a.venueId), item.point.id);
  } finally {
    release();
    await result;
  }
  assert.match(String(await result), /backup.unavailable/);
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*) FROM backup_verifications WHERE point_id=$1",
        [item.point.id],
      )
    ).rows[0].count,
    "0",
  );
});

test("key-vault failure does not change archive verification status", async () => {
  const item = await capture();
  const wrong = new BackupCatalogue(
    db.pool,
    new BackupKeyVault(randomBytes(32)),
    storage,
  );
  await assert.rejects(
    wrong.verify(item.point.id, "wrong-master", async () =>
      assert.fail("restore must not run"),
    ),
    /backup.key_unavailable/,
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT verification FROM backup_points WHERE id=$1",
        [item.point.id],
      )
    ).rows[0].verification,
    "pending",
  );
  assert.equal(
    (await db.pool.query("SELECT count(*) FROM backup_verifications")).rows[0]
      .count,
    "0",
  );
});

test("retention preserves the newest unverified snapshot when no verification has succeeded", async () => {
  const old = await capture(a, 60),
    latest = await capture(a, 50);
  assert.equal(await store.cleanupOne(a.venueId), old.point.id);
  assert.equal(await store.cleanupOne(a.venueId), null);
  assert(objects.has("venue-a/" + latest.point.objectKey));
});

test("publication removes incoming data and retries interrupted removal after commit", async () => {
  const item = await capture();
  assert.equal(objects.has("venue-a/" + item.reservation.incomingKey), false);
  const pending = await store.reserveCapture(a.installationId, randomUUID());
  objects.set("venue-a/" + pending.incomingKey, item.bytes);
  failDelete = true;
  await assert.rejects(
    store.publish(a.installationId, pending.id, item.metadata),
    /store offline/,
  );
  assert.equal(
    (
      await db.pool.query("SELECT count(*) FROM backup_points WHERE id=$1", [
        pending.id,
      ])
    ).rows[0].count,
    "1",
  );
  failDelete = false;
  assert.equal(
    (await store.publish(a.installationId, pending.id, item.metadata)).id,
    pending.id,
  );
  assert.equal(objects.has("venue-a/" + pending.incomingKey), false);
});

test("provisioning translates an occupied storage location to a stable conflict", async () => {
  await db.pool.query("DELETE FROM backup_key_versions WHERE venue_id=$1", [
    b.venueId,
  ]);
  await db.pool.query("DELETE FROM backup_locations WHERE venue_id=$1", [
    b.venueId,
  ]);
  await assert.rejects(
    store.provision(b.installationId, {
      endpoint: "https://store.test",
      bucket: "venue-a",
      region: "local",
    }),
    /^Error: backup.conflict$/,
  );
});

test("test-only storage refuses verification and retention after a venue becomes production", async () => {
  const item = await capture();
  await db.pool.query(
    "UPDATE venues SET environment='production' WHERE id=$1",
    [a.venueId],
  );
  await assert.rejects(
    store.verify(item.point.id, "worker", async () => {}),
    /backup.local_integration_only/,
  );
  await assert.rejects(
    store.cleanupOne(a.venueId),
    /backup.local_integration_only/,
  );
});
