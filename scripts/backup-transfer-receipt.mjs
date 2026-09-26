import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { SignupStore, RegistrationStore } from "../packages/registration/src/index.ts";
import { database } from "../packages/account-http/test/fixtures.ts";
import { BackupCatalogue } from "../packages/backups/src/catalogue.ts";
import { BackupKeyVault } from "../packages/backups/src/keys.ts";
import { bufferObject, stageReadable } from "../packages/backups/src/object-transfer.ts";
import { BackupObjects, receipt } from "../packages/backups/src/storage.ts";
import { BackupWorker } from "../packages/backups/src/worker.ts";
import { verifyBackupTransferReceipt } from "./verify-backup-transfer-receipt.mjs";

const waitron = resolve(process.env.WAITRON_CHECKOUT ?? "");
assert(process.env.WAITRON_CHECKOUT, "Set WAITRON_CHECKOUT");
const databaseUrl = new URL(process.env.TEST_DATABASE_URL ?? "postgres://invalid");
assert.equal(databaseUrl.hostname, "127.0.0.1", "receipt PostgreSQL must be loopback-only");
assert.equal(databaseUrl.pathname, "/cloud_test", "receipt PostgreSQL must be the test database");
const fixture = {
    bytes: 4 * 1024 * 1024,
    chunkBytes: 64 * 1024,
    chunkDelayMs: 4,
    deadlineMs: 120,
  },
  payload = Buffer.alloc(fixture.bytes, 0x64),
  expected = receipt(payload),
  roots = [],
  root = async (prefix) => {
    const value = await mkdtemp(join(tmpdir(), prefix));
    roots.push(value);
    return value;
  },
  readSource = async (source) => {
    const chunks = [];
    for await (const chunk of source.open()) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks, source.receipt.size);
  },
  decodeAwsChunks = (body) => {
    const chunks = [];
    let offset = 0;
    while (offset < body.length) {
      const end = body.indexOf("\r\n", offset);
      assert(end >= 0, "invalid aws-chunked size line");
      const size = Number.parseInt(body.subarray(offset, end).toString().split(";", 1)[0], 16);
      assert(Number.isSafeInteger(size) && size >= 0, "invalid aws-chunked size");
      offset = end + 2;
      if (size === 0) break;
      chunks.push(body.subarray(offset, offset + size));
      offset += size;
      assert.equal(body.subarray(offset, offset + 2).toString(), "\r\n");
      offset += 2;
    }
    return Buffer.concat(chunks);
  };
let server, db, source, objects;
const sockets = new Set();

