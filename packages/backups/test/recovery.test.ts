import {verifyPointFixture,configureRecoveryVerification,fixtureTarget} from './fixtures/verification.ts';
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { login } from "@waitron-cloud/identity";
import {
  SignupStore,
  RegistrationStore,
  transaction,
} from "@waitron-cloud/registration";
import { database } from "../../account-http/test/fixtures.ts";
import { BackupKeyVault } from "../src/keys.ts";
import { BackupCatalogue } from "../src/catalogue.ts";
import {RecoveryRequests} from "../src/recovery-request.ts";
import {requestPayloadV2,recoveryPayloadV2} from "../src/recovery-v2.ts";
import { BackupRecovery, type RecoveryInput } from "../src/recovery.ts";
import { receipt } from "../src/storage.ts";
let db: Awaited<ReturnType<typeof database>>;
before(async () => {
  db = await database();
});
after(async () => db?.close());
const targetKeys=new Map<string,ReturnType<typeof generateKeyPairSync>>();
const keyPair = () => {
  const key = generateKeyPairSync("ed25519");
  targetKeys.set(key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),key);
  return {
    key,
    publicKey: key.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64url"),
  };
};
test("owner-authorised replacement is durable, target-bound and does not activate or re-enrol a server", async () => {
  await configureRecoveryVerification(db.pool);
  const vault = new BackupKeyVault(randomBytes(32)),
    objects = new Map<string, Buffer>(),
    catalogue = new BackupCatalogue(db.pool, vault, () => ({
      async read(k) {
        return objects.get(k)!;
      },
      async put(k, b) {
        objects.set(k, Buffer.from(b));
        return receipt(b);
      },
      async remove(k) {
        objects.delete(k);
      },
    }));
  const recovery = new BackupRecovery(db.pool, vault, "https://cloud.test"),
    other = new BackupRecovery(db.secondPool, vault, "https://cloud.test");
  const start=async(store:BackupRecovery,token:string,csrf:string,input:RecoveryInput)=>{
    if(!(await db.pool.query('SELECT 1 FROM backup_recovery_requests WHERE id=$1 UNION ALL SELECT 1 FROM backup_recoveries WHERE target_public_key=$2',[input.id,input.targetPublicKey])).rowCount){
      const key=targetKeys.get(input.targetPublicKey)!,bytes=requestPayloadV2('https://cloud.test',input.id,'start',input.targetPublicKey,'12345678',fixtureTarget.digest,Date.now());
      await new RecoveryRequests(db.pool,vault,'https://cloud.test').machine('start',{version:2,target:fixtureTarget,payload:bytes.toString('base64url'),signature:sign(null,bytes,key.privateKey).toString('base64url')});
    }
    return store.start(token,csrf,input);
  };
  const password = "a long enough recovery password",
    signup = new SignupStore(db.pool, db.outbox),
    owners = [];
  for (const email of ["recovery-a@example.test", "recovery-b@example.test"]) {
    await signup.request(email);
    const mail = db.outbox.open(
      (
        await db.pool.query(
          "SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0],
    );
    assert("token" in mail);
    const owner = await signup.complete(mail.token, {
      password,
      organisationName: email,
      legalBusinessName: "Recovery SL",
      countryCode: "ES",
    });
    const session = await transaction(db.pool, (c) =>
      login(c, { email, password }),
    );
    owners.push({ ...owner, ...session });
  }
  const owner = owners[0]!,
    stranger = owners[1]!,
    reg = new RegistrationStore(db.pool),
    binding = {
      operationId: randomUUID(),
      installationKey: keyPair().publicKey,
      localVenueId: randomUUID(),
      environment: "test",
      organisationId: owner.organisationId,
      legalBusinessId: owner.legalBusinessId,
    };
  await reg.start(binding);
  await reg.approveCloud(binding, owner.accountId);
  await reg.approveLocal(binding, randomUUID());
  const installed = await reg.complete(binding);
  await catalogue.provision(installed.installationId, {
    endpoint: "https://store.test",
    bucket: "recovery-venue",
    region: "local",
  });
  const capture = await catalogue.reserveCapture(
      installed.installationId,
      randomUUID(),
    ),
    bytes = Buffer.from("encrypted archive");
  objects.set(capture.incomingKey, bytes);
  const point = await catalogue.publish(installed.installationId, capture.id, {
    ...receipt(bytes),
    capturedAt: new Date(Date.now() - 50 * 86400000).toISOString(),
    retention: "daily",
    sourceNodeId: randomUUID(),
    modules: { core: 1 },
  });
  const target = keyPair(),
    input = {
      id: randomUUID(),
      pointId: point.id,
      mode: "failure" as const,
      targetPublicKey: target.publicKey,
      oldServerUnavailable: true,
      acceptDataLoss: true,
    };
  await assert.rejects(
    start(recovery,owner.token, owner.csrfToken, input),
    /backup.unverified/,
  );
  await verifyPointFixture(db.pool,catalogue,point.id);
  await assert.rejects(
    start(recovery,stranger.token, stranger.csrfToken, input),
    /backup.permission_denied/,
  );
  await assert.rejects(start(recovery,owner.token, "wrong", input));
  await assert.rejects(
    start(recovery,owner.token, owner.csrfToken, {
      ...input,
      oldServerUnavailable: false,
    }),
    /backup.confirmation_required/,
  );
  const [one, two] = await Promise.all([
    start(recovery,owner.token, owner.csrfToken, input),
    start(other,owner.token, owner.csrfToken, input),
  ]);
  assert.deepEqual(one, two);
  assert.equal(one.status, "pending");
  await assert.rejects(
    start(recovery,owner.token, owner.csrfToken, {
      ...input,
      targetPublicKey: keyPair().publicKey,
    }),
    /backup.conflict/,
  );
  await assert.rejects(
    start(recovery,owner.token, owner.csrfToken, {
      ...input,
      id: randomUUID(),
    }),
    /backup.recovery_active/,
  );
  const secondBinding = {
    ...binding,
    operationId: randomUUID(),
    installationKey: keyPair().publicKey,
    localVenueId: randomUUID(),
  };
  await reg.start(secondBinding);
  await reg.approveCloud(secondBinding, owner.accountId);
  await reg.approveLocal(secondBinding, randomUUID());
  const second = await reg.complete(secondBinding);
  await catalogue.provision(second.installationId, {
    endpoint: "https://store.test",
    bucket: "second-venue",
    region: "local",
  });
  const secondCapture = await catalogue.reserveCapture(
    second.installationId,
    randomUUID(),
  );
  objects.set(secondCapture.incomingKey, bytes);
  const secondPoint = await catalogue.publish(
    second.installationId,
    secondCapture.id,
    {
      ...receipt(bytes),
      capturedAt: new Date().toISOString(),
      retention: "daily",
      sourceNodeId: randomUUID(),
      modules: { core: 1 },
    },
  );
  await verifyPointFixture(db.pool,catalogue,secondPoint.id);
  await assert.rejects(
    start(other,owner.token, owner.csrfToken, {
      ...input,
      id: randomUUID(),
      pointId: secondPoint.id,
    }),
    /backup.target_not_fresh/,
  );
  const proof = (
    action: "read" | "restored",
    key = target.key,
    now = Date.now(),
  ) => {
    const bytes = recoveryPayloadV2(
      "https://cloud.test",
      input.id,
      action,
      point.digest,
      fixtureTarget.digest,
      now,
    );
    return {
      version:2 as const,target:fixtureTarget,
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, key.privateKey).toString("base64url"),
    };
  };
  await assert.rejects(
    recovery.target(input.id, "read", proof("read", keyPair().key)),
    /backup.invalid_proof/,
  );
  await assert.rejects(
    recovery.target(
      input.id,
      "read",
      proof("read", target.key, Date.now() - 120000),
    ),
    /backup.invalid_proof/,
  );
  await db.pool.query(
    "UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1",
    [owner.accountId],
  );
  await assert.rejects(
    recovery.target(input.id, "read", proof("read")),
    /backup.permission_denied/,
  );
  await assert.rejects(
    recovery.status(owner.token, input.id),
    /backup.permission_denied/,
  );
  await db.pool.query(
    "UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1",
    [owner.accountId],
  );
  await assert.rejects(
    recovery.target(input.id, "restored", proof("read")),
    /backup.invalid_proof/,
  );
  const listing = await recovery.catalogue(owner.token, installed.venueId);
  assert.equal(listing.points[0]?.capturedAt, point.capturedAt);
  assert.equal(listing.defaultPointId, point.id);
  assert.equal(listing.continuousRecovery, null);
  await assert.rejects(
    recovery.catalogue(stranger.token, installed.venueId),
    /backup.permission_denied/,
  );
  const access = await recovery.target(input.id, "read", proof("read"));
  assert("point" in access);
  assert.equal(access.keys.recoveryKey, capture.keys.recoveryKey);
  assert.equal(access.point.id, point.id);
  assert.equal((await db.pool.query("SELECT restored_at FROM backup_recoveries WHERE id=$1",[input.id])).rows[0].restored_at,null);
  const status = await recovery.status(owner.token, input.id);
  assert(!JSON.stringify(status).includes(capture.keys.recoveryKey));
  assert(!JSON.stringify(status).includes(capture.keys.streamKey));
  await recovery.target(input.id, "restored", proof("restored"));
  const restoredAt=(await db.pool.query("SELECT restored_at FROM backup_recoveries WHERE id=$1",[input.id])).rows[0].restored_at;
  assert.ok(restoredAt instanceof Date);
  await delay(5);
  await recovery.target(input.id, "restored", proof("restored"));
  assert.deepEqual((await db.pool.query("SELECT restored_at FROM backup_recoveries WHERE id=$1",[input.id])).rows[0].restored_at,restoredAt);
  assert.equal(
    (await recovery.status(owner.token, input.id)).status,
    "restored",
  );
  assert.equal(
    (await db.pool.query("SELECT count(*) FROM installations")).rows[0].count,
    "2",
  );
  assert.equal(
    (await db.pool.query("SELECT revoked_at FROM installations")).rows[0]
      .revoked_at,
    null,
  );
  const next = await catalogue.reserveCapture(
    installed.installationId,
    randomUUID(),
  );
  objects.set(next.incomingKey, bytes);
  const newer = await catalogue.publish(installed.installationId, next.id, {
    ...receipt(bytes),
    capturedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    retention: "daily",
    sourceNodeId: randomUUID(),
    modules: { core: 1 },
  });
  await verifyPointFixture(db.pool,catalogue,newer.id);
  assert.equal(await catalogue.cleanupOne(installed.venueId), null);
  await recovery.close(owner.token, owner.csrfToken, input.id);
  await assert.rejects(
    recovery.target(input.id, "read", proof("read")),
    /backup.unavailable/,
  );
  assert.equal(await catalogue.cleanupOne(installed.venueId), point.id);
  await assert.rejects(
    start(recovery,owner.token, owner.csrfToken, {
      ...input,
      id: randomUUID(),
      pointId: newer.id,
    }),
    /backup.target_not_fresh/,
  );
  const expiredKey = keyPair();
  const expiredInput = {
    ...input,
    id: randomUUID(),
    pointId: newer.id,
    targetPublicKey: expiredKey.publicKey,
  };
  await start(recovery,owner.token, owner.csrfToken, expiredInput);
  await db.pool.query(
    "UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [expiredInput.id],
  );
  const expBytes = recoveryPayloadV2(
    "https://cloud.test",
    expiredInput.id,
    "read",
    newer.digest,
    fixtureTarget.digest,
    Date.now(),
  );
  await assert.rejects(
    recovery.target(expiredInput.id, "read", {
      version:2,target:fixtureTarget,
      payload: expBytes.toString("base64url"),
      signature: sign(null, expBytes, expiredKey.key.privateKey).toString(
        "base64url",
      ),
    }),
    /backup.unavailable/,
  );
  await db.pool.query(
    "UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1",
    [owner.accountId],
  );
  await assert.rejects(
    recovery.target(expiredInput.id, "read", {
      version:2,target:fixtureTarget,
      payload: expBytes.toString("base64url"),
      signature: sign(null, expBytes, expiredKey.key.privateKey).toString(
        "base64url",
      ),
    }),
    /backup.permission_denied/,
  );
  await catalogue.cleanupOne(installed.venueId);
  assert.equal(
    (
      await db.pool.query("SELECT status FROM backup_recoveries WHERE id=$1", [
        expiredInput.id,
      ])
    ).rows[0].status,
    "closed",
  );
  await db.pool.query(
    "UPDATE cloud_accounts SET disabled_at=NULL WHERE id=$1",
    [owner.accountId],
  );
  const resumed = {
    ...expiredInput,
    id: randomUUID(),
    targetPublicKey: keyPair().publicKey,
  };
  await start(recovery,owner.token, owner.csrfToken, resumed);
  await db.pool.query(
    "UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [resumed.id],
  );
  await start(recovery,owner.token, owner.csrfToken, {
    ...resumed,
    id: randomUUID(),
    targetPublicKey: keyPair().publicKey,
  });
  const current = (
    await db.pool.query(
      "SELECT id FROM backup_recoveries WHERE venue_id=$1 AND status<>'closed'",
      [installed.venueId],
    )
  ).rows[0].id;
  await db.pool.query(
    "UPDATE venues SET environment='production' WHERE id=$1",
    [installed.venueId],
  );
  await assert.rejects(
    recovery.catalogue(owner.token, installed.venueId),
    /backup.local_integration_only/,
  );
  await assert.rejects(
    recovery.target(current, "read", { payload: "x", signature: "x" }),
    /backup.local_integration_only/,
  );
  await assert.rejects(
    start(recovery,owner.token, owner.csrfToken, {
      ...resumed,
      id: randomUUID(),
      targetPublicKey: keyPair().publicKey,
    }),
    /backup.local_integration_only/,
  );
  await db.pool.query("UPDATE venues SET environment='test' WHERE id=$1", [
    installed.venueId,
  ]);
  await recovery.close(owner.token, owner.csrfToken, current);
  const shared = keyPair().publicKey;
  const race = await Promise.allSettled([
    start(recovery,owner.token, owner.csrfToken, {
      ...input,
      id: randomUUID(),
      pointId: newer.id,
      targetPublicKey: shared,
    }),
    start(other,owner.token, owner.csrfToken, {
      ...input,
      id: randomUUID(),
      pointId: secondPoint.id,
      targetPublicKey: shared,
    }),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    race.filter(
      (r) =>
        r.status === "rejected" &&
        String(r.reason) === "Error: backup.target_not_fresh",
    ).length,
    1,
  );
});
