# Public UI registry implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` for later implementation, task by task. Step 1 is a reviewed planning checkpoint. All unchecked implementation steps remain open. Registry publication and the Cloud migration wait for the gates below.

**Goal:** Install Waitron's current account controls publicly, without package credentials, and keep Cloud upgrades visible and time bounded.

**Architecture:** Waitron A1336 owns staging and automatic npm releases. Cloud consumes exact public versions, opens one upgrade PR per stable release, and checks freshness independently of dependency selection. Keep source identity, lockfile integrity and portal behavior together in one Cloud migration PR.

**Tech stack:** Node 26, pnpm 9.15.0, npmjs.org, GitHub Actions, Lit, Chromium and the existing PostgreSQL test wrapper.

**Approved design:** Waitron keeps `workspace:*` consumers and publishes each changed-core main merge through Trusted Publishing. Cloud retires its publisher, installs exact public releases, opens an update PR for every new version, and fails CI when its pin is too far behind. The owner performs the first public publish. This document proposes the package name, bootstrap procedure and seven-day limit for that handoff.

## Constraints and evidence

- Step 1 prepares the plan and one owner/watcher decision. No package publication, Cloud implementation, push or landing belongs to this step.
- Cloud baseline: `800717778b6ca28779ed7c0347b0911f8bd56148` (`git rev-parse HEAD`); initial `git status --short` was empty.
- Read-only Waitron source: `c115dbad87ce8e27f0497bdbe31dd304c1ae9ff0`; `git -C /Users/clintongormley/workspace/repos/waitron rev-parse origin/main` agreed, and `git status --short` was empty. No fetch or install there.
- Current published source is `0a93f4d3557b669661ac8f589aad866e2cd9653f`, version `0.1.0` (`scripts/release/ui-source.json:2-4`). Current Waitron source still declares `0.1.0`; version alone cannot identify these bytes.
- Inspect immutable Waitron files with `git -C /Users/clintongormley/workspace/repos/waitron show c115dbad87ce8e27f0497bdbe31dd304c1ae9ff0:packages/ui-core/package.json` and the same command for each source path below.
- Measurements below use the two exact source revisions. Build and browser results concern a disposable current-source tarball; the eventual public release must pass its own install and image gates.
- Preserve source-revision checks, source archive isolation, sandbox boundaries, transaction assertions and fiscal assertions. Do not change Waitron workspace consumers from `workspace:*` or make its source manifest public.
- Future feature/bugfix work uses TDD: print the expected failing behavioral test, implement minimally, then print its passing result. Prove each new guard by omitting it in a disposable copy and observing failure.
- No lane runs `npm publish` except with `--dry-run`. First publication belongs to the owner; later publication belongs to the approved Waitron workflow.

## Review focus

These five acceptance tests belong to the tasks below, rather than a separate review exercise:

- Task 1, `rejects installed source mismatch`: a correct version with the wrong source SHA fails, while the selected public artifact passes.
- Task 2, `cold descendants install anonymously`: all five workflow entry points fetch without Authorization; corrupted tarball integrity still fails.
- Task 4, `reconciles every version after interrupted polling`: two releases produce two distinct PRs; retry after each partial operation produces no duplicate.
- Task 4, `rejects dispatch for a replaced head`: success for an older SHA cannot validate the current PR, and each required workflow runs for the new SHA.
- Task 5, `freshness cannot be omitted or restarted`: exactly seven days fails, a third release does not reset the deadline, and skipping the job fails the summary.

## Name, bytes and licence

Recommend **`@waitron/ui-core` on npmjs.org**. It matches Waitron's workspace name and the existing `@waitron` naming precedent.
Unauthenticated registry GETs on 2026-11-05 found `@waitron/ui-core` 404, `@waitron-io/ui-core` 404 and `@waitron/verifactu` 200, latest `0.2.1`, maintainer `clintongormley`.
A 404 does not establish scope ownership or publishing permission. The owner must check both, and inspect the package bytes before publishing.

Propose first public version **`0.2.0`**, built from current green Waitron main at bootstrap, with a freshly recorded full SHA. Do not republish September's `0.1.0` under a new registry name.
Keep release version separate from source version: if the private source manifest still says `0.1.0`, staged `version` is `0.2.0` and `waitronSource.version` truthfully remains `0.1.0`.
`waitronSource` records `{repository: "clintongormley/waitron", commit: <40 hex>, version: <source manifest version>}`; package version identifies the public artifact.

