# Scoped and reused CI design and execution plan

**Goal:** You run affected package suites and reuse verified PR-head CI after an identical-tree merge, keeping `summary` as the strict landing gate.
**Scope:** One production PR after the seven-way registration partition (`e8ed2e58`). Disposable proof branches never change main.
**Sources:** `.github/workflows/ci.yml`; workspace manifests; `scripts/ci-workflow.test.mjs`; root `tsconfig.json`.
**Prior art:** Read Waitron's `scripts/changed-packages.mjs`, `scripts/changed-scope.mjs`, and `CLAUDE.md` §2. Borrow directory attribution and validation, not its documentation/root exemptions.
**Execution:** Work inline, test first, retain behavioral assertions, and use D67's FULL finish/review path. Record observed failures before implementation and sign off every future commit.

## Design

### Scope and outputs

- Add a bounded `changes` job before work, with full git history and Node 26. Disable automatic package caching in this job because it never installs dependencies. Grant only additional `actions: read` and `pull-requests: read` for evidence reads; keep existing read permissions.
- PR scope uses the event's exact base/head SHAs and their merge base, never moving branch names or pnpm's changed-since filter. Every job checks out the exact PR head SHA. This makes the successful run head name the tested source rather than a synthetic merge commit.
- Discover workspace directories from `pnpm-workspace.yaml` through validated pnpm workspace inventory; read their manifests, excluding the root. Require unique names and declared test scripts; invalid discovery fails the planner.
- Attribute NUL-delimited git paths to the innermost package directory. Include both paths of renames and deletions. Build reverse dependency edges from `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies` referencing workspace members. Supplement them with sibling source/fixture paths, workspace names and root package paths found in quoted source literals. A relative template whose package cannot be determined adds every member as a possible dependency. Generated output and dependencies are excluded from that scan.
- Select changed packages plus all transitive dependents, handling cycles. A changed dependency declaration selects its owning package directly; a removed or renamed package path that is absent from the current inventory forces full work. A removed edge therefore cannot hide the package whose manifest removed it.
- Root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `scripts/`, `.github/`, `compose.yaml`, `deploy/`, and ANY path outside packages mean full work, including documentation. Empty, unreadable or unknown diffs/graphs also mean full work.
- Malformed manifests and invalid/empty pnpm output fail the gate rather than claim an empty run passed. Unknown changed paths select the complete validated current inventory.
- Emit a validated plan: reason, concrete package rows and receipt suites, a typecheck flag, and reuse evidence; matrix outputs derive from that plan. Missing or malformed outputs fail summary.
- Expand selected packages into `include` rows using D66's partition: registration 7, account-http 3, backups 2, portal 3; all other test packages one job. Dependency edges are discovered, never hardcoded; shard counts are scheduling policy.
- Assert each selected package occurs, each shard occurs exactly once, counts do not exceed test files, and names come from the discovered inventory. Newly discovered test packages get one job; removed/unknown scheduled names cannot silently pass.
- Keep D66's sorted-file partition, all test commands/counts, PostgreSQL wrapper, portal build, 30/120-second deadlines, browser-only bounded install, historical fetches, eight-minute work limits and `fail-fast: false`.
- Retain full `pnpm typecheck` on every non-reused package or full change: backend manifests invoke root `tsconfig.json`, whose `packages/**/*.ts` input checks the whole backend. Narrow package selection would misrepresent that check. Keep existing script guards in this job.

### Receipt inputs

All five receipts run for any selected backend package under `packages/`, except isolated ui-smoke. This conservative scope includes dynamically assembled fixture inputs: backup capacity imports backups, gateway limits imports remote-access, and migration/recovery receipts import registration and identity. Portal alone runs local-stack because its runtime supplies portal assets. ui-smoke alone needs no receipt. Root/script/deployment edits run all five. Backend receipt scope deliberately over-selects to keep cross-package contracts covered without an incomplete handwritten dependency map.

### Verified reuse on a main push

- Start in full mode. Only a single-commit merge push is eligible; direct/multiple-commit pushes stay full. Query commit-associated PRs and require exactly one returned merged PR in this repository, targeting main, with `merge_commit_sha` equal to the pushed SHA.
- Read its immutable final head SHA. Find an exact completed green `pull_request` run of THIS workflow ID/path in this repository with matching `head_sha`, head repository and final head branch. Require the latest exact-head run to pass, including its latest attempt. After a merge, GitHub may clear a run’s PR list, so branch/repository/head checks establish the association.
- Read the chosen run's latest-attempt jobs. Require complete job records, no failed/cancelled/unfinished work, and exactly one successful planner and strict summary. More than one page of jobs falls back to full. The successful strict summary already verifies each planned row. Exact-head checkout wiring replaces a separate tested-tree artifact.
- Fetch the exact head and push commits, then compare `git rev-parse <sha>^{tree}` for both. Identical commit messages or patch IDs are insufficient.
- A scoped green head merged on advanced main is reusable ONLY when these trees still match. An ordinary behind merge adds main's changes, changes the tree and MUST run every package, receipt and full typecheck, not merely its former PR scope.
- Any API/git/artifact failure, incomplete job records, missing association, malformed evidence, non-green latest attempt or ambiguity leaves full mode. Bound calls/timeouts and log the fallback reason. A broken planner itself fails summary.
- Explain beside the comparison that Cloud cannot enforce up-to-date branches on its GitHub plan, so tree equality is the guard. Reuse summary records the head SHA and run ID.

