# Shared UI extraction implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan
> inline. The owner has authorised automatic finishing and landing. Run one Claude
> whole-branch review during finishing; do not dispatch per-task agents.

**Goal:** Give Waitron and Cloud one tested, versioned implementation of the controls
needed for account forms.

**Architecture:** Extract `@waitron/ui-core` inside Waitron and retain `@waitron/ui`
as its compatibility entry point. Build and install a tarball into an isolated browser
fixture to prove the package works outside the workspace.

**Tech stack:** Node 24+, pnpm 9.15.0, TypeScript, Lit 3, esbuild, Vitest,
Playwright Chromium and axe-core. Reuse Waitron's dependency versions and lockfile.

**Spec:** [Approved shared UI extraction](../specs/2026-09-23-shared-ui-extraction-design.md).
This plan awaits written-plan review. Source inspection used Waitron commit
`00786ae779d130f077b1b9dcd8cd45d11c4b702f`; the tests below are work to perform.

## Global constraints

- Keep source in Waitron's `packages/ui-core`, initially private and version `0.1.0`.
- Preserve tags, properties, events, styling, focus and keyboard behaviour.
- Runtime dependencies are Lit and browser APIs; Lit is an external peer dependency.
- Preserve `@waitron/ui` root and existing deep JavaScript import paths with re-exports.
- Keep one component implementation and registration, including when entry points mix.
- Keep venue controls, content-language state, floor styles and brand assets in Waitron.
- Preserve behavioural and accessibility assertions; use real Chromium.
- Carry coverage thresholds of 98% statements, lines and functions, 95% branches,
  and the weekly mutation threshold of 90% into the new package.
- Keep existing licensing and notices. Publication, registry credentials and Cloud
  account screens belong to subsequent work.
- Use signed-off commits and normal hooks. Run focused checks locally; CI owns the
  mandatory package coverage gate. Finish and land automatically after verification.

## Review focus

1. Mixed old/new imports must share constructors, icon registry and identifier state
   without duplicate custom-element registration (task 1).
2. Password-manager fields, reveal controls, errors and Enter submission must retain
   their browser behaviour after bundling (tasks 1 and 2).
3. Theme installation must work repeatedly in document and shadow roots, with light
   and dark themes and no dependency on Vite's CSS loader (tasks 1 and 2).
4. A tarball consumer must resolve JavaScript, declarations and assets without
   workspace links; a component import must not register unrelated controls (task 2).
5. Moving source must not remove coverage, accessibility, source guards or weekly
   mutation checks; a core-only change must select the UI CI job (task 3).

## Preparation

- [ ] Read Waitron's `CLAUDE.md` and developer guides for UI conventions, design
  system, testing, workflow, CI gates and writing claims. Recheck the current diff
  against the inspected commit before applying this file map.
- [ ] Create `refactor/shared-ui-core` with
  `python3 ~/workspace/tools/worktree.py new waitron refactor/shared-ui-core`.
  Leave the main checkout's untracked `docs/compliance/asesor-screening-brief.md`
  untouched. Use the worktree's managed environment if a development server is needed.
- [ ] Copy this approved plan and its spec into the same paths in the Waitron
  worktree, recording the Cloud source commit, so the reviewer receives both.

## Task 1: Extract controls and preserve Waitron imports

**Files, relative to the Waitron worktree:**

- Create `packages/ui-core/package.json`, `tsconfig.json`, `vitest.config.ts` and
  `stryker.config.json`; modify `packages/ui/package.json` and `pnpm-lock.yaml`.
- Move these component stems from `packages/ui/src/components/` to
  `packages/ui-core/src/components/`, together with their `.test.ts` and
  `.a11y.test.ts` files: `wt-button`, `wt-input`, `wt-card`, `wt-icon`, `wt-spinner`,
  `wt-form-actions`, `wt-form-error-summary`.
- Move `interactive.ts`, `submit-on-enter.ts` and their tests, plus `tokens/`,
  from `packages/ui/src/` to `packages/ui-core/src/`.
