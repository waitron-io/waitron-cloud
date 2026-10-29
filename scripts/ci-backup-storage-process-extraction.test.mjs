import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, after } from "node:test";

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
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-process-extraction-seed-"));
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
import { join } from "node:path";
const allocate = fs.mkdtemp, read = fs.readFile;
const refused = Object.assign(new Error("controlled certificate read refusal"), { code: "EACCES" });
let root, allocations = 0;
fs.mkdtemp = async (...args) => { allocations++; root = await allocate(...args); return root; };
// Pause after real extraction and certificate generation, before any listener or store.
fs.readFile = async (path, ...args) => {
  const value = await read(path, ...args);
  if (root && path === join(root, "cert.pem")) {
    const released = new Promise(resolve => process.once("message", resolve));
    process.send({ stage: "ready", root, pid: process.pid });
    assert.equal(await released, "refuse");
    throw refused;
  }
  return value;
};
childProcess.spawn = () => assert.fail("certificate read refusal must precede store startup");
net.createServer = https.createServer = () => assert.fail("certificate read refusal must precede listener allocation");
syncBuiltinESMExports();
globalThis.fetch = () => assert.fail("both processes must reuse the read-only pinned archive");
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
const failure = await startBackupStorage().then(async storage => {
  await storage.stop();
  assert.fail("certificate refusal must reject startup");
}, error => error);
assert.equal(failure, refused, "startup must preserve the original refusal");
assert.equal(allocations, 1, "a certificate read refusal must never retry startup");
await assert.rejects(fs.stat(root), { code: "ENOENT" }, "failed startup must remove its private extracted root");
process.send({ stage: "done", root });
process.disconnect();
`;

function startProbe(directory) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const messages = new Map(), waiting = new Map();
  let stdout = "", stderr = "", failure;
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  function rejectWaiters(error) {
    failure = error;
    for (const waiter of waiting.values()) waiter.reject(error);
    waiting.clear();
  }
  child.on("error", rejectWaiters);
  child.on("message", message => {
    messages.set(message.stage, message);
    waiting.get(message.stage)?.resolve(message);
    waiting.delete(message.stage);
  });
  const closed = new Promise(resolve => child.once("close", (code, signal) => {
    rejectWaiters(new Error(`storage probe exited (${code}, ${signal}): ${stderr}`));
    resolve({ code, signal, stdout, stderr });
  }));
  return {
    child, closed,
    wait(stage) {
      if (messages.has(stage)) return Promise.resolve(messages.get(stage));
      if (failure) return Promise.reject(failure);
      const waiter = Promise.withResolvers();
      waiting.set(stage, waiter);
      return waiter.promise;
    },
  };
}

async function metadata(path) {
  // Reads may change access times; cache identity, permissions and writes must stay unchanged.
  const { ino, mode, size, mtimeMs, ctimeMs } = await stat(path);
  return { ino, mode, size, mtimeMs, ctimeMs };
}

// Skipped extraction, shared destinations, lost cache reuse or cleanup of another
// process's root must fail before either process can start a store.
for (const first of [0, 1]) {
  test(`separate storage processes preserve the other extraction when process ${first + 1} fails first`, { timeout: 30000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-process-extraction-"));
    const cache = join(directory, "waitron-cloud-test-binaries");
    const archive = join(cache, archiveName), children = [];
    t.after(async () => {
      for (const { child } of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
      await Promise.all(children.map(child => child.closed));
      await chmod(cache, 0o755).catch(error => { if (error.code !== "ENOENT") throw error; });
      await rm(directory, { recursive: true, force: true });
    });
    await mkdir(cache);
    await writeFile(archive, await readFile(seed), { flag: "wx", mode: 0o444 });
    await writeFile(join(cache, "neighbour"), "unrelated cache input");
    await mkdir(join(directory, "unrelated-root"));
    await writeFile(join(directory, "unrelated-root", "keep"), "other fixture");
    await chmod(cache, 0o555);
    const before = { archive: await metadata(archive), cache: await metadata(cache) };
    children.push(startProbe(directory), startProbe(directory));
    const ready = await Promise.all(children.map(child => child.wait("ready")));
    assert.notEqual(ready[0].pid, ready[1].pid, "the extractors must be independent processes");
    assert.notEqual(ready[0].root, ready[1].root, "each process needs a private extraction root");
    const snapshots = [];
    for (const { root } of ready) {
      const weed = await stat(join(root, "weed")).catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      assert.ok(weed?.isFile() && weed.size > 1000000 && (weed.mode & 0o111), "each process must extract a real executable into its own root");
      const cert = await readFile(join(root, "cert.pem")), key = await readFile(join(root, "key.pem"));
      assert.ok(cert.toString().includes("-----BEGIN CERTIFICATE-----"));
      assert.ok(key.toString().includes("PRIVATE KEY-----"));
      snapshots.push({ weed: await metadata(join(root, "weed")), cert, key });
    }
    children[first].child.send("refuse");
    await children[first].wait("done");
    assert.deepEqual(await children[first].closed, { code: 0, signal: null, stdout: "", stderr: "" });
    await assert.rejects(stat(ready[first].root), { code: "ENOENT" });
    const second = 1 - first, remaining = ready[second].root;
    assert.equal(children[second].child.exitCode, null, "the other process must remain paused during the first cleanup");
    assert.deepEqual(await metadata(join(remaining, "weed")), snapshots[second].weed);
    assert.deepEqual(await readFile(join(remaining, "cert.pem")), snapshots[second].cert);
    assert.deepEqual(await readFile(join(remaining, "key.pem")), snapshots[second].key);
    assert.deepEqual(await metadata(archive), before.archive);
    assert.deepEqual(await metadata(cache), before.cache);
    assert.deepEqual((await readdir(directory)).sort(), [remaining.split("/").at(-1), "unrelated-root", "waitron-cloud-test-binaries"].sort());
    children[second].child.send("refuse");
    await children[second].wait("done");
    assert.deepEqual(await children[second].closed, { code: 0, signal: null, stdout: "", stderr: "" });
    await assert.rejects(stat(remaining), { code: "ENOENT" });
    assert.deepEqual((await readdir(directory)).sort(), ["unrelated-root", "waitron-cloud-test-binaries"]);
    assert.deepEqual((await readdir(cache)).sort(), [archiveName, "neighbour"].sort());
    assert.equal(await readFile(join(cache, "neighbour"), "utf8"), "unrelated cache input");
    assert.equal(await readFile(join(directory, "unrelated-root", "keep"), "utf8"), "other fixture");
    assert.deepEqual(await metadata(archive), before.archive);
    assert.deepEqual(await metadata(cache), before.cache);
    assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"), digest);
  });
}
