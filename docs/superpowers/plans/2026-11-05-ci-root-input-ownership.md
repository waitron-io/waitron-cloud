# D571 part 3 implementation plan

> **Execution: native inline, the owner's preference.** Use `superpowers:executing-plans` task by task. Read `superpowers:test-driven-development` before writing implementation or tests. Write the failing behavioral test, run it and observe the expected failure, implement the minimum, then run it to pass. No implementation in this planning invocation.

**Goal:** Build the review foundation for root-input ownership, beginning with three conservative examples, without replacing existing CI scheduling.
**Architecture:** Validate finite ownership and exact two-revision review evidence, compose it with current package selection, and keep the existing
runners plus an independent summary.
**Tools:** Node 26, pnpm 9.15, Git object reads and Node behavioral tests.
**Spec:** [Reviewed root-input owners](../specs/2026-11-05-ci-root-input-ownership-design.md).
**Landing order:** Review and land these two documents alone before substantial code. H owns this slice and later #938; K owns part 2b; I owns part 5.
Never resume or modify `feat/precise-ci-selection`.

## Constraints and review focus

Preserve every assertion, test/fixture command, deadline, receipt, browser retry bound and package partition. Keep main pushes, part 4 real-input
cost/venue rules and forced-full nightly work unchanged; admit only the independently verified new metadata rule in the spec. Unknown/unresolved inputs stay full. Guide and backlog updates belong in the implementation PR. Use
normal signed-off commits (`git commit -s`), hooks, one Claude whole-branch run-it review before code landing, exact-head CI, H11 landing and H12
readback.

Pin these five failure classes to the tasks below:

1. New reverse readers or changed read boundaries hidden by evidence renewal: task 1.
2. Deleted, renamed, added or nonregular inputs and removed evidence: task 1.
3. Receipt-only, root-only and mixed work accidentally empty or missing owners: task 2.
4. Forged plans and missing/duplicate/unexpected/skipped job records: task 3.
5. Neighbor integration and nightly/main/proof behavior drifting: task 4.

## Files and interfaces

| File | Responsibility |
| --- | --- |
| New `scripts/ci-root-inputs.json` | Three-entry registry and complete reviewed site ledger from the spec |
| New `scripts/ci-root-review.d/*.json` | Separate exact-input identity and review provenance records, with retained removals |
| New `scripts/ci-root-review.mjs` | `rootReviewProjection(revision,git) -> {registryObjectId,inputs:[{path,mode,type,objectId}]}`; `checkRootReview(revision,git) -> registry`; explicit-path index-only renewal CLI |
| Modify `scripts/ci-input-audit-records.mjs` or extract shared helpers | Parameterize canonical inventory/retention/writing mechanisms for a separate namespace; keep all existing mode behavior |
| New `scripts/ci-root-inputs.mjs` | `rootInputPlan(paths,base,head,git)` and `assertRootInputWork(plan,{base,head,git})` as specified; exact-head execution preflight CLI `--check` using `CI_PLAN` |
| Modify `scripts/ci-plan.mjs` | Extract `packageWorkForPaths(paths,workspace,base,head,git)`; compose audited root work and emit `root_tests` |
| Modify `scripts/ci-summary.mjs` | Root verification options, independent job identities and stricter unknown/duplicate refusal |
| Modify `scripts/ci-proof-inputs.mjs` | Ignore only verified new root-review metadata; preserve every real-input and conservative fallback rule |
| Modify `.github/workflows/ci.yml` | Root gate/output, root/receipt preflight and full-history summary checkout; existing runner commands retained |
| New `scripts/ci-root-inputs.test.mjs`, `scripts/ci-root-review.test.mjs` | Real Git histories, review/selection/CLI behavior and mutation controls |
| Existing `scripts/ci-{plan,summary,root-shards,scripts,gateway-scripts,workflow,cli,mixed-docs,receipts,proof-inputs,nightly-summary}.test.mjs` | Preserve old assertions and add integration behavior |

Do not introduce `PlanV2`, a universal job matrix, timing scheduler or arbitrary execution registry. If I has landed equivalent
immutable-range/evidence helpers, adapt through those reviewed interfaces instead of duplicating them; preserve the spec's return shapes and behavior.
If K has landed, extract its current package behavior rather than resurrecting this base's implementation.

