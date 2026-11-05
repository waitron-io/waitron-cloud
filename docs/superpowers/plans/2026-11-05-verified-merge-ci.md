# Verified merge CI implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` inline, task by task. Read the TDD skill before writing implementation or tests. This invocation produces design and plan only.

**Goal:** Reuse independently verified identical-tree PR results and select changed-tree main work from the actual push range.

**Architecture:** Share revision selection between real PR and push events. Verify attempt-bound plan artifacts against reviewed selectors, exact workflow provenance and complete job evidence; each workflow owns its decision.

**Tech stack:** Node ESM, `node:test`, Git, existing `gh api` and GitHub Actions.

**Spec:** [Verified merge CI design](../specs/2026-11-05-verified-merge-ci-design.md).

## Global constraints

- Runtime landing waits for PR #942, nightly AWS coverage and watcher confirmation of all six updated Cloud runbooks. A design-only PR may land first under RUNNER §5.2.
- Uncertain evidence/range means full work; no empty success, older-green substitution, assertion removal or deadline increase. Schedule/dispatch/calls/full input force full.
- Use audit v2 per-path renewal after reader review; preserve frozen v1 policy bytes. Do not renew peers without reviewing their exclusions and consumers.
- No provider resource, deployment or new spending. Existing checks, cancellation policies and exact source checkouts remain. Sign off commits and squash; never bypass hooks.

## Review focus

1. A newer red run or changed attempt must defeat old green evidence (Task 3).
2. A successful source summary with an omitted selected shard must refuse reuse (Tasks 2–3).
3. Multi-commit/direct pushes cover the whole before..after range, and historical selection ignores later workspace changes (Task 1).
4. Missing sibling evidence cannot borrow CI proof or repeat independently proved work (Task 4).
5. A reusable nightly invoked by a PR must still run full despite its inherited PR event (Tasks 1 and 4).

## Task 0: Publish the planning milestone

- [ ] Have RUNNER read/check these two documents in its parent invocation. Land the docs-only milestone through its normal current-head checks and own H11 procedure; no runtime claim or code review exception for the later implementation. Do not implement in this planning invocation.
- [ ] Before implementation, re-read H/I watcher instructions, fetch/reconcile the actual landed #942 and part 4 interfaces. Coordinate the range interface and workflow files with lane H; do not overwrite its held work. Record the AWS/nightly integration requirement and send the spec's complete readback checklist to the watcher. Runtime landing remains gated until confirmation.

## Task 1: Share exact revision selection

**Files:** create `scripts/ci-range.mjs`, `scripts/ci-range.test.mjs`, `scripts/ci-workspace-snapshot.mjs`, `scripts/ci-workspace-snapshot.test.mjs`; modify `scripts/ci-scope.mjs`, `scripts/ci-plan.mjs`, `scripts/ci-plan.test.mjs`, `scripts/ci-cli.test.mjs`.

**Interfaces:** implement `resolveRange(event,context,git)`, `loadWorkspaceAtRevision(head,git)` and `selectPlan({base,head},snapshot,git)` from the spec. Keep `createPlan`'s existing signature; expand context with actual event/ref/full/called identities. Keep existing selection rules and audited receipt behavior. Pass immutable source/manifests/test inventory into the current reviewed graph and allocation code; do not execute historical modules or query historical packages through current-directory pnpm discovery.

- [ ] First add failing tests `push covers before through after`, `direct and multi-commit use identical selectors`, `invalid push range forces full`, and `full invocation ignores PR-shaped payload`. Assert exact Git arguments, NUL names/spaces/renames, ancestry, event.after agreement; cover forced/deleted, zero/malformed/missing SHAs, non-ancestor and empty diff. Assert schedule, dispatch, reusable call and full input never consult reuse. Observe each expected behavioral failure before implementation.
- [ ] Add a real Git fixture recording one head, then change the current checkout's workspace membership, dependencies and test inventory. Historical reconstruction/readback must still produce that head's literal expected jobs; wrong snapshot revision or missing tracked inputs refuses reuse. Observe failure before adding the Git-backed snapshot loader.
- [ ] Extract the existing selector with minimal changes; select real push revisions directly. Preserve mixed Markdown, immutable audits, package/revision/lock selection and receipts. No fake PR payload and no dependence on event.commits length for range calculation.
- [ ] Run red, then green with this explicit file list:

