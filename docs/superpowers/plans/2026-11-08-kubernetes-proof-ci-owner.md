# D614: Give Kubernetes proof changes their CI owner

Driver-provided authority: watcher, Lane G queue/questions, 2026-11-08 16:45, assigns D614 after D613 A opens. A is PR #1105, `fb572dde82422f3059aecff2382eb1bf3725efa6`, still in CI. Base: `1d314875ea6681bfa03fbca593d984733e0740b2`. Owner: “only if it speeds up our CI or reduces the number of CI jobs that we have to run”; “i just want it all to arrive yesterday”. Watcher reported seven runs/~110 runner-minutes each; not remeasured.

Build allowlist:

- Code: `scripts/ci-plan.mjs`, `scripts/ci-scripts.mjs`, `scripts/ci-proof-inputs.mjs`.
- Workflow: `.github/workflows/kubernetes-proof.yml`.
- Tests: `scripts/ci-plan.test.mjs`, `scripts/ci-scripts.test.mjs`, `scripts/ci-summary.test.mjs`, `scripts/ci-evidence.test.mjs`, `scripts/ci-proof-inputs.test.mjs`, `deploy/kubernetes/proof/workflow.test.mjs`.
- Docs: this plan, `docs/ci-root-input-ownership.md`, `docs/ci-proof-selection.md`, `docs/backlog.md` (D614 paragraph only).

Reuse script mode for `deploy/kubernetes/proof/**`, `scripts/kubernetes-proof-*` and their workflow. Verify both trusted revisions, complete paths, regular files and workflow coverage; run proof-module syntax checks and the existing `deploy/kubernetes/proof/workflow.test.mjs` in the script job, leaving heavy setup/controller checks in Kubernetes. Verified proof-plus-package changes pass remaining package paths through existing selection; ordinary docs may accompany either. Preserve package-only ownership, unknown/.env.example fallback and empty-work refusals. Trace planner→script/root validation→summary/evidence consumers (`ci-scope.mjs:110`, `ci-evidence.mjs:68`). Exempt this family from venue/cost selection, retaining historical cost handling.

TDD controls cover those combinations, forged/dirty/missing evidence, deletion/rename and missing workflow coverage. Run `node --test scripts/ci-{plan,scripts,summary,evidence,proof-inputs}.test.mjs deploy/kubernetes/proof/workflow.test.mjs`.

Finish: current-head jobs confirm narrow selection and independent Kubernetes success; standard summary cannot certify that workflow. AWS/independent planner overhead remains; D613 A is independent. No new jobs/frameworks, disposable-folder changes or tax/security/tenant/key/recovery-assertion changes. Estimate code +140/−20, tests +240/−0, docs +55/−10 lines. Source inspection only. Driver commits, obtains one Claude plan read, then watcher approval before build. Budget: 45 minutes to PR, excluding approval waits.