### Task 1: Admit only explicitly reviewed ownership

- [ ] Trace every registry entry from root and package commands through reverse callers, imports, directory/file reads and child commands. Record
  exact site/boundary/role evidence in `ci-root-inputs.json`. Inspect `ci-dependency-fixture.mjs`, `ci-audit-fixture-dependencies.mjs` and their saved
  JSON fixtures: distinguish copied candidate bytes from historical fixture bytes. An unproved consumer keeps the entry full; do not delete or weaken
  its existing test.
- [ ] Add failing tests named `two saved trees need current review`, `new reader cannot inherit approval`, `target reader bytes require renewal`,
  `registry edit stays full`, `missing stale or removed evidence refuses`, and `review metadata is not a command`. Assert exact owner IDs/full
  reasons, not just truthy results.
- [ ] Add `unrelated branches renew different records and merge in either order` using real independent branches. Assert no shared digest changes,
  unchanged records remain byte-identical, and both merged inventories qualify. Add `stale head fails mandatory summary even for full or legacy work`;
  a full-work fallback is not sufficient. Cover new/deleted metadata and a complete full-work activation separately from steady-state narrowing.
  Delete the registry and every record after a genuine activation and require full-plan summary failure; historical activation cannot disappear with metadata.
- [ ] Add real-Git controls for deletion, delete/add rename, addition inside a read directory, chmod, symlink, submodule, invalid paths, truncated NUL
  data, missing/shallow history and changed root commands. Assert both inventories are inspected even when one refuses. Deleting a required test
  selects full and cannot spawn an empty head runner; a missing required command fails execution.
- [ ] Run `node --test scripts/ci-root-review.test.mjs scripts/ci-root-inputs.test.mjs`. Record the expected assertion failure before implementation.
- [ ] Implement strict registry/per-input record validation and `rootReviewProjection/checkRootReview`; use complete Git rows and current docs metadata
  validation. Pin targets and potential readers, exclude only the spec's defined metadata/prose, and reject duplicate/unknown JSON fields. Implement
  staged renewal with nonempty explicit reviewed input paths, reviewer/reference, regular-file preflight and identical repeat output. Never update a
  shared inventory digest. Reuse D577 machinery through namespace-aware helpers with existing behavioral assertions retained. Prove projection works before docs renewal
  while admission refuses until docs records verify. A changed consumed boundary requires a shared/full registry edit, not just renewal.
- [ ] Implement the two-tree finite mapper. Missing bootstrap evidence returns full; an arbitrary new `scripts/` or workflow reader cannot qualify
  merely because docs records were generated. Keep v1 frozen and existing four audit modes unchanged. Verify docs currency independently; stale unused
  peers neither grant authority nor demand renewal.
- [ ] Rerun the task command to pass. In a disposable copy, remove old-tree inspection, target fingerprinting and mode checks separately; require each
  corresponding control to fail. Restore the copy. Commit this unit signed off with its verification receipts.

### Task 2: Compose nonempty root, receipt and package work

- [ ] Add failing cases `root contract has eight jobs without compiler`, `receipt without packages is work`, `mandatory receipt survives omission
  audit`, `package plus root is union`, `several root entries deduplicate`, `shared or unknown input wins`, and `prose or evidence alone cannot empty
  the plan`. Assert concrete packages/shards, receipt IDs, booleans and complete root markers.
- [ ] Add legacy compatibility controls for docs-only, identity, gateway, lock, ordinary packages and full work. Exclusive scripts still reject
  packages/receipts/compiler/reuse/docs. Root-review/docs renewal plus real package paths may enter the verified route with empty entry IDs,
  preserving package selection; evidence/prose alone stays full. Malformed evidence, peer-record edits and changed descriptors take full work. Stale
  docs refuse; stale unused peers remain unused. Preserve legacy mixed-docs assertions.
  Post-activation exclusive script edits with new root records may retain full work under their unchanged full-diff rules; assert that fallback and
  mandatory head freshness rather than weakening legacy checks to manufacture a shortcut.
- [ ] Run `node --test scripts/ci-root-inputs.test.mjs scripts/ci-plan.test.mjs scripts/ci-scripts.test.mjs scripts/ci-gateway-scripts.test.mjs
  scripts/ci-mixed-docs.test.mjs scripts/ci-receipts.test.mjs` and observe expected new failures.