```sh
node --test scripts/ci-range.test.mjs scripts/ci-workspace-snapshot.test.mjs scripts/ci-plan.test.mjs scripts/ci-cli.test.mjs scripts/ci-mixed-docs.test.mjs scripts/ci-docs.test.mjs scripts/ci-receipts.test.mjs scripts/ci-lock-revisions.test.mjs scripts/ci-manifest-lock.test.mjs
```

Expected: new behavioral failures first; then zero failed/cancelled tests. Record results and a signed-off commit. Adapt obsolete full-main assertions to the authorised behavior while preserving fallback, exact-range and completeness controls.

## Task 2: Record source plans and derive complete job contracts

**Files:** create `scripts/ci-evidence.mjs`, `scripts/ci-evidence.test.mjs`; modify `scripts/ci-summary.mjs`, `scripts/ci-summary.test.mjs`, `scripts/ci-root-shards.test.mjs`, `scripts/ci-scripts.test.mjs` and the evidence-emitting steps in the workflows from Task 4.

**Interfaces:** implement `PlanEvidence`, `ReuseProof` and `expectedJobContract(workflowPath,selection)` exactly as specified. Export existing allocation validation instead of duplicating shard policy. Provide evidence writer CLI and `node scripts/ci-evidence.mjs --readback <decision.json>` for independent post-merge validation.

- [ ] Add failing tests for complete full/scoped/docs/scripts contracts, complete cost/venue/AWS/download contracts, captured original event/workflow SHA provenance with empty optional API associations, artifact identity/digest/version/size, omitted/duplicate shards, unknown jobs, missing skipped placeholders and empty plan. Old `{sha,runId}` must fail; a valid versioned proof must permit only its workflow's current skips. Assert mutually exclusive scripts/documentation/reuse, all needs results, and unchanged 60-second publication behavior.
- [ ] Implement JSON-only evidence, canonical digests, exact matrix names and reviewed workflow contracts. Source summary is a completed required job; it gets no self-publication exception. Artifact upload is a mandatory planner step with `if-no-files-found:error`; a failed emission cannot approve reuse. Decode one bounded regular JSON archive member without arbitrary extraction. Publish actual plan and provenance for future source runs.
- [ ] Run red, then green:

```sh
node --test scripts/ci-evidence.test.mjs scripts/ci-summary.test.mjs scripts/ci-root-shards.test.mjs scripts/ci-scripts.test.mjs scripts/ci-cli.test.mjs
```

Retain omission/failure/publication assertions, their receipts and a signed-off commit. Confirm all `plan.reuse` consumers named in the spec were reconciled.

## Task 3: Verify bounded independent source evidence

**Files:** replace `scripts/ci-reuse.mjs`; create `scripts/ci-reuse-api.mjs`, `scripts/ci-reuse-api.test.mjs`; expand `scripts/ci-reuse.test.mjs`, `scripts/ci-cli.test.mjs` and Task 2's evidence tests.

**Interfaces:** synchronous `findReuse(context,{api,git,now},workflowPath)` returns only `{reuse,reason}`, preserving `createPlan`'s synchronous callers. The adapter exposes `readRepository`, `readWorkflow`, `readCommit`, `listAssociatedPRs`, `listRuns`, `readRun`, `listAttemptJobs`, `listArtifacts`, `readPlanArtifact`; list methods return the spec's page object and accept the remaining deadline. Inject API, Git and monotonic clock in tests. Never read live credentials in a unit test.

