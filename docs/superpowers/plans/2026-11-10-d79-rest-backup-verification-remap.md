# D79-rest: map existing backup verification and correct its guides

**Cleared by the watcher on 10 November 2026 at 18:35** for the four-guide documentation-only correction; no owner approval of this page is claimed. Source comparison: Cloud `fe0ba8a9ed5b8e03ed5465a10d969226d1178ba5`; Waitron `origin/main` `565819bf59bd64a297ec2efba28fc53d337fdf42`, both read with `git rev-parse`. A separate Sol/high invocation drafted this page; Claude read it once (147 seconds), source only. This correction accepts its simpler documentation-only recommendation. No genuine archive run occurred. The driver’s three existing integration target/evidence/ownership files passed 60 tests; `node --test scripts/ci-docs.test.mjs` passed 15. Neither proves fresh archive recovery.

**Authority found:** `/Users/clintongormley/waitron-campaign-d/archive/questions-to-2026-10-23.md:2917` records **OWNER ANSWER (2026-10-18 ~10:10, through the watcher): “Approved”** to the backup-verification contract. Line 2918 preserves fiscal authority and keeps snapshots unavailable/enforcement off until evidence and release gates pass. The driver read these lines and retained the excerpt; Claude could not access the private archive. Public contract: `f8e243f4` (#211), `docs/superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md:313`. This is design approval, not approval of this page.

## What already landed

The October 21 plan’s unchecked boxes are stale as an implementation inventory. `git show --shortstat 121d162ed` records #307’s 163 files, +9,597/−451 lines:

| Old tasks | Current source receipts |
| --- | --- |
| 1–2: adapters/protocol/target | `deploy/test-cloud/backup-worker.mjs:30`; `packages/backups/src/verification-protocol.ts:489`; `deploy/backup-verifier/target.json:3` |
| 3–5: evidence, bound child, admission | `packages/registration/migrations/043_backup_target_verification.sql:195`; `packages/backups/src/waitron-data-verify-child.mjs:33`; `verification-admission.ts:101` in that directory |
| 6–8: recovery/replacement/retention/status | `packages/backups/src/recovery-v2.ts:17`, `recovery.ts:172`, `replacement.ts:36`, `catalogue.ts:514`; `packages/registration/src/monitoring.ts:39` |
| 9–10: portal/schema/joint proof | `apps/portal/src/locale.ts:199,466`; `scripts/schema-upgrade-backup-fixture.mjs:5`; `deploy/test-cloud/snapshot-proof.test.mjs:62–111` |

Waitron A850/A1004 landed (#1939/#1968); current Waitron still reports `activation: "not_attempted"` (`apps/server/src/backup-verification.ts:399`). The November 1 compatibility work landed in `bb2fa407e` (#700): release/assets, genuine setup/prepared recovery and historical separation (`scripts/cloud-cost/replay-release.mjs`, `waitron-adapter.mjs`, `archive-evidence.mjs`). Its amended line 145 deliberately preserves ordinary restore’s refusal; no task checkbox establishes fresh qualification.

Later paired real-server journeys exist in `scripts/test-cloud-paid-{verification,recovery,authorised-recovery}.test.mjs`, with historical Linux results in `docs/test-cloud.md:728–837`. They cover actual worker admission, owner delivery, unchanged fiscal refusal, and a separate authorised disposable restore. #914 (`2208befc4`) supplies integrated journeys; #1088 (`3f2ca18fa`) reads a selected image’s exact target (`scripts/test-cloud-integration.mjs:273–283`). #1125 (`223250abc`) adds Kubernetes verification (`scripts/kubernetes-check.mjs:201`). These are existing paths, not new work. Default Waitron pin remains `ec91a9e3`; current-main runtime compatibility is unverified.

## Smallest usable result and remaining work

You can find the existing proof and its limits without mistaking the legacy failure for missing verification. After clearance, change only **`docs/backlog.md`, `docs/test-cloud.md`, `docs/local-backups.md`, `docs/managed-key-operations.md`**. Correct D451/D79’s inventory; link the existing paired/joint commands and label recorded outcomes historical. Remove `test-cloud.md:540–543`’s obsolete incomplete-controls claim; qualify its exit-zero description with #307’s historical receipt. Explain that `scripts/test-local-backups.mjs:515–530` runs ordinary hooks before the bound verifier, and still correctly refuses without allocation authority. Its two-venue wrapper (`scripts/cloud-two-venue-milestone-receipt.mjs:48`) inherits that limit; document this in the local guide, leaving executable callers and all protected assertions unchanged. D79 owns this documentation correction, not a promised repair or retirement of the old command.

Run `node --test scripts/ci-docs.test.mjs`, the immutable changed-document audit and link checks, then docs-only finish/land. No fresh Docker run is required to correct the record; any later run uses existing helpers and D79 resource rules. Expected additions/deletions: production +0/−0, tests +0/−0, support +0/−0; documentation roughly +45/−30, excluding this page.

Leave venue activation, fiscal implementation/immutable rows, assertion amendments, location work, retargeting Waitron, published-image qualification and deployment untouched. Release gates and the unexercised module `needs_authority` outcome stay open. No new product code, schema, protocol, receipt framework or runtime claim is proposed.