- Split `packages/ui/src/base-styles.ts` and its tests: move `baseStyles` and
  `disabledStyles` into `packages/ui-core/src/base-styles.ts`; keep `selectStyles`
  and `floorTrayStyles` in the original module.
- Create `packages/ui-core/src/index.ts` and
  `packages/ui/src/core-compatibility.test.ts`. Keep the old moved runtime module
  paths as re-exports, including `tokens/index.ts`.
- Copy test-only support into core: `test-helpers.ts`, `a11y-helpers.ts`,
  `a11y-helpers.test.ts`, `harness.test.ts`, `vitest-park-pointer.ts`, `vite-env.d.ts`.
  Keep Waitron's copies for existing consumers. These are excluded from the artifact.
- Add core versions of `no-hardcoded-chrome.test.ts` and
  `tap-target-and-focus.test.ts`, with expected controls limited to core. Preserve
  the original guards over Waitron's remaining controls and compatibility exports.
- Update `packages/layouts/src/theme-registry.test.ts` to read the moved token CSS;
  update its companion `theme.ts` comment and other source-path references found
  by `rg 'ui/src/tokens' apps packages`. Brand asset paths stay in place.

**Interfaces:** Existing component classes and types keep their signatures.
Core exports the seven components, `registerIcons(icons: Record<string, string>): void`,
`applyTokens(root: HTMLElement): void`,
`submitOnEnter(event: KeyboardEvent, button: HTMLElement | null): void`,
`uniqueId(prefix: string): string`, `dispatchWtChange<T>(host: HTMLElement,
event: Event, detail: T): void`, `delegatesFocusShadowRootOptions`, `baseStyles`
and `disabledStyles`. Expose `.` plus `/components/<stem>`, `/tokens`,
`/interactive`, `/base-styles` and `/submit-on-enter` through package exports.

- [ ] Add compatibility assertions before moving implementation. For example:

  ```ts
  import { WtInput as CoreInput } from "@waitron/ui-core/components/wt-input";
  import { WtInput as LegacyInput } from "./components/wt-input.js";
  import { WtInput as RootInput } from "./index.js";

  test("all entry points share the registered input", () => {
    expect(CoreInput).toBe(LegacyInput);
    expect(RootInput).toBe(CoreInput);
    expect(customElements.get("wt-input")).toBe(CoreInput);
  });
  ```

  Extend this to all seven constructors. Register an icon through core and render it
  through the facade; alternate calls to old/new `uniqueId` and require distinct IDs.
- [ ] Run `pnpm --filter @waitron/ui test src/core-compatibility.test.ts`.
  Expect failure resolving the absent core package. Save the failing output.
- [ ] Move the source and tests, keeping assertions intact. Give core the same Lit,
  browser-test and TypeScript settings as UI; use source entries in workspace exports.
  Add `"@waitron/ui-core": "workspace:*"` to UI. Each moved facade is a re-export:

  ```ts
  export * from "@waitron/ui-core/components/wt-input";
  ```

  Core's test config registers its own pointer-parking and colour-scheme commands.
  It must not import UI to obtain test support. Split mixed style assertions so
  each remains over the implementation it originally tested.
- [ ] Run the compatibility test again and the moved core suite:
  `pnpm --filter @waitron/ui-core test`. Run UI's retained style/source guards and
  `pnpm --filter @waitron/layouts test src/theme-registry.test.ts`.
  Require passing assertions for shadow-root events, input names/autocomplete,
  password-reveal slots, disabled controls, Enter modifiers/composition, error
  summaries and repeated token installation. Existing component tests supply these;
  add a failing behavioural test first for any uncovered case.
- [ ] Run focused typechecks for `@waitron/ui-core`, `@waitron/ui`, `@waitron/till`,
  `@waitron/dashboard` and `@waitron/setup`. Inspect the renamed-test diff to ensure
  no assertions disappeared. Commit with `git commit -s`.

## Task 2: Build and prove the installed package

