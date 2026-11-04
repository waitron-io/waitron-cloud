# D571 part 2: Package reader boundaries implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` inline, without delegation. Read the TDD skill before writing implementation or tests. Scope is approved; do not request approval.

**Goal:** Remove only false package dependencies and false source-discovery refusals, retaining every genuine consumer and conservative fallback.
**Architecture:** Keep the current manifest/source graph and union of independently checked immutable base/head trees. Add exact reviewed reader declarations that exempt only proven non-source directory operations, while retaining quoted dependencies and helper traversal.
**Tech stack:** Node ESM, Git tree/blob evidence, existing Node behavioral tests; no parser dependency.
**Spec:** This document and `docs/backlog.md`'s CI execution budget section; runner's D571 part-2 instructions supply approval and earlier diagnostic receipts.

## Constraints and decisions

- Use the registered part-2 feature worktree. Confine review commands and all temporary mutations to their disposable candidate.
- Start stacked on PR #936 now and land in order. Root owners, proof/receipt selection, reuse and nightly full runs belong to parts 3–6. Do not touch the parked precise-selection branch.
- Preserve all original assertions, receipt requirements, test discovery, package commands, shard counts and deadlines. No production guard may be disabled. D571's root-script PR itself still requires full CI. Reader-qualified narrower packages must retain all six independent receipts until separate omission evidence is approved.
- Preserve the driver's uncommitted six-test file and implementation as the starting point. Runner observed six reds, then five passes with the exact installed-helper pin; the real immutable portal test remains red. These are supplied receipts, not a new test run by this plan author.
- Choose exact path/mode/type/blob declarations over a new parser: this bounds today's reviewed readers without claiming general JavaScript analysis. A parser would also need bindings, generated programs and computed filesystem paths; importing a parser alone proves none of those.
- Keep both passes of `quotedReferences`; replacing them with import regexes would lose generated-program dependencies. Never exempt an entire module or treat every directory operation as harmless.
- Match declarations against each immutable tree's entry, never live file bytes or just head. Missing/altered/renamed/unrecognised readers and unsupported modes retain the existing full-package fallback. Do not auto-renew pins.
- Retain `scopeForRevisions(paths, workspace, base, head, git)` and `createPlan` interfaces. Check both snapshots even if the first fails, preserve the first refusal, and union old/new consumers with the live graph.

## Measured baseline and remaining scope

Read-only measurements on 2026-11-04 at `4ee15a61828cc3e6844bb9cdb11fd1339de2cc12` used `loadWorkspace`, `scopeForPaths([directory+'/src/change.ts'])`, `workPlan`, and `scopeForRevisions` with `readGitBlobs`, base=head=that SHA.
With the driver's uncommitted exact-copier declaration, every immutable call below refused at `packages/remote-access/src/gateway-cli.ts`; the unchanged baseline first refuses the copier. `createPlan`'s catch retains all packages, whose allocation is 28 groups. The live ownership probe measures selection, not an executed package test or an actual changed file.
Reproduce the measurement with the candidate's installed local workspace; this performs no install:

```sh
cd /Users/clintongormley/workspace/worktrees/cloud-fix-ci-package-reader-boundaries && pwd && node --input-type=module <<'NODE'
import {execFileSync} from 'node:child_process'; import {loadWorkspace,scopeForPaths,workPlan} from './scripts/ci-scope.mjs'; import {scopeForRevisions,readGitBlobs} from './scripts/ci-package-revisions.mjs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024}); git.readBlobs=readGitBlobs; const sha=git('rev-parse','HEAD').trim(), w=loadWorkspace(); console.log({base:sha,head:sha});
for(const p of w){const paths=[p.directory+'/src/change.ts'], live=scopeForPaths(paths,w); let saved; try{const s=scopeForRevisions(paths,w,sha,sha,git);saved={...s,groups:workPlan(s,w).packages.length};}catch(e){saved={refusal:e.message.split('\n')[0]};} console.log({package:p.name,live,groups:workPlan(live,w).packages.length,saved});}
NODE
```

| Changed package | Live selected packages | Live package groups | Immutable baseline |
| --- | ---: | ---: | --- |
| portal | 1 | 6 | refuses |
| account-http | 8 | 28 | refuses |
| backups | 8 | 28 | refuses |
| identity | 9 | 28 | refuses |
| operations | 8 | 28 | refuses |
| registration | 8 | 28 | refuses |
| remote-access | 8 | 28 | refuses |
| translation | 8 | 28 | refuses |
| ui-smoke | 1 | 1 | refuses |

