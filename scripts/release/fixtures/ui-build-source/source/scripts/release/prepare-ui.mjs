import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
  realpath,
  stat,
  chmod,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL, URL } from "node:url";

const hash = (bytes) => createHash("sha512").update(bytes).digest("hex");
const BUILD_ENV = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "SystemRoot",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
]);
const env = () =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => BUILD_ENV.has(key)));
const run = (file, args, cwd, overrides = {}) =>
  execFileSync(file, args, {
    cwd,
    env: { ...env(), ...overrides },
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
const outside = (parent, child) => {
  const path = relative(parent, child);
  return path.startsWith("../") || path === ".." || isAbsolute(path);
};

export function releaseManifest(packed, source, releaseVersion) {
  assert.equal(source.repository, "clintongormley/waitron", "unexpected source repository");
  assert.match(source.commit, /^[a-f0-9]{40}$/, "source commit must be a full SHA");
  assert.match(
    releaseVersion,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    "invalid release version",
  );
  assert.equal(packed.name, "@waitron/ui-core", "unexpected source package name");
  assert.equal(packed.version, source.version, "unexpected source version");
  assert.deepEqual(packed.dependencies ?? {}, {}, "runtime dependencies must remain external");
  assert.deepEqual(
    packed.optionalDependencies ?? {},
    {},
    "runtime dependencies must remain external",
  );
  assert.deepEqual(
    packed.bundledDependencies ?? [],
    [],
    "runtime dependencies must remain external",
  );
  assert.deepEqual(
    packed.bundleDependencies ?? [],
    [],
    "runtime dependencies must remain external",
  );
  assert.deepEqual(packed.peerDependencies, { lit: "^3.2.0" }, "Lit must remain a peer");
  assert.equal(packed.license, "SEE LICENSE IN dist/LICENSE", "unexpected licence");
  assert(packed.exports?.["."]?.import && packed.exports["."].types, "built exports required");
  for (const value of Object.values(packed.exports)) {
    for (const target of typeof value === "string" ? [value] : Object.values(value)) {
      assert(
        typeof target === "string" &&
          target.startsWith("./dist/") &&
          !target.split("/").includes(".."),
        "built exports required",
      );
    }
  }
  const manifest = { ...packed };
  for (const key of ["private", "scripts", "devDependencies", "publishConfig"])
    delete manifest[key];
  return {
    ...manifest,
    name: "@waitron-io/ui-core",
    version: releaseVersion,
    repository: { type: "git", url: "https://github.com/waitron-io/waitron-cloud.git" },
    homepage: `https://github.com/${source.repository}/tree/${source.commit}/packages/ui-core`,
    waitronSource: { ...source },
    publishConfig: { registry: "https://npm.pkg.github.com", access: "restricted" },
  };
}

export async function prepareUi({ checkout, output, releaseVersion, sourceCommit }) {
  assert.match(sourceCommit, /^[a-f0-9]{40}$/, "source commit must be a full SHA");
  assert.match(
    releaseVersion,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    "invalid release version",
  );
  checkout = await realpath(checkout);
  output = await realpath(output);
  assert.equal(
    await realpath(run("git", ["rev-parse", "--show-toplevel"], checkout).trim()),
    checkout,
    "checkout must be the repository top level",
  );
  assert(
    !run("git", ["ls-files", "-v"], checkout)
      .split("\n")
      .some((line) => /^[a-zS] /.test(line)),
    "source index flags may hide changes",
  );
  assert(outside(checkout, output), "output must be outside the source checkout");
  assert.equal((await readdir(output)).length, 0, "output must be empty");
  assert.equal(
    run("git", ["rev-parse", "HEAD"], checkout).trim(),
    sourceCommit,
    "checkout must match source commit",
  );
  const clean = () =>
    assert.equal(
      run("git", ["status", "--porcelain", "--untracked-files=normal"], checkout).trim(),
      "",
      "source checkout must be clean",
    );
  clean();
  const original = JSON.parse(
    await readFile(join(checkout, "packages/ui-core/package.json"), "utf8"),
  );
  const source = {
    repository: "clintongormley/waitron",
    commit: sourceCommit,
    version: original.version,
  };
  assert.equal(original.name, "@waitron/ui-core", "unexpected source package name");
  assert.match(
    original.version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    "invalid source version",
  );
  const lock = join(output, ".preparing");
  await mkdir(lock);
  let temp;
  try {
    temp = await realpath(await mkdtemp(join(tmpdir(), "waitron-ui-stage-")));
    run("pnpm", ["run", "build"], join(checkout, "packages/ui-core"));
    run("pnpm", ["pack", "--pack-destination", temp], join(checkout, "packages/ui-core"), {
      npm_config_ignore_scripts: "true",
    });
    clean();
    assert.equal(
      run("git", ["rev-parse", "HEAD"], checkout).trim(),
      sourceCommit,
      "build changed source commit",
    );
    const staged = join(temp, "package");
    await mkdir(staged);
    run(
      "tar",
      [
        "-xzf",
        join(temp, `waitron-ui-core-${source.version}.tgz`),
        "--strip-components=1",
        "-C",
        staged,
      ],
      checkout,
    );
    const packed = JSON.parse(await readFile(join(staged, "package.json"), "utf8"));
    const manifest = releaseManifest(packed, source, releaseVersion);
    for (const value of Object.values(manifest.exports)) {
      for (const target of typeof value === "string" ? [value] : Object.values(value)) {
        const file = await realpath(join(staged, target));
        assert(
          !outside(staged, file) && (await stat(file)).isFile(),
          "export target must be a staged file",
        );
      }
    }
    const notices = {};
    for (const notice of ["LICENSE", "LICENSE-GRANTS.md"]) {
      const bytes = await readFile(join(staged, "dist", notice));
      assert.deepEqual(
        bytes,
        await readFile(join(checkout, notice)),
        `packed ${notice} differs from source`,
      );
      notices[notice] = hash(bytes);
    }
    await writeFile(join(staged, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(
      join(staged, "README.md"),
      `# @waitron-io/ui-core

Use these shared account controls in a registry consumer. Release ${releaseVersion} comes from @waitron/ui-core@${source.version} at ${source.commit}. Waitron itself keeps its workspace imports.

\`\`\`ts
import "@waitron-io/ui-core/components/wt-input";
import { applyTokens } from "@waitron-io/ui-core/tokens";

applyTokens(document.querySelector<HTMLElement>("#app")!);
\`\`\`

Install Lit 3 as a peer dependency. The package includes JavaScript, declarations and theme CSS.

Read the [source guide](https://github.com/clintongormley/waitron/blob/${source.commit}/packages/ui-core/README.md) for the controls and workspace development.

The package carries Elastic License 2.0 in dist/LICENSE and its grants in dist/LICENSE-GRANTS.md.
`,
    );
    const normalize = async (directory) => {
      await chmod(directory, 0o755);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        assert(entry.isFile() || entry.isDirectory(), "staged contents must be regular files");
        if (entry.isDirectory()) await normalize(path);
        else await chmod(path, 0o644);
      }
    };
    await normalize(staged);
    run("npm", ["pack", "--ignore-scripts", "--pack-destination", temp], staged);
    const filename = `waitron-io-ui-core-${releaseVersion}.tgz`;
    const bytes = await readFile(join(temp, filename));
    const inputs = {};
    for (const path of run(
      "git",
      [
        "ls-files",
        "-z",
        "--",
        "packages/ui-core",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.base.json",
        "LICENSE",
        "LICENSE-GRANTS.md",
        ".github/workflows",
      ],
      checkout,
    )
      .split("\0")
      .filter(Boolean)) {
      inputs[path] = hash(await readFile(join(checkout, path)));
    }
    assert(
      inputs["packages/ui-core/package.json"] && inputs.LICENSE && inputs["LICENSE-GRANTS.md"],
      "required source inputs missing",
    );
    const recipeSha512 = hash(await readFile(new URL(import.meta.url)));
    const toolchain = {
      node: process.version,
      pnpm: run("pnpm", ["--version"], checkout).trim(),
      npm: run("npm", ["--version"], checkout).trim(),
    };
    const receipt = {
      source,
      releaseVersion,
      inputs,
      recipeSha512,
      toolchain,
      tarball: {
        filename,
        sha512: hash(bytes),
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      },
      manifestSha512: hash(await readFile(join(staged, "package.json"))),
      notices,
    };
    await writeFile(join(lock, filename), bytes);
    await writeFile(join(lock, "preparation.json"), JSON.stringify(receipt, null, 2) + "\n");
    const receiptPath = join(output, "preparation.json");
    await link(join(lock, "preparation.json"), receiptPath);
    try {
      await link(join(lock, filename), join(output, filename));
    } catch (error) {
      await rm(receiptPath);
      throw error;
    }
    return receipt;
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

export async function main(args) {
  const [checkout, output, ...flags] = args;
  assert(
    checkout && output && flags.length === 4,
    "Usage: prepare-ui.mjs <clean checkout> <empty output> --release-version <version> --source-commit <full SHA>",
  );
  const options = Object.fromEntries([flags.slice(0, 2), flags.slice(2, 4)]);
  assert(
    Object.keys(options).length === 2 &&
      Object.hasOwn(options, "--release-version") &&
      Object.hasOwn(options, "--source-commit"),
    "release version and source commit are required",
  );
  return prepareUi({
    checkout,
    output,
    releaseVersion: options["--release-version"],
    sourceCommit: options["--source-commit"],
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href
) {
  await main(process.argv.slice(2));
}
