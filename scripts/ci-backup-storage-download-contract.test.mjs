import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { downloadStorageArchive } from "./fixtures/storage-archive-download.mjs";

const execute = promisify(execFile);

async function probe(t, mode) {
  const root = await mkdtemp(join(tmpdir(), "cloud-native-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { stdout, stderr } = await execute(process.execPath, ["--input-type=module", "-e", `
import { createServer } from "node:http";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackupStorage } from "./scripts/backup-storage-fixture.mjs";
const mode = ${JSON.stringify(mode)};
const original = Error("controlled body refusal");
const timeout = AbortSignal.timeout.bind(AbortSignal), later = globalThis.setTimeout;
AbortSignal.timeout = ms => timeout(ms === 30000 ? (mode === "quiet" ? 750 : 75) : ms);
globalThis.setTimeout = (fn, ms, ...args) => later(fn, ms === 10000 ? 60 : ms, ...args);
let server, calls = 0, completed = false;
if (mode === "quiet") {
  server = createServer((req, res) => {
    res.writeHead(200); res.write("partial");
    later(() => { completed = true; res.end("invalid archive"); }, 200);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  calls++;
  if (mode === "quiet") return nativeFetch("http://127.0.0.1:" + server.address().port, options);
  if (mode === "cancel-error") return {ok: false, status: 503,
    body: {async cancel() { throw original; }}};
  const response = new Response("invalid archive");
  if (mode === "missing-status") Object.defineProperty(response, "status", {value: undefined});
  response.arrayBuffer = async () => {
    if (mode.startsWith("late-")) await new Promise(resolve => later(resolve, 150));
    if (mode !== "late-bytes") throw original;
    return new TextEncoder().encode("invalid late archive").buffer;
  };
  return response;
};
let failure;
try { const storage = await startBackupStorage(); await storage.stop(); }
catch (error) { failure = error; }
finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
console.log(JSON.stringify({ message: failure?.message, diagnostic: failure?.storageDownload,
  causeName: failure?.cause?.name, causeMessage: failure?.cause?.message,
  causeIsOriginal: failure?.cause === original, calls, completed,
  cache: await readdir(join(tmpdir(), "waitron-cloud-test-binaries")),
  roots: (await readdir(tmpdir())).filter(name => name.startsWith("cloud-backup-storage-")) }));
`], { cwd: new URL("..", import.meta.url), env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root }, timeout: 5000 });
  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.calls, 1);
  assert.deepEqual(result.cache, []);
  assert.deepEqual(result.roots, []);
  return result;
}

test("native body silence spends the total budget without a seed inactivity limit", async t => {
  const result = await probe(t, "quiet");
  assert.equal(result.completed, true);
  assert.equal(result.message, "SeaweedFS archive digest mismatch");
  assert.equal(result.diagnostic, undefined);
});

test("unavailable status stays null and preserves the original body refusal", async t => {
  const result = await probe(t, "missing-status");
  assert.equal(result.message, "SeaweedFS download failed (body)");
  assert.equal(result.diagnostic.httpStatus, null);
  assert.equal(result.causeIsOriginal, true);
});

for (const mode of ["late-bytes", "late-error"]) {
  test(`native ${mode} consumption cannot replace an expired acquisition deadline`, async t => {
    const result = await probe(t, mode);
    assert.equal(result.message, "SeaweedFS download failed (body)");
    assert.equal(result.causeName, "TimeoutError");
    assert.equal(result.diagnostic.httpStatus, 200);
    assert.equal(result.causeIsOriginal, false);
  });
}

test("refused body cancellation preserves the HTTP refusal and one attempt", async t => {
  const result = await probe(t, "cancel-error");
  assert.equal(result.message, "SeaweedFS download failed (status)");
  assert.equal(result.diagnostic.httpStatus, 503);
  assert.equal(result.causeName, "Error");
  assert.equal(result.causeMessage, "SeaweedFS download failed");
  assert.equal(result.causeIsOriginal, false);
});

for (const mode of ["success", "refusal"]) {
  test(`a throwing download diagnostic sink preserves ${mode}`, async t => {
    const original = Error("controlled transport refusal");
    t.mock.method(globalThis, "fetch", async () => {
      if (mode === "refusal") throw original;
      return new Response("archive bytes");
    });
    const download = () => downloadStorageArchive("https://example.invalid/archive", {
      report() { throw Error("controlled diagnostic refusal"); },
    });
    if (mode === "success") assert.equal((await download()).toString(), "archive bytes");
    else await assert.rejects(download, error => error === original);
  });
}
