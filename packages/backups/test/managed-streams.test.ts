import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { RegistrationStore, SignupStore } from "@waitron-cloud/registration";
import { database } from "../../account-http/test/fixtures.ts";
import { BackupCatalogue } from "../src/catalogue.ts";
import { BackupKeyVault } from "../src/keys.ts";
import {
  ManagedStreams,
  type ManagedStreamAuthority,
  type ManagedStreamProvision,
} from "../src/managed-streams.ts";

let db: Awaited<ReturnType<typeof database>>;
const vault = new BackupKeyVault(randomBytes(32));
const objects = new Map<string, Buffer>();
const provisions = new Map<string, ManagedStreamProvision>();
let provisionWait: (() => Promise<void>) | undefined;
let readWait: (() => Promise<void>) | undefined;
let provisionFailure: Error | undefined;

const authority: ManagedStreamAuthority = {
  async provision(input) {
    await provisionWait?.();
    if (provisionFailure) throw provisionFailure;
    let result = provisions.get(input.venueId);
    if (!result) {
      result = {
        writerReference: `writer:${input.venueId}`,
        readerReference: `reader:${input.venueId}`,
        writerCredentials: {
          accessKeyId: `write-${input.venueId}`,
          secretAccessKey: randomBytes(24).toString("base64url"),
        },
      };
      provisions.set(input.venueId, result);
    }
    return result;
  },
  async read(reference, location, key) {
    await readWait?.();
    const bytes = objects.get(`${reference}:${location.bucket}:${key}`);
    if (!bytes) throw new Error("NoSuchKey");
    return bytes;
  },
};

before(async () => {
  db = await database();
});
after(async () => db?.close());
beforeEach(async () => {
  objects.clear();
  provisions.clear();
  provisionWait = undefined;
  readWait = undefined;
  provisionFailure = undefined;
  await resetSchema(db.pool);
});

