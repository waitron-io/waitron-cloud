import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const command = fileURLToPath(new URL("fixtures/storage-archive-download.mjs", import.meta.url));

async function fixture(t, respond) {
  const root = await mkdtemp(join(tmpdir(), "cloud-storage-image-"));
  const isolatedCommand = join(root, "download.mjs");
  await copyFile(command, isolatedCommand);
  const server = createServer(respond);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, command: isolatedCommand, url: `http://127.0.0.1:${server.address().port}/archive`, output: join(root, "weed.tgz") };
}

function run(f, preload = "") {
  const args = preload ? ["--import", "data:text/javascript," + encodeURIComponent(preload)] : [];
  return execute(process.execPath, [...args, f.command, f.url, f.output], { cwd: f.root, timeout: 10000 });
}

function records(result) {
  return result.stderr.trim().split("\n").map(line => JSON.parse(line));
}

// Removing the command entry point leaves a successful exit without an archive.
test("the image download command writes the response bytes without workspace dependencies", async t => {
  let requests = 0;
  const f = await fixture(t, (_request, response) => { requests++; response.end("pinned archive bytes"); });
  const result = await run(f);
  assert.deepEqual(await readdir(f.root), ["download.mjs", "weed.tgz"], "a successful download must produce the archive");
  assert.equal(await readFile(f.output, "utf8"), "pinned archive bytes");
  assert.equal(requests, 1);
  assert.equal(result.stdout, "");
  assert.ok(records(result).some(record => record.event === "headers" && record.status === 200));
  assert.ok(records(result).some(record => record.event === "settled" && record.bytesReceived === 20));
});

for (const recover of [true, false]) {
  test(`the image command ${recover ? "recovers from" : "stops after"} three temporary attempts`, async t => {
    let requests = 0;
    const f = await fixture(t, (_request, response) => {
      requests++;
      response.writeHead(recover && requests === 3 ? 200 : 503);
      response.end(requests === 3 && recover ? "verified later by the caller" : "temporary refusal");
    });
    let result;
    if (recover) result = await run(f);
    else await assert.rejects(run(f), error => { result = error; return error.code === 1; });
    assert.equal(requests, 3);
    assert.deepEqual(records(result).filter(record => record.event === "retry").map(record => record.attempt), [1, 2]);
    if (recover) assert.equal(await readFile(f.output, "utf8"), "verified later by the caller");
    else assert.deepEqual(await readdir(f.root), ["download.mjs"]);
  });
}

test("a permanent HTTP refusal never retries or writes its body", async t => {
  let requests = 0;
  const f = await fixture(t, (_request, response) => { requests++; response.writeHead(404); response.end("not an archive"); });
  await assert.rejects(run(f), error => {
    assert.equal(error.code, 1);
    assert.ok(records(error).some(record => record.event === "headers" && record.status === 404));
    assert.equal(records(error).at(-1).event, "failed");
    return true;
  });
  assert.equal(requests, 1);
  assert.deepEqual(await readdir(f.root), ["download.mjs"]);
});

for (const phase of ["headers", "body", "retry pause"]) {
  test(`the image command's shared deadline interrupts ${phase} and leaves no output`, async t => {
    let requests = 0;
    const f = await fixture(t, (_request, response) => {
      requests++;
      if (phase === "body") { response.writeHead(200); response.write("partial archive"); }
      if (phase === "retry pause") { response.writeHead(503); response.end(); }
    });
    await assert.rejects(run(f, `
const timeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = ms => { if (ms !== 30000) throw Error("unexpected budget"); return timeout(500); };
`), error => {
      assert.equal(error.code, 1, "the command itself must reject before the outer test timeout");
      assert.deepEqual(records(error).at(-1), { event: "failed", name: phase === "retry pause" ? "AbortError" : "TimeoutError", code: 23 });
      return true;
    });
    assert.equal(requests, 1);
    assert.deepEqual(await readdir(f.root), ["download.mjs"]);
  });
}

test("the image command retries an inactive transfer without writing partial bytes", async t => {
  let requests = 0;
  const f = await fixture(t, (_request, response) => {
    requests++;
    response.writeHead(200); response.write("incomplete");
  });
  await assert.rejects(run(f, `
const timeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 10000 ? 100 : ms, ...args);
`), error => {
    assert.equal(error.code, 1);
    assert.deepEqual(records(error).filter(record => record.event === "retry").map(record => record.phase), ["body", "body"]);
    assert.equal(records(error).at(-1).name, "TimeoutError");
    return true;
  });
  assert.equal(requests, 3);
  assert.deepEqual(await readdir(f.root), ["download.mjs"]);
});
