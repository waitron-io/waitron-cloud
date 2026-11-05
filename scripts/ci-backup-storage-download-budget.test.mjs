import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

// Without the fixture's deadline, the real server completes with invalid bytes.
for (const phase of ["headers", "body", "status"]) {
  test(`native archive ${phase} refusal closes its request within the acquisition budget`, { timeout: 10000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), "cloud-native-budget-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const { stdout, stderr } = await execute(process.execPath, ["--input-type=module", "-e", `
import { createServer } from "node:http";
import { readdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackupStorage } from "./scripts/backup-storage-fixture.mjs";
const timeout = AbortSignal.timeout.bind(AbortSignal), budgets = [];
AbortSignal.timeout = ms => { budgets.push(ms); return timeout(ms === 30000 ? 75 : ms); };
let calls = 0, completed = false, disconnected = false;
let releaseConnection;
const connectionClosed = new Promise(resolve => { releaseConnection = resolve; });
const timers = new Set();
const server = createServer((req, res) => {
  req.on("close", () => { if (!completed) disconnected = true; releaseConnection(); });
  if (${JSON.stringify(phase)} !== "headers") {
    res.writeHead(${phase === "status" ? 503 : 200}); res.write("partial archive");
  }
  const timer = setTimeout(() => { completed = true; res.end("invalid complete archive"); }, 350);
  timers.add(timer);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => { calls++; return nativeFetch("http://127.0.0.1:" + server.address().port, options); };
await writeFile(join(tmpdir(), "neighbour"), "unrelated input");
let failure;
let releasedBeforeCleanup;
try {
  const storage = await startBackupStorage();
  await storage.stop();
} catch (error) { failure = error; }
finally {
  const observeTimer = setTimeout(() => releaseConnection(), 150);
  await connectionClosed;
  clearTimeout(observeTimer);
  releasedBeforeCleanup = disconnected;
  for (const timer of timers) clearTimeout(timer);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ message: failure?.message, causeName: failure?.cause?.name,
  diagnostic: failure?.storageDownload, calls, budgets, completed, releasedBeforeCleanup,
  neighbour: await readFile(join(tmpdir(), "neighbour"), "utf8"),
  roots: (await readdir(tmpdir())).filter(name => name.startsWith("cloud-backup-storage-")),
  cache: await readdir(join(tmpdir(), "waitron-cloud-test-binaries")) }));
`], { cwd: new URL("..", import.meta.url), env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root }, timeout: 5000 });
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.equal(result.message, `SeaweedFS download failed (${phase})`);
    assert.ok((phase === "status" ? ["Error"] : ["TimeoutError", "AbortError"]).includes(result.causeName), stdout);
    assert.deepEqual(result.budgets, [30000], "one deadline must cover headers and body");
    assert.equal(result.diagnostic.phase, phase);
    assert.equal(result.diagnostic.httpStatus, phase === "headers" ? null : phase === "status" ? 503 : 200);
    assert.equal(result.calls, 1, "native failures must never retry");
    assert.equal(result.completed, false, "the server must not finish after the deadline");
    assert.equal(result.releasedBeforeCleanup, true, "the fixture must close its request before test cleanup");
    assert.deepEqual(result.roots, []);
    assert.deepEqual(result.cache, []);
    assert.equal(result.neighbour, "unrelated input");
  });
}