The staged manifest keeps `@waitron/ui-core`, removes `private`, development dependencies and development lifecycle scripts, and exports built JavaScript, declarations and CSS only.
Set its repository to `https://github.com/clintongormley/waitron.git`, public npm registry/access, and a source-SHA homepage. Preserve Lit's peer declaration and existing export subpaths.
Cloud's current `scripts/release/ui-manifest.mjs:3-24` supplies useful refusal assertions, but its name, repository, registry and source/release-version equality must not be copied unchanged into A1336.

Keep `license: "SEE LICENSE IN dist/LICENSE"`, the source's **Elastic License 2.0**, and unmodified `dist/LICENSE-GRANTS.md`. Verifactu's Apache licence is not a relicensing precedent.
At the inspected Waitron SHA, `packages/ui-core/scripts/build.mjs` externalizes `lit` and `lit/*` and copies both root notices. `src/components/wt-icon.ts` accepts caller-registered paths; it contains no icon collection.
The current-source pack contains 70 files and 19 exports, no test/fixture members, and byte-identical copies of both source notices. Lit remains external; the installed Lit, lit-html, lit-element and @lit/reactive-element packages declare BSD-3-Clause and carry their own LICENSE files. Preserve those notices when distributing the portal bundle, and inspect generated legal comments and copied material in the final release. No font binaries or icon collection were found in the pack; this is not a final notice-completeness claim.

- [ ] A1336 inspects `npm pack --json` output, tar member list, built import list and bundler input report. Compare both packed notices byte for byte with the selected source SHA.
- [ ] Confirm external Lit remains a peer; exclude test helpers importing Vitest/axe, source tests, credentials and unintended assets. Enumerate every embedded third-party module, copied code, font and icon asset, with its licence/notice disposition.
- [ ] If new bundled material appears, retain its required notices and obtain owner review of the artifact inventory before bootstrap. Archive tarball hash, SHA-512 integrity, manifest, notices and inventory; no legal-completeness claim without this gate.

## Gate A: Waitron bootstrap and automatic publishing, owned by A1336 / lane F

Files in Waitron, to be implemented there: `.github/workflows/ui-release.yml`, staged-manifest preparation/tests and the existing `packages/ui-core/scripts/build.mjs` / `test/package-consumer.test.mjs` integration.
Cloud does not implement or edit these files. Split A1336 into preparation and activation: release staging and its dry-run tests must be ready before the owner can first-publish; automatic publication activates after the public package and Trusted Publisher exist. The watcher must release that preparation work rather than making it wait for the first publish. A1336 returns the public version, registry integrity, full source identity, notice inventory and green exact-source checks.

Give A1336 a proposed `scripts/release/prepare-ui.mjs` interface: `node scripts/release/prepare-ui.mjs --source <clean-current-green-checkout> --version 0.2.0 --out <new-empty-output>`. It verifies the clean full source SHA, builds/packs ui-core, validates the built export targets and notice inventory, then emits one script-free staged tarball with the manifest above. This helper does not exist in Waitron yet; its implementation and failing-then-passing tests are A1336 preparation. The following owner commands apply only to its inspected output.

- [ ] Refresh green main and inspect the staged `0.2.0` artifact using the source's package-consumer test outside the workspace, declaration checks and `npm publish <inspected.tgz> --dry-run --access public --registry https://registry.npmjs.org --ignore-scripts`.
- [ ] Owner verifies npm scope control and permission in their own account, then runs `npm login --registry https://registry.npmjs.org` and `npm whoami --registry https://registry.npmjs.org`. Do not copy login output or credentials into receipts.
- [ ] **Owner action only:** publish that exact inspected tarball using `npm publish <inspected.tgz> --access public --registry https://registry.npmjs.org --ignore-scripts`, completing two-factor authentication at the prompt. The lane never executes this command.
- [ ] Read back anonymously: `npm view @waitron/ui-core@0.2.0 name version dist.integrity dist.tarball waitronSource --json --registry https://registry.npmjs.org`. Download and compare the public tarball with the inspected bytes; prove anonymous cold installation.
- [ ] Only after the package exists, owner configures its npm Trusted Publisher: GitHub owner **`clintongormley`**, repository **`waitron`**, workflow filename **`ui-release.yml`**, no environment by default. If an environment is chosen, its exact name must match both sides. Explicitly enable direct `npm publish`; new connections otherwise allow staged publication, which would add an approval step.
- [ ] A1336 uses GitHub-hosted runners, Node **>=22.14.0** (use repository Node 26), npm **>=11.5.1**, `contents: read`, and publish-job `id-token: write`. OIDC is the short-lived workflow identity; no npm token or interactive version bump.
- [ ] Complete the first successful trusted publish within two days of configuring that connection, or recreate an expired connection. Prove a subsequent changed-core main merge publishes automatically and reads back correctly. Publishing must execute in the configured workflow, with the matching repository URL and no unconfigured wrapper identity.

