# Precise CI selection implementation plan

**Goal:** Select all real consumers for every PR path and reduce full-run rounded job-minutes toward 55 or below while keeping each job about ≤300 seconds.
**Architecture:** Compare immutable base/head input graphs; select logical checks; pack them into validated workflow jobs. Keep D67 reuse and landing guards.
**Tools:** Node 26, pnpm 9.15, git objects, built-in Node tests; no added production YAML dependency.
**Spec:** [Precise CI selection](../specs/2026-10-14-precise-ci-selection.md).
**Execution:** Inline, bounded test-first tasks after fresh review and landing of the docs-only design milestone.

## Constraints and review focus

Preserve all product/privacy/ownership/expiry assertions, migration contents, test deadlines, browser retry bounds, historical fetches and fail-fast:false. Operating-cost modelling and daily CI scheduling are separate work. Implementation may update backlog evidence; do not rewrite campaign/global policies. Before **every** future push run full touched+dependent package suites locally; scripts/workflow/lockfile/shared config require the whole workspace, regardless of narrower CI selection. Sign off every commit and never bypass hooks.

Five failure classes need explicit controls: disappearing edges/renames (task 1), directory additions and opaque paths (task 2), transitive/peer/integrity-only lock changes (task 3), forged empty/partial plans (task 4), and complete files/counts after grouping (task 5). Uncertainty must print path/reason and select full or fail; no silent omission.

## File interfaces

| File | Interface and responsibility |
| --- | --- |
| New `scripts/ci-inputs.mjs` | `readTree(sha,git) → Tree{sha,files,read(path)}`; `buildInputGraph(tree) → Graph{members,units,edges,uncertainties}`. Tree-backed manifests, bounded input-site resolver and explicit command/read descriptors. Each edge records input path/directory, consumer unit, caller location and execution role. |
| New `scripts/ci-lock.mjs` | `parseLock(text,path) → Lock`; `changedImporters(before,after) → {importers,reasons}`. Strict covered v9 parser and resolved importer fingerprints including metadata, transitives and peer contexts. |
| Modify `scripts/ci-scope.mjs` | `scopeForChanges(changes,beforeGraph,afterGraph,lockDelta) → {unitIds,reasons,full}`; `workPlan(scope,afterGraph,timings) → PlanV2`; `validatePlan(plan,graphs)`. Runner/summary reconstruct immutable inventories to validate required entries and complete selected-package files. No unchecked legacy output. |
| New `scripts/ci-schedule.mjs` | `packWork(units,timings) → jobs`; deterministic explicit file groups, setup profiles and complete allocation validation. Timings carry source/head/profile and per-file estimates; missing/stale observations retain conservative groups. |
| New `scripts/ci-timings.json` | Validated scheduling data derived from actual proof receipts: per-file blob/input-closure identity, profile, duration/count, setup estimate and run ID. Raw receipts stay outside the repository; committed groups/timings make production scheduling reproducible. |
| New `scripts/ci-docs.mjs` | `checkDocs(tree,paths)`: Markdown text checks, structural source-map validation and direct allowlisted JSON verifier invocation. Unmapped receipt fails by path. Never launches a production proof generator. |
| New `scripts/ci-run.mjs` | `runJob(plan,jobId,execute)`: validated argv/cwd, optional single setup per compatible job, per-unit receipt `{id,package,files,count,durationMs,status}`. No arbitrary shell command from plan JSON. |
| Modify `scripts/ci-plan.mjs` | Retain `createPlan(event,context,workspace,git,api)` public entry while adapting internals to tree snapshots. Return validated `{version:2,mode,base,head,changes,reasons,units,jobs,reuse}`; emit `plan/work/work_matrix` from it. |
| Modify `scripts/ci-summary.mjs`, `ci.yml` | `assertSummary(plan,results,jobs)` validates allocation and exact jobs. Workflow `needs:[changes,work]`, exact-head checkout, matrix name `work (<id>)`, `always()` summary; harmless placeholder only behind false gate. |
| New/modified `scripts/ci-*.test.mjs` | Add inputs/lock/schedule/docs/run tests; migrate all existing scope/plan/summary/workflow/CLI consumers together. `ci-reuse.mjs` behavior stays intact; keep its controls. |

