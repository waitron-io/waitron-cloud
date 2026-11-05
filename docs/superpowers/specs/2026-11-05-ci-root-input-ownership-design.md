# D571 part 3: reviewed owners for root inputs

You currently get full standard CI for most changes outside a workspace package.
Give a small, reviewed set of those inputs owners, then run their existing checks.
Keep full work whenever you cannot prove that the selected owners are complete.
Land this design and its [plan](../plans/2026-11-05-ci-root-input-ownership.md) as a docs-only milestone before substantial implementation.

## Inspected facts

These observations describe `4018e9cff8a10f4cf02b33e823bd52a5b2bee26b`, not implemented part 3 behavior.

- `ci-plan.mjs:createPlan` tries documentation and exclusive script plans before package selection. Other non-package paths make
  `ci-scope.mjs:scopeForPaths` full. Its PR range is merge-base to event head, with NUL-delimited `--no-renames` paths.
- `ci-scripts.mjs:assertScriptWork` prohibits packages, receipts, compiler work, documentation and reuse alongside scripts. Identity and gateway each
  have a two-target family; gateway also syntax-checks its generator caller. Both immutable audit modes must qualify.
- `ci.yml` gates all four root jobs on `typecheck`, also used by the compiler job. Root runs `scripts/ci-*.test.mjs` plus identity and gateway tests
  with TAP, concurrency 2 and four Node partitions. Neither `ci-run-root.mjs` nor `ci-root-tests.mjs` exists in this tree.
- `workPlan` refuses zero packages. `ci-receipts.mjs` chains five conservative omission audits; Cloud cost is the sixth suite. `ci-run-receipts.mjs`
  accepts only nonempty, unique allowlisted suites, runs fixed `pnpm [suite]` arguments and propagates failures.
- `ci-summary.mjs` independently checks complete package allocations, actual job names and needs results. It requires four root jobs whenever
  `typecheck` is true. It allows unexpected jobs only when completed and skipped; its current-run publication exception still requires final needs
  success and exact run/attempt/head step evidence.
- V2 input records retain frozen v1 evidence, per-path identity, mode and removal provenance. Docs, identity, gateway and lock authority are separate.
  `mixedCodePaths` currently requires all head modes before ignoring accompanying evidence; the proof selector uses its own docs-only evidence rule.
- Read-only probe: `node --input-type=module -e 'import {loadWorkspace,scopeForPaths,workPlan} from "./scripts/ci-scope.mjs"; const w=loadWorkspace();
  console.log(workPlan(scopeForPaths([],w),w));'` reports 29 grouped package jobs, all six receipt suites and `typecheck:true`. This is planner
  output, not a test or timing receipt.

Consumer inspection includes the named modules above, `ci-package-revisions.mjs`, all four receipt-specific selectors, `ci-docs.mjs`,
`ci-proof-inputs.mjs`, `ci-reuse.mjs`, workflow gates, root/package manifests and their caller tests. The October precise-selection documents supply
consumer history only. Their old package counts, universal scheduler and parked `feat/precise-ci-selection` branch are not this design.

## First slice and full boundary

Bound the first slice to these three candidates. Register each only after its review qualifies; an unqualified candidate stays unregistered/full. IDs
identify checks, never commands supplied by a registry.

| Entry ID | Exact changed input | Inspected boundary and intended owners |
| --- | --- | --- |
| `root-partition-contract` | `scripts/ci-root-shards.test.mjs` | Imports `ci-summary.mjs`, reads `ci.yml` at line 9, executes extracted root commands against generated temporary tests. The root wildcard consumes it. Select all four existing root jobs. |
| `capacity-verifier-test` | `scripts/verify-backup-capacity-receipt.test.mjs` | Imports the transfer verifier at line 3 and constructs receipt data in memory. The root manifest's three-file capacity command consumes it. Select whole `test:backup-capacity`. |
| `local-health-test` | `deploy/local-stack/operations-health.test.mjs` | Imports `operations-health.mjs` at line 4 and uses temporary loopback HTTP servers. Root `test:local-stack` discovers it through `deploy/local-stack/*.test.mjs`. Select that whole receipt. |

Keep existing identity/gateway script shortcuts unchanged. This slice adds useful root-only and receipt-only work and their unions with existing
package work. It does not complete global root precision. All other `scripts/`, `deploy/` and `.github/workflows/` paths remain full unless an
existing independently audited mode already handles them. In particular, every workflow edit remains full in this slice because it can change
execution and gates.
This is an ownership-review foundation with three initial examples, not a small three-file mapper. Its review obligation applies to every code PR.

