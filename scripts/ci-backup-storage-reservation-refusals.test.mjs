import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { before, after } from "node:test";

const execute = promisify(execFile);
const pins = {
  "darwin-arm64": ["darwin_arm64", "3ad466db33e83d0b103f90a06997feeb1cc42fd536e6cbdcdded975778f64fda"],
  "linux-arm64": ["linux_arm64", "ba5c9def9ff98f78becdf309a50a9f906922f6383a7c4c772d01ede3cc012e16"],
  "linux-x64": ["linux_amd64", "31fb804858885f9e7f18b6d3b1da09e824baac3e6a55b5a62c3c4c77e6ed6d7d"],
};
let seedRoot, seed, archiveName;

// The shared cache is read-only; every extraction and injected failure is private.
before(async () => {
  const pin = pins[process.platform + "-" + process.arch];
  assert.ok(pin, "reservation refusal checks need a supported storage fixture platform");
  const [name, checksum] = pin;
  archiveName = "seaweed-4.47-" + name + ".tar.gz";
  let bytes;
  try {
    bytes = await readFile(join(tmpdir(), "waitron-cloud-test-binaries", archiveName));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch("https://github.com/seaweedfs/seaweedfs/releases/download/4.47/" + name + ".tar.gz", {
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.ok, true, "the pinned release archive must be available");
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(createHash("sha256").update(bytes).digest("hex"), checksum);
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-reservation-seed-"));
  seed = join(seedRoot, archiveName);
  await writeFile(seed, bytes, { flag: "wx", mode: 0o400 });
}, { timeout: 45000 });
after(async () => { if (seedRoot) await rm(seedRoot, { recursive: true, force: true }); });

const probe = `
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import childProcess from "node:child_process";
import net from "node:net";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [position, seed, archiveName] = process.argv.slice(1);
const refusedPosition = Number(position);
const bytes = await fs.readFile(seed);
const cache = join(tmpdir(), "waitron-cloud-test-binaries"), archive = join(cache, archiveName);
await fs.mkdir(cache);
await fs.writeFile(archive, bytes, {mode: 0o444});
await fs.mkdir(join(tmpdir(), "unrelated-root"));
await fs.writeFile(join(tmpdir(), "unrelated-root", "keep"), "unrelated state");
const archiveBefore = await fs.stat(archive);
const tcpServer = net.createServer, tlsServer = https.createServer, allocate = fs.mkdtemp;
const competitor = tcpServer(socket => socket.end("competing listener"));
await new Promise(resolve => competitor.listen(0, "127.0.0.1", resolve));
competitor.unref();
const competingPort = competitor.address().port;
const servers = [], heldPorts = [];
let root, issuer, original, allocations = 0, calls = 0, issuerPort;
fs.mkdtemp = async (...args) => { allocations++; root = await allocate(...args); return root; };
// Only the selected reservation changes destination; listen and its socket error
// remain real. The first TCP server is the separate identity-port probe.
net.createServer = (...args) => {
  const server = tcpServer(...args);
  server.unref();
  servers.push(server);
  const index = servers.length - 1;
  if (index === 0) return server;
  const listen = server.listen;
  server.listen = function(port, host, callback) {
    calls++;
    if (index === refusedPosition) {
      const emit = this.emit;
      this.emit = function(event, ...values) {
        if (event === "error") original = values[0];
        return emit.call(this, event, ...values);
      };
      return listen.call(this, competingPort, host, callback);
    }
    return listen.call(this, port, host, () => {
      heldPorts.push(this.address().port);
      callback();
    });
  };
  return server;
};
https.createServer = (...args) => {
  issuer = tlsServer(...args);
  issuer.unref();
  issuer.once("listening", () => { issuerPort = issuer.address().port; });
  return issuer;
};
childProcess.spawn = () => assert.fail("reservation refusal must precede store startup");
globalThis.fetch = () => assert.fail("the verified warm archive must be reused");
syncBuiltinESMExports();
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
try {
  let failure;
  try {
    const storage = await startBackupStorage();
    await storage.stop();
  } catch (error) { failure = error; }
  assert.ok(original, "the selected real reservation must hit an occupied socket");
  assert.equal(failure, original, "startup must return the original reservation socket error");
  assert.equal(failure.code, "EADDRINUSE");
  assert.equal(failure.port, competingPort);
  assert.equal(failure.storageDownload, undefined);
  assert.equal(failure.storageStartup, undefined);
  assert.equal(allocations, 1, "reservation errors must not retry child startup");
  assert.equal(calls, refusedPosition, "allocation must stop at the refused reservation");
  assert.equal(heldPorts.length, refusedPosition - 1);
  assert.ok(issuerPort, "the real identity server must bind before reservations");
  assert.equal(issuer.listening, false, "failed reservation must close the owned identity server");
  assert.ok(servers.every(server => !server.listening), "cleanup must release every earlier reservation");
  assert.ok(!existsSync(root), "cleanup must remove the extracted binary and private key");
  assert.deepEqual((await fs.readdir(tmpdir())).sort(), ["unrelated-root", "waitron-cloud-test-binaries"]);
  assert.equal(await fs.readFile(join(tmpdir(), "unrelated-root", "keep"), "utf8"), "unrelated state");
  assert.deepEqual(await fs.readdir(cache), [archiveName]);
  const current = await fs.stat(archive);
  assert.equal(current.ino, archiveBefore.ino);
  assert.equal(current.mtimeMs, archiveBefore.mtimeMs);
  assert.equal(current.mode, archiveBefore.mode);
  assert.deepEqual(await fs.readFile(archive), bytes);
  // Rebinding the actual ports proves the cleanup completed before rejection.
  for (const port of [issuerPort, ...heldPorts]) {
    const replacement = tcpServer();
    replacement.unref();
    await new Promise((resolve, reject) => {
      replacement.once("error", reject);
      replacement.listen(port, "127.0.0.1", resolve);
    });
    await new Promise(resolve => replacement.close(resolve));
  }
  const received = await new Promise((resolve, reject) => {
    let value = "";
    const socket = net.connect(competingPort, "127.0.0.1");
    socket.setTimeout(3000, () => socket.destroy(Error("competing listener did not respond")));
    socket.on("data", chunk => { value += chunk; });
    socket.on("error", reject);
    socket.on("end", () => resolve(value));
  });
  assert.equal(received, "competing listener", "cleanup must preserve a competing listener");
  console.log(JSON.stringify({refusedPosition, releasedReservations: heldPorts.length, allocations}));
} finally {
  await Promise.all([issuer, ...servers, competitor].filter(server => server?.listening)
    .map(server => new Promise(resolve => server.close(resolve))));
}
`;

// Omitting socket rejection, partial reservation release, identity-server closure
// or private-file cleanup must fail these checks without starting a store.
for (const position of [1, 4, 8]) {
  test(`storage reservation ${position} refusal releases earlier listeners and only owned files`, { timeout: 30000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-reservation-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath,
      ["--input-type=module", "-e", probe, String(position), seed, archiveName], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
        timeout: 25000, maxBuffer: 1024 * 1024,
      });
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), {refusedPosition: position, releasedReservations: position - 1, allocations: 1});
  });
}
