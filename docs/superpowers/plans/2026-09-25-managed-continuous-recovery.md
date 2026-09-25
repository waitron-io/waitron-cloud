# Managed Continuous Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a test venue from Cloud-managed Litestream data through Waitron's landed recovery path, with verified recovery-time evidence and snapshot fallback.

**Architecture:** A Cloud stream catalogue binds one active installation to a provider-owned prefix and verifies Waitron's signed pointer directly from storage. The existing owner recovery operation freezes either that continuous generation or a verified snapshot and releases the matching secret material only to the approved replacement key.

**Tech Stack:** Node 24, TypeScript, PostgreSQL, Hono, Lit, SeaweedFS 4.47, Waitron SQLite/Litestream 0.5.17.

**Spec:** `docs/superpowers/specs/2026-09-25-managed-continuous-recovery-design.md`

## Global Constraints

- No Waitron source edit, live provider resource, customer mail, public deployment or automatic promotion.
- Keep archive and stream restore paths separate. Never apply stream changes after a snapshot restore.
- Browser and status responses contain no storage credentials, recovery keys, provider references, bucket paths or generation names.
- A recorded recovery time comes only from a provider-read pointer whose Ed25519 signature Cloud verified.
- Every production behavior starts with an observed failing test. Every commit uses `git commit -s`.

## Review Focus

- A validly shaped pointer signed by the other venue must be refused and must not update evidence.
- Revocation or replacement during the provider read must prevent a late observation from committing.
- A second pointer with an older `writtenAt` must not move recovery evidence backwards.
- An approved continuous operation must stay on its frozen generation after a newer observation arrives.
- Closing or owner revocation during credential resolution must prevent recovery-kit disclosure.

---

### Task 1: Persist and verify managed stream evidence

**Files:**
- Create: `packages/registration/migrations/018_managed_continuous_recovery.sql`
- Create: `packages/backups/src/managed-streams.ts`
- Create: `packages/backups/test/managed-streams.test.ts`
- Modify: `packages/registration/src/migrate.ts`
- Modify: migration count and startup guard tests
- Modify: `packages/backups/package.json`

**Interfaces:**
- Consumes: `BackupKeyVault`, `backup_locations`, current installation/service rows and a provider adapter that returns opaque writer/reader references plus credentials.
- Produces: `ManagedStreams.configure(installationId, revision, input)`, `ManagedStreams.observe(installationId, revision)` and `ManagedStreams.recovery(venueId, frozenRevision)`.

- [x] Write PostgreSQL tests for exact configuration retry, cross-venue scope, malformed signer/source IDs, provider failure, signed observation, crossed signature, older evidence, concurrent workers and revocation/replacement during the provider wait. Run them and confirm the missing migration/module failures.
- [x] Add migration 018 with one stream row per venue, current source installation/revision, local venue/source node/signer, prefix, opaque credential references and nullable verified evidence. Extend `backup_recoveries` with a coherent snapshot-or-continuous source shape while preserving existing rows.
- [x] Implement strict pointer decoding and Ed25519 verification over Waitron's canonical pointer message. Implement configure/observe/recovery with installation and revision fences before and after external waits.
- [x] Run `node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/managed-streams.test.ts` and registration migration tests. Commit the green unit with sign-off.

### Task 2: Add authenticated machine configuration and observation

**Files:**
- Modify: `packages/registration/src/installation-proof.ts`
- Create: `packages/account-http/src/managed-streams.ts`
- Create: `packages/account-http/test/managed-streams.test.ts`
- Modify: `packages/account-http/src/app.ts`
- Modify: `packages/backups/src/capture-config.ts`
- Modify: account server migration guards and package exports

**Interfaces:**
- Consumes: Task 1 `ManagedStreams` and the existing machine proof/lease format.
- Produces: POST `/api/installations/backup-stream-configure` and `/api/installations/backup-stream-observe`.

- [x] Write failing HTTP tests for exact signed requests, lease/revision mismatch, unknown fields, Origin refusal, changed retry, response redaction, provider waits and per-IP/per-installation rate limits.
- [x] Add the two machine actions to the proof allowlist and route. Validate only the documented configure body or `{}` observe body. Reuse the existing public installation errors and no-store response handling.
- [x] Extend capture runtime options with an optional managed-stream adapter. Absence returns the normal temporary-unavailable response; it never widens snapshot grants.
- [x] Run focused account HTTP, installation-proof and configuration tests. Commit the green unit with sign-off.

### Task 3: Select continuous recovery and deliver a frozen kit

