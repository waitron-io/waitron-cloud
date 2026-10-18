# Coordinated CI reader audits

You cannot keep the documentation, script and lockfile shortcuts current by renewing their certificates in turn: each certificate is an input to its peers. Replace those three files with one strict, manually reviewed policy. This is one bounded D69 follow-up to [precise CI selection](2026-10-14-precise-ci-selection.md), not the broader resolver or scheduling project.

## Present evidence and scope

The starting tree is `e1f28ae67d861d4037cd12a005dfe84298b18cba`. Direct calls to `auditDocumentation`, `scriptPlan` for both families, and `lockPackageScope` on that revision confirmed documentation current and scripts/lock stale. In an independent local clone, renewing scripts made documentation stale; renewing documentation then made scripts stale again. Both control commits used `git commit -s`, and the clone was removed. These are executed currency/renewal controls, not changed-path or runtime-product proofs. `node --test scripts/ci-docs.test.mjs` passed all ten tests. No provider or production review seat is needed for this documentation milestone.

You change only certificate storage, strict reading, explicit renewal tooling, fixtures and the associated instructions/diagnostic. Keep runtime product behavior, providers, migrations, fiscal rules, ownership/privacy/security assertions, deadlines, workflow triggers, daily schedules, grouping and cost targets unchanged. Keep every existing behavioral guard and conservative fallback. Native inline implementation after this documentation milestone lands is already authorised; no further design approval is required.

## Consumer trace

The inspected trace uses `rg -n` for certificate paths, reader exports, imports, file reads and child commands across `scripts`, `.github`, `package.json` and `docs`. These are source-inspection findings; the plan supplies execution proofs.

| Input or boundary | Direct and indirect consumers you must preserve |
| --- | --- |
| Three audit JSON files | `ci-docs.mjs`, `ci-scripts.mjs`, `ci-lock-selection.mjs`; their fixture builders and policy fault injections; `ci-dependency-fixtures.test.mjs` also reads the lock manifest digest map. Each production inventory currently fingerprints its peers. |
| Documentation reader | `ci-plan.mjs` admission and unconditional committed-checkout warning; `ci-docs.mjs` executed checker; `ci-summary.mjs` imports `assertDocumentation`; docs/CLI/workflow tests and both audit guides/backlog describe the contract. |
| Script reader | Planner admission, executed `ci-scripts.mjs`, summary's `assertScriptWork`, identity/gateway fixture and child-command tests. Identity spawns its own test; gateway tests read published evidence, and the runner syntax-checks the measurement generator without executing it. |
| Lock reader | Planner calls `lockPackageScope`; `ci-lock.mjs` parses/resolves old/new graphs; `ci-package-revisions.mjs` supplies immutable source/helper/manifest consumers and workspace completeness. Lock-selection, manifest-lock and lock-revisions tests exercise selection/refusal. |
| Work execution | `ci-scope.mjs` supplies packages, grouping, types and five receipts; `ci-run-receipts.mjs` validates/runs receipt test commands; `ci-summary.mjs` validates jobs. `ci.yml` calls the planner/checkers and runs `ci-*.test.mjs` plus the two owning script tests. Preserve its exact-head checkouts and all gates. |
| Receipt certificates | `ci-receipts.mjs` chains milestone, capacity, database, gateway and local-stack audits. The latter four use `ci-install-inputs.mjs`; local-stack also pins deployment/migration directory trees. These are separate literal certificates, not candidates for consolidation. |
| Saved fixtures and root guards | `ci-dependency-fixture.mjs` seeds saved dependency/execution JSON into the five receipt test families. Dependency-fixture tests run named positive tests after live-input changes; `ci-receipt-cleanup.test.mjs` runs fourteen exact fixture tests and checks real commits, batching and process cleanup. Root plan/CLI/summary/workflow/reuse/package-revision tests are transitive contract consumers. |

The guides are `docs/ci-documentation-audit.md` and `docs/ci-lockfile-audit.md`; the current status is the CI section of `docs/backlog.md`. This slice supersedes only the old certificate paths/schema and renewal instructions there and in test setup. It does not implement the larger plan's unified work schema or change any selection expectation.

## One shared policy, four separate inventories

Use `scripts/ci-input-audit.json` with exactly these fields: `version: 1`, `docsInputSha256`, `identityInputSha256`, `gatewayInputSha256`, `lockInputSha256`, and `manifests`. Every digest is a lowercase 64-character hexadecimal string. `manifests` is an object mapping canonical `apps/<member>/package.json` or `packages/<member>/package.json` paths to such digests. Reject unknown/missing fields, wrong types, unsupported versions, malformed JSON, duplicate members and damaged digests. Reject invalid manifest paths and missing/extra manifest evidence against the complete workspace when checking lock mode. Never fill absent fields with defaults.

Require the shared policy to exist as a `100644 blob` in each checked revision. Read complete NUL-terminated `git ls-tree -rz --full-tree` records, preserving original order, path, mode, type and object ID in each SHA-256 inventory. Reject malformed/truncated inventories and duplicate paths. The policy's own entry is excluded from every inventory; no other new exclusion is allowed.

