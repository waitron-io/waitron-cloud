# Kubernetes AWS response fix implementation plan

**Goal:** Unblock the documented no-GroupBy answer without weakening AWS authority or cost protection.
**Request:** Watcher lane G questions, 2026-11-07 14:05: “Fix it, test first”; audit the other AWS answers and “Make a refusal say which check failed.” The same note says “Land it as soon as CI is green”. The owner's current campaign message says “The owner authorises finish-branch and land-branch”. These external approvals are quoted because the restricted reviewer cannot read campaign files.
**Approach:** Keep the existing controller and validators; change only demonstrated response-shape mismatches and add safe refusal reasons. Use Node 26 and synthetic fixtures.
**Current receipt:** `scripts/kubernetes-proof-control.mjs:190` requires an empty `GroupDefinitions` array; `scripts/kubernetes-proof-control.test.mjs:17` supplies it.

## Scope and gates
- Work only in this worktree. No live provider calls, price downloads, infrastructure changes or expanded AWS authority.
- This plan is the only edit in the planning sitting; the driver signs its commit. Claude must read it with `~/workspace/tools/claude-seat.sh review-branch` before any build.
- Implementation stays inline and uses failing-test-first TDD; read `superpowers:test-driven-development` before writing code or tests.
- Preserve existing behavior assertions, semantic authority checks, error codes and retry behavior; do not weaken checks to fit fixtures.
- Beyond this plan, documentation edits are limited to D570's paragraph in `docs/backlog.md` and `deploy/kubernetes/proof/README.md`.

## One implementation task
- [ ] Trace every required AWS answer field and its consumers through `up` and `drill` in `scripts/kubernetes-proof-control.mjs`, `deploy/kubernetes/proof/{setup,prices}.mjs` and `scripts/kubernetes-proof-budget.mjs`; include shared billing/removal readers before changing their meaning.
- [ ] Compare STS identity, ungrouped/grouped CE, CloudFormation stacks/resources, Events rule/targets, S3 objects/list/write, SSM parameter, EC2 discovery/template/launch/observation/cleanup and all four pricing files with official AWS response documentation. Record specific mismatches and documentation links in the PR, not a new system or audit artifact.
- [ ] Derive a minimal synthetic no-GroupBy fixture from `~/waitron-campaign-g/receipts/d570/owner-sitting-20261107/real-ce-total-no-groupby.json` (no GroupDefinitions; Groups is []), preserving omissions and types while replacing identifiers and values; never copy or commit real account data or provider payloads.
- [ ] Add tests in `scripts/kubernetes-proof-control.test.mjs` proving omitted and empty `GroupDefinitions` produce the same billing observation; nonempty, null and malformed values refuse. Retain period, totals, currency, estimate, credit, pagination and cap assertions, including grouped-CE checks: grouped GroupDefinitions stays exactly equal to requested GroupBy.
- [ ] Run the new omitted-field test alone and observe failure at the existing shape check; then minimally accept absence or an empty array in `billingObservation`, with no fallback for missing cost or authority evidence.
- [ ] For each additional documented mismatch, first add a synthetic failing case to the owning `*.test.mjs`, observe the expected failure, then minimally fix its validator in the same PR. An optional field is acceptable only when the required semantic fact remains independently established; missing authority evidence still refuses.
- [ ] Add failing diagnostic tests across the scoped paths, then use optional fixed reason arguments on check/refuse/pending, one short reason per validator or step, including parse, provider, price and pending failures. No registry or new error type; table-driven diagnostic tests cover validators, not every call site. Preserve recognizable prefixes and retry codes; never interpolate payloads, credentials, raw provider errors or identifiers into reasons.
- [ ] Assert diagnostics identify the failed check, contain no synthetic secret/payload markers and stop later mutations; keep all existing behavioral assertions. Change exact message checks only to require the deliberately specified safe reason, and list each changed check under “Changed test checks” in the PR.
- [ ] Exercise connected synthetic `up` and `drill` flows with omitted-field variants of bill() and the CE fixtures currently at lines 1845 and 2110, plus refusal cases for wrong identity/ownership, grouped billing, incomplete pages, stale protection, unsafe template/network/disk settings and lost replies; retain booking and cleanup protections.

## Verification and handoff
- [ ] Run `node --test --test-name-pattern='GroupDefinitions|AWS response|safe refusal|^owner command up|^owner command drill' scripts/kubernetes-proof-control.test.mjs`; give new compatibility/diagnostic tests the matching prefixes and read executed test counts, nonzero for each prefix.
- [ ] Run only affected helper tests by name using `node --test --test-name-pattern='<affected test names>' <owning test file>` for setup, prices or budget; name files explicitly. CI owns full suites.
- [ ] Update only D570's paragraph and the owner guide with accepted omissions and safe refusal guidance (test counts stay in the PR); retain every unqualified live proof and existing authority limit.
- [ ] Before authorized finish/land, obtain Claude's whole-branch run-it review through `claude-seat.sh review-run` after the initial rebase in a temporary checkout, fix findings here, and inspect every selected CI job on the current head. Finish/land authority is the quoted owner/watcher instruction above; no live AWS action is part of this fix.
- [ ] Report focused test counts and remaining live qualification limits; announce readiness for `finish-branch` when implementation and required validation are complete.