Keep `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.json`, `compose.yaml`, `.dockerignore`, `.gitattributes` at any level,
installation/bootstrap programs, `scripts/test-postgres.mjs`, CI planners/runners/auditors and the new registry/checker shared/full. A root-ownership
registry edit is always full, including activation and removal, even if its head evidence is renewed. It cannot grant its own PR an exemption. Require
its reviewed unchanged definition in both revisions before later narrowing.

`pnpm-lock.yaml` remains full for this new route. Preserve the existing separate lock shortcut and all its refusal controls; part 3 grants no
additional lock exemption. Unknown paths, unexplained metadata, unsupported modes, missing objects and unresolved reads retain full work with a named
reason.

## Review evidence, not inferred ownership

Add `scripts/ci-root-inputs.json` with schema `{version:1, entries:[{id,paths,owners,sites}]}`.
`owners` is `{rootTests:boolean,receipts:string[]}` using only the IDs above and existing receipt allowlist. `sites` lists reviewed
`{reader,site,kind,boundary,role}` records. A site identifies the function/call and line in its pinned reader; kinds are `import`, `file`,
`directory`, `command` or `inventory`. Boundaries name exact paths, directory membership/filter/recursion, or a proved external/generated location.
Roles distinguish execution, syntax-only and metadata validation.

For each entry, review reverse callers as well as its imports. Trace root commands, package commands, imports, literal reads, dynamic reads, directory
enumeration, generated programs and child commands through their reachable callers in both saved trees. Record why a copying/audit reader merely
validates metadata, uses a saved fixture, or actually executes candidate bytes. Do not drop these consumers because an import search found none. An
unexplained reader blocks that entry. Regex searches are review aids, never a claim of complete discovery.

Use separate records under `scripts/ci-root-review.d/`, with canonical filenames derived from each input path. A present record is
`{version:1,path,state:"present",mode,type,objectId,registryObjectId,reviewer,reference}`. There is no shared content hash or file that every PR renews.
Enumerate complete Git inventories and require one matching record for every tracked input, including targets, potential readers, the registry,
checker and all manifests. Exclude only this new record namespace, existing input-audit metadata and regular `100644` Markdown matching
`unreadMarkdown`. The current docs audit must independently qualify those exemptions. Reuse D577's canonical naming, strict parsing, inventory and
historical-retention machinery through separately parameterized helpers; preserve its existing four modes and frozen v1 bytes.

Both revisions independently need complete current records for the same unchanged registry, plus valid docs authority. Each record's provenance
attests review of that input's relationship to every admitted entry, including a reason for no executable consumer. A changed consumed boundary needs
a registry/site-ledger edit and full work; renewing a record cannot authorize an undeclared reader. Object identity proves freshness, not correctness.
Removed inputs need retained absence records with a qualifying ancestor, following D577's removal contract. Missing, stale, malformed, deleted,
duplicate or orphan records refuse narrowing. Removing all metadata cannot restore a historical shortcut.

After explicitly reviewing the named inputs, run `node scripts/ci-root-review.mjs --write-staged --input <path> ... --reviewer <name>
--reference <review-reference>`. Require a nonempty explicit input list; update only those records from the index and never stage outputs or infer
approval. New inputs need review too. Check regular single-link outputs and unlinked parents before writing; repeat generation must be identical.
Stage root records, then renew and stage their owning docs records. Projection works before docs renewal; final admission requires both authorities.

Activate complete records and a required freshness check together in a full-work PR. Every ordinary code PR thereafter must review changed inputs,
renew only their root records and run the root-review check independently in mandatory summary, including full plans and legacy shortcuts. Root shard 1
and script execution may check earlier too. A stale head fails CI; running full cannot excuse it. Only narrowing additionally needs a qualifying base.
This keeps the next merge base current
without a shared-file rewrite. Docs-only PRs change no projected input. A PR from before activation stays full; bootstrap cannot grant its own shortcut.
Two unrelated changed inputs renew different records and docs records. Test a real two-branch merge, both orders and merged freshness. A registry edit
intentionally requires full review/renewal because it changes the reviewed ownership contract. Unused identity/gateway/lock peers remain unused.
Activation is historical authority, not a test for files present at head. Once a reachable ancestor activated root review, deleting its registry or
all records cannot disable mandatory summary freshness. Bootstrap is permitted only before any reachable activation; missing/shallow history refuses
the check. Prove complete metadata deletion still fails a full plan.
Existing exclusive script validators keep their full-diff and peer-audit checks. Accompanying root-record updates may conservatively force full work
when those exact legacy rules do not admit the new metadata; no preservation of their post-activation job saving is claimed. Do not weaken their
checks merely to recover a shortcut. Include these cases in the activation measurements and watcher report.

## Immutable selection and execution

