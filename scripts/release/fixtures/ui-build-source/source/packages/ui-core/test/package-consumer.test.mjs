/* global document, customElements, getComputedStyle, KeyboardEvent */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  cp,
  readFile,
  writeFile,
  rm,
  realpath,
  readdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import axe from "axe-core";

const run = promisify(execFile);
const root = dirname(import.meta.dirname);
const command = (args, cwd = root) =>
  run("pnpm", args, { cwd, timeout: 90000, maxBuffer: 4 * 1024 * 1024 });

const variants = process.env.UI_PACKAGE_TARBALL ? ["registry"] : ["workspace", "registry"];
for (const variant of variants)
  test(`a ${variant} release works in an independent browser consumer`, { timeout: 170000 }, () =>
    verifyPackage(variant),
  );

async function verifyPackage(variant) {
  const dir = await mkdtemp(join(tmpdir(), "waitron-ui-consumer-"));
  let browser;
  let server;
  try {
    const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const checkout = join(root, "../..");
    const gitEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    const { stdout: currentCommit } = await run("git", ["rev-parse", "HEAD"], {
      cwd: checkout,
      env: gitEnv,
      timeout: 10000,
    });
    const expectedCommit = process.env.UI_PACKAGE_SOURCE_COMMIT || currentCommit.trim();
    const packageName = variant === "registry" ? "@waitron-io/ui-core" : source.name;
    const tarball =
      variant === "registry"
        ? "waitron-io-ui-core-0.2.0.tgz"
        : `waitron-ui-core-${source.version}.tgz`;
    if (variant === "workspace") await command(["pack", "--pack-destination", dir]);
    else if (process.env.UI_PACKAGE_TARBALL)
      await cp(process.env.UI_PACKAGE_TARBALL, join(dir, tarball));
    else {
      const checkout = join(root, "../..");
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      );
      const { stdout: commit } = await run("git", ["rev-parse", "HEAD"], {
        cwd: checkout,
        env,
        timeout: 10000,
      });
      const stage = join(dir, "stage");
      await mkdir(stage);
      await run(
        process.execPath,
        [
          fileURLToPath(new URL("../../../scripts/release/prepare-ui.mjs", import.meta.url)),
          checkout,
          stage,
          "--release-version",
          "0.2.0",
          "--source-commit",
          commit.trim(),
        ],
        { env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
      );
      await cp(join(stage, tarball), join(dir, tarball));
    }
    const { stdout } = await run("tar", ["-xOf", join(dir, tarball), "package/package.json"], {
      timeout: 10000,
    });
    const packed = JSON.parse(stdout);
    assert.equal(packed.name, packageName);
    if (variant === "registry") {
      assert.match(packed.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
      if (process.env.UI_PACKAGE_RELEASE_VERSION)
        assert.equal(packed.version, process.env.UI_PACKAGE_RELEASE_VERSION);
      assert.equal(packed.waitronSource.commit, expectedCommit);
      assert.deepEqual(packed.repository, {
        type: "git",
        url: "https://github.com/waitron-io/waitron-cloud.git",
      });
      assert.equal(
        packed.homepage,
        `https://github.com/clintongormley/waitron/tree/${expectedCommit}/packages/ui-core`,
      );
      assert.deepEqual(packed.publishConfig, {
        registry: "https://npm.pkg.github.com",
        access: "restricted",
      });
      assert.equal(packed.waitronSource.version, source.version);
      assert.equal(packed.waitronSource.repository, "clintongormley/waitron");
      assert.match(packed.waitronSource.commit, /^[a-f0-9]{40}$/);
      for (const key of ["private", "scripts", "devDependencies"]) assert(!(key in packed));
    }
    assert.equal(
      packed.exports["."].import,
      "./dist/index.js",
      "tarball must expose built JavaScript",
    );
    assert.equal(packed.exports["."].types, "./dist/types/index.d.ts");
    assert.deepEqual(packed.exports["./unsaved-changes"], {
      types: "./dist/types/unsaved-changes.d.ts",
      import: "./dist/unsaved-changes.js",
    });
    assert.deepEqual(packed.dependencies ?? {}, {});
    assert.deepEqual(packed.peerDependencies, { lit: "^3.2.0" });
    const files = (await run("tar", ["-tf", join(dir, tarball)], { timeout: 10000 })).stdout
      .split("\n")
      .filter(Boolean);
    assert(
      files.every((name) => /^(package\/(dist\/|package.json$|README.md$))/.test(name)),
      files.join("\n"),
    );
    assert(
      !files.some((name) => /\.test\.|test-helpers|\.ts$/.test(name) && !name.endsWith(".d.ts")),
    );
    assert.deepEqual(Object.keys(packed.exports).sort(), Object.keys(source.exports).sort());
    for (const [entry, target] of Object.entries(packed.exports)) {
      for (const path of typeof target === "string" ? [target] : Object.values(target)) {
        assert(
          files.includes(`package/${path.replace(/^\.\//, "")}`),
          `${entry} must resolve to a packed file: ${path}`,
        );
      }
    }
    await cp(join(root, "test/consumer"), dir, { recursive: true });
    if (variant === "registry") {
      for (const file of ["main.ts", "input-only.ts"]) {
        const path = join(dir, file);
        await writeFile(
          path,
          (await readFile(path, "utf8")).replaceAll("@waitron/ui-core", packageName),
        );
      }
    }
    const lit = JSON.parse(await readFile(join(root, "node_modules/lit/package.json"), "utf8"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { [packageName]: `file:./${tarball}`, lit: lit.version },
      }),
    );
    await command(
      ["install", "--ignore-workspace", "--no-frozen-lockfile", "--ignore-scripts"],
      dir,
    );
    const installed = join(dir, "node_modules", packageName);
    assert(
      (await realpath(installed)).startsWith(await realpath(dir)),
      "package must not link back to the workspace",
    );
    for (const notice of ["LICENSE", "LICENSE-GRANTS.md"]) {
      assert.equal(
        await readFile(join(installed, "dist", notice), "utf8"),
        await readFile(join(root, "../..", notice), "utf8"),
      );
    }
    for (const name of ["colors", "structure"]) {
      assert.equal(
        await readFile(join(installed, `dist/tokens/${name}.css`), "utf8"),
        await readFile(join(root, `src/tokens/${name}.css`), "utf8"),
      );
    }
    await command(["exec", "tsc", "-p", join(dir, "tsconfig.json")]);
    const options = {
      absWorkingDir: dir,
      entryPoints: ["main.ts", "input-only.ts"],
      outdir: join(dir, "out"),
      bundle: true,
      format: "esm",
      platform: "browser",
      metafile: true,
      logLevel: "silent",
    };
    const result = await build(options);
    for (const path of Object.keys(result.metafile.inputs))
      assert(!path.includes(root), `workspace import: ${path}`);
    const assets = new Map([
      ["/", ["text/html", await readFile(join(dir, "index.html"))]],
      [
        "/input-only",
        [
          "text/html",
          (await readFile(join(dir, "index.html"), "utf8")).replace("/main.js", "/input-only.js"),
        ],
      ],
      ["/main.js", ["text/javascript", await readFile(join(dir, "out/main.js"))]],
      ["/input-only.js", ["text/javascript", await readFile(join(dir, "out/input-only.js"))]],
    ]);
    server = createServer((req, res) => {
      const asset = assets.get(req.url);
      res.writeHead(asset ? 200 : 404, { "Content-Type": asset?.[0] ?? "text/plain" });
      res.end(asset?.[1] ?? "Not found");
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForSelector('body[data-ready="true"]');
    assert.equal(await page.getAttribute("body", "data-theme-primary"), "#1f6feb");
    assert.equal(await page.getAttribute("body", "data-leave-outcomes"), "kept/proceeded/1");
    const email = page.locator("#email input");
    const password = page.locator("#password input");
    assert.equal(await email.getAttribute("name"), "email");
    assert.equal(await email.getAttribute("autocomplete"), "email");
    assert.equal(await password.getAttribute("name"), "password");
    assert.equal(await password.getAttribute("autocomplete"), "current-password");
    await page.locator("#submit button").click();
    await page.waitForSelector('wt-form-error-summary [role="alert"]');
    assert.equal(await page.locator("wt-form-error-summary li").count(), 2);
    assert.equal(await email.getAttribute("aria-invalid"), "true");
    assert.equal(await password.getAttribute("aria-invalid"), "true");
    assert(await email.evaluate((el) => el.getRootNode().activeElement === el));
    await email.fill("owner@venue.example");
    await password.fill("example password");
    await page.locator("#reveal button").click();
    assert.equal(await password.getAttribute("type"), "text");
    assert.equal(await password.inputValue(), "example password");
    assert.equal(await page.locator("#reveal button").getAttribute("aria-label"), "Hide password");
    await password.press("Enter");
    await page.waitForFunction(() => document.querySelector("#submissions").textContent === "1");
    assert.equal(await page.locator('wt-form-error-summary [role="alert"]').count(), 0);
    for (const modifier of ["Shift", "Alt", "Control", "Meta"])
      await password.press(`${modifier}+Enter`);
    await password.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: true,
          bubbles: true,
          composed: true,
        }),
      ),
    );
    assert.equal(await page.locator("#submissions").textContent(), "1");
    await page.addScriptTag({ content: axe.source });
    assert.deepEqual(await page.evaluate(async () => (await globalThis.axe.run()).violations), []);
    await password.fill("");
    await page.locator("#submit button").click();
    await page.waitForSelector('wt-form-error-summary [role="alert"]');
    const colours = [];
    for (const theme of ["light", "dark"]) {
      await page.locator("#app").evaluate((el, theme) => {
        el.dataset.theme = theme;
      }, theme);
      await page.mouse.move(-1, -1);
      colours.push(
        await page.locator("#app").evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      await page.locator("#nested-theme").evaluate((el, theme) => {
        el.dataset.theme = theme === "light" ? "dark" : "light";
      }, theme);
      const nestedColour = await page
        .locator("#nested-theme")
        .evaluate((el) => getComputedStyle(el).color);
      assert.notEqual(
        nestedColour,
        await page.locator("#app").evaluate((el) => getComputedStyle(el).color),
        "shadow-root tokens resolve independently of the outer theme",
      );
      const violations = await page.evaluate(async () => (await globalThis.axe.run()).violations);
      assert.deepEqual(violations, []);
      if (process.env.UI_PACKAGE_SCREENSHOTS)
        await page.screenshot({
          path: join(process.env.UI_PACKAGE_SCREENSHOTS, `${variant}-${theme}.png`),
          fullPage: true,
        });
    }
    assert.notEqual(colours[0], colours[1]);
    assert(!colours.includes("rgba(0, 0, 0, 0)"));
    assert.deepEqual(errors, []);
    await context.close();
    const isolated = await browser.newContext();
    const single = await isolated.newPage();
    await single.goto(`${origin}/input-only`);
    await single.waitForSelector('body[data-ready="true"]');
    assert.equal(await single.evaluate(() => !!customElements.get("wt-input")), true);
    assert.equal(await single.evaluate(() => !!customElements.get("wt-card")), false);
    assert.equal(await single.evaluate(() => !!customElements.get("wt-button")), false);
    await isolated.close();
    await rm(join(installed, "dist/components/wt-input.js"));
    await assert.rejects(build(options), /Could not resolve/);
  } finally {
    try {
      await browser?.close();
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await rm(dir, { recursive: true, force: true });
    }
  }
}