Plan unit shape: `{id,kind,entry,files}` with kinds `docs/script/config/typecheck/package/receipt` and safe registry entry IDs, not shell strings or production proof actions. Job shape: `{id,profile,units:[unitId...]}`; profiles define install, database/mail, Chromium and historical checkout needs. `mode:'work'` requires nonempty units/jobs and complete one-to-one allocation; `mode:'reuse'` requires empty work and valid SHA/runId evidence. PR `base` is merge-base; null push base requires full selection. Reasons cover every changed path. Summary rejects unknown schema versions/keys, invalid IDs/paths/fields, duplicate rows and unallocated work.

### Task 1: Immutable tree inventory and removed consumers

- [ ] Add `ci-inputs.test.mjs` and `ci-plan.test.mjs` failing controls: old/new package rename selects both consumer sets; removed manifest/import edge plus changed provider retains former consumer; deletion of a required test entry fails; spaces/NUL paths survive; mutable working tree cannot change the immutable plan. Mixed docs+portal+helper is their union.
- [ ] Run `node --test scripts/ci-inputs.test.mjs scripts/ci-plan.test.mjs`; retain expected assertion failures before implementing.
- [ ] Implement `readTree/buildInputGraph` and exact event `merge-base`, `diff --name-status -z` rename/delete records. Read both inventories, union reverse edges, attribute new/deleted files using both owners/directories. Missing object/inventory/diff → named full or planner failure.
- [ ] Rerun those tests to pass; remove old-tree union in a disposable checkout and require removed-edge control to fail. Commit this unit with `git commit -s`.

### Task 2: Every reader and root path category

- [ ] Add failing inputs/scope/docs controls: backlog+README selects docs only; SOURCE adds map/upstream checks; corrupted gateway JSON fails its direct verifier without package work; unknown receipt fails by path. `mail:down` edit selects compose reader; root `test:*` edit selects that entry; inert helper edit selects syntax/own callers; test-postgres edit selects all nine packages.
- [ ] Add one positive consumer control per evidence-matrix row: migrations/new SQL, runtime/fiscal/registration readers, upgrade helper callers, release source/workflow, Docker build inputs, `.npmrc`, workspace add/remove, portal/UI/root tsconfig, compiler versus root script fields. Root backend typecheck is one whole `packages/**/*.ts` check, not seven filtered checks.
- [ ] Add exact-template/directory/opaque tests: `../migrations/${name}` → registration directory, finite sibling variable → exact owner, truly opaque sibling/env path → named full; known temporary generated output has no repository edge. Keep real fixture links in the spec's nine-row table and prove identity still selects nine while portal selects one.
- [ ] Run `node --test scripts/ci-inputs.test.mjs scripts/ci-scope.test.mjs scripts/ci-docs.test.mjs` red, then implement the bounded resolver/descriptors and docs checker, rerun green. Every import/read/exec site gets exact/bounded/external-produced/CLI-only/opaque classification with caller evidence; resolver grammar it cannot understand is opaque, never dropped.
- [ ] Validate all root scripts (including proof/verify/release families), configs and newly added files through this inventory. Derive own test callers from imports, module URLs and child commands, not basename convention alone. Keep registered safe syntax/config checks for uncalled helpers; unknown non-code configuration falls back.
- [ ] Remove each narrowing rule's required consumer edge in disposable copies and require its positive control to fail. Commit signed off.

### Task 3: Resolved lockfile changes

- [ ] Add `ci-lock.test.mjs` failing cases: importer-only valid resolved change; snapshot-only transitive integrity edit; peer-context-only edit; optional edge removal; alias/workspace-link cycle; deleted importer/record; unsupported syntax/settings/protocol; duplicate/missing records; unexplained orphan. Assert selected importer/consumer sets and named fallback/failure, never just booleans.
- [ ] Run `node --test scripts/ci-lock.test.mjs scripts/ci-scope.test.mjs` red. Implement the spec's strict bounded parser; consume every token/field, reject partial parses and enforce bounded size/depth. Validate current 215/215 records and all ten importer closure counts against the spec's independently probed values.
- [ ] Fingerprint all reachable snapshots plus associated package metadata using full peer keys; preserve versions/integrity/optional/platform differences. Traverse workspace links and root compiler inputs separately; union affected importers/real consumers from both trees. Do not compare importer text alone.
- [ ] Rerun green; removing transitive, peer, integrity or old-record traversal must fail its control. Commit signed off. Use a genuinely valid resolved dependency addition/change for scratch, not arbitrary whitespace/specifier-only edits.

### Task 4: Receipt reachability and non-package success