Runner's individual import/fixture traces establish the account-http/backups/registration/operations/remote-access/translation cycle; identity changes additionally select identity, and portal/ui-smoke are consumer leaves. Preserve those real 28-group closures. Portal's six groups are a hypothesis to verify; report any remaining refusal or real additional consumer rather than forcing that number. Keep the new six-job assertion unchanged until its premise is established; if a real edge contradicts it, record the unresolved assertion for the owner. UI smoke's immutable result still needs proof.

## Reader evidence to review before admission

This is the direct-call inventory from saved source, plus the reached installed copier; it is a review queue, not an automatic allowlist or a complete indirect-reader detector. The runner's diagnostic copy masked only `admittedCalls` to reveal further readers; do not carry that diagnostic change into production.
All rows are `100644 blob`; the listed blob is identical for the measured base and head (both the SHA above). At execution, record actual merge-base and candidate SHAs and obtain each row independently with `git ls-tree` in both trees. A different blob needs new review, not substitution of these historical values.
Paths below are relative to the repository root. Review each entire source, generated program and actual directory argument; keep any real source-discovery operation modeled or unresolved.

| Reader path | Base/head baseline blob |
| --- | --- |
| scripts/ci-audit-fixture-dependencies.mjs | a83c121fc1c7b6f13ea4773a708d28dc0ee578e4 |
| packages/backups/src/waitron-data-verify-child.mjs | 60bed2d33942b37bf41e72d8b30c45368cef13cb |
| packages/backups/test/bound-fixture-failure.test.ts | 143fd206c6beccd3abc6c561b9fee8c68601c81b |
| packages/backups/test/bound-waitron-verifier.test.ts | 43cc683d6fce1ac01a06feff4c127ecdc8b583d2 |
| packages/backups/test/claim-pipeline.test.ts | c111aa8fb6dcfece993b0bf5cbcbf64cba6c963b |
| packages/backups/test/container-resource-diagnostics.test.ts | 273ff46531eb8d78e10122b92929dc530b74fd36 |
| packages/backups/test/object-transfer.test.ts | 88eadc6c02919df90635f7cd175d51bcaaba5039 |
| packages/backups/test/waitron-verifier.test.ts | 98f96f41e5210ef80bdb5d8b73ef78c8676bcb24 |
| packages/remote-access/src/gateway-cli.ts | 2a4ddb56defa5b491e188e511b3093da1d76e835 |
| packages/remote-access/src/gateway-traffic-runtime.ts | 698be5aad916c32ab5b1d6d7fbb6c734fb52ad07 |
| packages/remote-access/src/traffic-collector.ts | 9842ef9c0a02c6cc7bced63c37146ea93055e1af |
| packages/remote-access/src/traffic-spool.ts | 8c4dd9f6f5123a92d2316e7fea0f6cc2ca341c38 |
| packages/remote-access/test/fixtures/traffic-collector-race.ts | 9d288142752003d9d243e5e750f50326195dfa35 |
| packages/remote-access/test/forward-report-writer.test.ts | 114b5dfa5c7b0df1531c4e61f663707affd3483f |
| packages/remote-access/test/gateway-forward-reports.test.ts | 576b40ff0f6d1c17d909fd3b51f7c5ff397e687a |
| packages/remote-access/test/gateway-traffic-command.test.ts | 7d6df289eab4daa4a7356b9a6a704bc4ba75cd9f |
| packages/remote-access/test/gateway-traffic-finish.test.ts | 22972a324144c222376638e48d311cd5380c1220 |
| packages/remote-access/test/gateway-traffic-runtime.test.ts | 5cddb975c77f4eaf56e76467e0583509560bb235 |
| packages/remote-access/test/traffic-child-finish.test.ts | 72a4d2f3b4438b90dc102c42d5aabf0c6690664b |
| packages/remote-access/test/traffic-child-process.test.ts | 7f51f38112a50115af529ff46370908cd6883784 |
| packages/remote-access/test/traffic-collector-store.test.ts | d44b28a6abb30a7c4b8b41209fadaf67f94182dc |
| packages/remote-access/test/traffic-collector.test.ts | 90b7de47c8983d3190711724987bd6ea4a9890a8 |
| packages/remote-access/test/traffic-delivery-identity.test.ts | b3d8484f025e59d78d4a1c0d6115bba7cee26a3a |
| packages/remote-access/test/traffic-exporter-store.test.ts | e8cc39c0945c690bfa85ea08a08e20a70b88203d |
| packages/remote-access/test/traffic-exporter.test.ts | 7e30c7f4d2c04722059d8c6c75a75ed8dfdfd2c1 |
| packages/remote-access/test/traffic-spool.test.ts | 46e7a2ad96e508ad6561df11325470cbe4354a55 |
| packages/translation/quality/offline-boundaries.test.ts | 1e0d3f4133670c97c4b80ff3c2c1af63faac5a32 |
| packages/translation/quality/scorer.test.ts | 3c2156b63a2038905678540cadf4f8e0c8428a74 |
| packages/translation/quality/scorer.ts | 678d6168d3203b0784eda6feda9fd381356b8ff7 |
| packages/translation/quality/trial.test.ts | 1a144f13ccda0e290b98b35478e9852bd0b9abfb |
| packages/translation/test/local-stack-runtime.test.ts | 864ff0019b0837f7484a170985cae885b4fa3344 |