### Strict summary

- Keep `always()` and depend on `changes`, typecheck, receipts and packages. Require planner success and validated nonempty expectations outside reuse.
- Required jobs must be completed `success`; missing, skipped, cancelled, failed, queued or running jobs fail. Read this run/attempt's paginated jobs to verify every expected package/shard/receipt, not just matrix parent results.
- Accept `skipped` only for a receipt/job proven unnecessary by the validated scope, or work covered by verified exact-tree reuse. Empty matrices get a job-level condition and valid harmless matrix representation; any placeholder execution fails.
- Reject unexpected skips, missing/duplicate rows and malformed booleans; current-run job API failure fails summary. Reuse-evidence API failure instead schedules full work. Never add a blanket `success || skipped` rule.
- Preserve independent main concurrency, PR cancellation and summary's two-minute timeout. Validate the actual executed summary command under success/failure/missing/skipped/cancelled inputs.

## Execution and proof staging

1. **Failing controls first.** Create `scripts/ci-plan.test.mjs` for graph selection, manifest-edge deletion, rename, devDependency propagation, root/unknown/empty fallbacks, shard expansion and receipt inputs. Create `scripts/ci-reuse.test.mjs` for association/workflow/head/tree/attempt/API rejection. Extend `scripts/ci-workflow.test.mjs` to exercise strict summary and retain D66 behavioral checks; print the expected failures.
2. **Implement the minimum.** Add `scripts/ci-scope.mjs`, `scripts/ci-plan.mjs`, `scripts/ci-reuse.mjs`, and `scripts/ci-summary.mjs`; wire validated outputs into `ci.yml`'s dynamic matrices/conditions. Run `node --test scripts/ci-plan.test.mjs scripts/ci-reuse.test.mjs scripts/ci-workflow.test.mjs`. Remove each new safety guard in disposable copies and require its owning test to fail.
3. **Prepare real Actions proof before production landing.** In a disposable checkout, create a unique scratch target branch containing the candidate workflow. Add only temporary push/base-ref routing for that target in the SAME `ci.yml`; keep the production selection/reuse/summary logic unchanged. PRs target scratch; its pushes exercise the merge path. Do not deploy, publish, change repository settings or add lasting production proof paths.
4. **Establish a green scratch baseline.** Its initial unassociated push runs full. Then open actual PR controls with isolated package-file changes: portal only, a valid lockfile-only change, and identity. Before EVERY push run the touched packages' full suites plus transitive dependents locally; shared workflow/lockfile changes require the whole workspace.
5. **Prove selection using job records.** Portal selects only its three package shards, full typecheck and local-stack receipt; lockfile selects everything; identity selects all nine packages because direct fixture imports connect operations and ui-smoke as well as the manifest dependents. This expected broader selection comes from discovered source consumers, not a hardcoded package list. Record actual jobs, gates, per-package counts and summary outputs; a text guard or mocked API alone is insufficient.
6. **Prove both merge directions.** Open two disjoint portal-only PRs from the same scratch baseline and obtain scoped green heads. Merge the first while current: equal trees, work skipped and reuse evidence recorded. Leave the second behind and merge it without rebasing ONLY into scratch: different trees, full work required despite its scoped green head. Verify each exact merge SHA's actual run and every expected job.
7. **Measure and clean proof.** Record run IDs/attempts, PR/head/base/merge/tree SHAs, longest job, wall time, test counts and rounded job minutes from paginated `actions/runs/<id>/jobs`. Compare typical portal head+merge totals against D66 before/after; label timing estimates as estimates. Retain receipts in the D67 PR body, remove only your scratch branches/checkouts, and exclude all temporary triggers/control edits from the production patch.
8. **Finish the single D67 item.** Update `docs/backlog.md` with proved behavior and costs; update `/Users/clintongormley/waitron-campaign-d/RUNNER.md` to require rebase onto current main and exact-head green CI before merging, while retaining exact-merge summary read-back. List changed test checks and the required FYI. Perform the FULL review, normal hooks and current-head CI; hold the shared landing lock, recheck main, rebase/retest if it advanced, merge and verify exact-merge CI before marking D67 landed. Include scratch proofs in this same item; do not defer them to a later task.

**Acceptance:** Actual Actions controls and both real scratch merges prove selection and reuse; D66 coverage/partition and strict summary remain intact; all uncertain cases run full or fail the gate; the final production diff contains no temporary proof routing.