try {
  const tlsRoot = await root("cloud-transfer-tls-");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(tlsRoot, "key.pem"),
      "-out",
      join(tlsRoot, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const ca = await readFile(join(tlsRoot, "cert.pem"), "utf8"),
    stored = new Map(),
    attempts = new Map(),
    nextAttempt = (method, key) => {
      const name = `${method} ${key}`,
        value = (attempts.get(name) ?? 0) + 1;
      attempts.set(name, value);
      return value;
    },
    errorResponse = (response, status, code) => {
      response.writeHead(status, { "content-type": "application/xml" });
      response.end(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`);
    };
  server = createServer(
    { key: await readFile(join(tlsRoot, "key.pem")), cert: ca },
    async (request, response) => {
      try {
        request.on("error", () => {});
        response.on("error", () => {});
        const path = new URL(request.url, "https://127.0.0.1").pathname,
          key = path.replace(/^\/transfer-probe\//, ""),
          attempt = nextAttempt(request.method, key);
        if (request.method === "PUT" && key === "deadline-upload") {
          request.pause();
          return;
        }
        if (request.method === "PUT") {
          const chunks = [];
          for await (const chunk of request) {
            chunks.push(Buffer.from(chunk));
            await delay(fixture.chunkDelayMs);
          }
          const wireBytes = Buffer.concat(chunks),
            bytes = String(request.headers["content-encoding"] ?? "").includes("aws-chunked")
              ? decodeAwsChunks(wireBytes)
              : wireBytes;
          if (key === "retry-upload" && attempt === 1) {
            errorResponse(response, 503, "SlowDown");
            return;
          }
          stored.set(key, bytes);
          response.writeHead(200, { etag: `"${createHash("md5").update(bytes).digest("hex")}"` });
          response.end();
          return;
        }
        if (request.method === "GET" && key === "deadline-download") {
          response.writeHead(200, { "content-length": fixture.bytes });
          response.write(payload.subarray(0, fixture.chunkBytes));
          return;
        }
        if (request.method === "GET" && key === "retry-upload" && attempt === 1) {
          errorResponse(response, 503, "SlowDown");
          return;
        }
        if (request.method === "GET") {
          const bytes = stored.get(key);
          if (!bytes) {
            errorResponse(response, 404, "NoSuchKey");
            return;
          }
          response.writeHead(200, { "content-length": bytes.length });
          for (let offset = 0; offset < bytes.length; offset += fixture.chunkBytes) {
            response.write(bytes.subarray(offset, offset + fixture.chunkBytes));
            await delay(fixture.chunkDelayMs);
          }
          response.end();
          return;
        }
        errorResponse(response, 405, "MethodNotAllowed");
      } catch (error) {
        if (!response.destroyed) response.destroy(error);
      }
    },
  );
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  objects = new BackupObjects(
    { endpoint: `https://127.0.0.1:${port}`, bucket: "transfer-probe", region: "local" },
    { accessKeyId: "local-access", secretAccessKey: "local-secret" },
    ca,
  );
  source = await stageReadable(
    Readable.from(
      (async function* () {
        for (let offset = 0; offset < payload.length; offset += fixture.chunkBytes)
          yield payload.subarray(offset, offset + fixture.chunkBytes);
      })(),
    ),
    payload.length,
  );

  let started = performance.now();
  assert.deepEqual(
    await objects.putStaged("retry-upload", source, undefined, { timeoutMs: 10000 }),
    expected,
  );
  const uploadElapsedMs = performance.now() - started;
  assert.deepEqual(stored.get("retry-upload"), payload);
  assert.equal(attempts.get("PUT retry-upload"), 2);

  const downloadRoot = await root("cloud-transfer-stage-");
  started = performance.now();
  const downloaded = await objects.stage("retry-upload", undefined, {
    timeoutMs: 10000,
    temporaryRoot: downloadRoot,
  });
  const downloadElapsedMs = performance.now() - started;
  try {
    assert.deepEqual(downloaded.receipt, expected);
  } finally {
    await downloaded.dispose();
  }
  assert.equal(attempts.get("GET retry-upload"), 2);

  started = performance.now();
  await assert.rejects(
    objects.putStaged("deadline-upload", source, undefined, {
      timeoutMs: fixture.deadlineMs,
    }),
    /backup.cancelled/,
  );
  const uploadDeadlineMs = performance.now() - started;
  assert.equal(stored.has("deadline-upload"), false);

  started = performance.now();
  await assert.rejects(
    objects.stage("deadline-download", undefined, {
      timeoutMs: fixture.deadlineMs,
      temporaryRoot: downloadRoot,
    }),
    /backup.cancelled/,
  );
  const downloadDeadlineMs = performance.now() - started;
  assert.deepEqual(await readdir(downloadRoot), []);
  await assert.rejects(objects.stage("missing-object"), (error) => error?.name === "NoSuchKey");

  db = await database();
  const vault = new BackupKeyVault(randomBytes(32)),
    memory = new Map(),
    counts = { copies: 0 },
    memoryStore = () => ({
      async stage(key) {
        const bytes = memory.get(key);
        if (!bytes) throw new Error("NoSuchKey");
        return bufferObject(bytes);
      },
      async putStaged(key, staged) {
        counts.copies++;
        const bytes = await readSource(staged);
        memory.set(key, bytes);
        return staged.receipt;
      },
      async remove(key) {
        if (failRemove) throw new Error("storage reply lost");
        memory.delete(key);
      },
    });
  let failRemove = false;
  const catalogue = new BackupCatalogue(db.pool, vault, memoryStore),
    signup = new SignupStore(db.pool, db.outbox);
  await signup.request("transfer-receipt@example.test");
  const mail = db.outbox.open((await db.pool.query("SELECT * FROM email_outbox")).rows[0]);
  assert("token" in mail);
  const owner = await signup.complete(mail.token, {
      password: "A sufficiently long transfer password",
      organisationName: "Transfer receipt",
      legalBusinessName: "Transfer receipt SL",
      countryCode: "ES",
    }),
    registration = new RegistrationStore(db.pool),
    binding = {
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
  const venue = await registration.complete(binding);
  await catalogue.provision(venue.installationId, {
    endpoint: "https://storage.test",
    bucket: "transfer-receipt",
    region: "local",
  });
  const metadata = (bytes) => ({
      ...receipt(bytes),
      capturedAt: new Date().toISOString(),
      retention: "daily",
      sourceNodeId: randomUUID(),
      modules: { core: 1 },
    }),
    acknowledged = await catalogue.reserveCapture(venue.installationId, randomUUID()),
    archive = Buffer.from("acknowledged encrypted archive"),
    acknowledgedMetadata = metadata(archive);
  memory.set(acknowledged.incomingKey, archive);
  failRemove = true;
  await assert.rejects(
    catalogue.publish(venue.installationId, acknowledged.id, acknowledgedMetadata),
    /storage reply lost/,
  );
  failRemove = false;
  const point = await catalogue.publish(
    venue.installationId,
    acknowledged.id,
    acknowledgedMetadata,
  );
  assert.equal(counts.copies, 1);
  assert.equal(
    Number((await db.pool.query("SELECT count(*) FROM backup_points WHERE id=$1", [point.id])).rows[0].count),
    1,
  );
  const missing = await catalogue.reserveCapture(venue.installationId, randomUUID());
  await assert.rejects(
    catalogue.publish(venue.installationId, missing.id, metadata(Buffer.from("missing"))),
    /NoSuchKey/,
  );
  const expired = await catalogue.reserveCapture(venue.installationId, randomUUID());
  memory.set(expired.incomingKey, Buffer.from("expired"));
  await db.pool.query(
    "UPDATE backup_captures SET created_at=clock_timestamp()-interval '25 hours' WHERE id=$1",
    [expired.id],
  );
  await assert.rejects(
    catalogue.publish(venue.installationId, expired.id, metadata(Buffer.from("expired"))),
    /backup.capture_expired/,
  );

  const scheduler = new BackupWorker(db.pool, catalogue, async () => {});
  await scheduler.schedule();
  await db.pool.query(
    "UPDATE backup_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'verify'",
  );
  let stageSignal, entered;
  const stageStarted = new Promise((resolve) => {
      entered = resolve;
    }),
    cancellingCatalogue = new BackupCatalogue(db.pool, vault, () => ({
      async stage(_key, _streamKey, options) {
        stageSignal = options?.signal;
        entered();
        assert(stageSignal);
        await new Promise((_, reject) =>
          stageSignal.addEventListener("abort", () => reject(new Error("backup.cancelled")), {
            once: true,
          }),
        );
      },
      async putStaged() {
        throw new Error("unused");
      },
      async remove() {
        throw new Error("unused");
      },
    })),
    cancellingWorker = new BackupWorker(db.pool, cancellingCatalogue, async () => {
      assert.fail("restore must not start");
    }),
    controller = new AbortController(),
    running = cancellingWorker.runOnce(controller.signal);
  await stageStarted;
  started = performance.now();
  controller.abort();
  await running;
  const cloudAbortToSettleMs = performance.now() - started,
    job = (
      await db.pool.query(
        "SELECT attempts,failures FROM backup_jobs WHERE kind='verify' AND target_id=$1",
        [point.id],
      )
    ).rows[0];
  assert.equal(stageSignal.aborted, true);

  const require = createRequire(join(waitron, "apps/server/package.json")),
    helper = join(import.meta.dirname, "waitron-transfer-probe.ts"),
    { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", require.resolve("tsx"), helper],
      {
        cwd: join(waitron, "apps/server"),
        env: { ...process.env, WAITRON_CHECKOUT: waitron, TSX_DISABLE_CACHE: "1" },
        timeout: 30000,
      },
    ),
    waitronProbe = JSON.parse(stdout.trim().split("\n").at(-1));

  const git = (directory, args) =>
      execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim(),
    cloud = resolve(import.meta.dirname, ".."),
    result = {
      version: 1,
      cloudHead: git(cloud, ["rev-parse", "HEAD"]),
      cloudDirty: git(cloud, ["status", "--porcelain"]) !== "",
      waitronHead: git(waitron, ["rev-parse", "HEAD"]),
      waitronDirty: git(waitron, ["status", "--porcelain"]) !== "",
      fixture,
      transfers: {
        upload: {
          elapsedMs: uploadElapsedMs,
          bytesPerSecond: fixture.bytes / (uploadElapsedMs / 1000),
          attempts: attempts.get("PUT retry-upload"),
          committedBytes: stored.get("retry-upload").length,
        },
        download: {
          elapsedMs: downloadElapsedMs,
          bytesPerSecond: fixture.bytes / (downloadElapsedMs / 1000),
          attempts: attempts.get("GET retry-upload"),
          receivedBytes: downloaded.receipt.size,
        },
        deadline: {
          uploadRefused: true,
          uploadElapsedMs: uploadDeadlineMs,
          downloadRefused: true,
          downloadElapsedMs: downloadDeadlineMs,
          partialStages: (await readdir(downloadRoot)).length,
        },
        missingObjectRefused: true,
      },
      lifecycle: {
        acknowledgedUploadResumed: waitronProbe.acknowledgedUploadResumed,
        uploads: waitronProbe.uploads,
        publications: waitronProbe.publications,
        credentialRenewalReusedArchive: waitronProbe.credentialRenewalReusedArchive,
        archives: waitronProbe.archives,
        expiredOperationRefused: true,
        operationExpiryHours: 24,
      },
      shutdown: {
        cloudDownloadCancelled: stageSignal.aborted,
        cloudAbortToSettleMs,
        cloudFailures: Number(job.failures),
        cloudAttempts: Number(job.attempts),
        waitronArchiveAbortToSettleMs: waitronProbe.archiveAbortToSettleMs,
        waitronUploads: waitronProbe.shutdownUploads,
        waitronPublications: waitronProbe.shutdownPublications,
      },
      checks: [
        "controlled-https-storage",
        "postgresql-catalogue",
        "waitron-snapshot-worker",
        "no-production-resources",
      ],
    };
  verifyBackupTransferReceipt(result);
  if (process.env.BACKUP_TRANSFER_RECEIPT)
    await writeFile(
      process.env.BACKUP_TRANSFER_RECEIPT,
      JSON.stringify(result, null, 2) + "\n",
    );
  console.log(JSON.stringify(result));
} finally {
  objects?.close();
  await source?.dispose();
  await db?.close();
  if (server) {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections?.();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  await Promise.all(roots.map((value) => rm(value, { recursive: true, force: true })));
}
