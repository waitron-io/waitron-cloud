import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { before, after } from "node:test";

const execute = promisify(execFile);
const pins = {
  "darwin-arm64": ["darwin_arm64", "3ad466db33e83d0b103f90a06997feeb1cc42fd536e6cbdcdded975778f64fda"],
  "linux-arm64": ["linux_arm64", "ba5c9def9ff98f78becdf309a50a9f906922f6383a7c4c772d01ede3cc012e16"],
  "linux-x64": ["linux_amd64", "31fb804858885f9e7f18b6d3b1da09e824baac3e6a55b5a62c3c4c77e6ed6d7d"],
};
let seedRoot, seed, archiveName;
before(async () => {
  const [name, checksum] = pins[process.platform + "-" + process.arch];
  archiveName = "seaweed-4.47-" + name + ".tar.gz";
  let bytes;
  try { bytes = await readFile(join(tmpdir(), "waitron-cloud-test-binaries", archiveName)); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch("https://github.com/seaweedfs/seaweedfs/releases/download/4.47/" + name + ".tar.gz", {signal: AbortSignal.timeout(30000)});
    assert.equal(response.ok, true);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(createHash("sha256").update(bytes).digest("hex"), checksum);
  seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-readiness-seed-"));
  seed = join(seedRoot, archiveName);
  await writeFile(seed, bytes, {flag: "wx", mode: 0o400});
}, {timeout: 45000});
after(async () => { if (seedRoot) await rm(seedRoot, {recursive: true, force: true}); });

const probe = `
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import childProcess from "node:child_process";
import { createServer } from "node:net";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [mode, seed, archiveName, collision] = process.argv.slice(1);
const bytes = await fs.readFile(seed), cache = join(tmpdir(), "waitron-cloud-test-binaries");
await fs.mkdir(cache);
await fs.writeFile(join(cache, archiveName), bytes, {mode: 0o444});
await fs.writeFile(join(tmpdir(), "unrelated"), "keep");
const require = createRequire(new URL("./packages/backups/package.json", import.meta.url));
const {S3Client} = require("@aws-sdk/client-s3");
const original = Object.assign(Error("PRIVATE_READINESS_ERROR"), {name: "InternalError", $metadata: {httpStatusCode: 500}});
const owned = Object.assign(Error("PRIVATE_OWNED_BUCKET"), {name: "BucketAlreadyOwnedByYou"});
const send = S3Client.prototype.send, spawn = childProcess.spawn;
let child, reports = [];
const children = [], attempts = [], retries = [];
let competitor;
const report = console.error;
console.error = (...args) => {
  if (args[0] === "Storage fixture port handoff failed; retrying once:") {
    assert.equal(args.length, 2);
    assert.match(args[1].message, /^SeaweedFS exited: /);
    retries.push(args[1].storageStartup.readiness);
    if (mode === "reporter-throws") throw Error("PRIVATE_REPORTER_ERROR");
    return;
  }
  return report(...args);
};
const reportReadiness = console.error;
if (mode === "reporter-throws") console.error = (...args) => {
  if (args[0] === "Storage fixture port handoff failed; retrying once:") return reportReadiness(...args);
  reports.push(args[0]);
  throw Error("PRIVATE_REPORTER_ERROR");
};
childProcess.spawn = (...args) => {
  if (child) assert.ok(child.exitCode !== null || child.signalCode !== null, "the abandoned child must stop before restart");
  if (collision === "true" && children.length === 0) {
    const port = Number(args[1].find(arg => arg.startsWith("-s3.port=")).split("=")[1]);
    competitor = createServer(socket => socket.destroy());
    competitor.listen(port);
    assert.equal(competitor.address().port, port, "the competitor must own the S3 port before native startup");
  }
  child = spawn(...args); children.push(child);
  if (competitor && children.length === 1) child.once("exit", () => competitor.close());
  return child;
};
syncBuiltinESMExports();
S3Client.prototype.send = async function(command, options) {
  if (command.input.Bucket !== "readiness-probe") return send.call(this, command, options);
  assert.ok(options.abortSignal instanceof AbortSignal, "readiness keeps its request deadline");
  let attempt = attempts.find(attempt => attempt.client === this);
  if (!attempt) { attempt = {client:this, creates:0, heads:0}; attempts.push(attempt); }
  if (command.constructor.name === "CreateBucketCommand") {
    attempt.creates++;
    if (collision === "true" && attempts.length === 1 && attempt.creates === 1 && child.exitCode === null && child.signalCode === null)
      await new Promise(resolve => child.once("exit", resolve));
    throw mode === "head" ? owned : original;
  }
  assert.equal(command.constructor.name, "HeadBucketCommand");
  attempt.heads++;
  throw original;
};
const {startBackupStorage} = await import("./scripts/backup-storage-fixture.mjs");
let failure;
try { const storage = await startBackupStorage(); await storage.stop(); }
catch (error) { failure = error; }
assert.equal(failure, original, "diagnostics must preserve the original SDK error object");
assert.ok(attempts.length === 1 || attempts.length === 2, "startup allows at most one port handoff retry");
assert.equal(attempts.length, children.length, "each native child owns a separate readiness client");
assert.equal(retries.length, attempts.length - 1, "only an observed handoff refusal permits another attempt");
for (const [index, attempt] of attempts.entries()) {
  assert.ok(attempt.creates >= 1 && attempt.creates <= 120, "every attempt keeps its original readiness budget");
  assert.equal(attempt.heads, mode === "head" ? attempt.creates : 0);
  assert.ok(children[index].exitCode !== null || children[index].signalCode !== null, "every owned native child must stop");
  if (index < retries.length) assert.deepEqual(retries[index], {
    attempt:attempt.creates, request:mode === "head" ? "head-bucket" : "create-bucket",
    createRequests:attempt.creates, headRequests:attempt.heads,
  }, "an abandoned attempt retains its own exact request counts");
}
if (collision === "true") {
  assert.equal(attempts.length, 2, "a forced collision must exercise the one permitted native restart");
  assert.equal(attempts[0].creates, 1, "the abandoned client has its own controlled request count");
  assert.equal(competitor.listening, false, "the owned competitor must release its port");
}
const {creates, heads} = attempts.at(-1);
assert.equal(creates, 120, "diagnostics must preserve the existing readiness attempt budget");
assert.equal(heads, mode === "head" ? 120 : 0);
assert.ok(child.exitCode !== null || child.signalCode !== null, "startup refusal must stop its owned native store");
assert.deepEqual((await fs.readdir(tmpdir())).sort(), ["unrelated", "waitron-cloud-test-binaries"]);
assert.equal(await fs.readFile(join(tmpdir(), "unrelated"), "utf8"), "keep");
assert.deepEqual(await fs.readFile(join(cache, archiveName)), bytes);
const readiness = failure.storageStartup?.readiness;
assert.deepEqual(readiness, {
  attempt: 120, request: mode === "head" ? "head-bucket" : "create-bucket",
  createRequests: 120, headRequests: mode === "head" ? 120 : 0,
}, "startup refusal must identify the final readiness request and both request counts");
assert.ok(!JSON.stringify(readiness).includes("PRIVATE"));
if (mode === "reporter-throws") assert.deepEqual(reports, ["storage_readiness_failure=" + JSON.stringify(readiness)], "a throwing reporter must still receive only bounded request evidence");
console.log(JSON.stringify({mode, readiness, originalError: failure === original, stopped: true}));
`;

// Losing the active command or either count hides whether creation or the
// post-timeout ownership check refused. Both paths retain the same SDK error.
for (const collision of [false, true]) test(collision ? "storage readiness budgets and throwing reporters survive a forced native port collision" : "storage startup failures retain bounded readiness request evidence", {concurrency: 3, timeout: 65000}, async t => {
  await Promise.all(["create", "head", "reporter-throws"].map(mode => t.test(mode, {timeout: 60000}, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-readiness-test-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const {stdout, stderr} = await execute(process.execPath,
      ["--input-type=module", "-e", probe, mode, seed, archiveName, String(collision)], {
        cwd: new URL("..", import.meta.url),
        env: {...process.env, TMPDIR: directory, TMP: directory, TEMP: directory},
        timeout: 55000, maxBuffer: 1024 * 1024,
      });
    const result = JSON.parse(stdout);
    assert.equal(stderr, mode === "reporter-throws" ? "" : "storage_readiness_failure=" + JSON.stringify(result.readiness) + "\n", "a real CI refusal must print the bounded evidence rather than rely on custom Error fields");
    assert.equal(result.mode, mode);
    assert.equal(result.originalError, true);
    assert.equal(result.stopped, true);
  })));
});