**Files:**
- Modify: `packages/backups/src/recovery.ts`
- Modify: `packages/backups/src/recovery-request.ts`
- Modify: `packages/account-http/src/recovery.ts`
- Modify: `packages/account-http/src/backups.ts`
- Modify: corresponding backup/recovery PostgreSQL and HTTP tests

**Interfaces:**
- Consumes: Task 1 verified evidence and provider reader credentials.
- Produces: a source-discriminated recovery view and continuous `read` response containing one Waitron recovery-kit token.

- [ ] Write failing tests that default approval to the displayed continuous source, retain explicit snapshot selection, freeze the generation/time/revision, reject stale or changed evidence, hide secrets from owner views and stop disclosure after close/revocation/provider wait.
- [ ] Refactor `RecoveryInput` and stored views into discriminated snapshot/continuous sources. Preserve old snapshot callers and replacement behavior.
- [ ] Branch target `info/read/restored` by frozen source. Keep snapshot grants unchanged. For continuous read, resolve reader credentials, build the exact `WAITRON-RECOVERY-KIT-1:` payload and recheck operation/permission/evidence before returning it.
- [ ] Return nullable continuous public evidence from the owner catalogue without bucket, signer, generation or provider references.
- [ ] Run focused backups and account HTTP tests. Commit the green unit with sign-off.

### Task 4: Add bilingual owner selection and status

**Files:**
- Modify: `apps/portal/src/backup-types.ts`
- Modify: `apps/portal/src/backup-screen.ts`
- Modify: `apps/portal/src/recovery-types.ts`
- Modify: `apps/portal/src/recovery-controller.ts`
- Modify: `apps/portal/src/recovery-screen.ts`
- Modify: `apps/portal/src/locale.ts`
- Modify: corresponding controller and browser tests

**Interfaces:**
- Consumes: Task 3 public catalogue and recovery views.
- Produces: latest-continuous recommendation, explicit snapshot fallback and source-aware approved status.

- [ ] Write failing controller/browser assertions for English and Spanish, continuous default, explicit snapshot fallback, checked/recoverable times, uncertain writes, stale reloads and secret/tenant exclusion.
- [ ] Implement strict response validators and controller selection state. Approval sends either `source:continuous,venueId` or `source:snapshot,pointId`.
- [ ] Render concise confirmations and status at desktop and 390px in light/dark themes. Preserve current replacement flow and accessibility roles.
- [ ] Run focused portal controller/browser tests, build the portal and inspect screenshots. Commit the green unit with sign-off.

### Task 5: Prove the real two-venue recovery loop and document limits

**Files:**
- Modify: `scripts/backup-storage-fixture.mjs`
- Modify: `scripts/test-local-backups.mjs`
- Create: `scripts/verify-managed-recovery-receipt.mjs`
- Modify: `docs/local-backups.md`
- Modify: `docs/waitron-integration-contract.md`
- Modify: `docs/backlog.md`
- Modify: root scripts if a focused command is needed

**Interfaces:**
- Consumes: Tasks 1 through 4 and Waitron main's existing stream settings, pointer, sealed-state and `restore --from-bucket` interfaces.
- Produces: a schema-versioned machine-readable receipt and exact remaining production prerequisites.

- [ ] Add static local provider identities restricted to one venue stream prefix for writer and reader roles. Prove cross-venue reads/writes/listing fail.
- [ ] Extend the real proof to configure both Waitron streams, observe signed pointers, stop originals, recover one venue from the latest generation, interrupt/retry, and keep the other isolated. Delete one continuous source and prove verified-snapshot fallback.
- [ ] Add a verifier that rejects missing phases, mismatched heads, invented/retrograde recovery times, cross-venue success, absent retry evidence or any activation claim. Run mutation controls against its critical guards.
- [ ] Update user-facing local instructions, contract status and backlog with measured evidence and the exact production credential delivery/rotation, provider, retention, monitoring and planned-handover work.
- [ ] Run affected package typechecks and focused suites. Commit with sign-off.

### Task 6: Finish, land and verify the merge

**Files:**
- Review the complete branch and retained proof/review artifacts.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: one reviewed PR, current-head CI, landed main SHA, exact-merge CI and cleaned feature refs/worktree.

- [ ] Run finish-branch, including one independent Claude run-it review in an installed temporary checkout. Add failing regressions for accepted findings and rerun focused checks.
- [ ] Push normally and wait for required CI on the exact PR head.
- [ ] Acquire `~/waitron-campaign-shared/main.lock`, run land-branch from the Cloud main checkout, refresh dependencies and clean only this worktree/branch. Release the lock.
- [ ] Verify the main CI run names the exact merge SHA and succeeds. Record PR URL, heads, CI IDs, review artifacts and local receipt in Lane D progress, then mark D5 landed.
