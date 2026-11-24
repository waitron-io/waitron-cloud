# Cloud Backup Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the already authorised native inline implementation. Follow the TDD skill before writing code. Track steps with checkboxes. No new design or owner approval gate; this document proposes work, not executed proof.

**Goal:** Qualify an exact retained archive for an exact Waitron target without granting fiscal authority, and require that qualification throughout snapshot recovery.

**Architecture:** Continue the reconciled PR5 branch. Use Waitron's shipped verification bundle for module semantics, with a matching bounded Cloud protocol reader, immutable attempt evidence and one database qualification view for every consumer. Keep historical retention independent of present availability; negotiate snapshot recovery v2 without altering v1/continuous contracts.

**Tech Stack:** Node 26, TypeScript, PostgreSQL 18, pnpm 9.15, Docker, local SeaweedFS, existing account API and Lit portal.

**Spec:** [Approved backup verification contract](../specs/2026-10-18-backup-verification-without-fiscal-authority.md); [PR5](2026-10-17-test-cloud-free-paid.md#pr-5-supply-real-local-backup-and-remote-adapters-for-the-test-project); [documentation ownership](../../documentation-ownership.md).

## Current execution pin

The owner required worker threads to remain denied. The compatible A1004 release
is now `ec91a9e34d2daba146f4ee61850ea4136ad5cfb7` (Waitron #1968), superseding W
below for continued execution. Its compiled target digest is
`2e9a53ebe041b37415b0983563edaa1529714b42f3cd2637987b976667164d10` and runtime
fingerprint is `a62d25dfd879e6092efd9f6ffac64dd1f08304585d4e0e535535a53e7b818cf6`.
All 15 owners remain; core is schema 185 and venue-service is schema 66.
`deploy/backup-verifier/target.json` contains the entire descriptor exported from
that compiled bundle. The build compares every field. The original W/H receipts
below remain historical. The private transport, isolation, limits and authority
rules remain in force.

## Global Constraints

- Cloud planning base: `a31df0093529f5ebccc6fe3561dbcd194166ce48`. Parked PR5 branch: `feat/test-cloud-service-adapters`, `fecbf8f478e1842fc0cf5596bd205b5cfe25a0b2`; compare `1e854db468e5af3bb9ebc7907d3e395d2a9a8390..fecbf8f`. Its storage/account/remote/controller work is absent from main. Rebase and reconcile before continuing it, preserving all 54 fault receipts and prior runtime receipts in the campaign ledger. Do not duplicate those adapters or claim their receipts prove this new path.
- Waitron implementation landed as #1939, `5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa` (W below). Runtime release: `waitron-5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa`. Handoff H: `9fbbcd2daae08bb0d943186eff9bba8599002e9c:docs/superpowers/plans/2026-10-20-a850-backup-verification.md`, Task 27 completion. Inspect those immutable objects with `git show SHA:path` in your read-only Waitron checkout; never mutate Waitron.
- Read the complete descriptor from the pinned compiled bundle with `currentBackupVerificationTarget()`, as the [public release handoff](https://github.com/clintongormley/waitron/blob/9fbbcd2daae08bb0d943186eff9bba8599002e9c/docs/superpowers/plans/2026-10-20-a850-backup-verification.md#task-27-completion-and-implementing-release--21-october-2026) describes. Do not reconstruct it from prose. Expected target digest `27b6669fe7367c9619bd71fb7ac6ce0edcd97d5a7f3c6e83d953468ed62932c5`; runtime fingerprint `163574c6d3100c2a37db14eb56a111842aa85d27caf70802a2fd43e19126109f`. Compare every descriptor field, including all 15 owners, dependencies, package versions, SQL/journal migration digests and policy digests.
- Public bundle `apps/server/dist/backup-verification.js` exports `verifyBackupArtifact`, `BACKUP_VERIFICATION_MODULES`, `currentBackupVerificationTarget`, `buildBackupVerificationTarget`, `backupVerificationRequestDigest`, `readBackupVerificationRequest`, `readBackupVerificationResult`. Native targets carry a runtime fingerprint, never a fictitious image identity.
- The published image digest is **unqualified** by this handoff. A locally built immutable candidate may support integration; it is not a published release. Record both identities separately and require exact publication evidence before release pinning.
- Child: network `none`, read-only pinned image, UID/GID `1000:1000`, dropped capabilities, no-new-privileges, no Docker socket or host mounts, no listeners/workers/first-start; retain CPU/PID limits, **one child, 1,024 MiB memory, 256 MiB scratch, 30-second watchdog**. Limits cannot increase under this plan. Controller alone may access storage and Docker.
- Only the matching archive-key version enters private child transport. No master sealing key, stream key, storage/admin/provider credentials, fiscal authority, raw diagnostics or secret values in argv, environment, journal, logs or receipts. Clean owned scratch/handles/child before admission; uncertain cleanup is unavailable.
- Preserve every guard/assertion, fiscal authority, signed capture format, schema/byte limits, owner/plan/fresh-target/expiry/old-server confirmations and existing freshness thresholds. No fiscal writer, number/allocation/hash-chain/golden edits. Never substitute preview, integrity-only, skipped hooks or rolled-back activation for verification.
- Snapshots remain unavailable and deployment enforcement off until full joint proof and coordinated reviewed release. v1 and continuous behavior remain supported outside this new snapshot qualification; neither qualifies it. No provider accounts, deployment, quarantined venue mutation or external access is required for local implementation.
- Native TDD: add a named behavioral failure, run and observe its expected assertion failure, implement minimally, rerun green, then `git commit -s` with normal hooks. Preserve behavioral assertions when adapting fixture transport. Root/security assertions are not disposable implementation details.
- Current Lane D/user instruction supersedes the old PR5 full-local-suite rule: run focused local checks; CI owns mandatory package/dependant suites, root guards, types/build and required receipts. Inspect actual exact-head jobs and reuse provenance before readiness. Never call an unrun, skipped, fixture-only or historical check current proof.
- If an old recovery/security check breaks as a side effect, reproduce it and provide the exact command, assertion and proposed change for the existing owner-check boundary. Do everything independent; do not rewrite/weaken that check without exact approval. This is conditional on a real conflict, not an extra planning gate.

## Review Focus

1. A policy change while output waits for locks rejects the entire old outcome; no stale failure overwrites newer success (Task 5).
2. An unavailable recheck removes current eligibility but retains historical fallback, bytes, keys and accounting; prior invalid stays failed (Tasks 3, 5, 8).
3. Duplicate escaped JSON keys, noncanonical numbers and oversized split streams fail before a permissive parse can erase the fault (Tasks 2, 4, 6).
4. Unknown create/cleanup outcomes or a restarted controller cannot reclaim another scope's child or admit an orphan's success (Task 4).
5. A target binary or selected verification changes between owner approval and delivery/replacement; every boundary refuses before keys/credentials/placement (Tasks 6, 7, 10).

## Execution and commit boundaries

Tasks form one coherent PR5 branch, not separately activated wire releases. Tasks 2–4 add dormant primitives; Tasks 5–8 complete all admission/readers before any integration-only qualification is enabled. All commits retain the deployed unavailable profile and enforcement `0`. The SQL release gate defaults false and cannot be enabled by migration or a passed callback. Task 10 may enable it only in its disposable test database; deployment release is a continuing dependency. Each task's commit is independently fail-closed for the new path.

For each task, stage only its named files and use `git commit -s -m "<message>"`; do not commit receipts/secrets. Record command, revision/tree identity, exit code, assertion/count and redacted receipt path for every claimed run. The final driver announces readiness for `finish-branch`, then uses its one whole-branch Claude run-it review after initial rebase, normal hook and current-head CI; do not repeat prior reviewed work solely for a later rebase.

> **Built.** Tasks 1–9 are on main; Task 10 and the dependencies stay below. Their step-by-step text was removed on 24 November 2026; read it with
> `git show 3c69f4903:docs/superpowers/plans/2026-10-21-cloud-backup-verification.md`.

### Task 10: Complete the genuine joint proof and PR5 release handoff

**Files:** modify `scripts/{test-local-backups,backup-verifier-proof,backup-transfer-receipt,worker-scheduling-receipt}.mjs`, their existing receipt validators/tests; `deploy/test-cloud/{snapshot-proof.test.mjs,test-fixtures/snapshot-client.mjs,test-fixtures/snapshot-archive.mjs,deployment.test.mjs,compose.yaml}` only to preserve gates and support local fixtures; `docs/{test-cloud,waitron-integration-contract,backlog}.md`. Create `scripts/verify-backup-verifier-proof.mjs`, `scripts/verify-backup-verifier-proof.test.mjs` for the new complete proof.
**Interfaces:** redacted receipt names Cloud tree, W release/complete target digest, candidate image ID, separately qualified publication digest or `unqualified`, all phases/refusals, continuous-source absence, exact owned cleanup and individual assertion receipts. Distinguish executed, unavailable and not-run; no passing receipt assembled from unrelated old runs.

- [ ] Add receipt refusal tests for absent real capture/publication, fake module inventory, missing admission/recovery, present continuous source, missing target/integrity/authority denials, unconfirmed cleanup and candidate called published. Run `node --test scripts/verify-backup-verifier-proof.test.mjs`; observe failures before adding orchestration/validation.
- [ ] Build immutable local candidate with `WAITRON_CHECKOUT=<read-only-W-checkout> CLOUD_VERIFIER_IMAGE=<local-candidate-tag> node scripts/build-backup-verifier.mjs` using existing BuildKit secret transport, then inspect image ID/revision/compiled target. All writes/build output use Cloud-owned scratch; no Waitron checkout build/mutation. Run local `TEST_CLOUD_SNAPSHOT_PROOF_IMAGE=<Cloud-image> TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE=<candidate-image-id> node --test deploy/test-cloud/snapshot-proof.test.mjs`; require executed assertions, fail the proof receipt if skipped. These are the parked fixture's actual environment names; do not invent an enable flag.
- [ ] In one disposable local scenario use genuine W capture, encrypted archive, signed publication, storage staging, scoped worker, complete module verification, cleanup, transactional admission, API catalogue/default, owner v2 approval, target info/read, independent digest checks and pre-placement comparisons. Continuous stream/pointer must be absent throughout. Use Waitron's real v2 client from its pinned compiled distribution in private Cloud-owned fixture state; do not replace it with locally invented signatures only.
- [ ] Perform real recovery through the existing ordinary restore boundary. Without fiscal authority, record its unchanged `FISCAL_RESTORE` refusal and no first-start/trading/route movement. Complete genuine data-placement/recovery checks using existing authorised disposable Waitron fixtures only when their genuine separate authority is available; otherwise report the full joint recovery gate incomplete and leave snapshots unavailable. Verification success alone cannot stand in for recovery success, replacement activation or fiscal operation proof.
- [ ] Add genuine alternate target/binary mismatch before placement and deterministic archive integrity refusal using disposable corrupted copies, preserving the original fiscal evidence/goldens. Exercise needs_authority/unsupported/unavailable through actual owner/runtime fixtures where supported, plus wrong key, malformed output, timeout/OOM/scratch/cancel/crash/uncertain cleanup. Keep all 54 prior controls and their original receipts; add new controls for binding/coverage/image/claim/policy/cleanup and every recovery/replacement gate. Remove guards only in owned throwaway installed Cloud copies; never alter Waitron or fiscal data to obtain success.
- [ ] Run `node scripts/backup-verifier-proof.mjs /tmp/cloud-backup-verifier-proof.json`, then `node scripts/verify-backup-verifier-proof.mjs /tmp/cloud-backup-verifier-proof.json`, focused transfer/scheduling receipt tests and schema proof from Task 9. Preserve existing transfer/chunking/resource/accounting/security assertions; old fixture return objects cannot certify v2. Update docs with exact commands, outcomes and remaining gates, commit `test: prove target-bound snapshot verification and recovery`.
- [ ] Keep `deploy/test-cloud/compose.yaml` backup availability unavailable and enforcement off. CI must run all selected touched/dependant package suites, required root/type/build and database/upgrade/transfer/scheduling receipts at exact candidate head. Finish PR5 through `finish-branch` with one whole-branch review, triage findings and normal hooks; publish no provider/deployment action here. Release driver later qualifies published image digest against W/bundle/manifest and coordinates Cloud/Waitron v2 release only after the complete genuine proof. Report any unmet gate as incomplete, never as readiness.

## Spec coverage and continuing dependencies

Self-review: promise/ownership and complete Waitron module semantics: Tasks 2/4/10; exact request/result/target bounds: 2/4/6; child resources/ownership/cleanup: 4; outcomes/claim/lease/deadline/policy races: 3/5; recovery/request/replacement/API: 6/7; historical retention, captures, keys, usage and cleanup: 3/8; catalogue/defaults/portal/diagnostics/monitoring/mail/operations: 8/9; entitlement/provisioning/stream/deployment separation: 8/10; root/migration/upgrade/security receipts and genuine release acceptance: 1/9/10. All nine spec consumer rows and five worked outcomes have owning tasks and named assertions. No migration default qualifies an old consumer.

Continuing dependencies: exact published immutable image qualification, current-head CI and PR5 whole-branch review, complete joint genuine capture/publication/verification/admission/recovery with continuous source absent, separately authorised ordinary recovery/activation proof, and coordinated release. Waitron A850 implementation is landed, not an open implementation blocker; Cloud integration remains proposed. Historical public trust roots and `external-vault-archive-v2` remain unsupported, separately owned dependencies; no provider or secret-custody expansion is implied. Keep unavailable gates if any required proof cannot complete.
