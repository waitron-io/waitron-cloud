# D620: Single-machine Kubernetes service checks

**Source reading only.** Owner authority, relayed in Lane G `questions.md` on 9 November at 15:17: “write Cloud's service checks for D110 (sign-in, remote access, backups working on Kubernetes) and run them locally on ONE machine.” D618 runs those checks on three Amazon machines later. No build or runtime proof is claimed.

Sources: [D110](2026-10-22-cloud-country-cell.md), [deployment design §12](../specs/2026-10-22-cloud-production-deployment-design.md#12-what-approving-this-design-allows-and-what-is-left-open), [documentation ownership](../../documentation-ownership.md).

**Smallest decision:** have the watcher select an independently landable Kubernetes service-deployment prerequisite before D620. Landing the private image/tool foundation alone is insufficient. A standalone D620 implementation within about 500 changed lines has not been designed; these source counts are not a lower bound. Do not expand it or copy the private branch.

## Why the prerequisite is missing

Inspected main/worktree `5db39eacb840`; `C:` below means private `feat/kubernetes-country-cell` at `21e88a07b794`. `git merge-base --is-ancestor 21e88a07b794 main` returns 1. Main lacks its cluster/image modules. On C, `git ls-files --error-unmatch` refuses all seven paths: `scripts/kubernetes-{check,proof,receipt,venue,failures}.mjs`, `deploy/kubernetes/{render,runtime}.mjs`. `git ls-tree` finds no workload YAML there. The backlog explicitly leaves service/fault proof unbuilt (`docs/backlog.md:3137–3153`).

`git diff --numstat main...feat/kubernetes-country-cell -- deploy/kubernetes 'scripts/kubernetes-*.mjs'` totals 2,356 code, 5,739 test/fixture and 828 configuration lines, excluding 615 documentation lines. These are source counts, not a new-build estimate. Missing seams include service manifests, stable secret/schema wiring, database/object storage, signed route publication, active gateway ownership and genuine in-cluster verification (D110 plan Tasks 3–11).

## Reuse, without substituting the service

Reuse C's eight-role contract, image recipes, `runKindCreate` and `loadRoleImages`; its image smoke imports production APIs but does not exercise sign-in/backups (`C:deploy/kubernetes/test-fixtures/cloud-runtime.mjs:10–32`). Actual service entrypoints exist (`deploy/test-cloud/runtime.mjs:6`). Its aggregate journey creates another Compose deployment (`scripts/test-cloud-integration.mjs:170–171,275–277`), so running it unchanged cannot qualify Kubernetes.

Synthetic venue data is acceptable when native Waitron clients, capture and restore execute (`deploy/test-cloud/test-fixtures/integration-venue.mjs:11–36`). The matching Waitron producer/client/verifier revision is a named dependency (`deploy/backup-verifier/target.json:3–6`); change no Waitron code. Preserve one writer, recovery/key/tenant/permission refusals, schema checks and verifier containment; add no locations, fake login/routes/verdicts, framework or ledger.

## Conditional verification, after the prerequisite lands

1. Proposed `scripts/kubernetes-check.test.mjs`: add `signin_session_and_signup`, `staff_public_tunnel`, `capture_upload_restore`. Assert real account/session continuity; nonempty signed routes and verified staff/public packets through WireGuard; captured bytes/digest, catalogue completion and genuine restore, including crossed-tenant/permission/key refusals. Run `node --test scripts/kubernetes-check.test.mjs` to observed RED, implement minimally, rerun GREEN without weakening checks.
2. Proposed, currently absent: `node scripts/kubernetes-check.mjs --phase venue --state <private-dir>`. Existing `runKindCreate` creates three node containers on one machine (`C:scripts/kubernetes-kind.mjs:22–33`). Retain 18 GiB host/Docker headroom, 30 GiB disk, six CPUs and freshness/pressure guards (`C:scripts/kubernetes-local.mjs:6–15`); refusal stops the run.

**Finish line:** reusable checks against actual Kubernetes services on one host. D110's three 900-second loss legs and 90/300/180-second bounds remain open; D620 proves no real-host loss. Exclude AWS, spending, D570 and production.

**Changed file:** this page only, at most 500 words. Implementation/test/configuration budget now: **0/0/0**. No executable build is approved; remaining work has no supported 500-line estimate.