These requirements follow [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) and [scoped public publishing](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/). Recheck them during bootstrap.

A1336 allocates monotonic public patch versions after `0.2.0` in staging, without modifying Waitron's private source version or workspace links.
It reconciles every unhandled main merge changing `packages/ui-core`, in first-parent order, and waits for that merge's green checks. Each release records its own exact source SHA.
Do not depend on GitHub concurrency preserving every pending run: reconcile from the last published source through main, so a burst or interrupted run loses no changed-core merge.
Retries reuse the source-to-version mapping; an existing version is accepted only after matching source and artifact integrity readback. Never overwrite, silently skip a failed release or publish a different tree under a reserved version.
This reconciliation and recovery behavior is an A1336 acceptance gate, not work completed by this plan.

## Static drift and the portal compatibility gate

The immutable comparison measures **87 package commits**, **72 src files +16,011/-278**, including tests. Across the complete 80-file package diff:

| Class | Files | Added / removed |
| --- | ---: | ---: |
| Tests and support | 46 | +12,637 / -112 |
| Runtime | 28 | +3,422 / -166 |
| Build and docs | 6 | +107 / -21 |

Within `src`, 44 test/support files account for +12,589/-112; the other 28 runtime files account for +3,422/-166. Two more test-consumer files sit outside `src`. Do not describe the whole-src count as runtime growth.

A disposable tarball built from the inspected current SHA retains all 14 previous export paths and adds five. Substituting its built files into an archived Cloud checkout passes the portal build, portal and UI-smoke declaration checks, and all 64 existing checks in `node --test --test-timeout=120000 apps/portal/test/form-error-clearing-browser.test.ts` (32.266 seconds, no failures/cancellations/skips). That file exercises English/Spanish, light/dark, and 390/1280px. No product/test source or assertion was edited. This is a local compatibility sample, not a full portal, visual, anonymous registry-install or image qualification. The tarball still carries source-private 0.1.0 metadata; it is not the proposed public 0.2.0 artifact.
The immutable diff command is `git -C /Users/clintongormley/workspace/repos/waitron diff 0a93f4d3557b669661ac8f589aad866e2cd9653f c115dbad87ce8e27f0497bdbe31dd304c1ae9ff0 -- packages/ui-core`.

| Static change at the new SHA | Cloud consumer / required probe |
| --- | --- |
| `src/components/wt-input.ts`, `src/field-styles.ts`: floating labels, width constraints, hints, readonly and decimal behavior | `apps/portal/src/screens.ts:8-14`, `app.ts:196-218`; test value capture, accessible names, native selectors, password reveal, validation and focus. |
| `src/components/wt-button.ts`: hover/disabled colors and additional ARIA forwarding | `apps/portal/src/styles.css:13`; check primary hover contrast and loading/disabled behavior before deciding whether to remove Cloud's opacity override. |
| `src/components/wt-form-actions.ts`, `src/interactive.ts`: error dispatch/focus helpers | Portal form actions/error summary, click and Enter submission; retain existing event and error-focus assertions. |
| `src/tokens/{colors,structure}.css`, new `src/theme/*`, textarea/unsaved-change exports | `apps/portal/src/main.ts:1`, `packages/ui-smoke/src/fixture.ts:1-19`; check existing `applyTokens`, light/dark values, spacing and declarations, without enabling new theme features. |

These are risks and possible benefits, not proven breaks. Keep separate receipts distinguishing old package, current-source candidate and eventual public artifact. Reprobe any newer bootstrap SHA.

