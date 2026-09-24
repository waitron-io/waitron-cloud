import { promisify } from "node:util";
const run = promisify(execFile);
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn, execFileSync, execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rm, open } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(
  new URL("../packages/backups/package.json", import.meta.url),
);
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const pins = {
  "darwin-arm64": [
    "litestream-0.5.17-darwin-arm64.tar.gz",
    "e211f68ff7658d19f193f2914417afdf8f89a053ff8f263e5d6b3b1d3bbc7b08",
  ],
  "linux-arm64": [
    "litestream-0.5.17-linux-arm64.tar.gz",
    "f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5",
  ],
  "linux-x64": [
    "litestream-0.5.17-linux-x86_64.tar.gz",
    "cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d",
  ],
};
async function binary(root, platform) {
  const pin = pins[platform];
  if (!pin) throw Error("Unsupported Litestream test platform");
  const cache = join(tmpdir(), "waitron-cloud-test-binaries");
  await mkdir(cache, { recursive: true });
  const archive = join(cache, pin[0]);
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(
      "https://github.com/benbjohnson/litestream/releases/download/v0.5.17/" +
        pin[0],
    );
    if (!response.ok) throw Error("Litestream download failed");
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(createHash("sha256").update(bytes).digest("hex"), pin[1]);
  await writeFile(archive, bytes);
  execFileSync("tar", ["-xzf", archive, "-C", root]);
  const bin = join(root, "litestream");
  return bin;
}
// Storage proof only: this does not add the still-unimplemented sealed state row to Waitron.
export async function probeBackupStream({
  root,
  source,
  storage,
  location,
  key,
}) {
  const container = process.platform === "darwin",
    platform = container
      ? "linux-" +
        (execFileSync("docker", ["info", "--format", "{{.Architecture}}"], {
          encoding: "utf8",
        }).trim() === "aarch64"
          ? "arm64"
          : "x64")
      : process.platform + "-" + process.arch;
  const bin = await binary(root, platform),
    generation = randomUUID(),
    prefix = "streams/" + generation + "/",
    config = join(root, "stream.json"),
    output = join(root, "stream-restored.db"),
    caFile = join(root, "store-ca.pem");
  const grant = await storage.authority.grant(
    location,
    { kind: "stream", bucket: location.bucket, scope: prefix },
    storage.ca,
  );
  await writeFile(caFile, storage.ca);
  await writeFile(
    config,
    JSON.stringify({
      logging: { level: "debug" },
      snapshot: { interval: "24h", retention: "168h" },
      dbs: [
        {
          path: source,
          "monitor-interval": "1s",
          replica: {
            type: "s3",
            bucket: location.bucket,
            path: prefix.slice(0, -1),
            endpoint: container
              ? location.endpoint.replace("127.0.0.1", "host.docker.internal")
              : location.endpoint,
            region: location.region,
            "force-path-style": true,
            "sse-customer-algorithm": "AES256",
            "sse-customer-key": "${CLOUD_TEST_STREAM_KEY}",
          },
        },
      ],
    }),
    { mode: 0o600 },
  );
  const credentialFile = join(root, "stream-credentials");
  await writeFile(
    credentialFile,
    "[default]\naws_access_key_id=" +
      grant.credentials.accessKeyId +
      "\naws_secret_access_key=" +
      grant.credentials.secretAccessKey +
      "\naws_session_token=" +
      grant.credentials.sessionToken +
      "\n",
    { mode: 0o600 },
  );
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    AWS_SHARED_CREDENTIALS_FILE: credentialFile,
    LITESTREAM_S3_DEBUG: "retries",
    SSL_CERT_FILE: caFile,
    CLOUD_TEST_STREAM_KEY: key,
  };
  const envFile = join(root, "stream-env");
  await writeFile(
    envFile,
    Object.entries(env)
      .filter(([k]) => k !== "PATH")
      .map(([k, v]) => k + "=" + v)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  const image =
      "node@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4",
    containerName = "cloud-stream-" + generation;
  const command = container ? "docker" : bin,
    args = (a) =>
      container
        ? [
            "run",
            "--rm",
            "--name",
            containerName,
            ...["-v", root + ":" + root, "--env-file", envFile, image, bin],
            ...a,
          ]
        : a;
  assert.equal(
    (
      await run(command, args(["version"]), {
        env: container ? process.env : env,
      })
    ).stdout.trim(),
    "0.5.17",
  );
  const db = container ? null : new DatabaseSync(source);
  db?.exec("PRAGMA journal_mode=WAL");
  const log = await open(join(root, "litestream.log"), "w"),
    child = spawn(command, args(["replicate", "-config", config]), {
      env: container ? process.env : env,
      stdio: ["ignore", log.fd, log.fd],
    });
  const admin = new S3Client({
    endpoint: location.endpoint,
    region: location.region,
    credentials: storage.admin,
    forcePathStyle: true,
    requestHandler: { httpsAgent: storage.agent() },
    maxAttempts: 1,
  });
  async function restore() {
    const a = args(["restore", "-config", config, "-o", output, source]);
    if (container) a[a.indexOf("--name") + 1] = containerName + "-restore";
    try {
      return await run(command, a, {
        env: container ? process.env : env,
        timeout: 10000,
      });
    } finally {
      if (container)
        await run("docker", ["rm", "-f", containerName + "-restore"]).catch(
          () => {},
        );
    }
  }
  async function list() {
    const keys = [];
    let token;
    do {
      const page = await admin.send(
        new ListObjectsV2Command({
          Bucket: location.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        delay(5000),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise((r) => child.once("exit", r));
      }
    }
  }
  try {
    if (db)
      db.prepare("UPDATE locations SET name=?").run(
        "Stream initial " + randomUUID(),
      );
    let uploaded = [];
    for (let n = 0; n < 60; n++) {
      if (child.exitCode !== null)
        throw Error(await readFile(join(root, "litestream.log"), "utf8"));
      uploaded = await list();
      if (uploaded.some((k) => k.endsWith(".ltx"))) break;
      await delay(500);
    }
    assert(
      uploaded.some((k) => k.endsWith(".ltx")),
      "Litestream uploaded no LTX: " +
        (await readFile(join(root, "litestream.log"), "utf8")),
    );
    const ltx = uploaded.find((k) => k.endsWith(".ltx"));
    await assert.rejects(
      admin.send(new GetObjectCommand({ Bucket: location.bucket, Key: ltx })),
    );
    const marker = "Cloud stream " + randomUUID();
    if (container)
      await run("docker", [
        "exec",
        containerName,
        "node",
        "-e",
        "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.prepare('UPDATE locations SET name=?').run(process.argv[2]);d.close()",
        source,
        marker,
      ]);
    else db.prepare("UPDATE locations SET name=?").run(marker);
    let matched = false,
      restoreElapsedMs = 0;
    for (let n = 0; n < 30; n++) {
      await rm(output, { force: true });
      const started = Date.now();
      try {
        await restore();
        restoreElapsedMs = Date.now() - started;
        const restored = new DatabaseSync(output, { readOnly: true });
        try {
          assert.deepEqual(
            restored
              .prepare("PRAGMA integrity_check")
              .all()
              .map((r) => r.integrity_check),
            ["ok"],
          );
          matched = restored
            .prepare("SELECT name FROM locations")
            .all()
            .every((r) => r.name === marker);
        } finally {
          restored.close();
        }
      } catch (error) {
        if (n === 29) throw error;
      }
      if (matched) break;
      await delay(1000);
    }
    assert(
      matched,
      "Litestream restore missed a committed Waitron write: " +
        (await readFile(join(root, "litestream.log"), "utf8")),
    );
    await stop();
    const keys = await list();
    for (const key of keys)
      await admin.send(
        new DeleteObjectCommand({ Bucket: location.bucket, Key: key }),
      );
    assert.deepEqual(await list(), []);
    await rm(output, { force: true });
    let absent = false;
    try {
      await restore();
    } catch {
      absent = true;
    }
    assert(absent, "Missing continuous data must not restore successfully");
    return {
      version: "0.5.17",
      encrypted: true,
      scopedCredentials: true,
      restoredCommittedWaitronWrite: true,
      restoreElapsedMs,
      continuousDataDeleted: true,
      missingStreamRefused: true,
    };
  } finally {
    await stop();
    if (container)
      await run("docker", ["rm", "-f", containerName]).catch(() => {});
    db?.close();
    await log.close();
    admin.destroy();
  }
}