Review anchors: gateway-cli:46 scans `/input/public-certs`; traffic-collector:35 and traffic-spool:227 scan runtime report mappings; gateway-traffic-runtime:43 scans its private journal root. Backups' child:21 counts compiled `dist/drizzle` journals, while its tests scan owned scratch, including bound-fixture-failure:43. Translation's offline-boundaries:10 hashes archived `quality/original` and `quality/data`, scorer:16 reads grade JSON, trial tests scan generated results, and local-stack-runtime:47 embeds `/proc` discovery. Archive bytes and compiled assets remain genuine inputs, even though these operations do not discover Cloud source imports.

Also review exact versions of `scripts/billing-display-guard-probes.test.mjs` (`./`), `deploy/test-cloud/storage-authority.mjs` (`.`/`..`) and `scripts/allowance-traffic-guard-probes.mjs` (`.`): diagnostic-only traversal expands their quoted directory values into unrelated scripts/deployment sources. This second frontier is not covered by the direct-call table.

## Review focus

1. A valid declaration must not hide a quoted sibling import, generated program or root-helper chain; task 1 proves each executes and selects its consumer.
2. A fresh head cannot excuse stale base evidence, and dirty live bytes cannot replace either tree; task 1 checks asymmetric and dirty cases.
3. Reader aliases, indirect calls and newly reached helpers can escape the direct-call inventory; task 2 retains every existing unresolved-reader guard.
4. Installed workspace links must resolve candidate code, and scratch/certificate behavior must remain unchanged; task 3 retains real helper and guarded behavior checks.
5. A policy renewal or rebase can invalidate evidence despite passing selector tests; task 4 renews after reader review and qualifies exact head/merge CI.

### Task 1: Pin the failure boundaries first

**Files:** Read existing `scripts/ci-installed-reader.test.mjs`; add `scripts/ci-package-reader-boundaries.test.mjs`. Do not weaken or replace original tests.
- [ ] Run `node --test scripts/ci-installed-reader.test.mjs`; require all six names to execute and retain the expected portal refusal receipt before implementation.
- [ ] Add failing `reviewed readers retain quoted imports and helper chains`: seed an exact synthetic declaration in a disposable scanner copy, containing a runtime scan plus quoted sibling and root-helper references, nested generated code and a helper cycle. Execute its real consumer, mutate the dependency, require the consumer selected, and exclude an unrelated package. Production has no override switch.
- [ ] Add failing `reader evidence is independent in base and head`: separately alter blob, remove declaration, rename reader, change to executable/symlink/submodule, and use missing evidence in each tree. Require low-level refusal and real planner full-package fallback; prove both snapshot reads occur even when the first refuses.
- [ ] Add failing `dirty worktree cannot replace saved readers`: retain a real reader only in base, then only in head, overwrite its live file/helper to inert content, mutate its source input and require the executed real consumer selected or conservative full fallback.
- [ ] Add failing controls for each of the three directory-expansion cases above. A declaration may exclude only reviewed directory values; a real helper in the same directory must still execute and select its consumer. Changed evidence in either revision must refuse narrowing.
- [ ] Run the two named files; each new test must fail on its intended missing guarantee, not setup. Preserve the supplied six-test assertions and deadlines.

### Task 2: Admit reviewed operations without dropping dependencies

**Files:** Create `scripts/ci-package-readers.mjs`; modify `scripts/ci-package-revisions.mjs`. Leave `scripts/ci-scope.mjs` and helper/test source behavior intact unless a separately reproduced false edge requires a focused fix.
**Interface:** Export `reviewedDirectoryReaders`, a path-keyed record of exact `{mode,type,id}` plus explicit non-source directory-reference exclusions, computed source references and review rationale; `workspaceAt` alone consumes it against saved entries.
- [ ] Review every row above and every additional refusal/helper reached during the real immutable run. Record source paths, actual runtime/data directories, source-directory evidence and both snapshot blobs; admit only proven cases. Unknown scans stay full, with their actual path reported.
- [ ] Replace the installed helper's early `continue` with a checked directory-operation exemption. Keep glob guards, `sourceDependencies`, broad quoted references and normal helper-chain traversal. Explicit computed references must feed both helper traversal and package edges. For this exact copier only, exclude directory expansion of its literal `packages`, `apps` and `node_modules` roots, because it copies installed graphs rather than tracked source; retain literal file/helper references and all package dependency edges.
- [ ] Apply the same bounded rule to other reviewed directory operations; do not use a module-wide skip. Preserve package-owned data/asset selection, including translation archive inventory and compiled migration readers. Actual source scans still traverse their real directories or refuse narrowing.
- [ ] Run `node --test scripts/ci-installed-reader.test.mjs scripts/ci-package-reader-boundaries.test.mjs scripts/ci-package-revisions.test.mjs scripts/ci-package-revisions-directories.test.mjs scripts/ci-package-revisions-unresolved.test.mjs scripts/ci-package-revisions-computed.test.mjs scripts/ci-package-revisions-indirect.test.mjs`; require zero failures and six original installed-reader passes, including portal=6.
- [ ] In disposable copies only, remove a declaration, omit each snapshot pin check, skip helper traversal, and suppress an unknown-reader guard separately. Require the corresponding positive/refusal/consumer test to fail, then restore and rerun green. Retain every existing adversarial scanner test in CI.

