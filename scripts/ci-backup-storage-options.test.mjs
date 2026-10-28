import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
// Each child owns its temporary root; the real fixture never sees a shared cache.
const probe = `
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
const options = JSON.parse(process.argv[1]);
let allocations = 0, downloads = 0, extractions = 0;
const allocate = fs.mkdtemp;
fs.mkdtemp = (...args) => { allocations++; return allocate(...args); };
childProcess.execFileSync = () => { extractions++; throw Error("unexpected extraction"); };
syncBuiltinESMExports();
const transportFailure = new Error("controlled download refusal");
globalThis.fetch = async () => { downloads++; throw transportFailure; };
const { startBackupStorage } = await import("./scripts/backup-storage-fixture.mjs");
let failure;
try {
  const storage = await startBackupStorage(options);
  await storage.stop();
} catch (error) { failure = error; }
assert.ok(failure, "the probe must stop before starting a store");
console.log(JSON.stringify({
  message: failure.message, allocations, downloads, extractions,
  diagnostic: failure.storageDownload ?? null,
  originalCause: failure.cause === transportFailure,
  entries: (await fs.readdir(tmpdir())).sort()
}));
`;

async function runProbe(t, options) {
  const directory = await mkdtemp(join(tmpdir(), "cloud-storage-options-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout, stderr } = await execute(process.execPath,
    ["--input-type=module", "-e", probe, JSON.stringify(options)], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
      timeout: 15000, maxBuffer: 1024 * 1024,
    });
  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.extractions, 0, "refused startup must never run an external command");
  return result;
}

// Removing validation, accepting partial matches or replacing ?? with || admits these inputs.
for (const tokenDuration of ["", "12", "s", "1.5s", "-1s", "12d", " 12s", "12s ", "12s-extra"]) {
  test(`storage duration ${JSON.stringify(tokenDuration)} refuses before temporary state or download`, { timeout: 20000 }, async t => {
    const result = await runProbe(t, { tokenDuration });
    assert.equal(result.message, "Invalid local storage token duration");
    assert.equal(result.allocations, 0, "invalid configuration must refuse before allocating a private directory");
    assert.equal(result.downloads, 0, "invalid configuration must not request an archive");
    assert.equal(result.diagnostic, null, "configuration refusal must not be reported as a transport failure");
    assert.deepEqual(result.entries, [], "invalid configuration must leave no temporary state");
  });
}

for (const options of [{}, { tokenDuration: "12s" }, { tokenDuration: "15m" }, { tokenDuration: "1h" }]) {
  test(`storage options ${JSON.stringify(options)} reach the download boundary and clean up its refusal`, { timeout: 20000 }, async t => {
    const result = await runProbe(t, options);
    assert.equal(result.message, "SeaweedFS download failed (headers)");
    assert.equal(result.allocations, 1);
    assert.equal(result.downloads, 1, "a transport refusal must not retry startup");
    assert.equal(result.diagnostic.phase, "headers");
    assert.equal(result.diagnostic.httpStatus, null);
    assert.equal(result.originalCause, true);
    assert.deepEqual(result.entries, ["waitron-cloud-test-binaries"], "failed startup must remove its private directory");
  });
}
