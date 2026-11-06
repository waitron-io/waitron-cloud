import assert from "node:assert/strict";
import childProcess, { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";
import test from "node:test";
import { prepareStorageTarSeed } from "./fixtures/storage-tar-seed.mjs";
import { startBackupStorage } from "./backup-storage-fixture.mjs";

const execute = promisify(execFile);
async function claimsOwnedBy(root) {
  const directory = join("/tmp", "waitron-cloud-storage-ports-" + process.getuid());
  const owned = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const owner = await readlink(path).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (owner === root) owned.push(path);
  }
  return owned.sort();
}
const probe = `
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { errorMonitor } from "node:events";
import { chmodSync, unlinkSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const code = process.argv[1], spawn = childProcess.spawn, create = https.createServer;
let child, original, root, issuer, starts = 0;
childProcess.spawn = (binary, args, options) => {
  starts++;
  root = options.env.HOME;
  writeFileSync(join(tmpdir(), "owned-root"), root);
  if (code === "EACCES") chmodSync(binary, 0o600);
  else unlinkSync(binary);
  child = spawn(binary, args, options);
  // Observe the actual operating-system refusal without swallowing an unhandled
  // error on the fixture's behalf: the fixture must install its own listener.
  child.once(errorMonitor, error => { original = error; });
  return child;
};
https.createServer = (...args) => { issuer = create(...args); return issuer; };
syncBuiltinESMExports();
globalThis.fetch = () => assert.fail("startup must reuse the pinned archive");
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
const failure = await startBackupStorage().then(async storage => {
  await storage.stop();
  assert.fail("an unexecutable store must refuse startup");
}, error => error);
assert.equal(failure?.code, code);
assert.equal(failure, original, "cleanup must preserve the original spawn error object");
assert.equal(starts, 1, "a spawn refusal must not qualify for a port retry");
assert.equal(issuer.listening, false, "failed startup must close its identity listener");
await assert.rejects(fs.stat(root), { code: "ENOENT" });
const claims = join("/tmp", "waitron-cloud-storage-ports-" + process.getuid());
for (const entry of await fs.readdir(claims)) {
  const owner = await fs.readlink(join(claims, entry)).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
  assert.notEqual(owner, root, "failed startup must release every owned port claim");
}
assert.deepEqual((await fs.readdir(tmpdir())).sort(), ["owned-root", "waitron-cloud-test-binaries"]);
console.log(code + " cleanup complete");
`;

// Losing the native child's error listener must fail without terminating the
// test runner, and cleanup must leave an independently running store usable.
test("native spawn refusals clean up only the failed store and preserve a working peer", { timeout: 60000 }, async t => {
  const { seedRoot, seed, archiveName } = await prepareStorageTarSeed();
  t.after(() => rm(seedRoot, { recursive: true, force: true }));
  const spawn = childProcess.spawn;
  let peerChild;
  t.mock.method(childProcess, "spawn", (...args) => { peerChild = spawn(...args); return peerChild; });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const peerDirectory = await mkdtemp(join(tmpdir(), "cloud-storage-spawn-peer-"));
  let peer;
  t.after(async () => {
    await peer?.stop();
    await rm(peerDirectory, { recursive: true, force: true });
  });
  const peerCache = join(peerDirectory, "waitron-cloud-test-binaries");
  await mkdir(peerCache);
  await writeFile(join(peerCache, archiveName), await readFile(seed), { mode: 0o444 });
  t.mock.method(globalThis, "fetch", () => assert.fail("the working peer must reuse the prepared pinned archive"));
  const previousTmpdir = process.env.TMPDIR;
  try {
    process.env.TMPDIR = peerDirectory;
    peer = await startBackupStorage();
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  }
  t.mock.method(peerChild._handle, "kill", () => -1, { times: 1 });
  assert.throws(() => peerChild.kill("SIGHUP"), { code: "EPERM" }, "startup-only handling must not swallow later signal refusals");
  const peerBinary = await readFile(join(peer.root, "weed"));
  const peerClaims = await claimsOwnedBy(peer.root);
  assert.equal(peerClaims.length, 8, "the working peer must own its complete port allocation");
  for (const code of ["EACCES", "ENOENT"]) {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-spawn-refusal-"));
    t.after(async () => {
      const root = await readFile(join(directory, "owned-root"), "utf8").catch(() => null);
      const claims = join("/tmp", "waitron-cloud-storage-ports-" + process.getuid());
      for (const entry of await readdir(claims)) {
        const path = join(claims, entry);
        try { if (root && await readlink(path) === root) await unlink(path); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      await rm(directory, { recursive: true, force: true });
    });
    const cache = join(directory, "waitron-cloud-test-binaries");
    await mkdir(cache);
    const bytes = await readFile(seed);
    await writeFile(join(cache, archiveName), bytes, { mode: 0o444 });
    const { stdout } = await execute(process.execPath, ["--input-type=module", "-e", probe, code], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
      timeout: 20000,
    });
    assert.equal(stdout, code + " cleanup complete\n");
    assert.deepEqual(await readFile(join(cache, archiveName)), bytes);
    assert.deepEqual(await readFile(join(peer.root, "weed")), peerBinary);
    assert.deepEqual(await claimsOwnedBy(peer.root), peerClaims, "failed startup must preserve every working peer port claim");
    const bucket = await peer.bucket("peer-after-" + code.toLowerCase());
    assert.equal(bucket.endpoint, peer.endpoint, "the independent native peer must still serve S3 requests");
  }
});
