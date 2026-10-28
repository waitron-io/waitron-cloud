import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
// Each child has a cold, private cache; a probe never replaces a shared archive.
const probe = `
import { readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackupStorage } from "./scripts/backup-storage-fixture.mjs";
const mode = process.argv[1];
let calls = 0, bodyReads = 0, requested, server;
const original = new TypeError("controlled transport failure", {
  cause: Object.assign(new Error("length mismatch"), {code: "UND_ERR_RES_CONTENT_LENGTH_MISMATCH"})
});
const nativeFetch = globalThis.fetch;
if (mode === "truncated") {
  server = createServer((req, res) => {
    res.writeHead(200, {"Content-Length": "4096", "Connection": "close"});
    res.end("incomplete archive");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
}
globalThis.fetch = async url => {
  calls++; requested = url;
  if (mode === "headers") throw original;
  if (mode === "truncated") return nativeFetch("http://127.0.0.1:" + server.address().port);
  return {
    ok: mode !== "status", status: mode === "status" ? 503 : 200,
    url: "https://redirect.invalid/archive?signature=PRIVATE",
    async arrayBuffer() {
      bodyReads++;
      if (mode === "body") throw original;
      return new TextEncoder().encode("complete but wrong archive").buffer;
    }
  };
};
try {
  const storage = await startBackupStorage();
  await storage.stop();
  throw new Error("download unexpectedly accepted");
} catch (error) {
  const rootEntries = await readdir(tmpdir());
  const cacheEntries = await readdir(join(tmpdir(), "waitron-cloud-test-binaries"));
  console.log(JSON.stringify({
    message: error.message, diagnostic: error.storageDownload ?? null,
    causeIsOriginal: error.cause === original,
    causeCode: error.cause?.cause?.code,
    causeName: error.cause?.name,
    calls, bodyReads, requested, cacheEntries,
    roots: rootEntries.filter(name => name.startsWith("cloud-backup-storage-"))
  }));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
}
`;

async function runProbe(t, mode) {
  const directory = await mkdtemp(join(tmpdir(), "cloud-storage-download-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout, stderr } = await execute(process.execPath,
    ["--input-type=module", "-e", probe, mode], {
      cwd: new URL("..", import.meta.url), env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
      timeout: 15000, maxBuffer: 1024 * 1024,
    });
  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.calls, 1, "a download failure must not introduce a retry");
  assert.deepEqual(result.cacheEntries, [], "failed bytes must not reach the cache");
  assert.deepEqual(result.roots, [], "failed startup must remove its private root");
  assert.match(result.requested, /^https:\/\/github\.com\/seaweedfs\/seaweedfs\/releases\/download\/4\.47\/(darwin_arm64|linux_arm64|linux_amd64)\.tar\.gz$/);
  return result;
}

for (const [mode, phase, httpStatus] of [["headers", "headers", null], ["body", "body", 200], ["status", "status", 503]]) {
  test("storage archive " + mode + " failure identifies its public request and phase", { timeout: 20000 }, async t => {
    const result = await runProbe(t, mode);
    assert.deepEqual(result.diagnostic, { phase, url: result.requested, httpStatus });
    assert.match(result.message, /SeaweedFS download failed/);
    assert.equal(result.bodyReads, mode === "body" ? 1 : 0);
    if (mode !== "status") {
      assert.equal(result.causeIsOriginal, true, "the transport error must remain the cause");
      assert.equal(result.causeCode, "UND_ERR_RES_CONTENT_LENGTH_MISMATCH");
    }
    assert.ok(!JSON.stringify(result.diagnostic).includes("PRIVATE"), "signed redirect URLs must stay out of diagnostics");
  });
}

test("a genuinely truncated response is attributed to archive body consumption", { timeout: 20000 }, async t => {
  const result = await runProbe(t, "truncated");
  assert.deepEqual(result.diagnostic, { phase: "body", url: result.requested, httpStatus: 200 });
  assert.equal(result.causeName, "TypeError");
  assert.ok(result.causeCode, "the native response failure code must remain available");
});

test("a complete archive with the wrong digest remains refused outside transport reporting", { timeout: 20000 }, async t => {
  const result = await runProbe(t, "digest");
  assert.equal(result.message, "SeaweedFS archive digest mismatch");
  assert.equal(result.diagnostic, null);
  assert.equal(result.bodyReads, 1);
});
