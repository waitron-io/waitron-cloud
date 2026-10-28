import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const repository = new URL("../", import.meta.url);

async function fixture(t, { generatorFails = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "cloud-build-refusal-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"), cloud = join(root, "cloud");
  const temporary = join(root, "temporary"), bin = join(root, "bin");
  const capture = join(root, "build.json");
  for (const directory of [temporary, bin, join(source, "scripts"), join(cloud, "scripts"),
    join(cloud, "deploy/backup-verifier"), join(cloud, "packages/backups/src")]) {
    await mkdir(directory, { recursive: true });
  }
  await copyFile(new URL("scripts/build-backup-verifier.mjs", repository), join(cloud, "scripts/build-backup-verifier.mjs"));
  await copyFile(new URL("deploy/backup-verifier/Dockerfile", repository), join(cloud, "deploy/backup-verifier/Dockerfile"));
  for (const name of ["container-entry.mjs", "waitron-verifier.ts", "waitron-verify-child.mjs", "verify-process.ts",
    "verification-protocol.ts", "verification-transport.ts", "waitron-data-verify-child.mjs"]) {
    await copyFile(new URL("packages/backups/src/" + name, repository), join(cloud, "packages/backups/src", name));
  }
  await writeFile(join(source, "package.json"), '{"type":"module"}');
  await writeFile(join(source, "scripts/generate-hour-release.mjs"), generatorFails
    ? 'export function generateHourRelease() { throw new Error("controlled release generation refusal"); }'
    : 'export function generateHourRelease({source}) { return {sourceCommit:source}; }');
  const git = async (...args) => (await execute("git", args, { cwd: source })).stdout.trim();
  await git("init", "-q");
  await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-s", "-qm", "fixture");
  const revision = await git("rev-parse", "HEAD");
  const target = join(cloud, "deploy/backup-verifier/target.json");
  const pin = value => writeFile(target, JSON.stringify({ runtime: { revision: value }, digest: "a".repeat(64) }));
  await pin(revision);
  // The executable records the boundary instead of invoking a Docker daemon or building an image.
  const command = join(bin, "docker");
  await writeFile(command, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2), context = args.at(-1);
fs.writeFileSync(process.env.BUILD_CAPTURE, JSON.stringify({args, context,
  release: JSON.parse(fs.readFileSync(context + "/waitron/build/hour-release.json", "utf8"))}));
if (process.env.BUILD_EXIT === "27") { console.error("controlled image build refusal"); process.exit(27); }
`);
  await chmod(command, 0o700);
  async function run(overrides = {}) {
    const env = { ...process.env, WAITRON_CHECKOUT: source, NODE_AUTH_TOKEN: "synthetic-build-only",
      BUILD_CAPTURE: capture, BUILD_EXIT: "0", PATH: bin + ":" + process.env.PATH,
      TMPDIR: temporary, TMP: temporary, TEMP: temporary, ...overrides };
    for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
    let result;
    try {
      result = { ...(await execute(process.execPath, [join(cloud, "scripts/build-backup-verifier.mjs")],
        { env, timeout: 10000, maxBuffer: 1024 * 1024 })), code: 0 };
    } catch (error) {
      assert.equal(error.killed, false, "the build must finish without the test timeout killing it");
      assert.equal(error.signal, null);
      result = error;
    }
    assert.deepEqual(await readdir(temporary), [], "every build outcome must remove its private context");
    let build = null;
    try { build = JSON.parse(await readFile(capture, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return { ...result, build };
  }
  return { run, pin, revision };
}

// Removing the input refusal must not let either incomplete configuration reach a build.
for (const missing of ["WAITRON_CHECKOUT", "NODE_AUTH_TOKEN"]) {
  test("verifier build refuses a missing " + missing + " before creating a build", { timeout: 20000 }, async t => {
    const f = await fixture(t);
    const result = await f.run({ [missing]: undefined });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Set WAITRON_CHECKOUT and NODE_AUTH_TOKEN before building the verifier/);
    assert.equal(result.build, null);
  });
}

// Accepting a branch or abbreviated revision would let a moving checkout choose the source.
for (const revision of ["HEAD", "a".repeat(39), "A".repeat(40), null]) {
  test("verifier build refuses invalid source pin " + JSON.stringify(revision), { timeout: 20000 }, async t => {
    const f = await fixture(t);
    await f.pin(revision);
    const result = await f.run();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid pinned verifier source/);
    assert.equal(result.build, null);
  });
}

test("verifier build refuses an unavailable full commit instead of using the checkout head", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.pin("0".repeat(40));
  const result = await f.run();
  assert.equal(result.code, 1);
  assert.equal(result.build, null);
});

test("release generation failure prevents a build and removes its populated context", { timeout: 20000 }, async t => {
  const f = await fixture(t, { generatorFails: true });
  const result = await f.run();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /controlled release generation refusal/);
  assert.equal(result.build, null);
});

// Swallowing a command failure or omitting finally cleanup must fail these controls.
for (const exit of ["0", "27"]) {
  test("build command exit " + exit + " preserves the outcome and removes its private context", { timeout: 20000 }, async t => {
    const f = await fixture(t);
    const result = await f.run({ BUILD_EXIT: exit });
    assert.equal(result.code, exit === "0" ? 0 : 1);
    assert.ok(result.build, "the valid pinned source must reach the build boundary");
    assert.deepEqual(result.build.release, { sourceCommit: f.revision });
    assert.ok(result.build.args.includes("cloud.waitron-revision=" + f.revision));
    assert.deepEqual(result.build.args.slice(0, 3), ["build", "--secret", "id=npm_token,env=NODE_AUTH_TOKEN"]);
    if (exit === "27") assert.match(result.stderr, /controlled image build refusal/);
    else assert.equal(result.stderr, "");
  });
}
