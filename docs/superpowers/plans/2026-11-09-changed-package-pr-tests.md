# D616: Changed-package PR tests

Owner authority, quoted from Lane G queue, watcher 2026-11-09 08:22: owner “yes, same rule”; “if code in package X changes then run the tests for package X ... and then catch anything else in the nightlies.” Claude's 406-second source review found the changes below. Watcher BUILD approval and the policy choices below remain pending.

Use existing selectors: PR tests select changed packages, while whole-workspace typechecking covers dependents. Key this on `range.kind === 'pr'`; preserve default push selection, full nightly/manual runs, receipt audits, partitions and summaries. A dependent behaviour break that remains type-correct waits for nightly. No workflow edits or new evidence format.

**Files/size.** Code 50–100 lines: `scripts/ci-{scope,plan,root-inputs,reuse}.mjs`. Tests 220–320 lines: `scripts/ci-{scope,plan,mixed-docs,root-inputs,workspace-snapshot,reuse,package-direct-selection,local-stack-receipt,docs,gateway-scripts}.test.mjs`, plus the existing 34-file `scripts/ci-package-revisions{,-*}.test.mjs` family for fixture routing only. Guides/backlog 60–100 lines: `docs/ci-{package-selection,package-readers,documentation-audit,root-input-ownership}.md`, `docs/backlog.md`. Ask the watcher to authorize the stale `CLAUDE.md` CI paragraph correction; otherwise Claude updates it. No generated files.

1. **TDD package policy/reconstruction.** In the named scope/plan/direct-selection/snapshot/reuse tests, first fail PR source/test/multiple-owner cases and source reconstruction; then add owners-only scope and pass PR kind through reuse. Default/no-kind ranges retain current behaviour. Preserve reader/refusal assertions under that retained policy through a narrow fixture-helper switch; watcher must approve moving those existing PR fixtures. Add PR cases proving owners-only tests, full dependent typechecking and unchanged receipt refusals. Set refused receipt scope to all packages directly, never copy narrowed PR scope. Preserve refusal diagnostics and lockfile audits.
2. **TDD documentation routing, after watcher decision.** Use existing root/document owners and summaries, retaining saved-file and authority checks. Proposed bounded owners:

| Changed input | Required work |
| --- | --- |
| Ordinary root/docs Markdown | Existing documentation check |
| Integration contract | translation |
| Cost model and cost-model data | cloud-cost receipt |
| Cost calculator | cloud-cost receipt and ui-smoke |
| Known gateway receipt | Existing root checks |

Confirm actual execution owners before exempting other receipts/evaluations. Recommend keeping unknown non-Markdown, executable/symlink Markdown and checkout attributes full; interpret `*.md` as root/docs prose, with package README selecting its package. These are explicit exceptions to the literal docs rule, requiring watcher approval. No new zero-work route.
3. **Verify and finish.** Run explicit changed test files, preserving assertions; CI owns full suites. Re-run existing scope/workPlan and complete-planner before/after probes for identity, account-http, portal, ordinary docs and consumed-doc rows. Current raw direct counts are 5/23, 7/28 and 1/6 packages/jobs; projected owner counts 1/1, 1/3 and 1/6. Counts are not elapsed savings. Update the guides and replace “Aggregate usage savings remain open” in the backlog CI-runtime paragraph with D616's superseding decision. One Claude run-it review, one ready push/PR, green current-head checks, landing and exact-merge verification.
