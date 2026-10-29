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
  assert.ok(pin, "concurrent publication checks need a supported storage fixture platform");
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
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-concurrent-seed-"));
  seed = join(seedRoot, archiveName);
  await writeFile(seed, bytes, { flag: "wx", mode: 0o400 });
}, { timeout: 45000 });
after(async () => { if (seedRoot) await rm(seedRoot, { recursive: true, force: true }); });

// Pause real partial writes in a private cache to observe both publication orders.
const probe = `
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [firstText, seed, archiveName] = process.argv.slice(1);
const first = Number(firstText), second = 1 - first;
const bytes = await fs.readFile(seed);
const cache = join(tmpdir(), "waitron-cloud-test-binaries");
const archive = join(cache, archiveName);
await fs.mkdir(cache);
await fs.writeFile(join(cache, "neighbour"), "unrelated input");
await fs.mkdir(join(tmpdir(), "unrelated-root"));
const neighbourBefore = await fs.stat(join(cache, "neighbour"));
const write = fs.writeFile;
const slots = [];
let fetches = 0;
const roots = [], failures = [];
const gates = [Promise.withResolvers(), Promise.withResolvers()];
const ready = [Promise.withResolvers(), Promise.withResolvers()];
fs.writeFile = async (path, data, options) => {
  const index = slots.length;
  assert.ok(index < 2, "a warm reader must never publish another archive");
  slots.push(String(path));
  await write(path, data.subarray(0, 23), options);
  ready[index].resolve();
  await gates[index].promise;
  await write(path, data, {flag: "w"});
};
childProcess.execFileSync = (command, args) => {
  assert.equal(command, "tar", "the probe stops at extraction before launching a store");
  assert.deepEqual(args.slice(0, 3), ["-xzf", archive, "-C"]);
  assert.deepEqual(readFileSync(archive), bytes, "every extractor must see the complete pinned archive");
  assert.ok(!roots.includes(args[3]), "each startup must own a distinct extraction root");
  roots.push(args[3]);
  const error = new Error("controlled extraction refusal " + roots.length);
  failures.push(error);
  throw error;
};
syncBuiltinESMExports();
globalThis.fetch = async url => {
  fetches++;
  assert.equal(url, "https://github.com/seaweedfs/seaweedfs/releases/download/4.47/" + archiveName.slice("seaweed-4.47-".length));
  return new Response(bytes);
};
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
async function start() {
  try {
    const storage = await startBackupStorage();
    await storage.stop();
    assert.fail("the extraction boundary must refuse store startup");
  } catch (error) {
    assert.ok(failures.includes(error), "the extraction refusal must retain its identity");
  }
}
// Convert startup rejection to a barrier rejection so a broken publication fails promptly.
const starts = [start(), start()];
for (let i = 0; i < 2; i++) starts[i].catch(error => ready[i].reject(error));
await Promise.all(ready.map(item => item.promise));
assert.equal(new Set(slots).size, 2, "concurrent publishers need separate temporary paths");
for (const path of slots) {
  assert.ok(path.startsWith(archive + "."), "partial bytes must use a temporary path");
  assert.equal((await fs.stat(path)).size, 23);
  assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
}
await assert.rejects(fs.stat(archive), {code: "ENOENT"}, "partial downloads must not be visible at the final path");
gates[first].resolve();
// Slot assignment follows write arrival, independently of startup call order.
await Promise.race(starts);
assert.equal(roots.length, 1);
assert.deepEqual(await fs.readFile(archive), bytes);
assert.deepEqual((await fs.readdir(cache)).sort(), [archiveName, "neighbour", slots[second].split("/").at(-1)].sort());
const firstPublished = await fs.stat(archive);
await start();
assert.equal(fetches, 2, "the third startup must reuse the complete published cache");
assert.equal(roots.length, 2);
const readBack = await fs.stat(archive);
assert.equal(readBack.ino, firstPublished.ino, "a warm reader must not replace the published archive");
assert.equal(readBack.mtimeMs, firstPublished.mtimeMs);
assert.equal((await fs.stat(slots[second])).size, 23, "reader cleanup must preserve the other writer's temporary file");
gates[second].resolve();
await Promise.all(starts);
assert.equal(roots.length, 3);
assert.deepEqual(await fs.readFile(archive), bytes, "the second publication must also be complete");
assert.equal((await fs.stat(archive)).mode & 0o777, 0o600);
assert.deepEqual((await fs.readdir(cache)).sort(), [archiveName, "neighbour"].sort(), "publishers must leave no temporary files");
assert.deepEqual((await fs.readdir(tmpdir())).sort(), ["unrelated-root", "waitron-cloud-test-binaries"], "failed startups must clean only their own roots");
const neighbourAfter = await fs.stat(join(cache, "neighbour"));
assert.equal(neighbourAfter.ino, neighbourBefore.ino);
assert.equal(neighbourAfter.mtimeMs, neighbourBefore.mtimeMs);
assert.equal(await fs.readFile(join(cache, "neighbour"), "utf8"), "unrelated input");
console.log(JSON.stringify({fetches, extractions: roots.length, digest: createHash("sha256").update(await fs.readFile(archive)).digest("hex")}));
`;

for (const first of [0, 1]) {
  test(`concurrent storage publisher ${first + 1} completes before its peer and serves a warm reader`, { timeout: 20000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-concurrent-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath,
      ["--input-type=module", "-e", probe, String(first), seed, archiveName], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
        timeout: 15000, maxBuffer: 1024 * 1024,
      });
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), { fetches: 2, extractions: 3, digest });
  });
}
