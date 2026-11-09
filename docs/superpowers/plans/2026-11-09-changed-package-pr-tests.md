# D616: Changed-package PR tests

Plan authored from source inspection; parent ran the existing scope/workPlan helper, not tests. Authority: Lane G queue D616, owner 2026-11-09. Parent obtains Claude review and watcher approval before implementation.

Use existing Node/Git selectors, not a replacement. PR package tests select changed owners only; whole-workspace typechecking already covers dependents. Preserve default dependency scopes for receipts and pushes, nightly/manual full work, proof ownership, strict summaries, partitions and authority checks. Dependent behaviour that remains type-correct may fail only at the next nightly.

**Change paths and estimates.** Code, 120–200 lines: `scripts/ci-scope.mjs`, `scripts/ci-plan.mjs`, `scripts/ci-root-inputs.mjs`, `scripts/ci-reuse.mjs`. Tests, 180–260 lines: `scripts/ci-scope.test.mjs`, `scripts/ci-plan.test.mjs`, `scripts/ci-mixed-docs.test.mjs`, `scripts/ci-root-inputs.test.mjs`, `scripts/ci-workspace-snapshot.test.mjs`, `scripts/ci-reuse.test.mjs`. Guides/backlog, 60–100 lines: `docs/ci-package-selection.md`, `docs/ci-package-readers.md`, `docs/ci-documentation-audit.md`, `docs/ci-root-input-ownership.md`, `docs/backlog.md`. Workflow edits: zero; `.github/workflows/ci.yml` already executes exact package filters.

1. **TDD: package owners.** Add failing PR source/test/multiple-package cases in `ci-scope.test.mjs` and `ci-plan.test.mjs`; run `node --test scripts/ci-scope.test.mjs scripts/ci-plan.test.mjs`. Add an opt-in owners-only scope, applied only to PR ranges. Keep `scopeForRevisions` reader unions and refusal evidence for independent receipts; a reader refusal must not expand PR package tests. Leave lockfile ownership/audits intact.
2. **TDD: outside-package inputs.** Add failing cases in `ci-mixed-docs.test.mjs` and `ci-root-inputs.test.mjs`; run `node --test scripts/ci-mixed-docs.test.mjs scripts/ci-root-inputs.test.mjs`. Reuse documentation audit and root ownership: `docs/**` and Markdown never force full package work, alone or mixed. Preserve actual test/receipt owners for consumed inputs. Other inputs retain full fallback only when they can affect tests; workflows, shared configuration, locks, helpers and unresolved readers qualify. Make both files pass without weakening receipt or authority assertions.
3. **TDD: reconstruction.** Add failing cases in `ci-workspace-snapshot.test.mjs` and `ci-reuse.test.mjs`; run `node --test scripts/ci-workspace-snapshot.test.mjs scripts/ci-reuse.test.mjs`. Mark reconstructed source ranges as PRs in reuse; reconstruct pushes with their existing policy. Preserve immutable snapshots, saved shard inventory, missing-evidence refusals and exact-job summaries. Rerun all six focused files green.

Current `scopeForPaths(..., {direct: true})`/`workPlan` probe at `d9bad98be`: package rows below. Documentation row describes the existing planner, not the raw helper. Targets are projections:

| Change | Before packages/jobs | After |
| --- | ---: | ---: |
| identity | 5/23 | 1/1 |
| account-http | 7/28 | 1/3 |
| portal | 1/6 | 1/6 |
| ordinary docs only | 0/0 via planner | 0/0 |

Full allocation is 29 jobs. Re-run scope/workPlan and the complete planner before/after for the PR table; these counts establish selection, not elapsed savings.

Watcher decision: executable/link Markdown, contract/cost Markdown and receipt data have real guards. Prefer bounded owning checks; blanket exemption delays their failures until nightly. Never silently discard those guards. Flag Claude-maintained `CLAUDE.md:136`’s “one level” rule and `:147`’s prose boundary; do not edit it.

Update the named guides; D616 replaces D571’s measurement wait in its existing backlog paragraph only. Finish: one Claude-reviewed, current-head green PR with the measured table, then landing and exact-merge verification.
