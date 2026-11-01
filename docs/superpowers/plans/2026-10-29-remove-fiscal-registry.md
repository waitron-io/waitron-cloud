# Remove the Fiscal Registry Implementation Plan

> **For agentic workers:** Execute natively inline, task by task, using `superpowers:executing-plans`. Do not dispatch implementers. Read `superpowers:test-driven-development` before writing code. The owner has authorized planning and building the removal; this separate planning PR leaves runtime fully unchanged. Destructive schema work is not authorized.

**Goal:** Remove Cloud's obsolete allocation registry without changing retained schema, fiscal results or shared account/recovery behavior.

**Architecture:** Remove consumers before deleting the workspace package. Retain migration 038 and its schema safety coverage; use existing missing-route handling. Keep historical evidence separate from active producers.

**Tech Stack:** Node >=26, TypeScript, pnpm 9.15.0, Hono, Lit, PostgreSQL, Node test runner and Playwright.

**Spec:** [Removal design](../specs/2026-10-29-remove-fiscal-registry-design.md), including its source/consumer map.

## Global Constraints

- Proposal only. Cloud may build before A1189, but removal landing waits for Waitron callers to be gone; root driver obtains A1189 and Lane D evidence.
- Retain 038 byte-for-byte, all dormant tables/rows and existing schema/recovery expectations. No destructive action, history reset or altered schema expectation without explicit owner approval.
- Preserve unrelated expected fiscal values, security/tenant checks, backup/recovery gates and customer-facing billing behavior. No invented 410 response.
- Native inline execution; focused test-first work; signed-off commits (`git commit -s`); one Claude run-it whole-branch review during `finish-branch` after initial rebase.
- Until Docker returns on 3 November, run no Docker commands, `pnpm test`, `scripts/test-postgres.mjs` or provider/resource operations on the Mac. The owner-authorized `~/waitron-campaign-shared/test-box-run.sh` helper may run focused PostgreSQL checks on the test box, one lane at a time. Historical release checks need the full Git history supplied by CI, with its `TEST_DATABASE_URL` and Mailpit variables. Record expected RED and GREEN at their exact heads; a skipped/unavailable test is not either. If CI cannot supply the failing-test-first cycle, stop dependent implementation until it can.
- Portal visual regression covers EN/ES, light/dark, 390/1280. Read both documents and retrace consumers at execution head.

## Review Focus

1. Populated databases retain 038 and immutable rows: Task 1 keeps every schema assertion and pins its digest.
2. Stale bookmarks and machine callers follow ordinary missing routes: Tasks 2–3 test document GET/HEAD and API GET/POST, including unchanged host/query/security handling.
3. Removing fiscal UI must preserve account/session/recovery security and translation fixture arguments: Tasks 2–3 retain shared suites and test navigation/sign-out.
4. Deleted packages must not hide CI work or corrupt historical audits: Task 5 checks exact live membership, complete shards, full fallback and historical fixture reconstruction.
5. Mixed cost fixtures must retain mail/recovery/privacy checks without fabricated fiscal measurements: Task 4 preserves their assertions and historical receipt validation.

## Tasks

Commands run from the repository root unless a directory is specified. For each behavioral task, add the named assertions, run its RED command and inspect the intended assertion failure, make the minimal change, then rerun the same command for GREEN. Keep the RED receipt; do not count missing dependencies as the expected failure. Stage only the task's named files for its signed-off commit. Do not execute any task in this documentation PR.

### Task 1: Preserve migration coverage before deleting its package

**Files/interfaces:** Move `packages/fiscal-allocation/test/schema.test.ts` to `packages/registration/test/fiscal-registry-schema.test.ts`; create `packages/registration/test/fixtures/fiscal-registry-schema.ts` containing its exact `payload()`/`binding` fixture data and needed constants from `packages/fiscal-allocation/test/fixtures.ts`. Adjust relative imports only; no runtime interfaces change.

- [ ] This is coverage relocation, not new behavior: run the original file in CI, preserve all seven tests and expected values, then run `node --test --test-timeout=30000 packages/registration/test/fiscal-registry-schema.test.ts` in CI. Both must pass; do not manufacture a failing behavior test for a move.
- [ ] Create `packages/registration/test/migration-history.test.ts` with a native digest assertion: 038's name remains at index 37 and SHA-256 equals the design's recorded digest. Run `node --test packages/registration/test/migration-history.test.ts`; it must pass against unchanged SQL. Retain existing registration/schema-compatibility and recovery manifest tests.
- [ ] Commit: `git commit -s -m "test: retain fiscal registry migration compatibility coverage"`.

### Task 2: Remove the portal journey

**Files/interfaces:** Modify `apps/portal/src/{app,screens,api,locale}.ts`, `styles.css`, `packages/account-http/src/portal.ts`, `apps/portal/test/{fixtures,translation-fixture.test,cooldown-browser.test,usage-retry-clock.test}.ts`. Delete the three `apps/portal/src/fiscal-allocation-*.ts` modules and all current `apps/portal/test/fiscal-*.test.ts`, whose sole product is the withdrawn journey. The shared fixture becomes `startPortalFixture(captures?, remoteResolve?, factor?, translation?)`; move the translation caller's options from argument five to four.