### Task 3: Prove behavior and report the actual graph

**Files:** Add controls to the new test file; record measurements and review limits in this plan and `docs/backlog.md` during execution, without changing historical receipts.
- [ ] Before any further fix, add/run a failing control for each newly found false edge. Trace every direct source/manifest edge to `file:line`, including integration fixtures and generated code; remove only a reproduced false dependency, retaining the six-package cycle and identity consumers.
- [ ] Verify the measured hypotheses portal=6 and backend groups=28, preserving real additional consumers if found. Repeat all nine live and immutable measurements against the actual candidate, printing package names, groups, fallback reasons, base/head SHAs and declaration versions. Also exercise real PR-shaped package-only and portal-plus-audited-prose changes; distinguish probes from actual PR CI and claim no runtime savings without CI timings.
- [ ] Run `node --test scripts/ci-audit-fixture-dependencies.test.mjs scripts/ci-scope.test.mjs scripts/ci-plan.test.mjs scripts/ci-package-allocation.test.mjs`. Retain candidate-link resolution and empty-store translation mismatch/restoration checks; never alter the copier to satisfy the scanner.
- [ ] Add controlled reader behavior checks to the new file where an exemption lacks one: synthetic PEM refresh, bounded runtime JSON/journal discovery, scratch cleanup and compiled-journal presence/refusal. Exercise actual guarded entry points with owned fixtures and no provider calls; retain production checks. Existing package CI owns database/container-dependent behavior and every original package test.
- [ ] For each added behavior control, observe its targeted guard omission fail in a disposable copy, restore the guard, then run `node --test scripts/ci-package-reader-boundaries.test.mjs` green; also rerun this file after the final graph measurements.

### Task 4: Review, renew and land serially

- [ ] Review changed readers before renewing all four `scripts/ci-input-audit.json` inventories using `docs/ci-documentation-audit.md` and `docs/ci-lockfile-audit.md`; stage the complete reviewed candidate, run `node scripts/ci-input-audit.mjs --write-staged` twice with inspected/staged policy between, require stable bytes, commit with `-s`, then run `node scripts/ci-input-audit.mjs --check <exact-head-sha>`. Keep independent receipt pins/historical fixtures unchanged unless separately reviewed evidence requires renewal.
- [ ] Announce readiness for `finish-branch`; runner performs the initial rebase and one Claude whole-branch run-it review via `claude-seat.sh review-run` in a disposable complete candidate checkout with installed dependencies. Triage/fix findings in the feature checkout, rerun focused controls, and renew inventories after changed readers. Do not rerun the whole review solely for a later rebase.
- [ ] Keep the PR based on #936's branch until #936 lands. Then move this stack onto the actual new main (handle squash/rebase ancestry explicitly so #936 is not replayed), retarget to main, inspect the resulting diff, recheck saved base/head evidence, rerun focused checks and renew merged-tree audits where needed.
- [ ] Push through normal hooks; require every selected actual job on the current PR head green, including package coverage and independent receipts. No blanket workload reductions and no mandatory local root-suite run. Before serialized landing, qualify the prospective merged tree against latest main and land only after #936. Then verify every actual merge-CI job; a missing, unfinished or failed run stays explicitly open. A moved base requires a new candidate check; prior head results are insufficient.

**Plan review:** A fresh review required hypotheses instead of forced graph sizes, explicit directory-expansion controls and preservation of a real helper in an excluded directory. Those corrections are included. The final bounded declaration table contains 40 versions, including later directory-value cases beyond the direct-call review queue above.

**Open limits:** The inventory does not establish complete reader discovery; exact declarations are reviewed evidence, not a parser guarantee. More indirect scans or real helper consumers may keep full work. Backend coupling, parts 3–6, runtime cost targets and any unqualified fixture behavior remain open and must be reported honestly.