- [ ] Add failing controls for every admission field: repository ID/name/default branch, unique association, merged/main/same-repo PR, exact merge/head/tree, source event/workflow ID/path/head/branch/attempt and captured original PR base. A source with `pull_requests:[]` and valid attempt-bound event evidence must pass; wrong PR number/head, forged event fields, wrong workflow execution commit/topology, changed local reusable definition, wrong referenced workflow, missing event evidence or hostile historical module must fail without executing historical code. Verify workflow definitions at actual execution/head/current revisions; do not require unchanged base definitions when execution proof establishes the reviewed workflow.
- [ ] Add `latest red defeats old green`, `attempt changes after jobs`, `new run appears on reread`, failed/missing/cancelled/unfinished/duplicated jobs, total-success-with-missing-shard, docs/scoped legitimate skips versus invalid empty plan, expired/forged/missing artifacts and unavailable Git/API controls. Source plan reconstruction must equal the recorded plan before job validation.
- [ ] Add two-page success plus missing page, conflicting counts, duplicate IDs, cyclic/nonterminal pagination, a latest-red second page and GitHub result-limit controls. Assert five-page/list, 30-request, 30-second global and five-second command bounds; no timeout may return reuse. Use a fake clock and fake `gh` executable, not network calls.
- [ ] Implement the verifier, source and latest-list re-reads, and per-workflow full fallback. Wire CI planning and summary's final revalidation; a failure after skip outputs fails summary. No full-parent-chain walk.
- [ ] Extend the real Git CLI fixture: make a signed squash with equal trees, then advance main independently and squash to an unequal tree. Assert equal-tree proof suppresses product work; unequal tree selects the literal main range. Add a two-commit push touching different owners, a direct push and API refusal; assert selected jobs, full fallback and nonempty strict-summary results. Preserve tests proving every selected job omission fails.
- [ ] Run red, then green:

```sh
node --test scripts/ci-reuse.test.mjs scripts/ci-reuse-api.test.mjs scripts/ci-evidence.test.mjs scripts/ci-range.test.mjs scripts/ci-plan.test.mjs scripts/ci-cli.test.mjs scripts/ci-summary.test.mjs
```

Record exact commands/failures/passes; make a signed-off commit.

## Task 4: Wire sibling workflows and preserve nightly full work

**Files:** modify `.github/workflows/ci.yml`, `cloud-cost.yml`, `venue-services-proof.yml`, `aws-infrastructure.yml`, `download-supervision-diagnostic.yml` under that directory; coordinate `.github/workflows/nightly.yml`, `scripts/ci-nightly-summary.mjs` and its tests with H part 6. Modify `scripts/ci-docs.mjs`, H part 4's `scripts/ci-proof-inputs.mjs` and `scripts/ci-proof-inputs.test.mjs`; expand `scripts/ci-workflow.test.mjs`, create `scripts/ci-reuse-workflow.test.mjs`.

**Interfaces:** sibling planners emit their own native `required`/matrix and independent decision/evidence. Extend `proofInputPlan` with an explicit revision-range entry point rather than manufacturing a PR. The common verifier receives a literal workflow path. Pass `toJSON(inputs)` as `CI_WORKFLOW_INPUTS`; a present `full` key sets `called:true` regardless of its value. Calls, dispatch and schedule force full regardless of payload; retain explicit `full:true` call sites and default-true call inputs.

