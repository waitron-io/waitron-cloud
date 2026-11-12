# Retire the stale nightly password probe

**Finish line:** nightly reaches its live checks instead of invoking two removed cases. After landing, start the full workflow on main and read every job; a passing cost retry is not a repair.

**Request:** lane G queue, CI-nightly-1112 (watcher 12 November 12:40): investigate both failures in nightly `43207714335`, fix their causes in one small PR, then run nightly manually on main. Include a separate cost fix if small.

**Evidence:** `git show d79d05c3f -- packages/registration/test/authenticator-factor.test.ts` shows the shared ten-minute proof change removed the selected password-derivation cases and barrier. The unchanged nightly selector reproduces the missing-schema teardown failure on Linux; no current case matches. Reports are in lane G `receipts/ci-nightly-1112/`. Previous nightly `43008307192` passed.

Cost separately refused at `quiesce-idle` after 79.9 seconds. The same paced case has earlier D530 refusals in `docs/backlog.md`; an unchanged Linux run now passes one case in 85.1 seconds. This does not identify or fix its cause. Record this occurrence under the existing investigation, preserving all cost assertions and deadlines.

**Reuse and exclusions:** keep the existing nightly job, upload, current action-proof tests and every other diagnostic. Remove only the obsolete password experiment; do not restore per-action password handling, change identity logic, add permanent mutation tests or change provider/deployment permissions.

## Files and checks

- [ ] Get Claude's plan read and watcher clearance, explicitly covering removal of the obsolete workflow step and its wiring checks. This is a proposal, not owner approval.
- [ ] In `scripts/ci-workflow.test.mjs`, expect the two remaining named diagnostics and one PostgreSQL/Python wrapper, retaining checkout-history and all upload checks. Run `node --test scripts/ci-workflow.test.mjs`: the wrapper count must fail against the old workflow.
- [ ] Delete only `Check password snapshot ordering and deliberate faults` from `.github/workflows/nightly.yml`. Retain all live tests and the relay faults. Rerun the wiring test; require green.
- [ ] Update `docs/ci-nightly.md` and the existing D530/nightly text in `docs/backlog.md`, recording the separate cost recurrence without claiming it repaired. Run `node --test scripts/ci-workflow.test.mjs scripts/ci-docs.test.mjs` and read counts.
- [ ] Run unchanged `packages/registration/test/{authenticator-factor,account-action-proof}.test.ts` and `packages/account-http/test/{authenticator-factor,account-action-proof}.test.ts` through the PostgreSQL wrapper, with literal filenames. These own current proof/session behavior; wiring checks own workflow composition.
- [ ] Complete finish-branch review and current-head CI, including the real PR nightly rehearsal. List changed wiring checks and watcher clearance in the PR. After green landing, dispatch `gh workflow run nightly.yml --ref main`, bind its exact SHA and read every job. Record cause and manual-run result separately. Do not merge red or label cost fixed by a clean retry.

**Size:** product code 0; workflow +0/−65; tests +5/−5; guide/backlog about +15/−5, plus this one-page plan. A cost repair needs concrete evidence and a scoped amendment first.