- [ ] Add failing scope controls for each of the five receipt rows: capacity storage change selects capacity; public-gate change selects gateway; migration module selects database/local-stack; pure composer/helper selects milestone. Unrelated backend code cannot blanket-select all five. Assert CLI-only proof subprocesses stay excluded when imported, while directly edited proof scripts keep syntax/caller checks.
- [ ] Add summary and executed CLI controls for valid docs-only/script-only plans with zero packages/receipts; zero-work non-reuse still fails. Reject missing/duplicate/unfinished/cancelled/failed/skipped required jobs, unknown unit/command, forged profile, omitted file/unit, malformed booleans/arrays/matrix, unexpected execution and API failure. Reuse remains the existing separate mode.
- [ ] Run `node --test scripts/ci-scope.test.mjs scripts/ci-summary.test.mjs scripts/ci-cli.test.mjs scripts/ci-run.test.mjs` red. Implement complete schema/registry validation and `runJob/assertSummary`; test subprocess exit/count handling. Run green; remove schema/allocation/status guards independently and require failures.
- [ ] Keep original verifier/security/recovery assertions byte-for-byte. Commit signed off.

### Task 5: Measured grouping and real workflow wiring

- [ ] Add failing schedule/workflow controls: every selected package test file appears once, groups nonempty, portal build once per browser job before tests, historical fetches present, 30s/120s test deadlines unchanged, whole-package coverage stays whole if enabled. Combined jobs report each package/unit count and fail on any unit failure. Unselected units never enter a combined job.
- [ ] Run `node --test scripts/ci-schedule.test.mjs scripts/ci-workflow.test.mjs scripts/ci-run.test.mjs` red. Implement version-2 outputs/gates and deterministic packing. Run each database-profile job once through `test-postgres.mjs exec node scripts/ci-run.mjs` with validated plan/job arguments; execute its selected units inside that fixture. Preserve D67 checkout/concurrency/reuse, eight-minute work timeout and two-minute changes/summary limit; ≤300s is the measured operating budget.
- [ ] Measure files on Ubuntu scratch runners with original concurrency and real fixtures: Node reporter durations plus build hooks, PostgreSQL/Mailpit start/cleanup, Docker image builds, Chromium, install/cache/post steps. Avoid serial file-time sums as proof of parallel group duration. Store timings/counts outside product assertions; keep local execution receipts outside the repository during implementation.
- [ ] First evaluate balanced registration 4–7, account 2–3, backups ≥2, portal ≥3; these are search bounds, not chosen counts. Combine fast selected identity/operations/remote/fiscal/check/receipt units where measured safe, and ui-smoke with selected browser work where it fits. Retain separate counts and fixture ownership/cleanup. Do not add a global install/cache artifact stage without measured cold+warm transfer/setup savings; current warm installs cost 1–3s.
- [ ] Minimize `sum(ceil(jobSeconds/60))` using measured groups/setup profiles, persist validated timing data and rerun full proof. New/changed files and stale fixture/lock/profile observations use conservative groups and still appear exactly once. If >55 rounded minutes or a job >300s, adjust packing/setup and remeasure within D69; do not declare success. Publish chosen groups and per-package before/after, separate shared costs and queue time. Remove allocation/completeness guards to prove controls, rerun green, commit signed off.

### Task 6: Actual scratch PRs, controls and cleanup

- [ ] Use **one** disposable scratch target with temporary mapped base/push routing in the **same `ci.yml`**. Establish a full green baseline there. Keep production planner/reuse/runner/summary code unchanged between controls; record candidate and routing diff. No separate proof workflow, production merge or schedule.
- [ ] Before EVERY scratch/candidate push obey Cloud local full touched+dependent suites; shared scripts/workflow/lockfile/config require `node scripts/test-postgres.mjs` whole-workspace equivalent. Run registration with concurrency 2 before the file list when necessary (`backlog.md:477`), original deadline/build retained. Save each package's actual counts, not just exit codes; let normal push hook run.
- [ ] Open five real PR controls: (1) backlog/spec Markdown only → docs check + changes/summary, no package/receipt; (2) `identity-upstream.mjs` or another tested inert root helper only → syntax/own tests/callers, no packages; (3) valid single-importer resolved lock addition such as a pinned portal-only dev dependency with matching frozen install → affected importer/real consumers, no unrelated packages; (4) portal source → portal and actual readers; (5) test-postgres runner or proven install-wide setting → genuinely full with per-path reason.
- [ ] Prove narrow selection cannot hide breakage: mutate a real consumed sibling fixture/migration/read target and observe its owning test fail in the selected scratch work; restore and pass. Planner remove-edge tests complement this executed control. Do not change any product assertion to manufacture success.
- [ ] Recheck D67 with actual scratch equal-tree merge reuse and a deliberately behind scratch merge that requires full. Production landing always rebases; the behind exception exists only in disposable scratch. Capture latest-attempt jobs/summary for exact heads and both exact merge SHAs.
- [ ] Capture PR/base/head/merge/tree SHAs, run IDs/attempts, final logical units/jobs, file lists and **final counts for every selected package** (full run: every package). Compare each package against a complete candidate-suite run; investigate any changed count. The historical 1,477 aggregate is not a substitute for current per-package counts.
- [ ] Report docs-only, root-script, single-importer lock, one-package and full proof costs/wall time; PR/FYI table must include docs-only/one-package/full before/after. Use supplied 73/72/55 and portal 18 baselines, actual timestamp rounding, queue separated. Include per-package setup/test/group/minute before/after; never label projections as measured savings.
- [ ] Remove all scratch routing/triggers/control edits from production; inspect diff and prove guards on the clean candidate. Remove only owned scratch branches/checkouts/processes/containers by recorded IDs. Finish D69 with backlog update, Changed test checks and FYI; one Claude run-it whole-branch review after initial rebase via finish-branch, normal hooks and exact-head CI. Under the existing shared lock fetch/recheck main ancestry, rebase/retest/re-green if advanced, land and read every exact-merge job. Do not repeat approved whole-branch review solely for a rebase.