- [ ] RED: add `account_without_registry` in `apps/portal/test/fiscal-registry-removed-browser.test.ts` using the existing esbuild/stub-browser pattern: authenticated `/account` has zero links to `/fiscal-allocations`, sends zero registry requests across navigation/sign-out, keeps account/recover controls, heading focus, no horizontal overflow and no page errors. Capture/review screenshots for all eight locale/theme/width combinations. Add `retired_registry_document` GET/HEAD assertions to `packages/account-http/test/portal.test.ts`, matching `/missing` including security headers and empty HEAD body. Run `node --test --test-timeout=120000 apps/portal/test/fiscal-registry-removed-browser.test.ts` natively and `node --test packages/account-http/test/portal.test.ts` in CI. Expect the link and document-status assertions to fail.
- [ ] Remove only the mapped fiscal lifecycle, navigation, API classifiers/CSRF branch, copy and CSS, plus the server document entry. Preserve shared lifecycle and all other CSRF branches. Remove fiscal cases only from the two mixed tests. Keep the newly added removal regression despite its filename prefix.
- [ ] GREEN: repeat both commands; run `pnpm --dir apps/portal build`, then `node --test apps/portal/test/usage-retry-clock.test.ts apps/portal/test/cooldown-browser.test.ts apps/portal/test/session-activity-ordering.test.ts` natively. CI also runs `apps/portal/test/translation-fixture.test.ts`, `static.test.ts` and the retained recovery/security browser tests. Compare the eight screenshots with pre-change account views, accepting only the withdrawn link/layout change.
- [ ] Commit: `git commit -s -m "refactor: remove fiscal registry portal journey"`.

### Task 3: Remove account and machine routes

**Files/interfaces:** Modify `packages/account-http/src/{app,server}.ts`; delete `src/fiscal-allocations.ts`, `test/fiscal-{allocations,recovery-key-operator,fixture-cleanup,waitron-client,waitron-setup-diagnostics}.test.ts`, `test/fiscal-http-fixture.ts` and `test/fixtures/fiscal-{setup-controls.ts,waitron.ts,waitron-bridge.mjs}`. Retain the public `createAccountApp`/`startAccountServer` exports but remove their `fiscalAllocation?: RegistryOptions` option and fiscal error mapping.

- [ ] RED: create `retired_routes_use_generic_not_found` in `packages/account-http/test/fiscal-registry-removed.test.ts` on the ordinary `test/fixtures.ts` database, with no fiscal fixture. For all six suffixes (`reserve`, `consume`, `abandon`, `status`, `list`, `import-paper`) and `/api/installations/fiscal-allocations/report`, assert GET/POST matches same-family unknown paths: 404 `{error:'not_found'}`, no cookies, unchanged security headers and zero changes to seeded dormant rows. Rewrite `test/organisation-plan-fiscal.test.ts` to retain free/paid/free and zero events, expecting the same missing route instead of 503. Run both files with `node --test --test-timeout=30000 packages/account-http/test/fiscal-registry-removed.test.ts packages/account-http/test/organisation-plan-fiscal.test.ts` in CI; existing route responses must fail these assertions. Include wrong-host and query-string controls matching generic routes' existing 403/400 behavior.
- [ ] Before deleting old tests, map their security assertions to retained `account-http.test.ts`, `authenticator-factor.test.ts:101`, `account-security.test.ts`, `backups.test.ts`, `rate-limit.test.ts` and `recovery-v2.test.ts`. Preserve shared host/origin, body bounds, CSRF, tenant ownership, challenge-token refusal and cross-listener limits. Carry any uncovered shared assertion into its corresponding retained suite before removal; registry-specific authority locks/budgets disappear with their endpoint. Do not remove common guards to make the new tests pass.
- [ ] Delete the route dispatch/options/error case and the now-exclusive fixtures/tests. GREEN: repeat RED command in CI, then run the six retained suites there with `node --test --test-timeout=30000 packages/account-http/test/{account-http,authenticator-factor,account-security,backups,rate-limit,recovery-v2}.test.ts`.
- [ ] Commit: `git commit -s -m "refactor: remove fiscal allocation HTTP service"`.

### Task 4: Retire live cost callers and active documentation claims

**Files/interfaces:** Remove `scripts/cloud-cost/{fiscal.mjs,fiscal.test.mjs,fixtures/fiscal-conformance.test.mjs}` and the export in `local.mjs`. Modify `conformance.test.mjs`, `conformance-prepare.mjs` and `fixtures/service-receipt-conformance.test.mjs`. Keep `service-receipt.mjs`'s historical format, unit tests, projection/inventory data and old receipts unchanged.

