# D79-rest: verify backup data without fiscal activation

**PLAN FOR APPROVAL.** Read-only source comparison: Cloud `fe0ba8a9ed5b8e03ed5465a10d969226d1178ba5`; Waitron `origin/main` `565819bf59bd64a297ec2efba28fc53d337fdf42`. Both resolve with `git rev-parse`. The driver ran the three existing integration target/evidence/ownership files: 60 passed; `node --test scripts/ci-docs.test.mjs`: 15 passed. Neither is a genuine archive run; no Docker proof ran. Next: one Claude read, then watcher clearance before execution. Neither has happened here.

The contract's owner approval is recorded at `/Users/clintongormley/waitron-campaign-d/archive/questions-to-2026-10-23.md:2917`: **OWNER ANSWER (2026-10-18 ~10:10, through the watcher)**: **“Approved”**. Line 2918 keeps fiscal authority unchanged, snapshots unavailable and enforcement off until evidence/release gates pass. The public contract landed as `f8e243f4` (#211); its `Owner decision` is at `docs/superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md:313`. This approves the design, not this plan.

The October 21 plan's unchecked boxes are not today's implementation inventory. `git show --shortstat 121d162ed` confirms #307 landed 163 files, +9,597/−451 lines. Current source maps its tasks as follows; “landed” does not mean freshly tested:

| Old task | Landed source receipt |
| --- | --- |
| 1: reconcile adapters | `deploy/test-cloud/service-runtime.mjs:23`; worker wiring `deploy/test-cloud/backup-worker.mjs:30` |
| 2: protocol/target | `packages/backups/src/verification-protocol.ts:489`; `deploy/backup-verifier/target.json:3` |
| 3: evidence/qualification | `packages/registration/migrations/043_backup_target_verification.sql:195` |
| 4: bound child/transport | `packages/backups/src/waitron-data-verify-child.mjs:33`; `verification-transport.ts:10` in that directory |
| 5: admission | `packages/backups/src/verification-admission.ts:101` |
| 6–7: v2/recovery/replacement | `packages/backups/src/recovery-v2.ts:17`, `recovery.ts:172`, `replacement.ts:36` |
| 8: retention/status | `packages/backups/src/catalogue.ts:514`; `packages/registration/src/monitoring.ts:39`; `packages/operations/src/status.ts:94` |
| 9: portal/schema | `apps/portal/src/locale.ts:199,466`; `scripts/schema-upgrade-backup-fixture.mjs:5` |
| 10: joint proof | `deploy/test-cloud/snapshot-proof.test.mjs:62–111`; release qualification remains open |

These implementations landed in #307. Waitron A850 landed `5516dd57` (#1939), A1004 `ec91a9e3` (#1968). At current Waitron main, `apps/server/src/backup-verification.ts:317,399` still calls module data checks and reports `activation: "not_attempted"`.

The November 1 compatibility plan also has implementation: `bb2fa407e` (#700) includes Tasks 1–4's release/assets (`scripts/cloud-cost/replay-release.mjs:5–30`), setup/authenticated recovery (`waitron-adapter.mjs:108,257–281`) and historical separation (`archive-evidence.mjs:84–93`, same directory). Its route addendum appears at `scripts/cloud-cost/fixtures/remote-waitron-backend.mjs:24,31`. Task 0's decision is recorded in the plan at line 38; Task 5's fresh runtime qualification is not established here. Its line 145 explicitly preserves the native fiscal refusal.

**Smallest usable result:** re-run the existing joint proof so you can see a disposable venue's backup selected as verified in the owner API and its delivered bytes actually restored under separate fixture authority. `snapshot-proof.test.mjs:76,87–98` already asserts this and the primary client's unchanged `FISCAL_RESTORE` refusal. Qualify current Cloud against the existing pinned Waitron `ec91a9e3`, without repinning. Use the existing producer `node scripts/backup-verifier-proof.mjs <private-receipt.json>`, then `node scripts/verify-backup-verifier-proof.mjs <private-receipt.json>`, with the two image variables documented in `docs/test-cloud.md:487–492`. Check actual execution counts, cleanup and certification; no current-head success is claimed. RUNNER requires watcher clearance for D79 end-to-end runs; clearance must name a suitable host, because the capture alone permits 4 GiB and the full stack may exceed the test box’s roughly 5 GiB spare memory.

Do not repair `scripts/test-local-backups.mjs` merely to replace this proof. Its legacy hook call precedes bound verification at lines 515–530; its old recovery signature and success assumptions remain at 995–1008,1034–1037. Replacing those protected checks needs a separately justified change. Later `2208befc4` (#914) supplies integrated journeys; `3f2ca18fa` (#1088), `scripts/test-cloud-integration.mjs:273–283`, reads the selected image's exact target. Default pins remain `ec91a9e3` (`target.json:5`; `deploy/test-cloud/backup-verifier-runtime.mjs:7`); current-main compatibility is unverified, not absent.

**Remaining files:** this page now; after clearance and a successful run, only `docs/test-cloud.md` and `docs/backlog.md` to distinguish existing proof, fresh results and the legacy failure. Expected follow-up lines: production +0/−0; tests +0/−0; test support +0/−0; documentation approximately +20/−10. No build is proposed. A proof failure requires diagnosis before proposing one.

Outside scope: venue fiscal activation (only the existing separately authorised disposable fixture runs), immutable rows, protected assertion changes, publication/deployment, location removal or any new dependency on location, and retargeting current Waitron. Published-image qualification and release gates remain open; a module's `needs_authority` outcome is explicitly unexercised (`docs/test-cloud.md:600`). Open Waitron PRs 2754/2693/2669/2756 are driver-supplied context, not permission for fiscal edits.
