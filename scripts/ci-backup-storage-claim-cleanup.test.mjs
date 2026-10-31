import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import { unlinkSync, symlinkSync } from "node:fs";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

for (const fault of ["missing", "replaced", "unlink-refused"]) test(`storage ${fault} claim preserves the startup error and finishes owned cleanup`, { timeout: 30000 }, async t => {
  const original = Error("controlled spawn refusal");
  const denied = Object.assign(Error("controlled claim unlink refusal"), { code: "EACCES" });
  const foreign = await fs.mkdtemp(join(tmpdir(), "storage-claim-neighbour-"));
  const create = https.createServer, unlink = fs.unlink, open = fs.open;
  const directory = join("/tmp", "waitron-cloud-storage-ports-" + process.getuid());
  let issuer, root, claim, log;
  const claims = [];
  t.after(async () => {
    if (issuer?.listening) await new Promise(resolve => issuer.close(resolve));
    await log?.close();
    for (const path of claims) {
      try { if ([root, foreign].includes(await fs.readlink(path))) await unlink(path); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
    await fs.rm(foreign, { recursive: true, force: true });
    t.mock.restoreAll(); syncBuiltinESMExports();
  });
  t.mock.method(https, "createServer", (...args) => { issuer = create(...args); return issuer; });
  t.mock.method(fs, "open", async (path, ...args) => {
    const handle = await open(path, ...args);
    if (String(path).endsWith("/store.log")) log = handle;
    return handle;
  });
  t.mock.method(fs, "unlink", path => fault === "unlink-refused" && path === claim ? Promise.reject(denied) : unlink(path));
  t.mock.method(childProcess, "spawn", (_binary, args, options) => {
    root = options.env.HOME;
    for (const arg of args) if (/^-(s3|master|volume|filer)\.port(?:\.grpc)?=/.test(arg)) claims.push(join(directory, arg.split("=")[1]));
    claim = claims[0];
    if (fault !== "unlink-refused") unlinkSync(claim);
    if (fault === "replaced") symlinkSync(foreign, claim);
    throw original;
  });
  t.mock.method(console, "error", () => {});
  syncBuiltinESMExports();
  const { startBackupStorage } = await import("./backup-storage-fixture.mjs");
  await assert.rejects(startBackupStorage(), error => error === original, "claim cleanup must retain the original startup error object");
  assert.equal(issuer.listening, false, "claim refusal must not leave the owned HTTPS server open");
  await assert.rejects(fs.access(root), { code: "ENOENT" });
  for (const path of claims) {
    if (path === claim && fault === "replaced") assert.equal(await fs.readlink(path), foreign, "cleanup must preserve a replacement claim owned by a different fixture");
    else if (path === claim && fault === "unlink-refused") assert.equal(await fs.readlink(path), root);
    else await assert.rejects(fs.readlink(path), { code: "ENOENT" });
  }
});

for (const mode of ["permissive", "symlink", "regular-file", "wrong-owner"]) test(`storage refuses a ${mode} claim directory before selecting ports`, { timeout: 30000 }, async t => {
  const privateRoot = await fs.mkdtemp(join(tmpdir(), "storage-claim-directory-"));
  const directory = join("/tmp", "waitron-cloud-storage-ports-" + process.getuid());
  const create = https.createServer, allocate = fs.mkdtemp, stat = fs.lstat;
  const target = join(privateRoot, "claims");
  if (mode === "regular-file") await fs.writeFile(target, "owned metadata control", { mode: 0o700 });
  else await fs.mkdir(target, { mode: mode === "permissive" ? 0o777 : 0o700 });
  if (mode === "permissive") await fs.chmod(target, 0o777);
  const alias = join(privateRoot, "alias");
  await fs.symlink(target, alias);
  let issuer, root, spawns = 0;
  t.after(async () => {
    if (issuer?.listening) await new Promise(resolve => issuer.close(resolve));
    if (root) await fs.rm(root, { recursive: true, force: true });
    await fs.rm(privateRoot, { recursive: true, force: true });
    t.mock.restoreAll(); syncBuiltinESMExports();
  });
  t.mock.method(https, "createServer", (...args) => { issuer = create(...args); return issuer; });
  t.mock.method(fs, "mkdtemp", async (...args) => { root = await allocate(...args); return root; });
  t.mock.method(fs, "lstat", async path => {
    if (path !== directory) return stat(path);
    const result = await stat(mode === "symlink" ? alias : target);
    return mode === "wrong-owner" ? Object.assign(result, { uid: process.getuid() + 1 }) : result;
  });
  t.mock.method(childProcess, "spawn", () => { spawns++; throw Error("unsafe directory reached native spawn"); });
  syncBuiltinESMExports();
  const { startBackupStorage } = await import("./backup-storage-fixture.mjs");
  await assert.rejects(startBackupStorage(), /Storage port claim directory must be private and owned by this user/);
  assert.equal(spawns, 0);
  assert.equal(issuer.listening, false);
  await assert.rejects(fs.access(root), { code: "ENOENT" });
});