- [ ] Extract `packageWorkForPaths` without changing package dependency/revision semantics. For a verified root route, call it only on nonempty
  package paths, then union mandatory root receipts after existing receipt omissions. With no package paths, construct nonempty root/receipt work
  directly. Add `rootInputs`/`rootTests` only to this route; retain the existing `createPlan` signature and legacy plan fields.
- [ ] Keep full/main/forced behavior and the exclusive script fast path. A failed ownership proof must not fall through to a narrower package plan.
  Unsupported root/lock mixtures use full work with a path/reason. Do not narrow K's package fallback or repair #938 in this task.
- [ ] Rerun that command to pass. Mutate away the mandatory receipt union and shared-path precedence separately in a disposable copy; require
  failures, then restore. Commit signed off.

### Task 3: Validate execution independently of the proposed plan

- [ ] Add failing summary cases for every plan kind: remove each required job from both plan and records, duplicate selected/unselected identities,
  insert unknown skipped/successful jobs, skip a required job, change root gate/typecheck independently, omit root markers, forge paths/IDs/revisions,
  omit all work, and execute a placeholder. Require rejection for failure/cancellation/unfinished/API errors and correct acceptance for legitimate
  known skips.
- [ ] Add executed CLI controls with real Git histories and a fake job API: recompute root owners from the original event range, reject a different
  checkout or dirty tracked source before execution, and reject missing/deleted tests before spawn. Provide forged `CI_PLAN` argv/shell/provider text
  and assert no unallowlisted process starts. Execute safe synthetic subprocesses to prove nonzero exits propagate; do not launch deployment/proof
  generators.
- [ ] Add executed workflow-condition and root-inventory controls. Every complete root file appears once across eight partitions; empty expansion
  refuses. Keep the existing `ci-root-shards` failure-propagation assertions and runner flags, not a replacement test that mirrors new implementation.
  Keep receipt allowlist and concurrency/failure handling.
- [ ] Run `node --test scripts/ci-root-inputs.test.mjs scripts/ci-summary.test.mjs scripts/ci-root-shards.test.mjs scripts/ci-workflow.test.mjs
  scripts/ci-cli.test.mjs scripts/ci-run-receipts.test.mjs` and record the expected failures.
- [ ] Extend summary options with a trusted `{base,head,git}` root-verification context, obtained independently from the event by the CLI and
  `waitForSummary`. Call `assertRootInputWork` before accepting needs/job results. Require it for new root work; recompute even if the marker is
  omitted. Keep the independent package allocation contract, receipt ID checks, prefix validation and current-run publication deadline/identity logic.
  Detect activation from reachable Git history, not remaining head files. Once activated, validate the complete current head inventory for every plan, including full and legacy plans, independently
  of the proposed marker or selected jobs. Stale head records fail CI; a stale base merely refuses narrowing. Activation needs a complete qualified head.
- [ ] Independently derive required root/receipt owners and require package work when real package paths remain. Preserve the landed package
  selector's responsibility for affected-package completeness; do not claim this root check proves that separate property. Conservative full
  alternatives must contain all package allocations, all root jobs, compiler and six receipts.
- [ ] Emit `root_tests` for every plan: new validated `rootTests`, otherwise legacy `typecheck`. Wire the root gate and preflight in existing
  root/receipt jobs; full-history summary reads both saved trees. `--check` validates root ownership when present and preserves legacy modes
  otherwise. Keep exact-head refs, original test argv, `needs`, `always()`, eight/two-minute limits and summary's 60-second bound.
- [ ] Rerun to pass. Mutate independent owner reconstruction, exact-head checks and each missing/duplicate/status guard separately in a disposable
  copy; require the relevant control to fail. Restore it and commit signed off.

### Task 4: Qualify on landed main and finish the implementation

- [ ] Rebase onto actual landed main and inspect overlapping K/I work. Audit every spec-listed field and all consumers with `rg`, including tests,
  outputs, runner env, evidence serialization/digests and source-plan reconstruction. Add compatibility controls for K's direct package selection and
  I's source reconstruction/reuse if landed. Root fields cannot disappear in reconstruction; reuse stays exclusive and unsupported old evidence
  refuses. Preserve each neighbor's behavior without implementing their pending work.