Read complete trees and blobs through Git, using `readGitBlobs`. Require full commit SHAs and merge-base ancestry; never import or execute saved
JavaScript. `--no-renames` represents a rename as deletion plus addition, preserving both names. Compare mode/type/object ID and union old/new owners
for modifications, deletions, additions, renames and executable-bit changes. Require regular `100644` targets in both trees for this first slice. A
missing or moved target, changed mode, new unregistered file or removed required entrypoint takes full work, never an empty file list.

Do not execute an old-tree deleted test to claim head coverage. Full head work uses the existing nonempty root/receipt inventories; if a required head
command/test is missing, execution fails. Retiring an entry requires a separately reviewed shared/full registry change. Directory readers must include
additions and removals, not just existing matching blobs.

Keep `createPlan(event,context,workspace,git,api)` and existing package/receipt runners. Add:

- `rootInputPlan(paths,base,head,git)` in `ci-root-inputs.mjs`, returning `null` when neither a registered input nor root-review renewal is present,
  `{full:true,reason}` on refusal, or `{rootInputs,rootTests,receipts,packagePaths}`. `rootInputs` is `{version:1,base,head,paths,entryIds}` with
  complete changed paths and sorted unique entry IDs. Evidence plus real package paths may use this route with no entry IDs; evidence alone remains
  full.
- `packageWorkForPaths(paths,workspace,base,head,git)` in `ci-plan.mjs`, a behavior-preserving extraction of current package/revision/receipt
  selection, used only for nonempty package paths. Preserve package revision refusal and independent receipt audits. Do not implement K's new
  direct-selection policy.
- `assertRootInputWork(plan,{base,head,git})`, independently recomputing the root selection from the trusted event range. It does not accept
  plan-supplied paths/IDs as authority. Missing/altered markers cannot hide required root or receipt owners. A conservative full plan is accepted only
  with the full independent contract.

Recognize package paths from both immutable workspace/manifest inventories, not a directory-prefix guess or current `pnpm ls`. Unknown membership or
changed test commands retain full work.

New root plans retain `{packages,receipts,typecheck,reuse:null,reason}` and add `rootInputs` and boolean `rootTests`, the union of registry root
ownership and package work's `typecheck`. They have no `scripts` or `documentation` field. For legacy plans, root execution remains exactly
`typecheck`; only a validated root plan can separate the two. Add the `root_tests` output and gate existing root jobs on it; leave compiler gating on
`typecheck`. Full, package, docs, lock and exclusive-script plans keep their current meanings.

| New plan | Package/compiler/root/receipt behavior |
| --- | --- |
| Script-only contract edit | Zero packages, compiler false, `rootTests:true`, four complete root jobs, zero receipts |
| Receipt-only | Zero packages, compiler/root false, one or more whole allowlisted receipts |
| Package plus registered root input | Existing package plan, compiler and four root jobs, union its audited receipts with mandatory root-owned receipts |
| Several registered inputs | Union all owners once; require at least one executed check |

Do not call `workPlan` with an empty package scope. Do not run receipt omission audits after adding mandatory root receipts: they cannot remove an
owner selected by the registry. Package revision uncertainty retains the existing full package fallback; unresolved root ownership retains full
standard work.

Ignore accompanying root-review records and docs records only after both docs audits and both complete root reviews verify, with unchanged frozen
policy/descriptor and valid retained metadata. Only these two record namespaces may accompany this route; changed peer records or other metadata take full work.
Audited regular prose may accompany real root/package work without widening it. Evidence/prose alone cannot produce empty success. Leave legacy mixed
selection and cost/venue evidence rules unchanged.

Execution uses the existing four root argv sequences and fixed receipt suite IDs. Never accept shell strings, provider commands, deployment commands
or proof generators from JSON. Validate the exact head checkout and clean tracked tree before root-owned execution and summary, including receipt-only
work. Expand and verify nonempty complete root file inventories before `node --test`; never invoke a bare runner or pass an empty expansion. Retain
root TAP/concurrency/partition semantics, package builds and deadlines, fixture ownership, browser retry bounds, receipt commands and every behavioral
assertion.

## Independent summary and integration contract

Extend `assertSummary(plan,results,jobs,options={})` and `waitForSummary` with trusted root-range/Git verification. The CLI reads the original event
and fetches full history at the exact head. Recompute expected root owners even if `rootInputs` or `rootTests` was removed. Reject empty work,
malformed fields, conflicting legacy modes and omitted owners. Preserve existing independent package names/counts/group validation; this slice does
not claim to prove affected-package completeness beyond the landed package selector.

