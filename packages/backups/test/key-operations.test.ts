import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { promisify } from "node:util";
import {
  EmailOutbox,
  EmailWorker,
  RegistrationStore,
  SignupStore,
  transaction,
} from "@waitron-cloud/registration";
import { database } from "../../account-http/test/fixtures.ts";
import { BackupCatalogue } from "../src/catalogue.ts";
import { inspectManagedKeyDependencies } from "../src/key-operations.ts";
import { BackupKeyVault } from "../src/keys.ts";
import { receipt } from "../src/storage.ts";

let db: Awaited<ReturnType<typeof database>>;
let installationId: string;
let venueId: string;
let catalogue: BackupCatalogue;
const master = randomBytes(32);
const vault = new BackupKeyVault(master);
const emailKeys = {
  first: randomBytes(32).toString("hex"),
  second: randomBytes(32).toString("hex"),
  unused: randomBytes(32).toString("hex"),
};
const objects = new Map<string, Buffer>();
const execute = promisify(execFile);
const storage = (location: { bucket: string }) => ({
  async read(key: string) {
    const value = objects.get(`${location.bucket}/${key}`);
    if (!value) throw new Error("NoSuchKey");
    return value;
  },
  async put(key: string, bytes: Uint8Array) {
    const value = Buffer.from(bytes);
    objects.set(`${location.bucket}/${key}`, value);
    return receipt(value);
  },
  async remove(key: string) {
    objects.delete(`${location.bucket}/${key}`);
  },
});

before(async () => {
  db = await database();
  catalogue = new BackupCatalogue(db.pool, vault, storage);
});
after(async () => db?.close());
beforeEach(async () => {
  objects.clear();
  await db.pool.query(
    "TRUNCATE signup_requests,email_outbox,organisations,cloud_accounts CASCADE",
  );
  const signup = new SignupStore(db.pool, db.outbox);
  await signup.request("keys@example.test");
  const mail = db.outbox.open((await db.pool.query("SELECT * FROM email_outbox")).rows[0]);
  assert("token" in mail);
  const owner = await signup.complete(mail.token, {
    password: "a long enough managed keys password",
    organisationName: "Managed Keys",
    legalBusinessName: "Managed Keys SL",
    countryCode: "ES",
  });
  const registration = new RegistrationStore(db.pool);
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
  ({ installationId, venueId } = await registration.complete(binding));
  await catalogue.provision(installationId, {
    endpoint: "https://store.test",
    bucket: `managed-keys-${venueId}`,
    region: "local",
  });
  await db.pool.query("TRUNCATE email_outbox CASCADE");
});

async function capture() {
  const reservation = await catalogue.reserveCapture(installationId, randomUUID());
  const bytes = Buffer.from(`managed key archive ${reservation.id}`);
  objects.set(`${reservation.location.bucket}/${reservation.incomingKey}`, bytes);
  return catalogue.publish(installationId, reservation.id, {
    ...receipt(bytes),
    capturedAt: new Date().toISOString(),
    retention: "daily",
    sourceNodeId: randomUUID(),
    modules: { core: 1 },
  });
}