**Files:** Create `packages/ui-core/scripts/build.mjs`, `tsconfig.build.json`,
`test/package-consumer.test.mjs`, `test/consumer/index.html`,
`test/consumer/main.ts`, `test/consumer/input-only.ts`, `test/consumer/tsconfig.json`
and `README.md`. Modify `packages/ui-core/package.json` and `pnpm-lock.yaml`.

**Interfaces:** `pnpm --filter @waitron/ui-core build` produces `dist/` browser ESM,
declarations, token CSS and unchanged licence/notice files. `prepack` runs that build.
`pnpm --filter @waitron/ui-core test:package` runs the installed-artifact proof.
Workspace exports resolve source; `publishConfig.exports` resolves built files:

```json
{
  "exports": {".": "./src/index.ts", "./components/wt-input": "./src/components/wt-input.ts"},
  "publishConfig": {"exports": {
    ".": {"types": "./dist/types/index.d.ts", "import": "./dist/index.js"},
    "./components/wt-input": {
      "types": "./dist/types/components/wt-input.d.ts",
      "import": "./dist/components/wt-input.js"
    }
  }}
}
```

Apply that mapping to every entry listed in task 1. Export the two token CSS files
as `/tokens/colors.css` and `/tokens/structure.css`. The installed pnpm 9.15.0
was probed with a temporary private package: `pnpm pack` replaced its source exports
with `publishConfig.exports`. The real package test must verify its own manifest.

- [ ] Write `test/package-consumer.test.mjs` using Node's test runner and Playwright.
  It packs core, copies the fixture into a fresh OS temporary directory outside the
  workspace, installs only that tarball and Lit, typechecks it, bundles it and serves
  it on a loopback ephemeral port. Use exact Lit versions resolved from the workspace
  lockfile and `pnpm install --ignore-workspace --no-frozen-lockfile --ignore-scripts`
  in that temporary directory. Use the worktree's esbuild, TypeScript and Playwright
  executables, but resolve consumer imports only from the temporary fixture, with no
  aliases or extra module search paths. Close browser/server and remove the fixture
  in `finally`; bound child commands and the test with timeouts.
- [ ] Run `pnpm --filter @waitron/ui-core test:package`. Expect failure because the
  tarball still exposes source or lacks built exports. Do not accept a failure caused
  by unavailable Chromium or package-registry access as the intended red test.
- [ ] Build all entry points together using esbuild ESM splitting, `bundle: true`,
  `platform: "browser"`, `external: ["lit", "lit/*"]` and the existing decorator
  settings. Compile inline CSS with an esbuild plugin:

  ```js
  build.onLoad({ filter: /\.css\?inline$/ }, async ({ path }) => ({
    contents: await readFile(path.slice(0, -"?inline".length), "utf8"),
    loader: "text",
  }));
  ```

  Pair this with an `onResolve` handler resolving the CSS file against `resolveDir`
  into a dedicated namespace while retaining `?inline`. Emit declarations with
  `tsc -p tsconfig.build.json --emitDeclarationOnly`, excluding tests and helpers.
  Copy both token CSS files and root `LICENSE`/`LICENSE-GRANTS.md` into `dist/`.
  Restrict packed files to `dist/` and README; keep element-registration side effects.
  Assert packed notice bytes match the root originals.
- [ ] Make `main.ts` render a named email input (`autocomplete="email"`), password
  input (`autocomplete="current-password"`) with its reveal slot, submit button,
  card, spinner, icon, form actions and error summary. Use `submitOnEnter` for keyboard
  submission. An invalid submit sets `errors` on the summary and focuses the first
  invalid field; a valid submit increments a visible counter. This is fixture logic,
  not a new shared form controller or Cloud authentication implementation.
- [ ] Assert in real Chromium: Enter submits once; modifiers/composition do not;
  invalid data exposes readable errors; native input names/autocomplete survive;
  reveal works; light/dark computed colours change; document and shadow roots receive
  tokens without duplicate sheets. Run axe for both themes. Import root plus explicit
  entries and assert constructor identity, one registration and no browser errors.
  In a fresh browser context load `input-only.ts` and assert:

  ```ts
  expect(await page.evaluate(() => !!customElements.get("wt-input"))).toBe(true);
  expect(await page.evaluate(() => !!customElements.get("wt-card"))).toBe(false);
  ```

  In the Node runner use `node:assert/strict` equivalents of these assertions.
