# Remote Configuration Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continuously and safely reconcile signed gateway manifests plus public/staff TLS chains from Cloud's current placement state.

**Architecture:** A PostgreSQL target ledger projects one periodic route job per cell and two certificate jobs per active placement. Leased workers perform external DNS/ACME and filesystem work through explicit adapters, re-authorize certificate results after waits, publish with atomic file replacement, and retain prior artifacts on failure.

**Tech Stack:** TypeScript, Node test runner, PostgreSQL 18, `acme-client`, local Pebble DNS-01 fixtures, signed gateway manifests, Waitron's existing certificate CSR/install command.

**Spec:** `docs/superpowers/specs/2026-09-26-remote-configuration-reconciler-design.md`

## Global Constraints

- No live DNS change, live certificate issuance, provider provisioning, deployment or Waitron source edit.
- The staff private key never enters Cloud; only an explicitly supplied CSR and returned chain cross the boundary.
- A hostname, placement revision or revocation change during ACME work prevents the late chain from publishing.
- Failed issuance or publication leaves the last usable certificate/manifest file unchanged.
- Claims are bounded to eight attempts, a two-minute lease and at most 32 worker slots; retries use redacted stable codes.
- Routes refresh within five minutes so the existing ten-minute gateway authority can remain current.

## Review Focus

- A certificate result arriving after hostname change, replacement or revocation must not publish.
- An expired lease claimed by a restarted worker must make the old worker unable to acknowledge or publish stale certificate material.
- Two workers observing one due target must perform one external action.
- A missing CSR/key mapping or failed ACME/DNS call must retain the old artifact and allow unrelated targets to progress.
- A staged/cancelled/completed cell move must change the correct route digest and never publish another venue's route or signing key.

---

### Task 1: Durable desired-target ledger and claim lifecycle

**Files:**
- Create: `packages/registration/migrations/024_remote_configuration_jobs.sql`
- Modify: `packages/registration/src/migrate.ts`
- Create: `packages/remote-access/src/reconciler.ts`
- Create: `packages/remote-access/test/reconciler.test.ts`

**Interfaces:**
- Produce `RemoteConfigurationReconciler.schedule(): Promise<number>`.
- Produce `RemoteConfigurationReconciler.runOnce(signal?: AbortSignal): Promise<boolean>`.
- Produce `remoteConfigurationStatus(pool): Promise<{enabled:number; due:number; running:number; failed:number; oldestDueAt:string|null}>`.

- [ ] Write a PostgreSQL test that provisions two installations in one cell, calls `schedule()`, and expects one route plus four certificate targets with stable SHA-256 desired digests.
- [ ] Run `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/reconciler.test.ts` and observe failure because the migration and class do not exist.
- [ ] Add the migration with a unique `(kind,target_id)`, `pending|running|failed` status, desired/applied digests, due time, claim UUID, lease, attempt counters and enabled flag; add it to `migrationNames`.
- [ ] Implement target projection from ordered current routes and active placement certificate identities. Serialize scheduling with a PostgreSQL advisory transaction lock, immediately requeue changed digests, and disable disappeared targets.
- [ ] Add RED cases for concurrent claims, expired-lease restart, eight-failure parking, desired-state change resetting a parked target, revocation and unrelated-target progress.
- [ ] Implement `FOR UPDATE SKIP LOCKED` claims, claim-token acknowledgement, exponential retry capped at fifteen minutes, and status counts; run the focused file green.

### Task 2: Fenced certificate reconciliation and atomic artifacts

**Files:**
- Modify: `packages/remote-access/src/placement.ts`
- Modify: `packages/remote-access/src/reconciler.ts`
- Create: `packages/remote-access/src/reconciler-files.ts`
- Modify: `packages/remote-access/test/reconciler.test.ts`
- Modify: `packages/remote-access/test/certificates.test.ts`

