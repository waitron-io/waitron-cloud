# D613: omit audited root tests inside the verified command

**Authority.** Watcher, 2026-11-09 23:33: drop `rootFiles`; omissions are advice inside the existing verified root command; uncertainty runs the original full command; preserve each file’s existing partition. The final Claude plan read precedes building; both A1440 PRs must land first.

**Boundary.** Eligible PRs change only regular files in existing `packages/*/{src,test}/` or `apps/*/{src,test}/`, optionally ordinary root/docs prose under existing policy. Everything else retains full work, including new packages, manifests, migrations, package READMEs, root helpers and shared inputs. Main/full/nightly retain full work. Unknown/new tests run. Only these audited paths may be omitted:

```text
scripts/ci-package-revisions-indirect.test.mjs
scripts/ci-package-revisions.test.mjs
scripts/ci-package-revisions-directories.test.mjs
scripts/ci-package-revisions-arrays.test.mjs
scripts/ci-package-revisions-expression-unicode.test.mjs
scripts/ci-package-revisions-computed.test.mjs
scripts/ci-package-revisions-unicode.test.mjs
scripts/ci-package-revisions-middle-unicode.test.mjs
scripts/ci-package-revisions-first-unicode.test.mjs
scripts/ci-package-revisions-bracket-receivers.test.mjs
```

**Evidence.** These tests use temporary Git/workspaces with synthetic packages. The external audit, `/Users/clintongormley/waitron-campaign-i/receipts/d613-root-selection-20261109/d613-reader-audit.md`, reports 671 cases passing after all live package src/test trees were removed; actual reader `scripts/ci-package-allocation.test.mjs` failed on missing real test directories. Candidate: `6eb3e4675e6f58f8c300d566809d1ae028d00b8e`. Trace imports, helpers, copies, directory reads and children when readers change; uncertainty retains full work. Historical attributed sums 584.242/651.269 seconds are not job-minute savings. Five fewer root job-minutes remains a healthy natural eligible-PR target, requiring measurement.

**Layers and mechanism.** Mandatory root verification, summary, source-evidence equality, decision reconstruction, plan fields and eight job names remain unchanged, including limits and flags. Drop the proposed plan field entirely. Add no comparison job, record, expiry, optional metadata, scheduler, protocol or broad audit system; ordinary bugs need fixes, not extra failure gates.

The short `scripts/ci-root-selection.mjs` advisory selector operates only inside the existing verified root command. Discover the full sorted inventory, including the direct glob and four explicit files; establish each existing partition before omissions. The driver read installed Node 26.13’s `internal/test_runner/runner:1045`: index modulo shard total assigns files. Filter only within that original partition; execute retained files without sharding again. An empty individual partition succeeds without invoking Node’s test discovery. Each job independently retains its literal original full command for missing advice, older heads, uncertain eligibility/inventory or any advisory read/loading failure. Independent fallback therefore cannot lose another job’s files. Once tests start, propagate child failures. Actual readers remain; nightly still runs every test.

**Build and checks.** Read TDD; write behavioral tests, observe expected failures, implement minimally, then run every changed test file. Selector tests cover eligibility, exact omissions, unknown/new retention and advisory uncertainty/read failures. Command tests prove full/default and retained execution exactly once, stable partitions with mixed advisory/fallback jobs, empty individual partitions and child-failure propagation. Workflow tests preserve mandatory contracts. Repeat deletion/actual-reader controls on the candidate tree; retain full work if uncertain. Preserve existing assertions except the approved selection policy.

**Exact files.** Create `scripts/ci-root-selection.mjs` and `scripts/ci-root-selection.test.mjs`; modify `.github/workflows/ci.yml`, `scripts/ci-root-shards.test.mjs`, `scripts/ci-workflow.test.mjs`, `docs/ci-root-input-ownership.md`, `docs/ci-proof-selection.md`, `docs/backlog.md` and this plan. No edits to ci-plan, root-inputs, summary, evidence or decision.

**Budget and finish.** Estimates: production 80–140 changed lines; tests 180–260; documentation 40–80. Stop at 900 changed lines or three working hours to an open PR, including auditing; return a smaller opportunity to the watcher. Finish with focused checks, Claude run-it review and current-head CI; record a natural eligible PR’s selected files, results and job-minutes. Sample waiting is outside the budget; savings remain unproved until measured.