test("inventory blocks active and referenced keys without exposing key material", async () => {
  const oldPoint = await capture();
  await catalogue.rotate(installationId);
  await catalogue.rotate(installationId);
  await db.pool.query(
    `INSERT INTO backup_managed_streams(venue_id,installation_id,requested_revision,
      configuration_revision,key_version,local_venue_id,source_node_id,
      pointer_signer_public_key,object_prefix,writer_reference,reader_reference)
     VALUES($1,$2,0,1,1,$3,$4,'test-signer',$5,'test-writer','test-reader')`,
    [venueId, installationId, randomUUID(), randomUUID(), `streams/${venueId}/`],
  );
  const firstOutbox = new EmailOutbox({ activeKeyId: "first", keys: emailKeys });
  await transaction(db.pool, (client) =>
    firstOutbox.enqueue(client, "password_changed", { email: "owner@example.test" }),
  );
  const report = await inspectManagedKeyDependencies(db.pool, {
    backupVault: vault,
    emailKeys: { activeKeyId: "second", keys: emailKeys },
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ready, true);
  assert.deepEqual(
    report.backupKeys.map((item) => ({
      version: item.version,
      active: item.active,
      validation: item.validation,
      retirement: item.retirement,
      captures: item.dependencies.captures,
      points: item.dependencies.points,
      managedStreams: item.dependencies.managedStreams,
    })),
    [
      { version: 1, active: false, validation: "verified", retirement: "blocked", captures: 1, points: 1, managedStreams: 1 },
      { version: 2, active: false, validation: "verified", retirement: "eligible", captures: 0, points: 0, managedStreams: 0 },
      { version: 3, active: true, validation: "verified", retirement: "blocked", captures: 0, points: 0, managedStreams: 0 },
    ],
  );
  assert.equal(report.backupKeys[0]?.venueId, venueId);
  assert.equal(oldPoint.keyVersion, 1);
  assert.deepEqual(
    report.emailKeys.map((item) => ({
      keyId: item.keyId,
      active: item.active,
      validation: item.validation,
      retirement: item.retirement,
      pending: item.dependencies.pending,
    })),
    [
      { keyId: "first", active: false, validation: "verified", retirement: "blocked", pending: 1 },
      { keyId: "second", active: true, validation: "configured", retirement: "blocked", pending: 0 },
      { keyId: "unused", active: false, validation: "configured", retirement: "eligible", pending: 0 },
    ],
  );
  const json = JSON.stringify(report);
  for (const secret of [
    master.toString("hex"),
    ...Object.values(emailKeys),
    "owner@example.test",
    (await db.pool.query("SELECT sealed FROM backup_key_versions LIMIT 1")).rows[0].sealed,
  ]) {
    assert(!json.includes(secret));
  }
});

test("inventory reports missing or wrong keys and does not modify durable state", async () => {
  await capture();
  await catalogue.rotate(installationId);
  await catalogue.rotate(installationId);
  const firstOutbox = new EmailOutbox({ activeKeyId: "first", keys: emailKeys });
  await transaction(db.pool, (client) =>
    firstOutbox.enqueue(client, "password_changed", { email: "owner@example.test" }),
  );
  const before = await db.pool.query(
    "SELECT (SELECT count(*) FROM backup_key_versions) AS backup_keys, (SELECT count(*) FROM email_outbox) AS messages",
  );
  const report = await inspectManagedKeyDependencies(db.pool, {
    backupVault: new BackupKeyVault(randomBytes(32)),
    emailKeys: { activeKeyId: "second", keys: { second: emailKeys.second } },
  });
  const after = await db.pool.query(
    "SELECT (SELECT count(*) FROM backup_key_versions) AS backup_keys, (SELECT count(*) FROM email_outbox) AS messages",
  );

  assert.equal(report.ready, false);
  assert(report.backupKeys.every((item) => item.validation === "unavailable"));
  assert.equal(
    report.backupKeys.find((item) => item.version === 2)?.retirement,
    "blocked",
    "an unreferenced key is not eligible until its ciphertext can be authenticated",
  );
  assert.deepEqual(report.emailKeys, [
    {
      keyId: "first",
      active: false,
      configured: false,
      validation: "unavailable",
      retirement: "blocked",
      dependencies: { pending: 1, processing: 0 },
    },
    {
      keyId: "second",
      active: true,
      configured: true,
      validation: "configured",
      retirement: "blocked",
      dependencies: { pending: 0, processing: 0 },
    },
  ]);
  assert.deepEqual(after.rows, before.rows);

  const missingEmailConfiguration = await inspectManagedKeyDependencies(db.pool, {
    backupVault: vault,
  });
  assert.equal(
    missingEmailConfiguration.ready,
    false,
    "the combined preflight requires an active email key even when the queue is empty",
  );
});

test("a restarted worker and backup catalogue use retained keys after rotation", async () => {
  const point = await capture();
  await catalogue.rotate(installationId);
  const firstOutbox = new EmailOutbox({ activeKeyId: "first", keys: emailKeys });
  await transaction(db.pool, (client) =>
    firstOutbox.enqueue(client, "password_changed", { email: "owner@example.test" }),
  );
  const delivered: string[] = [];
  const restartedOutbox = new EmailOutbox({ activeKeyId: "second", keys: emailKeys });
  const restartedWorker = new EmailWorker(db.pool, restartedOutbox, {
    async sendVerification() {},
    async sendPasswordReset() {},
    async sendPasswordChanged(message) {
      delivered.push(message.email);
    },
    async sendServiceAlert() {},
  });
  assert.equal(await restartedWorker.runOnce(), true);
  assert.deepEqual(delivered, ["owner@example.test"]);

  const restartedCatalogue = new BackupCatalogue(db.pool, new BackupKeyVault(master), storage);
  let restored = "";
  await restartedCatalogue.verify(point.id, "managed-key-drill", async (bytes) => {
    restored = bytes.toString();
  });
  assert.equal(restored, `managed key archive ${point.id}`);
  await assert.rejects(
    new BackupCatalogue(db.pool, new BackupKeyVault(randomBytes(32)), storage).verify(
      point.id,
      "managed-key-drill",
      async () => assert.fail("wrong master key must not reach restore"),
    ),
    /backup.key_unavailable/,
  );
  assert.deepEqual(
    (await db.pool.query("SELECT outcome FROM backup_verifications WHERE point_id=$1", [point.id])).rows,
    [{ outcome: "verified" }],
  );

  const report = await inspectManagedKeyDependencies(db.pool, {
    backupVault: vault,
    emailKeys: { activeKeyId: "second", keys: emailKeys },
  });
  assert.equal(report.emailKeys.find((item) => item.keyId === "first")?.retirement, "eligible");
  assert.equal(report.backupKeys.find((item) => item.version === 1)?.retirement, "blocked");
});

test("operator CLI emits a secret-free report and exits nonzero when key material is wrong", async () => {
  const cli = new URL("../src/key-operations-cli.ts", import.meta.url);
  const environment = {
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    PGOPTIONS: `-c search_path=${db.schema}`,
    CLOUD_BACKUP_MASTER_KEY: master.toString("hex"),
    CLOUD_EMAIL_ACTIVE_KEY_ID: "second",
    CLOUD_EMAIL_KEYS: JSON.stringify(emailKeys),
  };
  const success = await execute(process.execPath, [cli.pathname], { env: environment });
  const report = JSON.parse(success.stdout);
  assert.equal(report.ready, true);
  assert(!success.stdout.includes(master.toString("hex")));
  assert(!success.stdout.includes(emailKeys.second));

  await assert.rejects(
    execute(process.execPath, [cli.pathname], {
      env: { ...environment, CLOUD_BACKUP_MASTER_KEY: randomBytes(32).toString("hex") },
    }),
    (error: { code?: number; stdout?: string }) => {
      assert.equal(error.code, 2);
      assert.equal(JSON.parse(error.stdout ?? "").ready, false);
      return true;
    },
  );
  await assert.rejects(
    execute(process.execPath, [cli.pathname], {
      env: { ...environment, CLOUD_EMAIL_KEYS: "{" },
    }),
    (error: { code?: number; stdout?: string; stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.match(error.stderr ?? "", /^Managed key check failed;/);
      return true;
    },
  );
});

test("email-key validation checks every live payload, not one representative row", async () => {
  const outbox = new EmailOutbox({ activeKeyId: "first", keys: emailKeys });
  await transaction(db.pool, async (client) => {
    for (let index = 0; index < 101; index++) {
      await outbox.enqueue(client, "password_changed", {
        email: `recipient-${index}@example.test`,
      });
    }
  });
  await db.pool.query(`UPDATE email_outbox SET payload=set_byte(payload,28,get_byte(payload,28)#1)
    WHERE id=(SELECT id FROM email_outbox ORDER BY key_id DESC,id DESC LIMIT 1)`);

  const report = await inspectManagedKeyDependencies(db.pool, {
    backupVault: vault,
    emailKeys: { activeKeyId: "first", keys: emailKeys },
  });
  assert.equal(report.ready, false);
  assert.equal(report.emailKeys.find((item) => item.keyId === "first")?.validation, "unavailable");
});

test("backup dependency tables are scanned once rather than once per key version", async () => {
  await catalogue.rotate(installationId);
  await catalogue.rotate(installationId);
  let maximumDependencyLoops = 0;
  const pool = new Proxy(db.pool, {
    get(target, property) {
      if (property !== "connect") return Reflect.get(target, property, target);
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(clientTarget, clientProperty) {
            if (clientProperty === "query") {
              return async (query: string, values?: unknown[]) => {
                if (query.includes("FROM backup_key_versions k")) {
                  const explained = await clientTarget.query(`EXPLAIN (ANALYZE,FORMAT JSON) ${query}`);
                  const visit = (plan: Record<string, unknown>) => {
                    if (
                      ["backup_captures", "backup_points", "backup_managed_streams"].includes(
                        String(plan["Relation Name"]),
                      )
                    ) {
                      maximumDependencyLoops = Math.max(
                        maximumDependencyLoops,
                        Number(plan["Actual Loops"]),
                      );
                    }
                    for (const child of (plan.Plans ?? []) as Record<string, unknown>[]) visit(child);
                  };
                  visit(explained.rows[0]["QUERY PLAN"][0].Plan);
                }
                return clientTarget.query(query, values);
              };
            }
            const value = Reflect.get(clientTarget, clientProperty, clientTarget);
            return typeof value === "function" ? value.bind(clientTarget) : value;
          },
        });
      };
    },
  });

  await inspectManagedKeyDependencies(pool, {
    backupVault: vault,
    emailKeys: { activeKeyId: "first", keys: emailKeys },
  });
  assert.equal(maximumDependencyLoops, 1);
});
