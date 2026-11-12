# Venue recovery cleanup plan

**Draft only:** RUNNER requested this plan; no implementation is authorised by this invocation. Claude must review the approach, then the watcher must clear it before build.

**Request:** `/Users/clintongormley/waitron-campaign-g/queue.md`, D-flake, 2026-11-12 03:46:
> the watcher's 01:03 priority: venue CI runs 43107131485, 43120094655 and 43142144653 repeat ERR_TEST_FAILURE 24/25 at file 0, line 87 (logs retained). Debug first: reproduce on Linux, add diagnostics, find the cause, then the smallest cause-based fix in its own small PR. Never a retry or a skip. Plan and Claude read once the cause is known. No new feature or provider access.

**Finish line:** the venue proof’s six consumers of the HTTP database fixture use owned database clones, removing their full-schema cleanup statements. All 102 existing cases and assertions remain intact; unrelated lock exhaustion is not claimed repaired.

**Red evidence already captured:** diagnostic run `43146130590`, job `130944337338`, scratch `bddd0c4852892e83a0e816e41b6b9324a8d8dbcb`.
`/Users/clintongormley/waitron-campaign-g/receipts/d-flake/github-wrapper-diagnostic.log:1091-1117` records PostgreSQL `53200` (shared lock-table exhaustion), `max_locks_per_transaction`, and `LockAcquireExtended`.
The stack reaches `packages/account-http/test/fixtures.ts:26`, whose `close()` runs `DROP SCHEMA CASCADE`, from `venue-service-recovery.test.ts:106` in `finally`.
This identifies the cleanup error; `finally` can mask an earlier error, so no provider or authority result is inferred. Passing Linux pair 39/39, raw matrices 360/360 on Node 26.11.1 and 26.13.0, and GitHub raw 360/360 and expanded 396/396 did not explain it; the original wrapper with full diagnostics did.

**Only implementation files:**

- `packages/account-http/test/venue-service-recovery.test.ts` (25 cases).
- `packages/account-http/test/venue-service-replacement.test.ts` (14 cases).
- `packages/backups/test/venue-service-replacement.test.ts` (14 cases).
- `packages/translation/test/venue-service-translation.test.ts` (15), `venue-service-queue.test.ts` (4), and `worker-cli.test.ts` (30; one database per file).
- `docs/backlog.md`, existing **Service-proof failure diagnostics (D530)** bundle.

**Reuse:** `packages/account-http/test/fixtures.ts:7-26` already accepts `database(template.name)` and closes an owned database clone without `DROP SCHEMA`.
Use `createVenueServiceTemplate()` from `packages/registration/test/fixtures/venue-service-template.ts`; reuse its clone ownership; the per-file immutable-template precedent is `packages/registration/test/fixtures/venue-service.ts:11-17`.
`packages/account-http/test/database-template.test.ts` already checks row isolation, current migrations, digest refusal and owned clone cleanup; retain it unchanged.

- [ ] Use the captured real failure as the red baseline; add no artificial lock-pressure probe or permanent stress test. The repair evidence is that these six files no longer execute the failing `DROP SCHEMA CASCADE` path. Passing checks below are regression evidence, not proof that every historical lock failure is gone.
- [ ] In each of the six files, import `before`, `after` and the existing template creator. Create one template in `before`, call `database(template.name)` in the local fixture, and close it with `await template?.close()` in `after`, so failed setup adds no cleanup error. This uses explicit hooks rather than the precedent’s lazy template creation. Keep every case's existing `finally` cleanup and every behavioural assertion unchanged. Add no shared abstraction.
- [ ] Run these six files against real PostgreSQL on Linux, expecting 102 passed, zero failed/cancelled/skipped:

  `node scripts/test-postgres.mjs exec node --test packages/account-http/test/venue-service-recovery.test.ts packages/account-http/test/venue-service-replacement.test.ts packages/backups/test/venue-service-replacement.test.ts packages/translation/test/venue-service-translation.test.ts packages/translation/test/venue-service-queue.test.ts packages/translation/test/worker-cli.test.ts`

- [ ] Run the existing helper control separately, expecting 1 passed:

  `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/database-template.test.ts`

- [ ] Update D530 in under 10 prose lines: name the captured cleanup cause, the removed failing statement, current-head regression results actually obtained, and remaining historical uncertainty. Add no defect catalogue.
- [ ] Finish one small PR through `finish-branch`: required initial rebase assessment, Claude run-it whole-branch review (two where its risk rules require), triage and fresh Claude read of fixes. State **Changed test checks: none**. Require the current-head venue proof and all selected CI jobs; read every job and justify planned skips. CI owns full package suites. Keep proof counts, receipt checks and deadlines unchanged.

**Size and exclusions:** about 30–45 test setup/teardown lines plus under 10 backlog lines. No production/support implementation, unrelated `database()` defaults, global lock increase, retries, skips, timeout changes, engine changes, migrations, new guards, stress suite, runtime feature, provider access or public privacy-rule changes. Scratch diagnostics and repeats stay outside the PR. D608 slice 6 at `d79d05c3` and its qualified merge run `43144440296` are context, not evidence for this fix.