## Gate B: One Cloud migration PR, only after Gate A

All following tasks belong to that one PR. Rebase against current Cloud main, refresh this inventory, and preserve concurrent changes. No token-free claim is made until the cold and image gates pass.

### Task 1: Pin and exercise the actual public artifact

Files: `apps/portal/build.mjs`, `apps/portal/test/build-notices.test.mjs` (new), `packages/account-http/test/portal.test.ts`, `apps/portal/package.json`, `packages/ui-smoke/package.json`, `pnpm-lock.yaml`, `apps/portal/src/**/*.ts`, `apps/portal/test/*.ts`, `packages/ui-smoke/{src/fixture.ts,test.mjs}`; create `packages/ui-smoke/ui-release.json` with two records: immutable `bootstrap` and current `expected`. Each records exact package/version, full `waitronSource`, registry integrity and publication time; bootstrap remains 0.2.0 across later updates.
Current receipt assertions are `packages/ui-smoke/test.mjs:13-24`; keep their installed-package, built-output and no-source-fallback behavior.

- [ ] First add failing assertions for exact public name/version/source and agreement between both manifests, lock entry and installed artifact. Show failures against the old package; reject ranges, workspace/file/git aliases and missing source metadata.
- [ ] Pin the released public version in both consumers; replace all active old-scope imports, including browser-test bundle strings. Regenerate the lock through pnpm, preserving SHA-512 integrity (SRI, the byte hash used on download).
- [ ] Match downloaded bytes to registry integrity, recorded source and expected notices. Fail on mismatched installed provenance or manifest disagreement; never make the smoke test merely trust its own rewritten expectation.
- [ ] Test the delivered notices, not only the npm tarball. In `apps/portal/test/build-notices.test.mjs`, make the minified `dist/app.js` fail unless it contains the complete unmodified UI LICENSE and LICENSE-GRANTS plus required notices for every bundled third-party input. Have `apps/portal/build.mjs` collect the esbuild input inventory and prepend preserved licence comments; Lit and all other bundled dependencies keep their required copyright/licence/disclaimer text. Missing required notice files refuse the build. Extend the existing served `/app.js` check in `packages/account-http/test/portal.test.ts` to verify those bytes reach the browser under the existing asset/security headers, without widening the static-file allowlist. A packed-notice pass alone does not satisfy this gate.
- [ ] Extend existing form/accessibility tests before any compatibility fix. Cover signup, login, recovery/reset, validation focus, keyboard Enter, password visibility, loading/disabled controls and session/account screens; retain existing assertions.
- [ ] Capture and inspect **eight combinations**: English/Spanish × light/dark × phone 390px/desktop 1280px, including initial, invalid and hovered primary-button states. Extend `apps/portal/test/accessibility.test.ts:7-35`; its current account screenshots do not prove every route at both widths.
- [ ] Run `pnpm test:ui`, `pnpm typecheck`, `pnpm portal:build`, then `node scripts/test-postgres.mjs exec pnpm --dir apps/portal test`. Expect success, no page errors, no horizontal overflow and no axe violations; archive screenshots and exact package/source identities.

### Task 2: Remove package authentication while retaining isolation

At the Cloud baseline, **37 tracked files contain `NODE_AUTH_TOKEN`**, including 17 matching workflow lines. The broader token/registry inventory covers 49 paths. Reproduce the literal file count with `git grep -l NODE_AUTH_TOKEN 800717778b6ca28779ed7c0347b0911f8bd56148 -- | wc -l`. Historical plans and giant JSON fixture strings are part of that count; classify actual readers rather than using a count as a deletion rule.

