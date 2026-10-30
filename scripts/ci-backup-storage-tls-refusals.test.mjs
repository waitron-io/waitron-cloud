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
  assert.ok(pin, "TLS refusal checks need a supported storage fixture platform");
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
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-tls-seed-"));
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
import { generateKeyPairSync, X509Certificate } from "node:crypto";
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
const competingPort = competitor.address().port;
const allocate = fs.mkdtemp, read = fs.readFile, command = childProcess.execFileSync;
const tcpServer = net.createServer, tlsServer = https.createServer;
const allocated = [];
let root, original, allocations = 0, certificates = 0, extractions = 0, tlsCalls = 0, reads = 0;
const otherKey = mode === "mismatched-key" ? generateKeyPairSync("rsa", {modulusLength: 2048}).privateKey.export({type: "pkcs8", format: "pem"}) : null;
fs.mkdtemp = async (...args) => { allocations++; root = await allocate(...args); return root; };
fs.readFile = async (path, ...args) => {
  const value = await read(path, ...args);
  if (root && path === join(root, "cert.pem")) {
    reads++;
    assert.ok(new X509Certificate(value).checkIP("127.0.0.1"), "certificate generation must succeed before TLS validation");
    if (mode === "malformed-certificate") return "damaged certificate";
  }
  if (root && path === join(root, "key.pem")) {
    reads++;
    assert.ok(value.toString().includes("PRIVATE KEY-----"));
    if (mode === "malformed-key") return Buffer.from("damaged private key");
    if (mode === "mismatched-key") return Buffer.from(otherKey);
  }
  return value;
};
childProcess.execFileSync = (name, args, options) => {
  assert.ok(name === "tar" || name === "openssl", "TLS refusal must precede child diagnostics");
  if (name === "tar") { extractions++; assert.deepEqual(args, ["-xzf", archive, "-C", root]); }
  else { certificates++; assert.ok(existsSync(join(root, "weed"))); }
  return command(name, args, options);
};
net.createServer = (...args) => { const server = tcpServer(...args); allocated.push(server); return server; };
https.createServer = (...args) => {
  tlsCalls++;
  let server;
  try { server = tlsServer(...args); } catch (error) { original = error; throw error; }
  server.close();
  throw Error("malformed TLS material was accepted");
};
childProcess.spawn = () => assert.fail("TLS refusal must precede store startup");
globalThis.fetch = () => assert.fail("TLS refusal must preserve the warm cache without downloading");
syncBuiltinESMExports();
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
try {
  let failure;
  try {
    const storage = await startBackupStorage();
    await storage.stop();
  } catch (error) { failure = error; }
  assert.ok(original, "the real TLS constructor must refuse invalid material");
  assert.equal(failure, original, "startup must preserve the real TLS error identity");
  assert.equal(failure.code, ({"mismatched-key": "ERR_OSSL_X509_KEY_VALUES_MISMATCH", "malformed-key": "ERR_OSSL_UNSUPPORTED", "malformed-certificate": "ERR_OSSL_PEM_NO_START_LINE"})[mode]);
  assert.equal(failure.storageDownload, undefined);
  assert.equal(failure.storageStartup, undefined);
  assert.equal(allocations, 1, "TLS refusals must not retry startup");
  assert.equal(extractions, 1);
  assert.equal(certificates, 1);
  assert.equal(reads, 2);
  assert.equal(tlsCalls, 1);
  assert.equal(allocated.length, 0, "TLS refusal must precede TCP listener allocation");
  assert.ok(allocated.every(server => !server.listening), "port probes must close before TLS construction");
  assert.ok(!existsSync(root), "failed TLS construction must remove its extracted root and private key");
  assert.deepEqual((await fs.readdir(tmpdir())).sort(), ["unrelated-root", "waitron-cloud-test-binaries"]);
  assert.equal(await read(join(tmpdir(), "unrelated-root", "keep"), "utf8"), "unrelated state");
  assert.deepEqual(await fs.readdir(cache), [archiveName]);
  const current = await fs.stat(archive);
  assert.equal(current.ino, archiveBefore.ino);
  assert.equal(current.mtimeMs, archiveBefore.mtimeMs);
  assert.equal(current.mode, archiveBefore.mode);
  assert.deepEqual(await read(archive), bytes);
  const received = await new Promise((resolve, reject) => {
    let value = "";
    const socket = net.connect(competingPort, "127.0.0.1");
    socket.setTimeout(3000, () => socket.destroy(Error("competing listener did not respond")));
    socket.on("data", chunk => { value += chunk; });
    socket.on("error", reject);
    socket.on("end", () => resolve(value));
  });
  assert.equal(received, "competing listener", "startup cleanup must preserve another listener");
  console.log(JSON.stringify({allocations, extractions, certificates, realTlsRefused: true}));
} finally { await new Promise(resolve => competitor.close(resolve)); }
`;

// Ignoring either TLS input, replacing its error or retaining private files must
// fail these checks; the TLS parser, extraction and certificates remain real.
for (const mode of ["malformed-certificate", "malformed-key", "mismatched-key"]) {
  test(`storage ${mode} retains its real TLS refusal and cleans only owned state`, { timeout: 30000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-tls-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath,
      ["--input-type=module", "-e", probe, mode, seed, archiveName], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
        timeout: 25000, maxBuffer: 1024 * 1024,
      });
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), {allocations: 1, extractions: 1, certificates: 1, realTlsRefused: true});
  });
}