- [ ] Add failing integration controls for all five examples, current-head evidence renewal, forced-full standard/nightly calls and part 4 cost/venue
  decisions. Run the relevant new cases red, implement only integration needed for this slice, then pass `node --test scripts/ci-root-inputs.test.mjs
  scripts/ci-root-review.test.mjs scripts/ci-proof-inputs.test.mjs scripts/ci-nightly-summary.test.mjs scripts/ci-workflow.test.mjs
  scripts/ci-cli.test.mjs`. Include landed K/I test files when relevant; do not execute an absent filename or a bare runner.
- [ ] Reproduce new root-review record renewal selecting both proof matrices for an otherwise unrelated portal change. Add controls for valid renewal,
  stale base/head, absent historical activation, forged/noncanonical/deleted records, registry/checker changes, changed readers and valid renewal mixed
  with a real proof input. Verify both original authorities before omitting only canonical metadata; apply all existing rules to remaining paths.
  Run those real-Git planner controls red, implement the bounded `ci-proof-inputs.mjs` metadata rule, then run them green. Delete either authority check
  in a disposable copy and require its stale/forged control to fail. Keep every existing part 4 real-input assertion and forced-full behavior.
- [ ] Prepare complete registry/per-input evidence and mandatory summary freshness in a full-work candidate. Review every recorded site, renew explicitly
  reviewed root inputs, then renew only owning docs records. Update the developer renewal procedure for every code PR, including full/legacy work.
  Stage explicitly and prove repeat generation unchanged. An unchanged post-bootstrap registry and valid reviews in both trees are required before any
  narrow acceptance case. If one candidate entry remains unresolved, keep its full fallback and report precisely which entry did not qualify.
- [ ] Update `docs/ci-documentation-audit.md`, `docs/ci-proof-selection.md` only where clarification is needed, and `docs/backlog.md` with actual
  scope/refusals. Do not change campaigns, sibling proof behavior, product assertions, receipts or deadlines. List any deliberate selection-contract
  assertion change with its stronger replacement; keep the original safety behavior covered.
- [ ] Measure before/after planner job counts using identical saved scenarios, distinguishing bootstrap fallback from reviewed steady state. Record
  SHAs, review currency, concrete plans and complete expected job names. Save actual hosted job/test counts separately. Do not use October job counts
  or unrun timing estimates as evidence of savings.
  Include both separate cost and venue matrices, ordinary package and legacy shortcut overhead, the initially reproduced metadata regression and the
  qualified metadata rule. The examples describe standard CI only. Do not claim D571 part 3 complete or a total saving from the three examples alone.
- [ ] Run focused behavioral checks and normal hooks according to the repository's local/CI split. Do not add a redundant whole-workspace run merely
  to finish. Run `finish-branch`: initial rebase, installed throwaway checkout containing the complete candidate, then one Claude whole-branch run-it
  review via `claude-seat.sh review-run`. Its brief must require exact cwd, explicit nonempty test lists and bounded falsification of ownership, mixed
  work and summary omissions. Fix verified findings test-first in the feature worktree; stop/clean only owned resources. Preserve approval across
  routine later rebases.
- [ ] Publish with normal hooks and signed-off commits. Inspect every final exact-head CI job, selected test counts, known skips and independent
  summary, plus applicable cost/venue checks. Missing, pending, cancelled or red work is not ready. Keep mutation artifacts and review experiments in
  disposable copies outside the product diff.
- [ ] Land through H11 using your own atomic main lock and fresh-fetch/ancestry checks from the current landing procedure. Release for any rebase and
  regain exact-head green before landing. Verify the signed-off squash tree and update main through normal procedure. Keep this docs-only milestone
  separate from that later code landing.
- [ ] Complete H12 by reading every job and log for the exact merge SHA, with actual plan, checkout SHAs, counts and explicit skips. Independently
  inspect the next qualifying nightly full run: all packages, eight root jobs, compiler, six receipts, complete cost/venue matrices and nightly
  summary. Main's unchanged full run does not prove a narrow PR ran correctly; the narrow PR does not qualify the nightly. Report any unqualified case
  plainly, then handle #938 as separate work.