test(
  "JavaScript builds have identical bytes in different checkout directories",
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "waitron-ui-portable-"));
    try {
      const results = [];
      for (const name of ["first", "second"]) {
        const checkout = join(directory, name);
        const destination = join(checkout, "packages/ui-core");
        await mkdir(join(destination, "scripts"), { recursive: true });
        for (const file of ["package.json", "tsconfig.json", "scripts/build.mjs"])
          await cp(join(root, file), join(destination, file));
        await cp(join(root, "src"), join(destination, "src"), { recursive: true });
        for (const file of ["tsconfig.base.json", "LICENSE", "LICENSE-GRANTS.md"])
          await cp(join(root, "../..", file), join(checkout, file));
        await symlink(join(root, "node_modules"), join(destination, "node_modules"), "dir");
        await run(process.execPath, ["scripts/build.mjs"], {
          cwd: destination,
          timeout: 20000,
          maxBuffer: 4 * 1024 * 1024,
        });
        const files = (await readdir(join(destination, "dist"), { recursive: true }))
          .filter((file) => file.endsWith(".js"))
          .sort();
        const bytes = {};
        for (const file of files)
          bytes[file] = createHash("sha512")
            .update(await readFile(join(destination, "dist", file)))
            .digest("hex");
        results.push(bytes);
      }
      assert.deepEqual(
        results[0],
        results[1],
        "checkout directory must not affect JavaScript bytes or chunk filenames",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
