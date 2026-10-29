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
  assert.ok(pin, "port probe checks need a supported storage fixture platform");
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
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-probe-seed-"));
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
const [mode, seed, archiveName] = process.argv.slice(1);
const bytes = await fs.readFile(seed);
const cache = join(tmpdir(), "waitron-cloud-test-binaries"), archive = join(cache, archiveName);
await fs.mkdir(cache);
await fs.writeFile(archive, bytes, {mode: 0o444});
await fs.mkdir(join(tmpdir(), "unrelated-root"));
await fs.writeFile(join(tmpdir(), "unrelated-root", "keep"), "unrelated state");
const archiveBefore = await fs.stat(archive);
const competitor = net.createServer(socket => socket.end("competing listener"));
await new Promise(resolve => competitor.listen(0, "127.0.0.1", resolve));
competitor.unref();
const allocate = fs.mkdtemp, tcpServer = net.createServer;
const setupRefusal = Error("controlled post-probe setup refusal");
let root, probeServer, original, allocations = 0, probes = 0, issuerAttempts = 0;
fs.mkdtemp = async (...args) => { allocations++; root = await allocate(...args); return root; };
// Keep the kernel's bind real, but direct the ephemeral probe to an occupied port.
net.createServer = (...args) => {
  probes++;
  probeServer = tcpServer(...args);
  probeServer.unref();
  const listen = probeServer.listen;
  probeServer.listen = function(port, host, callback) {
    assert.equal(port, 0);
    assert.equal(host, "127.0.0.1");
    return listen.call(this, mode === "occupied" ? competitor.address().port : 0, host, callback);
  };
  const emit = probeServer.emit;
  probeServer.emit = function(event, ...values) {
    if (event === "error") original = values[0];
    return emit.call(this, event, ...values);
  };
  return probeServer;
};
https.createServer = () => {
  issuerAttempts++;
  assert.equal(probeServer.listening, false, "the successful probe must close before identity-server construction");
  assert.equal(probeServer.listenerCount("error"), 0, "a successful probe must detach its startup handler");
  throw setupRefusal;
};
childProcess.spawn = () => assert.fail("probe qualification must precede store startup");
globalThis.fetch = () => assert.fail("the verified warm archive must be reused");
syncBuiltinESMExports();
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
try {
  let failure;
  try {
    const storage = await startBackupStorage();
    await storage.stop();
  } catch (error) { failure = error; }
  if (mode === "occupied") {
    assert.ok(original, "the real occupied-port probe must fail");
    assert.equal(failure, original, "startup must reject with the original probe error");
    assert.equal(failure.code, "EADDRINUSE");
    assert.equal(issuerAttempts, 0, "failed probe must stop before identity-server construction");
  } else {
    assert.equal(original, undefined);
    assert.equal(failure, setupRefusal);
    assert.equal(issuerAttempts, 1);
  }
  assert.equal(failure.storageDownload, undefined);
  assert.equal(failure.storageStartup, undefined);
  assert.equal(allocations, 1, "probe failures must not trigger child-port retries");
  assert.equal(probes, 1);
  assert.equal(probeServer.listening, false);
  assert.ok(!existsSync(root), "failed startup must remove extracted files and private key");
  assert.deepEqual((await fs.readdir(tmpdir())).sort(), ["unrelated-root", "waitron-cloud-test-binaries"]);
  assert.equal(await fs.readFile(join(tmpdir(), "unrelated-root", "keep"), "utf8"), "unrelated state");
  assert.deepEqual(await fs.readdir(cache), [archiveName]);
  const current = await fs.stat(archive);
  assert.equal(current.ino, archiveBefore.ino);
  assert.equal(current.mtimeMs, archiveBefore.mtimeMs);
  assert.equal(current.mode, archiveBefore.mode);
  assert.deepEqual(await fs.readFile(archive), bytes);
  const received = await new Promise((resolve, reject) => {
    let value = "";
    const socket = net.connect(competitor.address().port, "127.0.0.1");
    socket.setTimeout(3000, () => socket.destroy(Error("competing listener did not respond")));
    socket.on("data", chunk => { value += chunk; });
    socket.on("error", reject);
    socket.on("end", () => resolve(value));
  });
  assert.equal(received, "competing listener", "cleanup must preserve the competing listener");
  console.log(JSON.stringify({mode, allocations, probes, issuerAttempts}));
} finally { await new Promise(resolve => competitor.close(resolve)); }
`;

// Missing rejection, probe closure, handler detachment or owned-file cleanup must fail.
for (const mode of ["occupied", "available"]) {
  test(`storage port probe ${mode} bind preserves its failure and owned cleanup`, { timeout: 30000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-probe-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath,
      ["--input-type=module", "-e", probe, mode, seed, archiveName], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
        timeout: 25000, maxBuffer: 1024 * 1024,
      });
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), {mode, allocations: 1, probes: 1, issuerAttempts: mode === "occupied" ? 0 : 1});
  });
}
