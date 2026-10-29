import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
// Child isolation keeps fault injection and every cache path private to this probe.
const probe = `
import fs from "node:fs/promises";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mode = process.argv[1];
const cache = join(tmpdir(), "waitron-cloud-test-binaries");
await fs.mkdir(cache);
await fs.writeFile(join(cache, "neighbour"), "unrelated cache input");
await fs.mkdir(join(tmpdir(), "unrelated-root"));
const before = await fs.stat(join(cache, "neighbour"));
const code = mode === "allocation" ? "ENOSPC" : mode === "cache-directory" || mode === "archive-permission" ? "EACCES" : "EIO";
const original = Object.assign(new Error(mode === "port-shaped" ?
  "SeaweedFS exited: Port allocation failed: port 43123 is not available on 127.0.0.1 and cannot be used" :
  "controlled filesystem refusal"), { code });
let allocations = 0, cacheDirectories = 0, archiveReads = 0, downloads = 0, commands = 0;
const allocate = fs.mkdtemp, mkdir = fs.mkdir, read = fs.readFile;
fs.mkdtemp = (...args) => {
  allocations++;
  if (mode === "allocation") return Promise.reject(original);
  return allocate(...args);
};
fs.mkdir = (path, ...args) => {
  if (path === cache) {
    cacheDirectories++;
    if (mode === "cache-directory") return Promise.reject(original);
  }
  return mkdir(path, ...args);
};
fs.readFile = (path, ...args) => {
  if (String(path).startsWith(join(cache, "seaweed-4.47-"))) {
    archiveReads++;
    return Promise.reject(original);
  }
  return read(path, ...args);
};
childProcess.execFileSync = () => { commands++; throw Error("unexpected external command"); };
syncBuiltinESMExports();
globalThis.fetch = async () => { downloads++; throw Error("unexpected archive request"); };
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
let failure;
try {
  const storage = await startBackupStorage();
  await storage.stop();
} catch (error) { failure = error; }
const after = await fs.stat(join(cache, "neighbour"));
console.log(JSON.stringify({
  originalFailure: failure === original, code: failure?.code ?? null,
  downloadDiagnostic: failure?.storageDownload ?? null,
  startupDiagnostic: failure?.storageStartup ?? null,
  allocations, cacheDirectories, archiveReads, downloads, commands,
  unchangedNeighbour: before.ino === after.ino && before.mtimeMs === after.mtimeMs,
  neighbour: await fs.readFile(join(cache, "neighbour"), "utf8"),
  entries: (await fs.readdir(tmpdir())).sort(),
  cacheEntries: await fs.readdir(cache)
}));
`;

// Swallowing a non-ENOENT read error, skipping cleanup or retrying an unallocated
// port-shaped refusal must fail these controls without starting an external store.
for (const [mode, code, directories, reads] of [
  ["allocation", "ENOSPC", 0, 0],
  ["cache-directory", "EACCES", 1, 0],
  ["archive-permission", "EACCES", 1, 1],
  ["archive-io", "EIO", 1, 1],
  ["port-shaped", "EIO", 1, 1],
]) {
  test(`storage ${mode} refusal preserves the original error and unrelated files`, { timeout: 20000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-filesystem-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath,
      ["--input-type=module", "-e", probe, mode], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
        timeout: 15000, maxBuffer: 1024 * 1024,
      });
    const result = JSON.parse(stdout);
    assert.equal(result.originalFailure, true, "filesystem refusal must retain the original error object");
    assert.equal(result.code, code);
    assert.equal(result.allocations, 1, "a filesystem refusal must not retry startup");
    assert.equal(result.cacheDirectories, directories);
    assert.equal(result.archiveReads, reads);
    assert.equal(result.downloads, 0, "only a missing archive may request a download");
    assert.equal(result.commands, 0, "filesystem refusal must precede extraction and process startup");
    assert.equal(result.downloadDiagnostic, null);
    assert.equal(result.startupDiagnostic, null);
    assert.deepEqual(result.entries, ["unrelated-root", "waitron-cloud-test-binaries"], "failed startup must remove only its own private directory");
    assert.deepEqual(result.cacheEntries, ["neighbour"]);
    assert.equal(result.neighbour, "unrelated cache input");
    assert.equal(result.unchangedNeighbour, true);
    assert.equal(stderr, "");
  });
}
