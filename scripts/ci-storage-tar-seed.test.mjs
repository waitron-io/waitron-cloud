import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { before, after } from "node:test";
import { prepareStorageTarSeed } from "./fixtures/storage-tar-seed.mjs";

const execute = promisify(execFile);
let fixture;
before(async () => { fixture = await prepareStorageTarSeed(); }, { timeout: 45000 });
after(async () => { if (fixture) await rm(fixture.seedRoot, { recursive: true, force: true }); });

async function runSeedCase(t, setup) {
  const root = await mkdtemp(join(tmpdir(), "cloud-tar-seed-control-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const preload = join(root, "preload.mjs");
  await writeFile(preload, `
import { readFile } from "node:fs/promises";
const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
const nativeSetTimeout = globalThis.setTimeout;
let calls = 0;
const good = async () => new Response(await readFile(${JSON.stringify(fixture.seed)}));
${setup}
process.once("exit", () => console.error("seed_fetch_calls=" + calls));
`);
  const env = { ...process.env, TMPDIR: root, TMP: root, TEMP: root };
  delete env.NODE_TEST_CONTEXT;
  let result;
  try {
    result = await execute(process.execPath, ["--import", preload, "--test", "--test-reporter=tap", "scripts/ci-backup-storage-tar-refusals.test.mjs"], {
      cwd: new URL("..", import.meta.url), env, timeout: 40000, maxBuffer: 1024 * 1024,
    });
    result.code = 0;
  } catch (error) { result = error; }
  assert.equal(result.killed ?? false, false, "the acquisition must settle before the outer child cutoff");
  const output = result.stdout + result.stderr;
  const events = [...output.matchAll(/storage_seed_acquisition=(\{[^\n]+\})/g)].map(match => JSON.parse(match[1]));
  return { ...result, output, events };
}

for (const mode of ["status", "headers", "body", "inactivity"]) {
  test(`tar refusal setup recovers from temporary ${mode} failure before every extraction check`, { timeout: 45000 }, async t => {
    const result = await runSeedCase(t, `
${mode === "inactivity" ? 'globalThis.setTimeout = (fn, ms, ...args) => nativeSetTimeout(fn, ms === 10000 && calls === 0 ? 25 : ms, ...args);' : ''}
globalThis.fetch = async (url, options) => {
  if (++calls > 1) return good(url, options);
  ${mode === "status" ? 'return new Response("temporary upstream failure", {status: 503});' :
    mode === "headers" ? 'throw new TypeError("controlled reset", {cause: Object.assign(new Error("reset"), {code: "ECONNRESET"})});' :
    mode === "body" ? 'return new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array([1]));controller.error(new TypeError("controlled reset", {cause: Object.assign(new Error("socket"), {code: "UND_ERR_SOCKET"})}));}}));' :
    'return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), {once: true}));'}
};`);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /# pass 3\b/);
    assert.match(result.output, /# fail 0\b/);
    assert.match(result.output, /seed_fetch_calls=2/);
    assert.equal(result.events.filter(event => event.event === "retry").length, 1);
    assert.equal(result.events.at(-1).event, "complete");
    assert.ok(result.events.at(-1).bytesReceived > 0);
  });
}

for (const status of [401, 403, 404, 429, 503]) {
  test(`seed HTTP ${status} reports its stage and bounded attempts without extraction`, { timeout: 15000 }, async t => {
    const result = await runSeedCase(t, `globalThis.fetch = async () => { calls++; const response = new Response("PRIVATE response body", {status: calls > 3 ? 403 : ${status}});
      Object.defineProperty(response, "url", {value: "https://redirect.invalid/private?signature=PRIVATE"});
      return response; };`);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /# pass 0\b/);
    assert.match(result.output, new RegExp(`seed_fetch_calls=${status === 503 ? 3 : 1}`));
    const last = result.events.at(-1);
    assert.equal(last?.event, "failure");
    assert.equal(last.phase, "status");
    assert.equal(last.status, status);
    assert.equal(last.attempt, status === 503 ? 3 : 1);
    assert.equal(last.timeoutMs, 30000);
    assert.match(last.url, /^https:\/\/github\.com\/seaweedfs\/seaweedfs\/releases\/download\/4\.47\//);
    assert.ok(!JSON.stringify(result.events).includes("PRIVATE"));
  });
}

for (const phase of ["headers", "body", "retry"]) {
  test(`seed ${phase} cannot outlive the shared acquisition budget`, { timeout: 10000 }, async t => {
    const result = await runSeedCase(t, `
AbortSignal.timeout = ms => nativeTimeout(ms === 30000 ? 100 : ms);
globalThis.fetch = async (url, options) => {
  calls++;
  ${phase === "retry" ? 'return new Response("temporary", {status: 503});' :
    phase === "headers" ? 'return new Promise((resolve, reject) => {options.signal.addEventListener("abort", () => reject(options.signal.reason), {once: true}); nativeSetTimeout(() => {if (!options.signal.aborted) resolve(good(url, options));}, 250);});' :
    'return new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array([1, 2]));options.signal.addEventListener("abort", () => controller.error(options.signal.reason), {once: true});nativeSetTimeout(() => {if (!options.signal.aborted) controller.close();}, 250);}}));'}
};`);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /seed_fetch_calls=1/);
    const last = result.events.at(-1);
    assert.equal(last?.event, "failure");
    assert.equal(last.phase, phase === "retry" ? "status" : phase);
    assert.equal(last.timeoutMs, 30000);
    assert.equal(result.events.filter(event => event.event === "attempt").length, 1);
    if (phase === "body") assert.equal(last.bytesReceived, 2);
  });
}

test("seed digest refusal neither retries nor accepts bad bytes", { timeout: 10000 }, async t => {
  const result = await runSeedCase(t, 'globalThis.fetch = async () => {calls++; return new Response("bad archive");};');
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /# pass 0\b/);
  assert.match(result.output, /seed_fetch_calls=1/);
  assert.match(result.output, /archive digest mismatch/);
  assert.equal(result.events.at(-1)?.phase, "digest");
  assert.equal(result.events.at(-1)?.event, "failure");
});

test("permanent HTTP refusal still stops if cancelling its body reports a reset", { timeout: 10000 }, async t => {
  const result = await runSeedCase(t, `globalThis.fetch = async () => {
    calls++;
    return {ok: false, status: 403, body: {async cancel() {
      throw new TypeError("reset while closing refusal", {cause: Object.assign(new Error("reset"), {code: "ECONNRESET"})});
    }}};
  };`);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /seed_fetch_calls=1/);
  assert.equal(result.events.at(-1)?.status, 403);
  assert.equal(result.events.at(-1)?.attempt, 1);
  assert.equal(result.events.filter(event => event.event === "retry").length, 0);
});

for (const phase of ["headers", "body"]) {
  test(`an unclassified seed ${phase} refusal stops without retrying`, { timeout: 10000 }, async t => {
    const result = await runSeedCase(t, `globalThis.fetch = async () => {
      calls++;
      const error = new Error("unclassified seed refusal");
      ${phase === "headers" ? 'throw error;' : 'return new Response(new ReadableStream({start(controller) {controller.error(error);}}));'}
    };`);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /seed_fetch_calls=1/);
    assert.match(result.output, /unclassified seed refusal/);
    assert.equal(result.events.at(-1)?.phase, phase);
    assert.equal(result.events.at(-1)?.event, "failure");
  });
}

test("body progress renews inactivity without restarting the seed download", { timeout: 45000 }, async t => {
  const result = await runSeedCase(t, `
const bytes = await readFile(${JSON.stringify(fixture.seed)});
let bodyStarted = false;
globalThis.setTimeout = (fn, ms, ...args) => nativeSetTimeout(fn, ms === 10000 && bodyStarted ? 100 : ms, ...args);
globalThis.fetch = async (url, options) => {
  calls++; bodyStarted = true;
  return new Response(new ReadableStream({async start(controller) {
    let stopped = false;
    options.signal.addEventListener("abort", () => {stopped = true; controller.error(options.signal.reason);}, {once: true});
    for (let offset = 0; offset < bytes.length; offset += Math.ceil(bytes.length / 8)) {
      await new Promise(resolve => nativeSetTimeout(resolve, 25));
      if (stopped) return;
      controller.enqueue(bytes.subarray(offset, offset + Math.ceil(bytes.length / 8)));
    }
    controller.close();
  }}));
};`);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /# pass 3\b/);
  assert.match(result.output, /seed_fetch_calls=1/);
  assert.equal(result.events.at(-1)?.event, "complete");
  assert.ok(result.events.at(-1)?.elapsedMs >= 200);
});
