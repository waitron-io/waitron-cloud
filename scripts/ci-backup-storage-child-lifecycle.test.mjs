import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import test, { before, after } from "node:test";
import { releaseStorageControlClaims } from "../deploy/test-cloud/storage-admin-control-cleanup.mjs";
import { startBackupStorage } from "./backup-storage-fixture.mjs";
import { prepareStorageTarSeed } from "./fixtures/storage-tar-seed.mjs";

const execute = promisify(execFile);

let seedRoot, seed, archiveName;
before(async () => {
  ({ seedRoot, seed, archiveName } = await prepareStorageTarSeed());
}, { timeout: 45000 });
after(async () => { if (seedRoot) await rm(seedRoot, {recursive: true, force: true}); });

const deathProbe = `
import childProcess from "node:child_process";
import {renameSync, writeFileSync} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const [marker, paused] = process.argv.slice(1), spawn = childProcess.spawn;
childProcess.spawn = (bin, args, options) => {
  const native = paused === "true"
    ? spawn("sh", ["-c", 'kill -STOP $$; exec "$@"', "sh", bin, ...args], options)
    : spawn(bin, ["-v=1", ...args], options);
  writeFileSync(marker + ".tmp", JSON.stringify({
    pid: native.pid, root: options.env.HOME,
    port: args.find(arg => arg.startsWith("-s3.port=")).split("=")[1],
  }));
  renameSync(marker + ".tmp", marker);
  return native;
};
syncBuiltinESMExports();
const {startBackupStorage} = await import("./scripts/backup-storage-fixture.mjs");
await startBackupStorage();
writeFileSync(marker + ".ready", "");
`;

async function processState(pid) {
  try { return (await execute("ps", ["-ww", "-o", "stat=,args=", "-p", String(pid)], {env:{LC_ALL:"C.UTF-8"}})).stdout.trim(); }
  catch (error) { if (error.code === 1 && !error.stderr) return ""; throw error; }
}

async function eventually(check, message, timeout = 8000) {
  const end = Date.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await delay(50);
  } while (Date.now() < end);
  assert.fail(message);
}

async function exists(path) {
  try { await access(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

for (const paused of [false, true]) test(
  paused ? "a killed fixture prevents a paused launch from starting storage" :
    "SIGKILL of a ready fixture removes its native store and port claim",
  {timeout:60000}, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-death-test-café-"));
    const cache = join(directory, "waitron-cloud-test-binaries"), marker = join(directory, "child.json");
    let native, driver;
    const alive = async () => {
      const row = await processState(native.pid);
      return /^[^Z]/.test(row) && row.includes(join(native.root, "weed"));
    };
    t.after(async () => {
      if (driver?.exitCode === null && driver.signalCode === null) {
        const exited = once(driver, "exit");
        driver.kill("SIGKILL");
        await exited;
      }
      if (native) {
        if (await alive()) process.kill(native.pid, "SIGKILL");
        await eventually(async () => !await alive(), "the owned native process must exit");
        await releaseStorageControlClaims([native.root]);
      }
      await rm(directory, {recursive:true, force:true});
    });
    const peer = paused ? null : startBackupStorage();
    if (peer) {
      peer.catch(() => {});
      t.after(async () => (await peer).stop());
    }
    await mkdir(cache);
    await copyFile(seed, join(cache, archiveName));
    driver = spawn(process.execPath, ["--input-type=module", "-e", deathProbe, marker, String(paused)], {
      cwd: new URL("..", import.meta.url),
      env: {...process.env, TMPDIR:directory, TMP:directory, TEMP:directory}, stdio:"ignore",
    });
    native = await eventually(async () => {
      if (await exists(marker)) return JSON.parse(await readFile(marker, "utf8"));
    }, "the fixture must start its owned child", 40000);
    if (!paused) await eventually(() => exists(marker + ".ready"), "storage must answer S3 before SIGKILL", 40000);
    if (paused) await eventually(async () => (await processState(native.pid)).split(/\s/, 1)[0].includes("T"), "launcher must be paused");
    const claim = join("/tmp", "waitron-cloud-storage-ports-" + process.getuid(), native.port);
    assert.equal(await readlink(claim), native.root);
    const survivingStore = await peer;
    const exited = once(driver, "exit");
    driver.kill("SIGKILL");
    assert.deepEqual(await exited, [null, "SIGKILL"]);
    if (paused) {
      await eventually(async () => !await exists(join(native.root, "weed")), "parent death must revoke the pending executable");
      assert.ok(await exists(native.root), "revoke the pending executable before removing the fixture root");
      process.kill(native.pid, "SIGCONT");
    }
    await eventually(async () => !await alive(), "the native child must stop after parent death");
    await eventually(async () => !await exists(native.root), "parent death must remove the fixture root");
    await assert.rejects(readlink(claim), {code:"ENOENT"});
    if (survivingStore) assert.equal((await survivingStore.bucket("peer-survives")).bucket, "peer-survives");
  });