| Paths / anchors | Intended change |
| --- | --- |
| `.npmrc:1`, `.env.example:3`, `.github/workflows/ui-release.yml`, `scripts/release/*` | Delete Cloud's private registry mapping and release implementation/workflow; remove current install-token instructions. |
| `.github/workflows/{ci,cloud-cost,browser-reconnect-diagnostic,password-derivation-diagnostic,relay-counter-diagnostic,venue-services-proof}.yml`; `nightly.yml:13` | Remove package registry setup, installation `NODE_AUTH_TOKEN` bindings and unnecessary `packages: read`; keep GitHub API permissions needed for CI planning/receipts. |
| `deploy/local-stack/Dockerfile:23-30`, `compose.yaml:13,266-267` | Remove package secret mount, temporary npmrc and Compose secret declaration; use ordinary frozen-lockfile installation. |
| `deploy/backup-verifier/Dockerfile:5-11`, `scripts/build-backup-verifier.mjs:7,24` | Remove token requirement, secret argument and auth file; keep required `WAITRON_CHECKOUT`, pinned revision/archive, verifier target and generated hour-release checks. |
| `scripts/local-stack-lifecycle.mjs:23`, `local-stack-proof.mjs:13`, `operations-collection-proof.mjs:9`, `scheduled-usage-proof.mjs:10` | Remove package-token preconditions; keep argument validation and every resource/runtime refusal. |
| `scripts/cloud-cost/conformance-prepare.mjs:97-104` | Remove package-token forwarding from the allowlisted child environment; retain pinned source fetching, interruption cleanup and provider/venue-secret isolation. |
| `docs/{shared-ui-release,local-deployment,test-cloud,operations-status}.md`, `docs/backlog/{shared-ui,ci-audit-conflicts}.md`, `docs/backlog.md` | Update current operational examples and measured backlog status in the migration PR; identify historical plans as historical rather than claiming they were executed again. |

- [ ] Add failing tests proving no-token installs/build entry points work, including `scripts/{build-backup-verifier,scheduled-usage-proof}.test.mjs` and `ci-verifier-build-refusals.test.mjs:74-79,121` where the intended requirement changes.
- [ ] Replace `scripts/ci-nested-install-auth.test.mjs:19-69`'s synthetic-private-registry requirement with anonymous cold descendant-install tests for all four package entry points and the receipt entry point. Use an empty store and a loopback public tarball that rejects Authorization headers; retain a broken-integrity refusal control.
- [ ] Keep `deploy/test-cloud/{runtime,venue-service-runtime}.test.mjs` and `scripts/test-cloud-deploy.test.mjs:41-46` asserting ambient `NODE_AUTH_TOKEN` and other secrets never reach runtime children. Keep poisoned-environment/archive-exclusion controls in `ci-verifier-source-isolation.test.mjs` and `scripts/cloud-cost/conformance-*.test.mjs`.
- [ ] Trace installation readers before renewing audits: `scripts/ci-install-inputs.mjs:3-30`, `ci-capacity-receipt.mjs:7-40`, `ci-{capacity,database,gateway,local-stack}-receipt.test.mjs`, `ci-dependency-fixture.mjs:5-13`, `scripts/fixtures/ci-*-inputs.json`, and `scripts/ci-input-audit.d/*` records for `.npmrc`, manifests, workflows and `scripts/release/ui-source.json`.
- [ ] Preserve historical fixture certificates and omission/refusal assertions. Change a fixture expectation only when D579 deliberately changes its contract at least as strictly; do not replace historical snapshots wholesale with live files to make tests pass.
- [ ] Re-audit changed readers, then use `node scripts/ci-input-audit.mjs --write-staged --mode all` during later implementation, inspect/stage its output, and check the candidate commit with `node scripts/ci-input-audit.mjs --check <full-candidate-SHA>`. Unknown/changed install inputs in either revision must still select the real suites.
- [ ] Run `node --test scripts/ci-nested-install-auth.test.mjs scripts/build-backup-verifier.test.mjs scripts/ci-verifier-build-refusals.test.mjs scripts/ci-verifier-source-isolation.test.mjs scripts/scheduled-usage-proof.test.mjs scripts/ci-plan.test.mjs scripts/ci-capacity-receipt.test.mjs scripts/ci-database-receipt.test.mjs scripts/ci-gateway-receipt.test.mjs scripts/ci-local-stack-receipt.test.mjs` plus explicit named files for changed summaries. Never run a test command with an empty file list. Record before/after failures and guard-omission failures; do not remove generic `.npmrc`, secret-detection or environment-isolation guards.

### Task 3: Coordinate D110 without editing its branch

D110 candidate branch `feat/kubernetes-country-cell` was inspected read-only at **`bb686d7aa17deb9f9bac606bee76b84814a2c6f1`**. These paths are not assumed to be on Cloud baseline main.