- [ ] First add failing executable-condition tests. Evaluate the actual extracted workflow expressions with event/input/needs fixtures for valid reuse, changed-tree selection, planner failure, docs/unselected sibling, missing source and nightly PR rehearsal. Include an explicit false-input reusable call that must still force full. A small supported-expression evaluator must reject unknown syntax; supplement with actual planner/summary subprocesses. Regex-only assertions are insufficient.
- [ ] Wire mandatory lightweight sibling planners/summaries and artifacts, `actions:read`/`pull-requests:read` where needed, exact checkout refs and existing matrix commands. Require separate AWS four-cell evidence, separate native cost/venue evidence and download diagnostic evidence. Preserve cost main path exclusion and all diagnostic/manual triggers. Test a cost-only red source with green CI/AWS: only cost falls back; the other proofs remain usable.
- [ ] Preserve part 4 input lists and controls; range extraction is the only selection-policy refactor. If part 4 is not yet landed, retain current `ci-docs --plan` PR behavior behind the same range interface until integration. Add the AWS reusable full call to nightly and its required result to nightly-summary; preserve `17 3 * * *`, manual rehearsal, standard/cost/venue full calls, job prefixes and cancellation rules. No provider action is added.
- [ ] Run red, then green on the reconciled candidate:

```sh
node --test scripts/ci-reuse-workflow.test.mjs scripts/ci-workflow.test.mjs scripts/ci-proof-inputs.test.mjs scripts/ci-docs.test.mjs scripts/ci-nightly-summary.test.mjs scripts/ci-evidence.test.mjs scripts/ci-cli.test.mjs
```

Check every source checkout and every local reusable call against the spec. Preserve product commands and all existing timeouts. Record results and a signed-off commit.

## Task 5: Review, land and perform operator readback

**Files:** update `docs/ci-documentation-audit.md`, `docs/ci-nightly.md`, affected CI guides and `docs/backlog.md` in the runtime PR. Review changed executable readers, renew only their owning docs records under `scripts/ci-input-audit.d/docs/`, stage them and prove repeat generation is identical. Leave peer records stale unless their separate review is done.

- [ ] Execute the spec's readback locally against API fixtures, including each refused source and selected-range omission. Verify the runtime PR changes no assertion/deadline and includes no campaign files. Re-read current watcher instructions before finish and landing.
- [ ] Run `finish-branch`: initial rebase, installed disposable candidate containing the complete tree (including uncommitted candidate work), then one Claude run-it review via `~/workspace/tools/claude-seat.sh review-run <candidate> <brief> <report>`. Brief every command to start `cd <candidate> && pwd`, stop on failure and use explicit nonempty test file lists. Require bounded claim-falsification experiments for completeness/provenance/latest-run/pagination/conditions, without live provider actions. Retain report, timing, usage and triage; fix verified findings test-first. Delete only the candidate created for this review when finished.
- [ ] If hosted API shapes remain unverified, use at most one owned draft scratch PR and two candidate commits for equal/unequal-tree proof, at most two CI cycles, with no production merge or dispatch/deployment. Checkpoint if still inconclusive; never loosen admission. Close it and remove only recorded owned refs. Otherwise use normal post-landing evidence; do not create scratch work merely to repeat passing tests.
- [ ] Publish through normal hooks. Read **every final current-head job** and raw log for CI, AWS, cost, venue, nightly rehearsal and applicable diagnostics. Record exact checkouts, test counts, optional skips, actual plan and independent strict summary. Missing/pending/red is not qualified. The implementation PR takes full fallback unless the actual execution-definition proof establishes its reviewed workflow.
- [ ] Require #942, AWS nightly inclusion and the watcher's six-runbook confirmation. Acquire your own H11 atomic `main.lock` (30-second retries, ten-minute maximum; own holder note beside it). Fresh-fetch/classify overlap; release for any necessary rebase and regain current-head CI before reacquiring. Land the signed-off squash, verify prospective/actual tree, update main, run `pnpm install`, remove only owned worktree/local/remote refs and release only your lock/note. Retain prior review across routine rebases.
- [ ] Run the spec's exact operator checklist on the merge SHA, then on the first qualifying unchanged-workflow merge. Verify each reused source independently and distinguish inherited counts, newly executed work, unselected jobs and excluded triggers. For changed trees independently recompute before..after and inspect every selected job. Keep H12 open until the actual readback qualifies; inspect the next nightly's full work and summary separately. Report runtime behavior only after these receipts exist.
