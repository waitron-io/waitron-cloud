import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
// A separate process gives each probe its own cache without changing a shared archive.
const probe = `
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const mode = process.argv[1];
const names = {"darwin-arm64":"darwin_arm64", "linux-arm64":"linux_arm64", "linux-x64":"linux_amd64"};
const name = names[process.platform + "-" + process.arch];
assert.ok(name, "the probe needs a supported fixture platform");
const cache = join(tmpdir(), "waitron-cloud-test-binaries");
const archiveName = "seaweed-4.47-" + name + ".tar.gz";
const archive = join(cache, archiveName);
const bytes = mode === "empty" ? Buffer.alloc(0) : Buffer.from("corrupt cached archive");
if (mode === "cache-file") await writeFile(cache, "existing cache path");
else {
  await mkdir(cache);
  await writeFile(join(cache, "neighbour"), "unrelated input");
  if (mode === "directory") {
    await mkdir(archive);
    await writeFile(join(archive, "retained"), "existing directory");
  } else await writeFile(archive, bytes, {mode: 0o444});
}
const before = await stat(mode === "cache-file" ? cache : archive);
let fetches = 0, extractions = 0;
globalThis.fetch = async () => { fetches++; throw Error("unexpected network request"); };
childProcess.execFileSync = () => { extractions++; throw Error("unexpected extraction"); };
syncBuiltinESMExports();
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
let failure;
try {
  const storage = await startBackupStorage();
  await storage.stop();
} catch (error) { failure = error; }
assert.ok(failure, "invalid existing cache must refuse startup");
const after = await stat(mode === "cache-file" ? cache : archive);
const unchangedIdentity = before.ino === after.ino && before.mtimeMs === after.mtimeMs;
let content;
if (mode === "cache-file") content = await readFile(cache, "utf8");
else if (mode === "directory") content = await readFile(join(archive, "retained"), "utf8");
else content = (await readFile(archive)).toString("hex");
console.log(JSON.stringify({
  message: failure.message, code: failure.code ?? null,
  diagnostic: failure.storageDownload ?? null, fetches, extractions,
  unchangedIdentity, content,
  entries: mode === "cache-file" ? null : (await readdir(cache)).sort(), archiveName,
  neighbour: mode === "cache-file" ? null : await readFile(join(cache, "neighbour"), "utf8"),
  roots: (await readdir(tmpdir())).filter(name => name.startsWith("cloud-backup-storage-"))
}));
`;

async function runProbe(t, mode) {
  const directory = await mkdtemp(join(tmpdir(), "cloud-storage-cache-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout, stderr } = await execute(process.execPath,
    ["--input-type=module", "-e", probe, mode], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
      timeout: 15000, maxBuffer: 1024 * 1024,
    });
  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.fetches, 0, "only a missing archive may start a download");
  assert.equal(result.extractions, 0, "invalid cache input must never reach extraction");
  assert.equal(result.diagnostic, null, "cache failures must not impersonate transport failures");
  assert.equal(result.unchangedIdentity, true, "startup must preserve the existing cache input");
  assert.deepEqual(result.roots, [], "failed startup must remove its private directory");
  if (mode !== "cache-file") {
    assert.deepEqual(result.entries, [result.archiveName, "neighbour"].sort());
    assert.equal(result.neighbour, "unrelated input");
  }
  return result;
}

for (const mode of ["corrupt", "empty"]) {
  test("an existing " + mode + " storage archive is refused without download or replacement", { timeout: 20000 }, async t => {
    const result = await runProbe(t, mode);
    assert.equal(result.message, "SeaweedFS archive digest mismatch");
    assert.equal(result.code, null);
    assert.equal(result.content, mode === "empty" ? "" : Buffer.from("corrupt cached archive").toString("hex"));
  });
}

test("an archive cache read error is preserved without fetching or removing its input", { timeout: 20000 }, async t => {
  const result = await runProbe(t, "directory");
  assert.equal(result.code, "EISDIR");
  assert.equal(result.content, "existing directory");
});

test("a file blocking the cache directory is preserved without fetching or extraction", { timeout: 20000 }, async t => {
  const result = await runProbe(t, "cache-file");
  assert.equal(result.code, "EEXIST");
  assert.equal(result.content, "existing cache path");
});
