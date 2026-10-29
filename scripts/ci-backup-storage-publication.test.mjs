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

// Reuse a real pinned archive read-only, or fetch it once. Digest validation stays real.
before(async () => {
  const pin = pins[process.platform + "-" + process.arch];
  assert.ok(pin, "publication checks need a supported storage fixture platform");
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
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-publication-seed-"));
  seed = join(seedRoot, archiveName);
  await writeFile(seed, bytes, { flag: "wx", mode: 0o400 });
}, { timeout: 45000 });
after(async () => { if (seedRoot) await rm(seedRoot, { recursive: true, force: true }); });

// Each child owns its cache and fault injection; no shared file is modified.
const probe = `
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [mode, seed, archiveName] = process.argv.slice(1);
const bytes = await fs.readFile(seed);
const cache = join(tmpdir(), "waitron-cloud-test-binaries");
const archive = join(cache, archiveName);
await fs.mkdir(cache);
await fs.writeFile(join(cache, "neighbour"), "unrelated cache input");
await fs.mkdir(join(tmpdir(), "unrelated-root"));
const neighbourBefore = await fs.stat(join(cache, "neighbour"));
const original = Object.assign(new Error("controlled publication refusal"), {
  code: mode === "partial-write" ? "ENOSPC" : "EACCES"
});
const extractionFailure = new Error("controlled extraction refusal");
const write = fs.writeFile, rename = fs.rename;
let fetches = 0, writes = 0, renames = 0, commands = 0;
let temporary, temporaryMode, partialBytes, competitorBefore;
fs.writeFile = async (path, data, options) => {
  if (!String(path).startsWith(archive)) return write(path, data, options);
  writes++;
  temporary = String(path);
  if (mode === "partial-write") {
    await write(path, data.subarray(0, 23), options);
    partialBytes = (await fs.stat(path)).size;
    throw original;
  }
  return write(path, data, options);
};
fs.rename = async (from, to) => {
  renames++;
  assert.equal(String(from), temporary);
  assert.equal(String(to), archive);
  temporaryMode = (await fs.stat(from)).mode & 0o777;
  assert.deepEqual(await fs.readFile(from), bytes, "the temporary archive must be complete");
  assert.equal(await fs.stat(archive).then(() => true, error => {
    if (error.code !== "ENOENT") throw error;
    return false;
  }), false, "the final cache path must stay absent until publication");
  if (mode === "competing-rename") {
    await write(archive, bytes, {flag: "wx", mode: 0o444});
    competitorBefore = await fs.stat(archive);
  }
  if (mode !== "published") throw original;
  return rename(from, to);
};
childProcess.execFileSync = (command, args) => {
  commands++;
  assert.equal(command, "tar");
  assert.equal(args[1], archive);
  assert.deepEqual(readFileSync(archive), bytes, "extraction must see the complete published archive");
  throw extractionFailure;
};
syncBuiltinESMExports();
globalThis.fetch = async url => {
  fetches++;
  assert.equal(url, "https://github.com/seaweedfs/seaweedfs/releases/download/4.47/" + archiveName.slice("seaweed-4.47-".length));
  return new Response(bytes);
};
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
let failure;
try {
  const storage = await startBackupStorage();
  await storage.stop();
} catch (error) { failure = error; }
const neighbourAfter = await fs.stat(join(cache, "neighbour"));
const published = await fs.readFile(archive).catch(error => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
const competitorAfter = competitorBefore ? await fs.stat(archive) : null;
console.log(JSON.stringify({
  originalFailure: failure === original, extractionFailure: failure === extractionFailure,
  code: failure?.code ?? null, diagnostic: failure?.storageDownload ?? null,
  fetches, writes, renames, commands, temporaryMode, partialBytes,
  temporaryIsSeparate: temporary !== archive && temporary.startsWith(archive + "."),
  publishedDigest: published ? createHash("sha256").update(published).digest("hex") : null,
  competitorPreserved: competitorBefore ? competitorBefore.ino === competitorAfter.ino &&
    competitorBefore.mtimeMs === competitorAfter.mtimeMs && competitorAfter.mode === competitorBefore.mode : null,
  neighbourPreserved: neighbourBefore.ino === neighbourAfter.ino && neighbourBefore.mtimeMs === neighbourAfter.mtimeMs,
  neighbour: await fs.readFile(join(cache, "neighbour"), "utf8"),
  cacheEntries: (await fs.readdir(cache)).sort(), entries: (await fs.readdir(tmpdir())).sort()
}));
`;

// Missing finally-cleanup, publishing directly, or deleting a competing final archive
// must fail these disk assertions even though the store itself never starts.
for (const mode of ["partial-write", "rename", "competing-rename", "published"]) {
  test(`storage archive ${mode} preserves publication and cleanup boundaries`, { timeout: 20000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-publication-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath,
      ["--input-type=module", "-e", probe, mode, seed, archiveName], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
        timeout: 15000, maxBuffer: 1024 * 1024,
      });
    const result = JSON.parse(stdout);
    assert.equal(stderr, "");
    assert.equal(result.originalFailure, mode !== "published", "publication errors retain their identity");
    assert.equal(result.extractionFailure, mode === "published");
    assert.equal(result.code, mode === "published" ? null : mode === "partial-write" ? "ENOSPC" : "EACCES");
    assert.equal(result.diagnostic, null, "filesystem failures must not impersonate downloads");
    assert.equal(result.fetches, 1, "publication refusal must not retry startup");
    assert.equal(result.writes, 1);
    assert.equal(result.renames, mode === "partial-write" ? 0 : 1);
    assert.equal(result.commands, mode === "published" ? 1 : 0, "failed publication must never reach extraction");
    assert.equal(result.temporaryIsSeparate, true, "downloads must use a separate temporary cache path");
    if (mode === "partial-write") assert.equal(result.partialBytes, 23, "the failed write must leave real partial bytes for cleanup");
    else assert.equal(result.temporaryMode, 0o600);
    const hasArchive = mode === "competing-rename" || mode === "published";
    assert.equal(result.publishedDigest, hasArchive ? digest : null);
    assert.equal(result.competitorPreserved, mode === "competing-rename" ? true : null);
    assert.deepEqual(result.cacheEntries, hasArchive ? [archiveName, "neighbour"].sort() : ["neighbour"], "temporary publication files must be removed");
    assert.deepEqual(result.entries, ["unrelated-root", "waitron-cloud-test-binaries"], "failed startup must remove only its own root");
    assert.equal(result.neighbourPreserved, true);
    assert.equal(result.neighbour, "unrelated cache input");
  });
}
