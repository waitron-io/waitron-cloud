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

before(async () => {
  const pin = pins[process.platform + "-" + process.arch];
  assert.ok(pin, "concurrent extraction needs a supported storage fixture platform");
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
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-concurrent-extraction-seed-"));
  seed = join(seedRoot, archiveName);
  await writeFile(seed, bytes, { flag: "wx", mode: 0o400 });
}, { timeout: 45000 });
after(async () => { if (seedRoot) await rm(seedRoot, { recursive: true, force: true }); });

const probe = `
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import childProcess from "node:child_process";
import net from "node:net";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const [firstIndex, seed, archiveName] = process.argv.slice(1);
const bytes = await fs.readFile(seed);
const cache = join(tmpdir(), "waitron-cloud-test-binaries"), archive = join(cache, archiveName);
await fs.mkdir(cache);
await fs.writeFile(archive, bytes, { mode: 0o444 });
await fs.writeFile(join(cache, "neighbour"), "unrelated cache input");
await fs.mkdir(join(tmpdir(), "unrelated-root"));
await fs.writeFile(join(tmpdir(), "unrelated-root", "keep"), "other fixture");
await fs.chmod(cache, 0o555);
// Reads may update access times; identity, permissions and modification times must stay unchanged.
const metadata = async path => {
  const { ino, mode, size, mtimeMs, ctimeMs } = await fs.stat(path);
  return { ino, mode, size, mtimeMs, ctimeMs };
};
const archiveBefore = await metadata(archive), cacheBefore = await metadata(cache);
const read = fs.readFile, allocate = fs.mkdtemp, command = childProcess.execFileSync;
const roots = [], reads = new Map(), entered = Promise.withResolvers();
let extractions = 0, certificates = 0;
fs.mkdtemp = async (...args) => {
  const index = roots.length;
  roots.push(null);
  const root = await allocate(...args);
  roots[index] = root;
  return root;
};
// Hold each fixture after real extraction and certificate generation so cleanup
// can be observed while the other fixture still owns its extracted files.
fs.readFile = async (path, ...args) => {
  const value = await read(path, ...args);
  if (roots.some(root => path === join(root, "cert.pem"))) {
    const root = dirname(path), release = Promise.withResolvers();
    const failure = Object.assign(new Error("controlled certificate read refusal"), { code: "EACCES", root });
    reads.set(root, { release, failure });
    if (reads.size === 2) entered.resolve();
    await release.promise;
    throw failure;
  }
  return value;
};
childProcess.execFileSync = (name, args, options) => {
  if (name === "tar") extractions++;
  else {
    assert.equal(name, "openssl", "only archive and certificate commands may run");
    certificates++;
  }
  return command(name, args, options);
};
childProcess.spawn = () => assert.fail("certificate read refusal must precede store startup");
net.createServer = https.createServer = () => assert.fail("certificate read refusal must precede listener allocation");
syncBuiltinESMExports();
globalThis.fetch = () => assert.fail("concurrent extraction must reuse the read-only archive");
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
const outcomes = [0, 1].map(() => startBackupStorage().then(async storage => {
  await storage.stop();
  assert.fail("certificate read refusal must reject startup");
}, error => error));
await Promise.race([entered.promise, ...outcomes.map(outcome => outcome.then(error => { throw error; }))]);
assert.equal(roots.length, 2);
assert.notEqual(roots[0], roots[1], "each fixture needs its own extraction directory");
assert.equal(extractions, 2);
assert.equal(certificates, 2);
const snapshots = new Map();
for (const root of roots) {
  const weed = await fs.stat(join(root, "weed")).catch(() => null);
  assert.ok(weed?.isFile() && weed.size > 1000000 && (weed.mode & 0o111), "each private root must contain the real extracted executable");
  assert.ok((await read(join(root, "cert.pem"), "utf8")).includes("-----BEGIN CERTIFICATE-----"));
  assert.ok((await read(join(root, "key.pem"), "utf8")).includes("PRIVATE KEY-----"));
  snapshots.set(root, {
    weed,
    cert: await read(join(root, "cert.pem")),
    key: await read(join(root, "key.pem")),
  });
}
const first = roots[Number(firstIndex)], second = roots[1 - Number(firstIndex)];
reads.get(first).release.resolve();
assert.equal(await outcomes[Number(firstIndex)], reads.get(first).failure, "the first refusal must retain its error identity");
await assert.rejects(fs.stat(first), { code: "ENOENT" }, "first failed startup must remove only its owned root");
const remaining = snapshots.get(second);
assert.deepEqual(await fs.stat(join(second, "weed")), remaining.weed, "first cleanup must preserve the other extracted executable");
assert.deepEqual(await read(join(second, "cert.pem")), remaining.cert);
assert.deepEqual(await read(join(second, "key.pem")), remaining.key);
assert.deepEqual(await metadata(archive), archiveBefore, "cleanup must preserve the shared read-only archive");
assert.deepEqual(await metadata(cache), cacheBefore);
assert.deepEqual((await fs.readdir(tmpdir())).sort(), [second.split("/").at(-1), "unrelated-root", "waitron-cloud-test-binaries"].sort());
reads.get(second).release.resolve();
assert.equal(await outcomes[1 - Number(firstIndex)], reads.get(second).failure, "the second refusal must retain its error identity");
assert.equal(roots.length, 2, "certificate read failures must never retry startup");
await assert.rejects(fs.stat(second), { code: "ENOENT" });
assert.deepEqual((await fs.readdir(tmpdir())).sort(), ["unrelated-root", "waitron-cloud-test-binaries"]);
assert.deepEqual((await fs.readdir(cache)).sort(), [archiveName, "neighbour"].sort());
assert.equal(await read(join(cache, "neighbour"), "utf8"), "unrelated cache input");
assert.equal(await read(join(tmpdir(), "unrelated-root", "keep"), "utf8"), "other fixture");
assert.deepEqual(await metadata(archive), archiveBefore);
assert.deepEqual(await metadata(cache), cacheBefore);
assert.deepEqual(await read(archive), bytes);
await fs.chmod(cache, 0o755);
console.log(JSON.stringify({ digest: createHash("sha256").update(await read(archive)).digest("hex") }));
`;

// Missing extraction, shared destinations, cache replacement or cleanup outside
// the owned root must break these controls in either failure order.
for (const first of [0, 1]) {
  test(`concurrent real storage extraction preserves the other root when fixture ${first + 1} fails first`, { timeout: 30000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-concurrent-extraction-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath,
      ["--input-type=module", "-e", probe, String(first), seed, archiveName], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
        timeout: 25000, maxBuffer: 1024 * 1024,
      });
    assert.equal(stderr, "");
    assert.deepEqual(JSON.parse(stdout), { digest });
  });
}
