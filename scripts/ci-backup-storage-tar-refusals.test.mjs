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
  assert.ok(pin, "tar refusal checks need a supported storage fixture platform");
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
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-tar-seed-"));
  seed = join(seedRoot, archiveName);
  await writeFile(seed, bytes, { flag: "wx", mode: 0o400 });
}, { timeout: 45000 });
after(async () => { if (seedRoot) await rm(seedRoot, { recursive: true, force: true }); });

const probe = `
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import childProcess from "node:child_process";
import net from "node:net";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [mode, seed, archiveName] = process.argv.slice(1);
const bytes = await fs.readFile(seed), cold = mode === "cold-obstructed";
const cache = join(tmpdir(), "waitron-cloud-test-binaries"), archive = join(cache, archiveName);
await fs.mkdir(cache);
await fs.mkdir(join(tmpdir(), "unrelated-root"));
await fs.writeFile(join(tmpdir(), "unrelated-root", "keep"), "unrelated state");
await fs.writeFile(join(cache, "neighbour"), "unrelated input");
if (!cold) await fs.writeFile(archive, bytes, {mode: 0o444});
const before = cold ? null : await fs.stat(archive);
const neighbourBefore = await fs.stat(join(cache, "neighbour"));
const allocate = fs.mkdtemp, command = childProcess.execFileSync;
let root, original, allocations = 0, downloads = 0, extractions = 0;
fs.mkdtemp = async (...args) => { allocations++; root = await allocate(...args); return root; };
childProcess.execFileSync = (name, args, options) => {
  assert.equal(name, "tar", "a tar refusal must prevent certificate commands");
  extractions++;
  assert.deepEqual(args, ["-xzf", archive, "-C", root]);
  assert.deepEqual(readFileSync(archive), bytes, "tar must receive complete verified bytes");
  // A nonempty directory cannot be replaced by the archive's weed executable.
  // Keep every deliberately obstructed path inside this child's private root.
  if (mode !== "missing-tar") {
    mkdirSync(join(root, "weed"));
    mkdirSync(join(root, "weed", "obstruction"));
  }
  try {
    return command(mode === "missing-tar" ? join(root, "unavailable-tar") : name, args,
      {...options, stdio: ["ignore", "pipe", "pipe"]});
  } catch (error) {
    original = error;
    if (mode === "missing-tar") assert.equal(error.code, "ENOENT");
    else {
      assert.equal(error.signal, null, "real tar must exit rather than be killed");
      assert.ok(Number.isInteger(error.status) && error.status > 0, "the real extractor must refuse");
      assert.ok(error.stderr.length > 0, "the real extractor must supply its refusal");
    }
    throw error;
  }
};
childProcess.spawn = () => assert.fail("tar refusal must precede store startup");
net.createServer = https.createServer = () => assert.fail("tar refusal must precede listener allocation");
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
assert.ok(original, "the command must actually refuse");
assert.equal(failure, original, "extraction must preserve the original command error");
assert.equal(failure.storageDownload, undefined);
assert.equal(failure.storageStartup, undefined);
assert.equal(allocations, 1, "extraction refusal must never retry startup");
assert.equal(extractions, 1);
assert.equal(downloads, cold ? 1 : 0);
assert.ok(!existsSync(root), "failed extraction must remove all of its private root");
assert.deepEqual((await fs.readdir(tmpdir())).sort(), ["unrelated-root", "waitron-cloud-test-binaries"]);
assert.equal(await fs.readFile(join(tmpdir(), "unrelated-root", "keep"), "utf8"), "unrelated state");
assert.deepEqual((await fs.readdir(cache)).sort(), [archiveName, "neighbour"].sort());
const current = await fs.stat(archive);
if (before) {
  assert.equal(current.ino, before.ino, "extraction failure must preserve its cached input");
  assert.equal(current.mtimeMs, before.mtimeMs);
  assert.equal(current.mode, before.mode);
} else assert.equal(current.mode & 0o777, 0o600);
const neighbourAfter = await fs.stat(join(cache, "neighbour"));
assert.equal(neighbourAfter.ino, neighbourBefore.ino);
assert.equal(neighbourAfter.mtimeMs, neighbourBefore.mtimeMs);
assert.equal(await fs.readFile(join(cache, "neighbour"), "utf8"), "unrelated input");
assert.deepEqual(await fs.readFile(archive), bytes);
console.log(JSON.stringify({allocations, downloads, extractions, realCommandRefused: true}));
`;

for (const mode of ["warm-obstructed", "cold-obstructed", "missing-tar"]) {
  test(`storage extraction ${mode} preserves its real command refusal and cleans only owned files`, { timeout: 30000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-tar-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath,
      ["--input-type=module", "-e", probe, mode, seed, archiveName], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
        timeout: 25000, maxBuffer: 1024 * 1024,
      });
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), {
      allocations: 1, downloads: mode === "cold-obstructed" ? 1 : 0, extractions: 1, realCommandRefused: true,
    });
  });
}