- [ ] Relay this exact integration list to the watcher/D110 owner; whoever lands second rebases and preserves both behaviors. Do not wait merely because files overlap, and do not modify that worktree.
- [ ] In the authorized integration checkout, change `scripts/kubernetes-images.mjs:254-263` (`runImageBuilderBuild`) and `:350-381` (`buildRoleImages` token validation/call) to build without a token parameter or stdin credential. Remove only secret-specific branches in `builderBuildCommand:227-239`.
- [ ] Retain private source-policy creation/cleanup, forced content transfer, builder socket/daemon override refusal, caller `--secret` refusal, bounded processes, cancellation and owned-resource cleanup. Generic source credential refusal at `:101-105` remains.
- [ ] Update `deploy/kubernetes/images/{cloud,verifier}/Dockerfile:7-12` to anonymous frozen installs and `scripts/kubernetes-build-secret.test.mjs:91-155` to prove no credential is needed or forwarded. Preserve failure/cancellation/cleanup coverage around the remaining source-policy temporary files.
- [ ] Update obsolete registry fixtures/inventories in `scripts/kubernetes-image-sources.test.mjs:23-63` and `kubernetes-source.test.mjs:32-45`; retain hostile `.npmrc` refusal in `kubernetes-source-archives.test.mjs:113-114` and `kubernetes-source.test.mjs:80-107`.
- [ ] Keep secret-absence assertions in `deploy/kubernetes/test-fixtures/{cloud-runtime,verifier-runtime}.mjs:33,15` respectively; update `deploy/kubernetes/README.md:77-80,200-237` after real token-free image proof. Test both Cloud and pinned Waitron verifier source archives independently.

### Task 4: Every-version upgrade PRs with unattended CI

Create `scripts/ui-registry.mjs`, `scripts/ui-registry.test.mjs`, `scripts/ui-updates.mjs`, `scripts/ui-updates.test.mjs`, `.github/workflows/ui-updates.yml`; modify `.github/workflows/{ci,aws-infrastructure,cloud-cost,venue-services-proof}.yml` and existing CI planner/summary tests.
`ui-registry.mjs` owns registry parsing, exact stable-version ordering, manifest/lock agreement and freshness; reuse `parseLock` from `scripts/ci-lock.mjs:119`. `ui-updates.mjs` owns GitHub reconciliation; keep network/GitHub adapters injectable for deterministic tests.
Define `readRegistry(fetch)` to return validated `{versions, time, distTags}`; `evaluateFreshness({installed, registry, observedReleases, now, maxLagDays:7})` returns the newer versions, first-newer publication time and deadline, or throws on invalid evidence. Load validated prior release observations from the updater's persistent PR records, including closed PRs, before evaluating disappearance or changed timestamps.
Fix `baselineVersion` at the first public `0.2.0` release in the updater workflow configuration; do not reset it to the current Cloud pin, or missed versions could disappear. Define `reconcileUpdates({registry, github, baselineVersion, now})` to return per-version `{version, pr, headSha, validationRunIds}`; never report a PR as validated from creation alone.