- [ ] Rerun `test:package`; require success from the installed artifact, including
  TypeScript declaration checking with `skipLibCheck: false`. Assert no runtime
  `@waitron/shared` dependency and no shipped tests/source aliases. As a negative
  control, remove an exported JS file from the temporary installed copy and require
  rebuilding the fixture to fail. Document install/import examples and commit signed off.

## Task 3: Retain CI coverage and land the extraction

**Files:** Modify `scripts/changed-scope.mjs`, `scripts/changed-scope.test.mjs`,
`scripts/ci-workflow.test.mjs`, `scripts/coverage-thresholds.test.ts`,
`.github/workflows/ci.yml`, `.github/workflows/mutation.yml`,
`docs/developers/design-system.md` and `docs/backlog.md` in Waitron.

**Interfaces:** Keep `UI_PACKAGE = "@waitron/ui"` and the `ui` gate name. Add
`UI_CORE_PACKAGE = "@waitron/ui-core"` to `OWN_SHARD_PACKAGES`. The existing UI
job runs coverage for both packages sequentially, followed by `test:package`.

- [ ] Trace every consumer of `UI_PACKAGE`, `OWN_SHARD_PACKAGES` and the UI workflow
  filters before changing them. Add a core-only row to the existing exclusive-gate
  test; assert `ui=true` and every other gate false. Add workflow assertions that both
  UI packages run in `test-ui`, both are excluded from light shards, and the packed
  consumer proof runs there. Assert both weekly mutation packages and report paths.
- [ ] Run `pnpm exec vitest run scripts/changed-scope.test.mjs scripts/ci-workflow.test.mjs`.
  Expect the added core scope and workflow assertions to fail against the old wiring.
- [ ] Make the UI predicate cover either package, keeping the singular constant's
  meaning unchanged:

  ```js
  { output: "ui", covers: (scope) =>
    scope.has(UI_PACKAGE) || scope.has(UI_CORE_PACKAGE) }
  ```

  Update both light-shard exclusion lists and the UI runnable guard. Run coverage
  with both explicit filters and `--workspace-concurrency=1`. Add core to
  `HIGH_BAR_PACKAGES`. Extend the weekly UI mutation job to a two-package matrix
  with distinct report names/paths and `fail-fast: false`; preserve its 90% gate.
- [ ] Run the changed root tests plus `scripts/coverage-thresholds.test.ts`,
  `scripts/park-pointer-registered.test.ts` and `scripts/guarded-teardowns.test.ts`.
  Require pass. Run the relevant core source guards and installed-package proof after
  any build changes. Inspect the real resolved package scope to verify core changes
  include UI's downstream consumers. CI runs mandatory coverage for the current head;
  do not duplicate the full workspace suite locally.
- [ ] Document how Waitron develops core and how the compatibility imports work.
  Update Waitron's backlog in this branch; keep private distribution and Cloud screens
  explicitly open. Make a signed-off commit.
- [ ] Run `finish-branch`: rebase as needed, create an isolated complete candidate with
  locked dependencies, run one Claude run-it review, triage findings and apply fixes
  with failing tests first. Push through normal hooks and wait for current-head CI.
- [ ] Run `land-branch` automatically, confirm the merge, refresh main dependencies
  and remove only this task's managed worktree and local/remote branches. Update the
  Cloud backlog in its own automatically finished/landed docs PR with the Waitron PR
  receipt and next action: configure private distribution, then build account screens.

## Completion evidence

Record the compatibility and preserved-test results, installed-tarball browser/type
checks, CI run and head SHA, review findings, and merge/cleanup receipts. The work
is complete when Waitron consumes the extracted implementation and those checks pass.
No live registry publication or Cloud account-screen delivery is claimed by this plan.