Require `changes`, each selected root shard, compiler, package row, `receipts`, exclusive `scripts` or `documentation`, and final summary as
applicable. Every selected identity occurs exactly once and succeeds. Missing, duplicated, failed, cancelled, unfinished or skipped required jobs
fail. Reject unknown names even if skipped; accept known unselected identities only as skipped, with no duplicate skipped placeholders. Qualify exact
skipped-matrix placeholder names against hosted candidate records before allowing them; an unfamiliar name refuses. Validate all needs
booleans/results against independently required work. Keep pagination, `standard / ` prefix validation, the 60-second publication bound and its exact
identity checks. Allow at most one live summary self-record, never as evidence of its own success. Its final success remains a landing requirement.

Audit the complete field contract: `packages` rows (`package,shard,shards,members`), `receipts`, `typecheck`, `scripts.{base,head,paths}`,
`documentation.{base,head,paths}`, `reuse`, `reason`, new `rootInputs`/`rootTests`, every output boolean, `package_matrix`, job names and
`CI_RESULTS`. Reasons remain bounded diagnostics, never authority. Placeholder matrices cannot execute.

I's part 5 reconstruction must preserve and compare the new selection fields and root gate, use the currently reviewed code on historical data and
refuse unsupported evidence. Reuse remains exclusive and suppresses root work too. K's part 2b must preserve package rows, complete allocations,
receipt independence and this root-owner union. Integrate and rerun both neighbors' controls against whichever is actually landed on main; neither
documents alone nor an old branch grants behavior. If I lands first, preserve its qualified main behavior rather than restoring this base's full-main
policy. Do not implement part 2b, part 5 or #938 here. H handles part 3, then #938 separately.

Preserve part 4 (`d05ccc9b`) selection of real proof inputs and part 6 (`7393f4ce`) nightly full calls. New root records otherwise look like arbitrary
scripts to both proof selectors. Add one bounded metadata rule to `ci-proof-inputs.mjs`: ignore only canonical root-review records after both saved
root inventories and documentation authorities independently qualify against the unchanged reviewed registry. A registry/checker edit, missing base
activation, stale/forged/removed record, unexplained reader, nonregular entry or unknown path retains full proofs. Evaluate every nonmetadata changed
path under the existing cost/venue rules. A real proof input mixed with valid record renewal still selects its proof. This prevents routine record
renewal from adding proof matrices to unrelated package PRs without exempting any proof program or fixture. Do not change main-push policy, separate proof triggers
or their existing real-input rules. Forced full/nightly bypass every shortcut and execute all packages, compiler, four root partitions, six receipts
and the separate complete proof matrices.

## Hand-checked examples and qualification limits

These are source-inspected examples and intended results after reviewed bootstrap, not executed acceptance receipts.
The table lists standard CI only. Without the bounded metadata rule, renewing `scripts/ci-root-review.d/**` selects both separate proof matrices,
including for an ordinary portal change. Reproduce that regression before implementing the rule. Then prove valid renewal preserves each original
proof decision, invalid renewal retains proof work, and a real proof input still selects its matrix. Include all workflows in before/after counts;
three smaller standard plans alone cannot establish an overall saving. Bootstrap and checker/registry edits still select complete proofs.

| Change | Concrete intended checks | Fallback control |
| --- | --- | --- |
| `scripts/ci-root-shards.test.mjs` | Four `root (N/4)` jobs with the complete existing root inventory; no compiler/packages/receipts | Its workflow read and synthetic child runner must be recorded; stale review or omitted partition refuses |
| `scripts/verify-backup-capacity-receipt.test.mjs` | `receipts` runs `pnpm test:backup-capacity`, including fixture, transfer and capacity tests | Follow its transfer-verifier import and saved receipt-fixture consumers; unexplained live caller takes full |
| `deploy/local-stack/operations-health.test.mjs` | `receipts` runs the unchanged entire `pnpm test:local-stack` command | Its health-module import and wildcard directory owner are explicit; unregistered sibling additions take full |
| `apps/portal/src/app.ts` plus that health test | Existing portal/package-revision selection, compiler and four root jobs, plus `test:local-stack` regardless of omission audits | Current unresolved package readers may retain all package jobs; no one-package promise |
| `.github/workflows/ci.yml`, `scripts/test-postgres.mjs` or `pnpm-lock.yaml` plus a registered test | Full standard work; lock mixed with that test cannot use the existing lock-only shortcut | Shared input wins over every narrow owner |

Reverse-call searches and inspection cannot certify these entries on a future tree. Implementation must finish each site's review before activating
it; a refused entry stays explicitly full. No tests, timing measurements or runtime changes are claimed by this milestone.

Measure job counts before and after with the same saved base/head scenarios and planner entry point. Record implementation SHA, event range, review
currency, exact plan, selected package rows/root shards/receipts and expected job names, including changes/summary; distinguish receipt suites from
their single hosted job. First compare with current fallback, then a reviewed post-bootstrap base. Capture actual exact-head Actions jobs and test
counts separately. Publish refusals as well as narrow cases. Claim no time or cost saving without measured hosted receipts.