async function installed(label: string) {
  const signup = new SignupStore(db.pool, db.outbox);
  await signup.request(`${label.toLowerCase().replaceAll(/[^a-z0-9]/g, "-")}-${randomUUID()}@example.test`);
  const mail = db.outbox.open(
    (await db.pool.query("SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1"))
      .rows[0],
  );
  assert("token" in mail);
  const owner = await signup.complete(mail.token, {
    password: "a long enough stream test password",
    organisationName: label,
    legalBusinessName: `${label} SL`,
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
  } as const;
  await registration.start(binding);
  await registration.approveCloud(binding, owner.accountId);
  await registration.approveLocal(binding, randomUUID());
  const result = await registration.complete(binding);
  const catalogue = new BackupCatalogue(db.pool, vault, () => ({
    async read() {
      throw new Error("unused");
    },
    async put() {
      throw new Error("unused");
    },
    async remove() {},
  }));
  await catalogue.provision(result.installationId, {
    endpoint: "https://store.test",
    bucket: `stream-${result.venueId}`,
    region: "local",
  });
  const revision = Number(
    (
      await db.pool.query("SELECT configuration_revision FROM installations WHERE id=$1", [
        result.installationId,
      ])
    ).rows[0].configuration_revision,
  );
  return { ...result, localVenueId: binding.localVenueId, revision };
}

function signer() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

function input(item: Awaited<ReturnType<typeof installed>>, publicKey: string) {
  return {
    localVenueId: item.localVenueId,
    sourceNodeId: randomUUID(),
    pointerSignerPublicKey: publicKey,
  };
}

function pointer(
  venueId: string,
  nodeId: string,
  key: KeyObject,
  writtenAt = "2026-09-25T18:00:00.000Z",
) {
  const body = {
    venueId,
    term: 2,
    nodeId,
    generation: `gen-2-${nodeId}-20260925T175500Z`,
    writtenAt,
  };
  const message = `{"pointer":{"generation":"${body.generation}","nodeId":"${body.nodeId}","term":2,"venueId":"${body.venueId}","writtenAt":"${body.writtenAt}"},"purpose":"waitron.stream.pointer.v1"}`;
  return Buffer.from(
    JSON.stringify({
      body,
      signature: sign(null, Buffer.from(message), key).toString("base64"),
    }),
  );
}

function storePointer(
  configured: Awaited<ReturnType<ManagedStreams["configure"]>>,
  bytes: Buffer,
) {
  objects.set(
    `reader:${configured.venueId}:${configured.bucket.bucket}:${configured.bucket.prefix}venues/${configured.localVenueId}/current.json`,
    bytes,
  );
}

test("configuration retries preserve one venue-scoped authority and reject changed or crossed bindings", async () => {
  const a = await installed("Stream A"),
    b = await installed("Stream B"),
    aSigner = signer(),
    bSigner = signer(),
    streams = new ManagedStreams(db.pool, vault, authority),
    aInput = input(a, aSigner.publicKey),
    bInput = input(b, bSigner.publicKey);
  const configured = await streams.configure(a.installationId, a.revision, aInput);
  assert.deepEqual(await streams.configure(a.installationId, a.revision, aInput), configured);
  assert.equal(configured.bucket.prefix, `streams/${a.venueId}/`);
  assert.equal(configured.bucket.accessKeyId, `write-${a.venueId}`);
  assert.equal(configured.configurationRevision, a.revision + 1);
  assert(!("readerReference" in configured));
  assert(!JSON.stringify(configured).includes(`writer:${a.venueId}`));
  assert(!JSON.stringify(configured).includes(`reader:${a.venueId}`));
  assert(!JSON.stringify(await db.pool.query("SELECT * FROM backup_managed_streams")).includes(configured.bucket.secretAccessKey));
  await assert.rejects(
    streams.configure(a.installationId, a.revision, { ...aInput, sourceNodeId: bInput.sourceNodeId }),
    /backup.conflict/,
  );
  const other = await streams.configure(b.installationId, b.revision, bInput);
  assert.notEqual(other.bucket.prefix, configured.bucket.prefix);
  assert.notEqual(other.bucket.accessKeyId, configured.bucket.accessKeyId);
});

test("configuration validates UUIDs and a canonical Ed25519 signer before provider access", async () => {
  const item = await installed("Invalid"),
    streams = new ManagedStreams(db.pool, vault, authority),
    valid = input(item, signer().publicKey);
  let providerCalls = 0;
  provisionWait = async () => {
    providerCalls++;
  };
  for (const changed of [
    { ...valid, localVenueId: "not-a-uuid" },
    { ...valid, sourceNodeId: "not-a-uuid" },
    { ...valid, pointerSignerPublicKey: "not-a-key" },
    { ...valid, pointerSignerPublicKey: valid.pointerSignerPublicKey.replace(/=$/, "") },
  ]) {
    await assert.rejects(
      streams.configure(item.installationId, item.revision, changed),
      /backup.invalid_stream_configuration/,
    );
  }
  assert.equal(providerCalls, 0);
});

test("provider failure and revocation during provisioning leave no stream binding or secret", async () => {
  const first = await installed("Provider fails"),
    streams = new ManagedStreams(db.pool, vault, authority);
  provisionFailure = new Error("provider offline");
  await assert.rejects(
    streams.configure(first.installationId, first.revision, input(first, signer().publicKey)),
    /provider offline/,
  );
  assert.equal((await db.pool.query("SELECT count(*) FROM backup_managed_streams")).rows[0].count, "0");

  const second = await installed("Revoked while waiting"),
    secondInput = input(second, signer().publicKey);
  provisionFailure = undefined;
  provisionWait = async () => {
    await db.secondPool.query("UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1", [
      second.installationId,
    ]);
  };
  await assert.rejects(
    streams.configure(second.installationId, second.revision, secondInput),
    /backup.revoked/,
  );
  assert.equal((await db.pool.query("SELECT count(*) FROM backup_managed_streams")).rows[0].count, "0");
});

test("concurrent configuration workers converge on the same binding", async () => {
  const item = await installed("Concurrent"),
    desired = input(item, signer().publicKey),
    first = new ManagedStreams(db.pool, vault, authority),
    second = new ManagedStreams(db.secondPool, vault, authority);
  const results = await Promise.all([
    first.configure(item.installationId, item.revision, desired),
    second.configure(item.installationId, item.revision, desired),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await db.pool.query("SELECT count(*) FROM backup_managed_streams")).rows[0].count, "1");
  assert.equal(
    (await db.pool.query("SELECT configuration_revision FROM installations WHERE id=$1", [item.installationId]))
      .rows[0].configuration_revision,
    item.revision + 1,
  );
});

test("observation accepts only the registered venue, node and signer and never moves backwards", async () => {
  const item = await installed("Observe"),
    correct = signer(),
    wrong = signer(),
    streams = new ManagedStreams(db.pool, vault, authority),
    desired = input(item, correct.publicKey),
    configured = await streams.configure(item.installationId, item.revision, desired);
  storePointer(configured, pointer(item.localVenueId, desired.sourceNodeId, wrong.privateKey));
  await assert.rejects(
    streams.observe(item.installationId, configured.configurationRevision),
    /backup.invalid_stream_pointer/,
  );
  assert.equal((await streams.recovery(item.venueId, configured.configurationRevision))?.recoverableAt, null);

  storePointer(configured, pointer(item.localVenueId, desired.sourceNodeId, correct.privateKey));
  const observed = await streams.observe(item.installationId, configured.configurationRevision);
  assert.equal(observed.recoverableAt, "2026-09-25T18:00:00.000Z");
  assert.equal(observed.sourceNodeId, desired.sourceNodeId);

  storePointer(
    configured,
    pointer(item.localVenueId, desired.sourceNodeId, correct.privateKey, "2026-09-25T17:00:00.000Z"),
  );
  assert.deepEqual(await streams.observe(item.installationId, configured.configurationRevision), observed);
  const crossed = pointer(randomUUID(), desired.sourceNodeId, correct.privateKey);
  storePointer(configured, crossed);
  await assert.rejects(
    streams.observe(item.installationId, configured.configurationRevision),
    /backup.invalid_stream_pointer/,
  );
});

test("a late observation cannot commit after revocation or configuration replacement", async () => {
  for (const change of ["revoked", "revision"] as const) {
    const item = await installed(`Late ${change}`),
      key = signer(),
      streams = new ManagedStreams(db.pool, vault, authority),
      desired = input(item, key.publicKey),
      configured = await streams.configure(item.installationId, item.revision, desired);
    storePointer(configured, pointer(item.localVenueId, desired.sourceNodeId, key.privateKey));
    readWait = async () => {
      if (change === "revoked") {
        await db.secondPool.query("UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1", [
          item.installationId,
        ]);
      } else {
        await db.secondPool.query(
          "UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1",
          [item.installationId],
        );
      }
    };
    await assert.rejects(
      streams.observe(item.installationId, configured.configurationRevision),
      new RegExp(change === "revoked" ? "backup.revoked" : "backup.conflict"),
    );
    assert.equal((await streams.recovery(item.venueId, configured.configurationRevision))?.recoverableAt, null);
    readWait = undefined;
  }
});
