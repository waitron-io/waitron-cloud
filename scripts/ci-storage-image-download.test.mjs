import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  return result.stderr.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
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
      const failure = records(error).at(-1);
      assert.deepEqual({ event: failure.event, name: failure.name, code: failure.code },
        { event: "failed", name: phase === "retry pause" ? "AbortError" : "TimeoutError", code: 23 });
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

test("a refused command reports its usage without hiding the assertion message", async t => {
  const f = await fixture(t, (_request, response) => response.end());
  await assert.rejects(execute(process.execPath, [f.command], { cwd: f.root }), error => {
    assert.equal(error.code, 1);
    assert.equal(records(error).at(-1).message, "Usage: storage-archive-download.mjs <url> <output>");
    return true;
  });
});

test("a malformed archive URL is redacted from the failure message", async t => {
  const f = await fixture(t, (_request, response) => response.end());
  f.url = "not a URL with private-user:private-password";
  await assert.rejects(run(f), error => {
    const message = records(error).at(-1).message;
    assert.equal(typeof message, "string");
    assert.ok(message.includes("<archive URL>"));
    assert.ok(!error.stderr.includes("private-password"));
    return error.code === 1;
  });
});

test("a filesystem refusal retains a bounded diagnostic message", async t => {
  const f = await fixture(t, (_request, response) => response.end("archive"));
  f.output = join(f.root, "x".repeat(500));
  await assert.rejects(run(f), error => {
    const failure = records(error).at(-1);
    assert.equal(failure.code, "ENAMETOOLONG");
    assert.equal(typeof failure.message, "string");
    assert.ok(failure.message.length > 0 && failure.message.length <= 240);
    return error.code === 1;
  });
});

async function imageFixture(t, proxy = false) {
  let bytes;
  const requests = [];
  const f = await fixture(t, (request, response) => { requests.push(request.url); response.end(bytes); });
  await mkdir(join(f.root, "source"));
  await mkdir(join(f.root, "bin"));
  await writeFile(join(f.root, "source/weed"), "controlled extracted binary\n");
  await execute("tar", ["-czf", join(f.root, "input.tgz"), "-C", join(f.root, "source"), "weed"]);
  bytes = await readFile(join(f.root, "input.tgz"));
  const dockerfile = await readFile(new URL("../deploy/local-stack/Dockerfile", import.meta.url), "utf8");
  // Run the actual acquisition chain with private paths and local HTTP bytes;
  // package installation remains covered by the real image build.
  const chain = /esac \\\n([\s\S]*?) \\\n && npm install/.exec(dockerfile);
  assert.ok(chain, "the image must expose its acquisition/checksum/extraction chain");
  const url = proxy ? "http://archive.invalid/weed.tgz" : f.url;
  const shell = chain[1].replace(/^\s*&&\s*/, "")
    .replaceAll("/tmp/storage-archive-download.mjs", "./download.mjs")
    .replaceAll("/tmp/weed.tgz", "./weed.tgz")
    .replaceAll("/usr/local/bin", "./bin")
    .replace("https://github.com/seaweedfs/seaweedfs/releases/download/${SEAWEED_VERSION}/${archive}", url);
  const env = { ...process.env, digest: createHash("sha256").update(bytes).digest("hex"),
    HTTP_PROXY: proxy ? new URL(f.url).origin : "", http_proxy: proxy ? new URL(f.url).origin : "",
    HTTPS_PROXY: "", https_proxy: "", ALL_PROXY: "", all_proxy: "", NO_PROXY: "", no_proxy: "",
    NODE_USE_ENV_PROXY: "0" };
  return { ...f, requests, execute: (overrides = {}) => execute("/bin/sh", ["-c", shell], {
    cwd: f.root, env: { ...env, ...overrides }, timeout: 5000,
  }) };
}

test("the Dockerfile acquisition chain reports stages, extracts verified bytes and removes its inputs", async t => {
  const f = await imageFixture(t);
  const result = await f.execute();
  assert.equal(await readFile(join(f.root, "bin/weed"), "utf8"), "controlled extracted binary\n");
  assert.ok(records(result).some(record => record.event === "headers" && record.status === 200));
  assert.ok(!(await readdir(f.root)).some(name => name === "weed.tgz" || name === "download.mjs"));
});

test("the Dockerfile acquisition chain refuses an incorrect checksum before extracting", async t => {
  const f = await imageFixture(t);
  await assert.rejects(f.execute({ digest: "0".repeat(64) }), error => error.code === 1);
  assert.deepEqual(await readdir(join(f.root, "bin")), []);
});

test("the Dockerfile acquisition chain refuses a missing checksum before extracting", async t => {
  const f = await imageFixture(t);
  await assert.rejects(f.execute({ digest: "" }), error => error.code === 1);
  assert.deepEqual(await readdir(join(f.root, "bin")), []);
});

test("the Dockerfile acquisition preserves inherited HTTP proxy configuration", async t => {
  const f = await imageFixture(t, true);
  await assert.doesNotReject(f.execute());
  assert.deepEqual(f.requests, ["http://archive.invalid/weed.tgz"]);
  assert.equal(await readFile(join(f.root, "bin/weed"), "utf8"), "controlled extracted binary\n");
});