## Changed test checks — deliberate supersessions only

List each changed assertion separately in the implementation PR and one `<D69> (#PR) — changed test checks, FYI, no answer needed` entry. The following changes are authorised by this spec; none authorises weakening unrelated security/recovery checks.

| Existing test/check | Stricter replacement |
| --- | --- |
| scope: `package paths include transitive...` README→package assertion | README selects its direct docs checker/readers; preserve transitive production/test assertions. |
| scope: `root, deleted unknown packages...` root/docs/script/lock full cases | Proven narrow cases plus old/new graph consumer assertions; unknown/deleted-unresolvable inputs still full/fail. |
| scope: `actual work plans preserve all twenty nonempty package shards and five receipts` | Complete measured file allocation and exact receipt closures. |
| scope: `backend work keeps all five receipts and no selected shard can be empty` | Exact receipt closures; empty-group refusal remains. |
| scope: `workspace source reads include...uncertain sibling templates` | Keep true opaque fallback; add exact bounded-template and directory-positive controls. |
| plan: `PR planner uses exact SHAs and NUL paths...` | Name-status/two-tree evidence and consumer union; retain exact-SHA/spaces/rename guarantee. |
| plan: `every direct, multi-commit, unknown and failed-evidence push falls back...` | Replace literal 20 with complete current full inventory; refusal stays. |
| plan: `forced, multiple, direct and non-parent pushes cannot reuse...` | Same complete inventory; eligibility refusals unchanged. |
| CLI: `real squash merges reuse equal trees and run full when main has advanced` | Complete full allocation replaces literal 20; both real-tree assertions stay. |
| summary: `summary accepts skipped work only with concrete reuse evidence and rejects empty plans` | Nonempty validated docs/script work may omit package/type units; truly empty/malformed work still fails. |
| summary: `non-reuse cannot skip types and duplicate planned rows cannot pass` | Only selected types are mandatory; duplicate rows still fail. |
| workflow: `every discovered workspace test package runs through the planned database matrix` | Unified matrix retains every package/file, required fixture and compiler check. |
| workflow: `all existing receipt suites and workflow guards remain available in CI` | All five available; exact selection; relocated CI/upstream/gateway guards retained. |
| workflow: `slow packages run every file shard with their original test deadlines` | Measured groups cover files once; portal build and 30s/120s deadlines stay. |
| workflow: `work jobs stop within eight minutes and planner/summary within two` | Rename work group only; original hard limits stay. |
| workflow: `browser setup is limited to browser packages and bounded across two attempts` | Profile gate permits selected browser units only; retry bounds stay. |
| workflow: `strict summary always runs and receives the plan and every dependency result` | New needs/results still cover every job; always/strict/API checks stay. |
| workflow: `all work gates follow the planner and every checkout tests the exact PR head` | New work gate and all exact-head checkouts remain asserted. |

**Milestone acceptance:** Only this spec, plan and their backlog note change; fresh review and docs-only landing precede implementation. **Implementation acceptance:** All six tasks and actual proof counts/costs pass, full-run budget is evidenced, D67/main green guards remain, production diff contains no proof routing. File-level timing and unverified dynamic/build-site classifications are explicit measurement/resolution gates, never permission to under-select.