- [ ] First fail tests for two releases between polls, `0.2.9` versus `0.2.10`, retries after branch/PR/dispatch creation, pagination, interrupted runs, and closed/merged PRs. Fetch the complete public package document, including `versions` and `time`, not only `latest`.
- [ ] Poll hourly with a daily catch-up/freshness run and manual retry. Enumerate every stable version after the bootstrap baseline in numeric semantic-version order, excluding prereleases. A missed poll must not collapse several versions into one PR.
- [ ] Use deterministic branch `automation/ui-core/<version>` and PR body marker `<!-- ui-core:<version> -->`; query all PR states with pagination. Persist source identity, integrity, publication time and validation run IDs in the PR metadata. Reconcile each missing operation idempotently; never advance a cursor past an uncreated PR.
- [ ] Each PR updates both exact pins, lock integrity and the `expected` record in `packages/ui-smoke/ui-release.json`, preserving its bootstrap record. Keep distinct PRs for distinct versions, without auto-merge. Closed failures remain recorded and visible; a superseded version still gets its own recorded PR, marked/closed as superseded, with a guard refusing to merge a downgrade.
- [ ] Updater job uses only `contents: write`, `pull-requests: write` on `GITHUB_TOKEN`; enable repository permission for Actions to create PRs. No PAT, npm token or cross-repository publishing permission.
- [ ] Execute updater code from trusted main and allow changes only to the two consumer manifests, lockfile and release expectation. Generate the lock with scripts disabled and no GitHub token in the package-manager child environment; compatibility repairs remain human-reviewed Cloud changes.
- [ ] A separate dispatch job uses `actions: write`, `contents: read`, `pull-requests: read`. It calls workflow-dispatch APIs for `ci.yml`, `aws-infrastructure.yml`, `cloud-cost.yml`, `venue-services-proof.yml` with the created branch ref and inputs `expected_head_sha`, `update_pr`, `ui_version`. Add dispatch support to CI/AWS; extend the existing cost/venue dispatch inputs.
- [ ] Give dispatched runs a deterministic run name containing PR number, version and expected head. Match API run records by workflow, dispatch event, branch, head and run name, then record the returned run IDs; include interrupted creation/readback in retry tests.
- [ ] Resolve the same-repository open PR through GitHub before checkout and compare branch head, dispatch `github.sha`, input SHA and actual checkout SHA. CI plans a full run for this dispatch (`scripts/ci-plan.mjs:42-97` already falls back to full for non-PR events); cost/venue proofs must also run fully. Recheck the PR head at completion.
- [ ] Require normal portal/package/typecheck/receipt gates, AWS checks and freshness, with `ci-summary.mjs:22-72` extended to require freshness. Bind run IDs, attempts, event type, package version and exact head to metadata and existing summary identity checks; a missing, skipped, failed or older-head check cannot satisfy the PR.
- [ ] Read branch-protection required contexts during implementation and dispatch any additional required workflow before acceptance. Preserve required check names; prove dispatch check runs attach to the PR head. Do not substitute a successful updater job for those checks.
- [ ] Retry dispatch when no matching run exists; do not duplicate an in-progress or successful exact-head run. Red validation stays red and visible. A branch update invalidates prior validation and queues a fresh dispatch.
- [ ] Return run IDs from the dispatch job to a metadata-only job with `pull-requests: write`; this job records them without executing candidate code. The dispatch job performs Actions API reads, so the updater job needs no Actions permission. Evaluate superseded PRs before closing them; never merge their older pins.
- [ ] Run `node --test scripts/ui-updates.test.mjs scripts/ui-registry.test.mjs scripts/ci-plan.test.mjs scripts/ci-summary.test.mjs`; expect every-version, partial-retry, replaced-head and missing-gate controls to pass. Then prove one real bot-created PR receives all required checks on its exact head without an approval click.

