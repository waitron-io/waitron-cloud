# D613: omit audited root tests inside the verified command

**Authority.** [Watcher 2026-11-10 00:02](/Users/clintongormley/waitron-campaign-i/questions.md:579): “If it saves clearly less, build the nine-file advisory cut with your corrections (ci-package-revisions.test.mjs kept whole; full-run and planner modes passed explicitly; partitions compared against real Node with the four explicit files and hyphen/dot names), within 720 lines.” [Watcher 2026-11-09 23:33](/Users/clintongormley/waitron-campaign-i/questions.md:568): “Yes: drop the rootFiles plan field. Omissions are advice inside the existing verified root command; any uncertainty or failed advisory read runs the original full command; keep each file's existing partition before omitting anything.” A1440 prerequisites verified merged: Cloud #1128 `22af1d45b9098f44dcd84565562fda82accb78fa`; Waitron #2673 `b7bb50fec3125d5718f2c53e9ad8babfce329a2e`. This corrects the [permitted final read](/Users/clintongormley/waitron-campaign-i/receipts/d613-final-plan-20261109/report.md); no further external plan review.

**Evidence.** The unchanged nine-file local profile passed: [CPU stacks](/Users/clintongormley/waitron-campaign-i/receipts/d613-final-plan-20261109/profile-summary.json) total 619.851s: initial Git init/config 22.194s, other non-child 13.240s, case commits 51.971s, planner graph 416.369s, child/other Git 116.078s. Initial fixture setup is far smaller than omitting complete files. These are neither CI savings nor a concurrency-derived ceiling. Healthy natural PR job-minute saving still needs measurement; no removal gate is approved.

**Final fix authority.** [Owner, recorded 2026-11-09 22:22](/Users/clintongormley/waitron-campaign-i/questions.md:501): “9% is significant, I'd build it as long as it doesn't add fragility.” [Watcher 2026-11-10 00:50](/Users/clintongormley/waitron-campaign-i/questions.md) approves the single run-it fix round and landing this cut on green; planner-graph measurement follows separately, at most one hour, without a build. The 1,111-second run-it reproduced one stale preflight-order check; repair its execution-step anchor without weakening the assertion, and prove it still refuses a preflight moved after execution.

The old 671-case audit deleted uncommitted live directories, missing the clone case at `scripts/ci-package-revisions.test.mjs:674–700`. Committed deletions in scratch `b78d2cd60602b4aeb4d9c39581657de57d33451f` reproduced [ENOENT](/Users/clintongormley/waitron-campaign-i/receipts/d613-final-plan-20261109/committed-live-reader-control.tap). Keep that whole file; move no tests. `node --test --test-reporter=tap --test-concurrency=2` over the nine named files passed 613 cases in that committed-deletion checkout: [receipt](/Users/clintongormley/waitron-campaign-i/receipts/d613-final-plan-20261109/nine-committed-deletion-control.tap).

**Omissions: only these nine.**

```text
scripts/ci-package-revisions-indirect.test.mjs
scripts/ci-package-revisions-directories.test.mjs
scripts/ci-package-revisions-arrays.test.mjs
scripts/ci-package-revisions-expression-unicode.test.mjs
scripts/ci-package-revisions-computed.test.mjs
scripts/ci-package-revisions-unicode.test.mjs
scripts/ci-package-revisions-middle-unicode.test.mjs
scripts/ci-package-revisions-first-unicode.test.mjs
scripts/ci-package-revisions-bracket-receivers.test.mjs
```

**Owner conditions, for all nine audited synthetic-only files.** Uncertainty runs full. Eligible changes cannot affect their synthetic fixtures, so needed checks remain. Advice failures run the original command, adding no independent failure gate. Trace imports, helpers, copies, reads and children when readers change.

**Mechanism.** Inside the verified root command, pass `CI_FORCE_FULL: ${{ inputs.full }}` and `CI_MODE: ${{ needs.changes.outputs.mode }}` explicitly. Narrow only `CI_MODE=selected` on `pull_request` runs, never forced full. Require only regular files in existing `packages/*/{src,test}/` or `apps/*/{src,test}/`, optionally ordinary prose. Everything else stays full; unknown/new tests run.

Use plain `.sort()` over the original full inventory: direct glob plus all four explicit files, `scripts/identity-upstream.test.mjs`, `scripts/verify-gateway-reconnection-receipt.test.mjs`, `scripts/billing-display-guard-probes.test.mjs`, `scripts/venue-service-guard-probes.test.mjs`. Preserve every original partition before omissions; execute retained files without re-sharding. Empty partitions succeed without default discovery. Each job uses its original literal full shell command on any advice/loading/read uncertainty or older head. Once test execution starts, propagate child failure without fallback. Log omitted paths to stderr. Fresh main root jobs stay full; identical-tree merges may reuse PR evidence; nightly stays full.

**Build and checks.** TDD: observe expected failure, implement minimally, run changed tests. Selector tests own eligibility, omissions and uncertainty. Command tests compare partitions against real Node with all four explicit files, hyphen/dot names, mixed advisory/fallback execution, exactly-once execution, empty partitions and child failures. Workflow tests pin inventory equality and unchanged mandatory verification, eight job names, flags and limits. Preserve behavioral assertions; add no needless gate.

**Exact twelve changed files.** Create `scripts/ci-root-selection.mjs` and `scripts/ci-root-selection.test.mjs`; modify `.github/workflows/ci.yml`, `scripts/ci-root-shards.test.mjs`, `scripts/ci-workflow.test.mjs`, `scripts/ci-root-inputs.test.mjs`, `docs/ci-root-input-ownership.md`, `docs/ci-proof-selection.md`, `docs/ci-package-readers.md`, `docs/ci-merge-evidence.md`, `docs/backlog.md` and this plan. No planner/evidence/summary/decision implementation edits; preserve plan fields, source-evidence equality and decision reconstruction.

**Finish.** Stop at 720 changed lines or three working hours to PR. Then focused checks, Claude run-it review and current-head CI; measure selected files, results and job-minutes on a healthy natural eligible PR. Sample waiting is outside the budget.
