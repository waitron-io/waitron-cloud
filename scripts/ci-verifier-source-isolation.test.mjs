import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const repository = new URL("../", import.meta.url);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "cloud-verifier-source-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source with spaces"), cloud = join(root, "cloud");
  const temporary = join(root, "temporary"), bin = join(root, "bin"), capture = join(root, "capture");
  for (const directory of [temporary, bin, join(source, "scripts"), join(cloud, "scripts"),
    join(cloud, "deploy/backup-verifier"), join(cloud, "packages/backups/src")]) {
    await mkdir(directory, { recursive: true });
  }
  for (const path of ["scripts/build-backup-verifier.mjs", "deploy/backup-verifier/Dockerfile",
    ...["container-entry.mjs", "waitron-verifier.ts", "waitron-verify-child.mjs", "verify-process.ts",
      "verification-protocol.ts", "verification-transport.ts", "waitron-data-verify-child.mjs"]
      .map(name => "packages/backups/src/" + name)]) {
    await copyFile(new URL(path, repository), join(cloud, path));
  }
  await writeFile(join(source, "package.json"), '{"type":"module"}');
  await writeFile(join(source, ".gitignore"), ".env\nprivate/\n");
  await writeFile(join(source, "venue-settings.json"), '{"origin":"committed"}\n');
  await writeFile(join(source, "scripts/generate-hour-release.mjs"),
    'export function generateHourRelease({source}) { return {sourceCommit:source, origin:"committed"}; }');
  const git = async (...args) => (await execute("git", args, { cwd: source })).stdout.trim();
  await git("init", "-q");
  await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-s", "-qm", "source fixture");
  const revision = await git("rev-parse", "HEAD");
  await writeFile(join(cloud, "deploy/backup-verifier/target.json"),
    JSON.stringify({ runtime: { revision }, digest: "a".repeat(64) }));
  // Capture the actual context passed to the build command without contacting Docker.
  const command = join(bin, "docker");
  await writeFile(command, `#!${process.execPath}
const fs = require("node:fs");
fs.cpSync(process.argv.at(-1), process.env.CONTEXT_CAPTURE, {recursive:true});
`);
  await chmod(command, 0o700);
  async function build() {
    const before = await git("status", "--porcelain", "--ignored");
    const { stdout, stderr } = await execute(process.execPath, [join(cloud, "scripts/build-backup-verifier.mjs")], {
      env: { ...process.env, WAITRON_CHECKOUT: source, NODE_AUTH_TOKEN: "synthetic-build-only",
        CONTEXT_CAPTURE: capture, PATH: bin + ":" + process.env.PATH,
        TMPDIR: temporary, TMP: temporary, TEMP: temporary }, timeout: 10000,
    });
    assert.equal(stdout, "");
    assert.equal(stderr, "");
    assert.deepEqual(await readdir(temporary), [], "the private build context must be removed");
    assert.equal(await git("status", "--porcelain", "--ignored"), before, "building must preserve the source checkout");
    return join(capture, "waitron");
  }
  return { source, git, revision, build };
}

// Copying the working tree or archiving the index would publish local edits.
for (const staged of [false, true]) {
  test("verifier context excludes " + (staged ? "staged" : "unstaged") + " tracked edits", { timeout: 20000 }, async t => {
    const f = await fixture(t);
    const path = join(f.source, "venue-settings.json");
    await writeFile(path, '{"origin":"local-private-edit"}\n');
    if (staged) await f.git("add", "venue-settings.json");
    const context = await f.build();
    assert.equal(await readFile(join(context, "venue-settings.json"), "utf8"), '{"origin":"committed"}\n');
    assert.equal(await readFile(path, "utf8"), '{"origin":"local-private-edit"}\n');
  });
}

test("verifier context excludes ignored credentials and untracked venue data", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await mkdir(join(f.source, "private"));
  const files = [".env", "private/credentials.json", "venue-export.json"];
  for (const path of files) await writeFile(join(f.source, path), "synthetic-private-input");
  const context = await f.build();
  for (const path of [...files, ".git/config"]) {
    await assert.rejects(readFile(join(context, path)), { code: "ENOENT" });
  }
  for (const path of files) assert.equal(await readFile(join(f.source, path), "utf8"), "synthetic-private-input");
});

// Importing the generator from the checkout would execute a local replacement.
test("verifier release stamp uses the committed generator despite its staged replacement", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await writeFile(join(f.source, "scripts/generate-hour-release.mjs"),
    'export function generateHourRelease({source}) { return {sourceCommit:source, origin:"local-replacement"}; }');
  await f.git("add", "scripts/generate-hour-release.mjs");
  const context = await f.build();
  assert.deepEqual(JSON.parse(await readFile(join(context, "build/hour-release.json"), "utf8")),
    { sourceCommit: f.revision, origin: "committed" });
});