`GITHUB_TOKEN` PR creation is not reliable unattended normal PR CI. [GitHub's event rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) currently describe approval-gated PR runs and allow explicit dispatch. This design uses dispatch and does not rely on someone approving generated events.

### Task 5: Mandatory freshness, including idle repositories

- [ ] Put an unconditional freshness job in `ci.yml`, required by its summary even for docs-only or narrowly selected work. Run that checker from trusted workflow code with `contents: read` and `pull-requests: read`; expose `readObservedReleases({github, bootstrap})` in `ui-registry.mjs` to read all paginated, updater-authored version-marker PR records, including closed/merged PRs. Validate package/version/source/integrity and immutable publication time before passing observations to `evaluateFreshness`; the committed bootstrap record comes from `packages/ui-smoke/ui-release.json` and is checked against the trusted migration baseline. Missing bootstrap data or unreadable, incomplete or conflicting observations refuse the check. The migration records bootstrap first; updater PRs preserve it and change only `expected`. This avoids requiring an empty-diff PR for the initial version. Run the same check daily against main in `ui-updates.yml`; alert through a failing visible run when idle main drifts.
- [ ] Recommend **seven days from the first publication of any newer stable version**. For installed version V, deadline is the earliest registry publication time among stable versions greater than V, plus seven days; fail at or after the deadline. Newer releases cannot reset that clock. No newer release means no absolute-age expiry.
- [ ] Compare both exact manifest pins, the expected source record and lock/SRI before assessing age. Reject missing installed versions, absent publication times, invalid dates, malformed registry data, unexpected registry redirects/hosts and manifest disagreement.
- [ ] On no network, timeout or invalid response, fail the check with a retryable diagnostic; do not report cached evidence as fresh or mutate pins. Use a bounded fetch/retry budget. Keep offline parsing tests separate from the live mandatory check.
- [ ] Treat `latest` as a consistency signal, not the release list: a rollback, missing tag, disappearing version or deprecated candidate fails closed for owner/watcher investigation. Never auto-downgrade, erase an observed deadline or silently skip a withdrawn release; retain observations in PR metadata.
- [ ] Add a two-run behavioral case: observe V+1 and persist its PR record, delete V+1 from the next registry response and return `latest` to V, then prove the checker refuses and retains the original deadline. Also fail for unreadable/pagination-truncated observations. Registry history before any observation cannot be reconstructed; do not claim detection of a version removed before its first observation.
- [ ] First fail boundary tests for no updates despite an old install, 6d23h59m versus exactly 7d, multiple newer versions, malformed/missing metadata, offline fetch, rollback and deleted-version evidence. Also fail workflow/summary tests when freshness is omitted or skipped, and when dispatch validates another SHA.
- [ ] Prove controls by omitting the freshness dependency, relaxing exact pins, ignoring the oldest-newer timestamp and accepting stale CI metadata in separate disposable copies. Each corresponding test must fail.
- [ ] Expose `node scripts/ui-registry.mjs --check` for CI and the daily job: exit 0 with installed version/deadline evidence when valid, exit nonzero with the refusal reason otherwise. Run the live command after its deterministic tests pass; archive the public metadata observation and check time.

### Task 6: Cold install, image proof, documentation and handoff

- [ ] On testbox, create a fresh committed-source export, empty home/user npm config and unique empty pnpm store. Use an allowlisted environment with no package credential, no token helper and no reused `node_modules`. Run `pnpm install --frozen-lockfile --store-dir <new-empty-store>` and the Task 1 checks; retain status/hash receipts, not environment dumps.
- [ ] Build local-stack, backup verifier and integrated D110 Cloud/verifier images with `--no-cache`, no secret argument and no credential present. Use a new owned builder/cache namespace or remove cache mounts in a disposable recipe: `--no-cache` alone does not empty BuildKit cache mounts.
- [ ] Exercise the real wrappers and proof entry points listed in Task 2 without a token; inspect the actual frozen source/lockfiles each nested install uses. An unexpected private dependency blocks that build; do not restore credentials or silently change the pinned verifier/fiscal source to pass.
- [ ] Run focused image/runtime and source-isolation checks; retain image IDs, source SHA labels, install/network evidence and secret-absence results. Preserve sandbox, transaction and fiscal checks. Stop/remove only resources created for these proofs; no shared cache pruning.
- [ ] Rewrite `docs/shared-ui-release.md` around Waitron ownership, anonymous install, exact-source upgrades, automatic PRs, dispatch CI, retry and freshness policy. Update `docs/backlog/shared-ui.md` to distinguish measured outcomes and remaining work, including the hover override decision. Do not edit it as implemented during step 1.
- [ ] After the migration lands, tell the watcher to retire lane D's SWITCH credential and the external `test-box-run.sh` note/helper. Only the watcher edits those outside-repository paths; do not delete unrelated user npm configuration or credentials.
- [ ] Preserve this reviewed plan in a locally signed-off commit. Later implementation uses signed-off commits and normal hooks. Once Gate A and all migration receipts pass, announce readiness for `finish-branch`; run normal review/CI and owner-authorized landing, then verify exact merged-head results. Step 1 performs none of those implementation or landing actions.

## Owner/watcher handoff

The single decision covers the public name, retained licence, bootstrap and freshness limit.

Recommend public `@waitron/ui-core`, first version `0.2.0` from freshly selected green Waitron main, preserving Elastic 2.0 plus unmodified LICENSE-GRANTS and inspected third-party notices. Registry 404 is not evidence of scope control; the owner must verify permission and package bytes.
The owner alone logs into npm, completes 2FA and publishes the inspected tarball, then anonymously reads back identity/integrity and configures Trusted Publisher `clintongormley / waitron / ui-release.yml`, with no environment unless explicitly chosen. Gate A gives exact commands and order.
Confirm the package-name/scope and seven-day grace period, release A1336 preparation before first publish, then return its artifact and automatic-release receipts. The planning probes above are complete; qualification of the staged public artifact remains open. Cloud step 2 stays unimplemented until the public package exists; no Cloud publication or landing occurs in step 1.
