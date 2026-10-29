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
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [mode, seed, archiveName] = process.argv.slice(1);
const bytes = await fs.readFile(seed), cache = join(tmpdir(), "waitron-cloud-test-binaries");
await fs.mkdir(cache);
await fs.writeFile(join(cache, archiveName), bytes, {mode: 0o444});
await fs.writeFile(join(tmpdir(), "unrelated"), "keep");
const require = createRequire(new URL("./packages/backups/package.json", import.meta.url));
const {S3Client} = require("@aws-sdk/client-s3");
const original = Object.assign(Error("PRIVATE_READINESS_ERROR"), {name: "InternalError", $metadata: {httpStatusCode: 500}});
const owned = Object.assign(Error("PRIVATE_OWNED_BUCKET"), {name: "BucketAlreadyOwnedByYou"});
const send = S3Client.prototype.send, spawn = childProcess.spawn;
let child, creates = 0, heads = 0;
childProcess.spawn = (...args) => { child = spawn(...args); return child; };
syncBuiltinESMExports();
S3Client.prototype.send = async function(command, options) {
  if (command.input.Bucket !== "readiness-probe") return send.call(this, command, options);
  assert.ok(options.abortSignal instanceof AbortSignal, "readiness keeps its request deadline");
  if (command.constructor.name === "CreateBucketCommand") {
    creates++;
    throw mode === "head" ? owned : original;
  }
  assert.equal(command.constructor.name, "HeadBucketCommand");
  heads++;
  throw original;
};
const {startBackupStorage} = await import("./scripts/backup-storage-fixture.mjs");
let failure;
try { const storage = await startBackupStorage(); await storage.stop(); }
catch (error) { failure = error; }
assert.equal(failure, original, "diagnostics must preserve the original SDK error object");
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
console.log(JSON.stringify({mode, readiness, originalError: failure === original, stopped: true}));
`;

// Losing the active command or either count hides whether creation or the
// post-timeout ownership check refused. Both paths retain the same SDK error.
test("storage startup failures retain bounded readiness request evidence", {concurrency: 2, timeout: 65000}, async t => {
  await Promise.all(["create", "head"].map(mode => t.test(mode, {timeout: 60000}, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-storage-readiness-test-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const {stdout, stderr} = await execute(process.execPath,
      ["--input-type=module", "-e", probe, mode, seed, archiveName], {
        cwd: new URL("..", import.meta.url),
        env: {...process.env, TMPDIR: directory, TMP: directory, TEMP: directory},
        timeout: 55000, maxBuffer: 1024 * 1024,
      });
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.equal(result.mode, mode);
    assert.equal(result.originalError, true);
    assert.equal(result.stopped, true);
  })));
});
