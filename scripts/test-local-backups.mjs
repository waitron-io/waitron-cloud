import assert from "node:assert/strict";
import { request as httpsRequest } from "node:https";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { startPortalFixture } from "../apps/portal/test/fixtures.ts";
import {
  SignupStore,
  PairingStore,
  transaction,
} from "../packages/registration/src/index.ts";
import { login } from "../packages/identity/src/index.ts";
import { BackupKeyVault } from "../packages/backups/src/keys.ts";
import { BackupObjects, receipt } from "../packages/backups/src/storage.ts";
import { BackupCatalogue } from "../packages/backups/src/catalogue.ts";
import {
  BackupRecovery,
  recoveryPayload,
} from "../packages/backups/src/recovery.ts";
import { startBackupStorage } from "./backup-storage-fixture.mjs";
import { probeBackupStream } from "./backup-stream-probe.mjs";
const checkout = process.env.WAITRON_CHECKOUT;
assert(checkout, "Set WAITRON_CHECKOUT");
const waitron = resolve(checkout),
  require = createRequire(join(waitron, "apps/server/package.json"));
const roots = [],
  children = [],
  objectClients = [],
  checks = [];
let f, s3;
const record = (value) => {
  checks.push(value);
  console.log("PASS:", value);
};
async function root() {
  const dir = await mkdtemp(join(tmpdir(), "cloud-integration-backup-"));
  roots.push(dir);
  return dir;
}
async function launch(dir) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      require.resolve("tsx"),
      join(waitron, "apps/server/scripts/cloud-integration-fixture.ts"),
    ],
    {
      cwd: join(waitron, "apps/server"),
      env: {
        ...process.env,
        CLOUD_TEST_ROOT: dir,
        CLOUD_TEST_ORIGIN: f.origin,
        CLOUD_TEST_BACKUP_STATE: "1",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (v) => (output = (output + v).slice(-16000)));
  const running = { child, done: new Promise((r) => child.once("exit", r)) };
  children.push(running);
  for (let n = 0; n < 300; n++) {
    if (child.exitCode !== null) throw Error(output);
    try {
      return {
        ...running,
        ...JSON.parse(await readFile(join(dir, "ready.json"), "utf8")),
      };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await delay(100);
  }
  throw Error("Waitron startup timeout");
}
async function stop(server) {
  if (server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  const timer = setTimeout(() => server.child.kill("SIGKILL"), 5000);
  try {
    assert.equal(await server.done, 0);
  } finally {
    clearTimeout(timer);
  }
}
async function worker(dir, command, input) {
  const child = spawn(
    process.execPath,
    [
      "--permission",
      "--allow-fs-read=*",
      "--allow-fs-write=" + (await realpath(dir)),
      "--allow-worker",
      "--allow-child-process",
      "--allow-addons",
      "--import",
      require.resolve("tsx"),
      join(waitron, "apps/server/scripts/cloud-backup-fixture.ts"),
    ],
    {
      cwd: join(waitron, "apps/server"),
      env: { ...process.env, TSX_DISABLE_CACHE: "1", CLOUD_TEST_ROOT: dir },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "",
    error = "";
  child.stdout.on("data", (v) => (output += v));
  child.stderr.on("data", (v) => (error = (error + v).slice(-16000)));
  child.stdin.end(JSON.stringify({ command, ...input }));
  const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  try {
    const code = await new Promise((r) => child.once("exit", r));
    if (code !== 0) throw Error("Waitron backup worker: " + error);
    return JSON.parse(output.trim().split("\n").at(-1));
  } finally {
    clearTimeout(timer);
  }
}
try {
  f = await startPortalFixture();
  s3 = await startBackupStorage();
  const signup = new SignupStore(f.db.pool, f.db.outbox),
    email = "backups-" + randomUUID() + "@example.test",
    password = "Cloud backup integration password";
  await signup.request(email);
  const mail = f.db.outbox.open(
    (await f.db.pool.query("SELECT * FROM email_outbox")).rows[0],
  );
  const owner = await signup.complete(mail.token, {
      password,
      organisationName: "Backup test",
      legalBusinessName: "Backup test SL",
      countryCode: "ES",
    }),
    session = await transaction(f.db.pool, (c) =>
      login(c, { email, password }),
    );
  const vault = new BackupKeyVault(randomBytes(32));
  const clients = new Map();
  const objects = (l) => {
    if (!clients.has(l.bucket)) {
      const client = new BackupObjects(l, s3.admin, s3.ca);
      clients.set(l.bucket, client);
      objectClients.push(client);
    }
    return clients.get(l.bucket);
  };
  const catalogue = new BackupCatalogue(f.db.pool, vault, objects),
    recovery = new BackupRecovery(f.db.pool, vault, f.origin),
    venues = [];
  for (let n = 0; n < 2; n++) {
    const dir = await root(),
      server = await launch(dir),
      ca = await readFile(join(dir, "tls", "ca.crt"));
    let cookie = "";
    const post = (path, data = {}) =>
      new Promise((done, fail) => {
        const body = JSON.stringify(data),
          url = new URL(server.origin + path);
        const req = httpsRequest(
          url,
          {
            ca,
            agent: false,
            method: "POST",
            headers: {
              Origin: server.origin,
              Cookie: cookie,
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
          },
          (res) => {
            let text = "";
            res.on("data", (v) => (text += v));
            res.on("end", () => {
              try {
                assert.equal(res.statusCode, 200, text);
                if (res.headers["set-cookie"])
                  cookie = res.headers["set-cookie"]
                    .map((c) => c.split(";")[0])
                    .join("; ");
                done(JSON.parse(text));
              } catch (e) {
                fail(e);
              }
            });
          },
        );
        req.on("error", fail);
        req.setTimeout(10000, () =>
          req.destroy(Error("local request timeout")),
        );
        req.end(body);
      });
    await post("/management-api/session", {
      email: "owner@example.test",
      password: "Local integration password",
    });
    const pairing = await post("/management-api/cloud/start");
    await new PairingStore(f.db.pool).approve(
      pairing.requestId,
      pairing.code,
      owner.organisationId,
      owner.legalBusinessId,
      session.token,
      session.csrfToken,
    );
    await post("/management-api/cloud/check");
    const paired = await post("/management-api/cloud/complete", {
      requestId: pairing.requestId,
      organisationId: owner.organisationId,
      legalBusinessId: owner.legalBusinessId,
    });
    const location = await s3.bucket("venue-" + n);
    await catalogue.provision(paired.registration.installationId, location);
    venues.push({
      root: dir,
      server,
      registration: paired.registration,
      location,
    });
  }
  record(
    "two real Waitron servers paired through manager sessions and Cloud owner approval",
  );
  const snapshots = [];
  for (const venue of venues) {
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(Error("CSR timeout")), 10000);
      venue.server.child.once("message", (m) => {
        clearTimeout(timer);
        m.csr ? done() : fail(Error("CSR failed"));
      });
      venue.server.child.send({
        csrHostname: "backup-" + randomUUID() + ".example.test",
      });
    });
    assert((await readFile(join(venue.root, "cloud-staff.key"))).length > 0);
    await writeFile(
      join(venue.root, "backup.env"),
      "WAITRON_BACKUP_DIR=/old-backup-target\n",
      { mode: 0o600 },
    );
    const reservation = await catalogue.reserveCapture(
      venue.registration.installationId,
      randomUUID(),
    );
    const captured = await worker(venue.root, "capture", {
      recoveryKey: reservation.keys.recoveryKey,
    });
    assert(captured.networkDenied);
    assert(captured.entries.includes("secrets/backup.env"));
    assert(
      !captured.entries.some(
        (n) => n.includes("cloud-connection") || n.includes("cloud-staff.key"),
      ),
    );
    const bytes = await readFile(join(venue.root, "captured.backup.enc"));
    const grant = await s3.authority.grant(
      venue.location,
      {
        kind: "capture",
        bucket: venue.location.bucket,
        scope: reservation.incomingKey,
      },
      s3.ca,
    );
    const upload = new BackupObjects(venue.location, grant.credentials, s3.ca);
    try {
      await upload.put(reservation.incomingKey, bytes);
    } finally {
      upload.close();
    }
    const point = await catalogue.publish(
      venue.registration.installationId,
      reservation.id,
      {
        ...receipt(bytes),
        capturedAt: captured.manifest.createdAt,
        retention: "daily",
        sourceNodeId: captured.sourceNodeId,
        modules: captured.manifest.modules,
      },
    );
    let result;
    await catalogue.verify(
      point.id,
      "waitron-local-" +
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: waitron,
          encoding: "utf8",
        }).trim(),
      async (archive, keys, p) => {
        const target = await root();
        await writeFile(join(target, "input.backup.enc"), archive, {
          mode: 0o600,
        });
        result = await worker(target, "restore", {
          recoveryKey: keys.recoveryKey,
          sourceNodeId: p.sourceNodeId,
          modules: p.modules,
          expectedVenue: captured.venueName,
        });
        assert(result.networkDenied);
        assert(result.integrityOk);
        assert(result.hooks.includes("fiscal-verifactu"));
        assert.equal(result.cloudCredentialPresent, false);
        assert.equal(result.staffKeyPresent, false);
      },
    );
    snapshots.push({ venue, reservation, point, captured, bytes, result });
  }
  record(
    "both encrypted snapshots restored by Waitron with integrity/schema checks, module hooks and network permission denied",
  );
  for (const item of snapshots) await stop(item.venue.server);
  const streams = [];
  for (const snapshot of snapshots)
    streams.push(
      await probeBackupStream({
        root: snapshot.venue.root,
        source: join(snapshot.venue.root, "venue", "venue.db"),
        storage: s3,
        location: snapshot.venue.location,
        key: snapshot.reservation.keys.streamKey,
      }),
    );
  record(
    "Litestream restored committed writes from both actual Waitron databases using encrypted scoped storage; removed streams refused restore",
  );
  const item = snapshots[0];
  await catalogue.rotate(item.venue.registration.installationId);
  const targetKey = generateKeyPairSync("ed25519"),
    operationId = randomUUID();
  await recovery.start(session.token, session.csrfToken, {
    id: operationId,
    pointId: item.point.id,
    mode: "failure",
    targetPublicKey: targetKey.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    oldServerUnavailable: true,
    acceptDataLoss: true,
  });
  const proof = (action) => {
    const bytes = recoveryPayload(
      f.origin,
      operationId,
      action,
      item.point.digest,
      Date.now(),
    );
    return {
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, targetKey.privateKey).toString("base64url"),
    };
  };
  const access = await recovery.target(operationId, "read", proof("read"));
  assert.equal(access.keys.recoveryKey, item.reservation.keys.recoveryKey);
  const grant = await s3.authority.grant(
      access.location,
      {
        kind: "restore",
        bucket: access.location.bucket,
        scope: access.point.objectKey,
      },
      s3.ca,
    ),
    reader = new BackupObjects(access.location, grant.credentials, s3.ca);
  const replacement = await root();
  try {
    await writeFile(
      join(replacement, "input.backup.enc"),
      await reader.read(access.point.objectKey),
      { mode: 0o600 },
    );
  } finally {
    reader.close();
  }
  const restored = await worker(replacement, "restore", {
    recoveryKey: access.keys.recoveryKey,
    sourceNodeId: access.point.sourceNodeId,
    modules: access.point.modules,
    expectedVenue: item.captured.venueName,
  });
  assert(restored.integrityOk);
  await recovery.target(operationId, "restored", proof("restored"));
  assert.equal(
    (await recovery.status(session.token, operationId)).status,
    "restored",
  );
  assert.equal(
    (await f.db.pool.query("SELECT count(*) FROM installations")).rows[0].count,
    "2",
  );
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT count(*) FROM installations WHERE revoked_at IS NOT NULL",
      )
    ).rows[0].count,
    "0",
  );
  await recovery.close(session.token, session.csrfToken, operationId);
  record(
    "owner recovery restored an older-key snapshot after rotation with original servers stopped and no continuous data present",
  );
  const bad = await root();
  await writeFile(join(bad, "input.backup.enc"), item.bytes, { mode: 0o600 });
  await assert.rejects(
    worker(bad, "restore", {
      recoveryKey: randomBytes(32).toString("base64url"),
      sourceNodeId: item.point.sourceNodeId,
      modules: item.point.modules,
      expectedVenue: item.captured.venueName,
    }),
  );
  await assert.rejects(readFile(join(bad, "venue", "venue.db")));
  record(
    "wrong recovery key leaves the replacement database absent; Cloud grants did not activate or re-enrol it",
  );
  const result = {
    cloudHead: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    waitronHead: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: waitron,
      encoding: "utf8",
    }).trim(),
    cloudDirty:
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim() !== "",
    streams,
    waitronDirty:
      execFileSync("git", ["status", "--porcelain"], {
        cwd: waitron,
        encoding: "utf8",
      }).trim() !== "",
    checks,
    continuousServerRestore:
      "blocked on Waitron sealed-state and cold-restore implementation",
    activation: "not performed",
  };
  if (process.env.BACKUP_RECEIPT)
    await writeFile(
      process.env.BACKUP_RECEIPT,
      JSON.stringify(result, null, 2) + "\n",
    );
  console.log(JSON.stringify(result));
} finally {
  for (const child of children) await stop(child);
  for (const client of objectClients) client.close();
  await s3?.stop();
  await f?.close();
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
}