- [ ] RED: in `scripts/cloud-cost/conformance.test.mjs`, assert discovery excludes `fiscal-conformance.test.mjs` and `local.mjs` exposes no `openFiscalMeasurement`. Run `node --test scripts/cloud-cost/conformance.test.mjs` natively; expect discovery/export assertion failures.
- [ ] Remove the producer; update discovery expectation and its runtime-selection exception. Convert both mixed conformance tests to mail/signup/recovery checks using `packages/account-http/test/fixtures.ts:database()`. Keep literal mail totals 4 attempts/3 accepted/1 refused/1 retried and 3 attempts/3 accepted/0 refused/0 retried, EN/ES subjects, token-driven signup/reset, cleared encrypted payloads, privacy and owned cleanup. Remove only registry operations and joined live receipt generation; do not invent zero fiscal measurements or alter historical receipt expectations.
- [ ] GREEN: repeat native command and `node --test scripts/cloud-cost/service-receipt.test.mjs`. In CI run `node --test --test-timeout=120000 scripts/cloud-cost/fixtures/service-receipt-conformance.test.mjs` with PostgreSQL/Mailpit; every retained mail/recovery assertion must pass.
- [ ] In the design's named current docs, replace active registry requirements with retirement/history wording; keep `docs/fiscal-allocation-registry.md` and its anchors as a historical destination. Link this design and the eventual A1189 receipt. Preserve backup-verification/ordinary-restore authority wording and all historical numbers. Check relative links natively and review the diff.
- [ ] Commit: `git commit -s -m "refactor: retire registry measurement callers and document removal"`.

### Task 5: Delete the package and keep CI complete

**Files/interfaces:** Delete remaining `packages/fiscal-allocation/`; remove its account dependency and regenerate `pnpm-lock.yaml` with `pnpm install --lockfile-only --offline --ignore-scripts`. Do not fetch packages if offline regeneration fails; report the dependency-cache prerequisite. Modify the design's live CI expectation files, `scripts/ci-summary.mjs`, `.github/workflows/ci.yml` and `scripts/ci-dependency-fixture.mjs`; retain historical certificates, manifests and `ci-install-inputs.mjs` unchanged.

- [ ] RED: update/add `scripts/ci-scope.test.mjs` and `ci-cli.test.mjs` assertions for nine live members, 21 logical shards and **19 grouped rows**: registration 5, account 3, backups 2, portal 6, translation 1, ui-smoke 1, plus one group containing identity/operations/remote-access. No fiscal package; six receipts and typecheck retained. Assert `packageShards` in `ci-summary.mjs` has no fiscal member and missing shards still fail. In `ci-dependency-fixtures.test.mjs`, add reconstruction from a fixture-owned tree without a fiscal directory: all pinned historical manifests still appear and positive omission/refusal assertions still execute. Run `node --test scripts/ci-scope.test.mjs scripts/ci-cli.test.mjs scripts/ci-dependency-fixtures.test.mjs`; expect live membership and absent-parent failures.
- [ ] Delete the package/dependency, regenerate the lock and remove only the fiscal summary/fetch-depth member and live expectations. Preserve three compiler configurations and all surviving shard counts. Independently record the regenerated lock's package/snapshot/closure counts before updating `ci-lock.test.mjs`; retain its literal assertions. Reconstruct saved historical membership from saved manifests and create missing parent directories before writing them. Keep the frozen certificate and historical input lists; stale audit evidence must retain full CI, not silently skip work.
- [ ] GREEN: repeat RED; run `node --test scripts/ci-{scope,cli,summary,lock,dependency-fixtures,typecheck,typecheck-inventory,input-audit-integration,package-revisions,capacity-receipt,database-receipt,gateway-receipt,local-stack-receipt}.test.mjs`, `pnpm typecheck` and `pnpm --dir apps/portal build`. Search imports, `/types`, options and old routes again; allow only retained schema/tests, historical documents/fixtures and removal regressions. Preserve `scripts/database-recovery-migrations.test.mjs` and schema-gate checks.
- [ ] Commit: `git commit -s -m "refactor: remove fiscal registry workspace package and CI member"`.

### Task 6: Finish the implementation branch, without premature landing

- [ ] Verify 038's recorded hash and unchanged ledger/schema expectations; run native focused checks above. Obtain exact-head GitHub CI package, root/typecheck and required receipt results, including relocated PostgreSQL schema tests. Do not duplicate the full workspace suite locally. Report any unavailable Docker/image proof as unqualified; older receipts cannot certify this head.
- [ ] Announce readiness to run `finish-branch`, then use the campaign’s existing authorization to follow it: initial rebase, **one Claude run-it whole-branch review** via `claude-seat.sh review-run` in an installed disposable checkout containing the complete candidate tree; triage findings inline, run focused checks, normal hooks and current-head CI. Subsequent rebases alone do not repeat that review. This docs-only planning PR needs no external production-code review.
- [ ] Root driver records A1189's landed caller-removal evidence, cross-repository contract links and Lane D's migration-policy response. Missing evidence blocks Cloud removal landing, not preparation. A requested schema reset/destructive retirement returns for explicit owner approval; do not include it here. Use the campaign’s existing finish/land authorization only after these gates pass; this plan grants no schema-reset or deployment authority.
