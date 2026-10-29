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
let seedRoot, seed, archiveName, digest;

// The shared cache is read-only; every extraction and injected failure is private.
before(async () => {
  const pin = pins[process.platform + "-" + process.arch];
  assert.ok(pin, "extraction checks need a supported storage fixture platform");
  const [name, checksum] = pin;
  digest = checksum;
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
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-extraction-seed-"));
  seed = join(seedRoot, archiveName);
  await writeFile(seed, bytes, { flag: "wx", mode: 0o400 });
}, { timeout: 45000 });
after(async () => { if (seedRoot) await rm(seedRoot, { recursive: true, force: true }); });

const probe = `
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync, statSync, readFileSync } from "node:fs";
import childProcess from "node:child_process";
import net from "node:net";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [mode, seed, archiveName] = process.argv.slice(1);
const bytes = await fs.readFile(seed);
const cache = join(tmpdir(), "waitron-cloud-test-binaries"), archive = join(cache, archiveName);
await fs.mkdir(cache);
await fs.mkdir(join(tmpdir(), "unrelated-root"));
await fs.writeFile(join(cache, "neighbour"), "unrelated input");
const neighbourBefore = await fs.stat(join(cache, "neighbour"));
if (mode !== "cold-certificate-command") await fs.writeFile(archive, bytes, {mode: 0o444});
const archiveBefore = mode === "cold-certificate-command" ? null : await fs.stat(archive);
const original = Object.assign(new Error("controlled certificate setup refusal"), {
  code: mode === "certificate-read" ? "EACCES" : "CERT_REFUSED"
});
const allocate = fs.mkdtemp, read = fs.readFile, command = childProcess.execFileSync;
let root, allocations = 0, downloads = 0, extractions = 0, certificates = 0, certificateReads = 0;
fs.mkdtemp = async (...args) => { allocations++; root = await allocate(...args); return root; };
fs.readFile = async (path, ...args) => {
  if (root && path === join(root, "cert.pem")) {
    certificateReads++;
    assert.ok(readFileSync(path, "utf8").includes("-----BEGIN CERTIFICATE-----"), "real certificate generation must precede its read");
    assert.ok(readFileSync(join(root, "key.pem"), "utf8").includes("PRIVATE KEY-----"));
    throw original;
  }
  return read(path, ...args);
};
childProcess.execFileSync = (name, args, options) => {
  if (name === "tar") {
    extractions++;
    assert.deepEqual(args, ["-xzf", archive, "-C", root]);
    return command(name, args, options);
  }
  assert.equal(name, "openssl", "startup must stop during certificate setup");
  certificates++;
  assert.ok(existsSync(join(root, "weed")), "real extraction must create weed inside the owned root");
  const binary = statSync(join(root, "weed"));
  assert.ok(binary.isFile() && binary.size > 1000000 && (binary.mode & 0o111), "the extracted store must be a nonempty executable file");
  assert.equal(args[args.indexOf("-keyout") + 1], join(root, "key.pem"));
  assert.equal(args[args.indexOf("-out") + 1], join(root, "cert.pem"));
  if (mode !== "certificate-read") throw original;
  return command(name, args, options);
};
childProcess.spawn = () => assert.fail("certificate setup refusal must precede store startup");
net.createServer = https.createServer = () => assert.fail("certificate setup refusal must precede listener allocation");
syncBuiltinESMExports();
globalThis.fetch = async url => {
  downloads++;
  assert.equal(url, "https://github.com/seaweedfs/seaweedfs/releases/download/4.47/" + archiveName.slice("seaweed-4.47-".length));
  return new Response(bytes);
};
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
let failure;
try {
  const storage = await startBackupStorage();
  await storage.stop();
} catch (error) { failure = error; }
assert.equal(failure, original, "the certificate refusal must retain its error identity");
assert.equal(failure.storageDownload, undefined);
assert.equal(failure.storageStartup, undefined);
assert.equal(allocations, 1, "certificate refusals must not retry startup");
assert.equal(extractions, 1, "each startup must extract the verified archive");
assert.equal(certificates, 1);
assert.equal(certificateReads, mode === "certificate-read" ? 1 : 0);
assert.equal(downloads, mode === "cold-certificate-command" ? 1 : 0, "warm archives must be reused");
assert.ok(!existsSync(root), "failed certificate setup must remove the extracted root");
assert.deepEqual((await fs.readdir(tmpdir())).sort(), ["unrelated-root", "waitron-cloud-test-binaries"]);
assert.deepEqual((await fs.readdir(cache)).sort(), [archiveName, "neighbour"].sort());
const archiveAfter = await fs.stat(archive);
if (archiveBefore) {
  assert.equal(archiveAfter.ino, archiveBefore.ino, "failed startup must preserve the cached archive");
  assert.equal(archiveAfter.mtimeMs, archiveBefore.mtimeMs);
  assert.equal(archiveAfter.mode, archiveBefore.mode);
} else assert.equal(archiveAfter.mode & 0o777, 0o600);
const neighbourAfter = await fs.stat(join(cache, "neighbour"));
assert.equal(neighbourAfter.ino, neighbourBefore.ino);
assert.equal(neighbourAfter.mtimeMs, neighbourBefore.mtimeMs);
assert.equal(await fs.readFile(join(cache, "neighbour"), "utf8"), "unrelated input");
assert.deepEqual(await fs.readFile(archive), bytes);
console.log(JSON.stringify({digest: createHash("sha256").update(await fs.readFile(archive)).digest("hex")}));
`;

// Omitting extraction, using the wrong directory, discarding cache reuse or
// retaining the extracted root must fail these controls before a store starts.
for (const mode of ["warm-certificate-command", "cold-certificate-command", "certificate-read"]) {
  test(`real storage extraction survives ${mode} refusal with owned cleanup`, { timeout: 30000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-extraction-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath,
      ["--input-type=module", "-e", probe, mode, seed, archiveName], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
        timeout: 25000, maxBuffer: 1024 * 1024,
      });
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), {digest});
  });
}