**Interfaces:**
- Extend `RemoteAccessStore.authorizeCertificate(id, kind, csr)` to return `{hostname,dnsName,revision}`.
- Produce `ReconcilerArtifacts` with `readCsr`, `readCertificate`, `publishCertificate` and `publishManifest` methods.
- Produce `FileReconcilerArtifacts` from explicit trusted route/certificate mappings.

- [ ] Add a RED test that pauses the issuer, changes the hostname and revision, then releases the old result and asserts no certificate was published and the prior chain is unchanged.
- [ ] Add RED cases for revocation, a changed CSR key, valid unexpired chain skip, expiring chain renewal, issuance failure, atomic-write failure and a late expired claim.
- [ ] Return the locked configuration revision from certificate authorization. In `runOnce`, load the CSR/current chain, call `certificateNeedsRenewal`, invoke the injected issuer only when needed, then re-authorize and compare the exact claimed identity before atomic publication and claim acknowledgement.
- [ ] Implement same-directory `wx` temporary writes with file sync, rename and directory sync. Validate that every configured certificate target and cell signing key has one exact mapping; never derive a path from a database/customer string.
- [ ] Run the focused reconciler, certificate, renewal and placement tests green. In a disposable checkout remove the revision comparison and confirm the paused-hostname test fails.

### Task 3: Route publication, operator CLI and local ACME/Waitron proof

**Files:**
- Modify: `packages/remote-access/src/reconciler.ts`
- Create: `packages/remote-access/src/reconciler-cli.ts`
- Modify: `packages/remote-access/package.json`
- Modify: `package.json`
- Create: `scripts/remote-reconciler-receipt.mjs`
- Create: `scripts/verify-remote-reconciler-receipt.mjs`
- Create: `scripts/verify-remote-reconciler-receipt.test.mjs`
- Modify: `docs/local-remote-access.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- The CLI accepts `CONFIG.json`, optionally followed by `--once` or `--status`; continuous mode uses the shared bounded worker loop.
- The receipt records exact Cloud/Waitron heads, dirty flags, manifest sequences, certificate serials/fingerprints, duplicate action counts, restart recovery, stale-result refusal and retained-material checks.

- [ ] Add a RED route-worker test: one due route target publishes a signed manifest with the configured cell key, duplicate workers publish once, and the target becomes due again five minutes after success.
- [ ] Implement route execution with a fresh `RemoteAccessStore.manifest`, the exact configured cell signing key, signed-envelope validation and atomic publication; a failed write retains the old file and retries.
- [ ] Add subprocess tests for strict CLI arguments/config, missing mappings, `--once`, `--status`, redacted failure output and signal shutdown; implement only the trusted adapter loading and shared worker loop needed for those cases.
- [ ] Write the receipt verifier first and observe it reject a fixture missing restart, duplicate, fencing or retention evidence.
- [ ] Use local Pebble/DNS to issue and renew public/staff chains, invoke Waitron's existing `cloud-certificate.ts install` against the staff chain, apply the reconciled signed route manifest, restart the Cloud worker, and prove both TLS paths plus other-venue isolation. Deliberately fail a renewal and change a hostname during a paused issuance; record that usable material remains and the stale result is refused.
- [ ] Update the operator guide and backlog with exact local evidence and the remaining live DNS/provider, staff-chain transport, production key-store and deployment work.

### Task 4: Focused gates and authorised branch completion

**Files:** all changed files above.

**Interfaces:** No new interfaces.

- [ ] Run the PostgreSQL-backed remote-access suite, receipt/verifier, workspace typecheck and `git diff --check`.
- [ ] Run mutation controls for the revision fence, claim token, atomic rename and route signing-key mapping; each relevant test must fail before restoring the guard.
- [ ] Commit logical checkpoints with `git commit -s` and leave the worktree clean.
- [ ] Run `finish-branch`, triage the single Claude run-it review, push through the normal hook and verify CI on the exact feature head.
- [ ] Hold `~/waitron-campaign-shared/main.lock` for the entire authorised `land-branch` flow, then verify exact-merge CI on the literal merge SHA before marking D21 landed.