| Mode | Existing content exemption, preserved exactly |
| --- | --- |
| Documentation | Only `100644 blob` root Markdown and `docs/**/*.md` outside `docs/receipts/`, using the existing `unreadMarkdown` path rules. Package Markdown, receipt Markdown/JSON, executable Markdown, symlinks and submodules remain inventoried inputs. Deleted regular prose uses old-tree evidence. |
| Identity | Exactly `scripts/identity-upstream.mjs` and `scripts/identity-upstream.test.mjs`; both must exist as `100644 blob` in both trees. All other inputs, including the gateway family and prose, stay pinned. |
| Gateway | Exactly `scripts/verify-gateway-reconnection-receipt.mjs` and its `.test.mjs`; both must exist as `100644 blob` in both trees. The generator `scripts/gateway-reconnection-receipt.mjs`, published receipt, identity family and all other inputs stay pinned. |
| Lock | `pnpm-lock.yaml` plus dependency declarations in workspace manifests, with a separate digest for each projected manifest. Require regular lockfile, policy and every manifest. Keep the current projection: validate object/string values for `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`, remove only those four fields, sort remaining top-level keys with the existing comparator, then hash `JSON.stringify`. Root manifest and all nondependency fields stay pinned. |

Keep lock parser limits, resolved/optional/peer/workspace graph validation, complete importer set `['.', ...workspace directories]`, changed-manifest ownership, and old/new reverse consumers. Root/unknown/removed importers, no-op or unsupported locks, lost evidence and mixed inputs retain full work. Narrow lock plans still run types and **all five receipts**.

Choose the shared policy over normalizing digest fields in three peer JSON files. Normalization could remove the cycle but would require three strict parsers and a special canonical representation of each peer, with more opportunities to ignore a meaningful field. One schema and one excluded policy make the manual review boundary easier to inspect.

Self-exclusion has the same manual review trust boundary as today's own-policy exclusion. A syntactically valid edit to one mode's hash does not alter another mode's input digest. Validate the entire schema on every read, then compare the selected mode's digest and, for lock mode, its projections. A damaged peer field refuses every mode; a well-formed but wrong peer digest fails that peer's check. The all-mode manual checker catches either. A policy-only or policy-plus-content diff is still outside every narrow path allowlist and runs full. This does not grant permission to add a reader of exempt content. Change the exemption and its behavioral controls before renewal if a new reader needs that content. Matching hashes record a review boundary; they do not prove that the audit was correct.

Prose edits intentionally invalidate identity, gateway and lock inventories as before. An identity edit invalidates docs, gateway and lock; a lock edit invalidates docs and both script inventories. Removing circular certificates permits simultaneous renewal of a fixed tree, not freshness across arbitrary subsequent edits.

## Migration and explicit renewal

Remove `ci-docs-audit.json`, `ci-scripts-audit.json` and `ci-lock-selection-audit.json` from production. Do not retain legacy readers or fallback parsing for their v1/v2 schemas. Historical revisions without the shared policy are unaudited under the new readers. A code PR spanning such a base runs full; a valid head policy cannot qualify that base. Future isolated changes between unchanged audited inputs may narrow in their own mode. If old files reappear, treat them as ordinary inventoried files, never certificates.

Keep the planner's warning on every run when the committed checkout lacks a current documentation audit. Update its policy path and renewal instructions; do not suppress it to hide a mismatch. Keep checker revalidation of both immutable revisions and exact changed paths, the script job's clean exact-head checkout and real child checks, strict summary results, unknown-path full fallback and D67 equal-tree merge reuse.

Provide an explicit local CLI in `scripts/ci-input-audit.mjs`: `--write-staged` computes all four inventories/projections from `git write-tree`, writes only the working policy and never stages it; `--check <commit>` checks all four modes at one immutable committed revision and writes nothing. No default action, network, live services or CI renewal. Inspect every changed/new/deleted reader and execution/install input before invoking it. Its staged-tree workspace discovery must accept only the supported workspace layout and complete manifests, never silently use live candidate files.

Stage the complete reviewed candidate, including a schema-valid policy placeholder for initial creation. Generate, inspect and stage the policy; generate again and require no byte change. Commit signed off and check all four modes against that actual committed checkout. Repeat review/generation if any inventoried input changes, including the audit guides, tests or backlog. This order avoids leaving the documentation warning unexplained.

Keep the five receipt certificates, installation pins, directory pins, test commands and saved `ci-dependency-inputs.json`/`ci-execution-inputs.json` unchanged. Invalidated receipt evidence retains that receipt with its reason; this work does not claim to renew them all. Saved fixtures must never regenerate from live candidates to obtain a pass. Deliberately migrate the dependency test's manifest-map read to the shared policy while retaining its independent saved-metadata equality assertion.

## Acceptance and remaining work

You finish this slice when independent fixtures and real committed checkouts prove simultaneous four-mode currency, stable second generation, valid isolated plans, every refusal and forged-plan rejection, with guard-removal controls failing in disposable trees and the original guards restored. Preserve all owning identity/gateway and receipt verifier assertions. No production routing changes or proof PR is needed; local committed fixtures supply the narrow controls, and one justified implementation CI run supplies production wiring evidence.

Run focused behavioral tests during implementation and let the normal push hook check the candidate once. CI owns the mandatory package suites and coverage under the owner’s 2026-10-18 decision; broader local runs are for investigating a failure. Finish the implementation with the FULL Claude run-it review, exact-head/every-job CI and serial locked ancestry checks, then read every job on the exact merge. Record actual test counts and wall time. Standard GitHub runners are free for this public repository, so no CI cost estimate is required. The wider D69 path-selection and job-duration work remains open. Owner questions: none.
