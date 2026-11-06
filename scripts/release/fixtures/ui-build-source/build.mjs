import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const entryPoints = Object.values(manifest.exports).filter((path) => path.endsWith(".ts"));
await rm(resolve(root, "dist"), { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints,
  outbase: "src",
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["lit", "lit/*"],
  tsconfig: "tsconfig.json",
  plugins: [
    {
      name: "inline-theme-css",
      setup(build) {
        build.onResolve({ filter: /\.css\?(inline|raw)$/ }, ({ path, resolveDir }) => ({
          path: relative(root, resolve(resolveDir, path.replace(/\?(inline|raw)$/, ""))),
          namespace: "theme-css",
        }));
        build.onLoad({ filter: /\.css$/, namespace: "theme-css" }, async ({ path }) => ({
          contents: await readFile(resolve(root, path), "utf8"),
          loader: "text",
        }));
      },
    },
  ],
});
for (const name of ["colors", "structure"]) {
  const target = resolve(root, `dist/tokens/${name}.css`);
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(root, `src/tokens/${name}.css`), target);
}
for (const notice of ["LICENSE", "LICENSE-GRANTS.md"]) {
  await cp(resolve(root, "../..", notice), resolve(root, "dist", notice));
}
