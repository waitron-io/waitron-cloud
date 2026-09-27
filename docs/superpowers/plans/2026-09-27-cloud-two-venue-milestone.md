# Complete Two-Venue Cloud Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide one reproducible local command and strict receipt proving the complete two-venue Cloud milestone from pairing through remote access, backup, recovery and replacement.

**Architecture:** Compose the landed remote, transfer and managed-recovery runners without adding product protocols. Extend the remote phase with real before/after snapshot publication, enrich the managed-recovery receipt with timings and replacement evidence, then validate and summarize all three child receipts in one milestone runner.

**Tech Stack:** Node.js 26, TypeScript, PostgreSQL 18, Docker, WireGuard, HAProxy, Pebble, SeaweedFS, Litestream and real Waitron SQLite fixtures.

**Spec:** `docs/superpowers/specs/2026-09-27-cloud-two-venue-milestone-design.md`

## Global Constraints

- Do not edit Waitron, add a recovery/tunnel protocol, create live resources, deploy or activate trading.
- Use the existing Waitron capture, continuous restore, cold restore, certificate and replacement interfaces.
- Every production-behaviour change begins with an observed failing test; this branch changes proof and documentation code only.
- Exact receipt shapes reject evidence that is missing, dirty, crossed between venues or from different commits.
- Every commit uses `git commit -s` and normal hooks.

## Review Focus

- A before/after backup point bound to the wrong installation or venue must invalidate the milestone receipt.
- A component receipt from a different Cloud or Waitron commit must invalidate the milestone receipt.
- A replacement that reuses the old recovery key or leaves old upload authority usable must be rejected.
- Zero, negative, non-finite or absent recovery/reconnection timings must be rejected.
- The receipt must reject a claimed activation or a snapshot fallback whose continuous source was not removed.

---

### Task 1: Define the milestone and managed-recovery receipt contracts

**Files:**
- Create: `scripts/verify-two-venue-milestone-receipt.mjs`
- Create: `scripts/verify-two-venue-milestone-receipt.test.mjs`
- Modify: `scripts/verify-managed-recovery-receipt.mjs`
- Modify: `scripts/verify-managed-recovery-receipt.test.mjs`

**Interfaces:**
- Consumes: current remote, transfer and managed-recovery JSON shapes.
- Produces: `verifyTwoVenueMilestoneReceipt(value)` and managed-recovery receipt version 2.

- [ ] **Step 1: Write failing receipt tests**

  Add one complete example and mutations for crossed venue bindings, mismatched commits,
  dirty heads, missing gateway/backup/recovery evidence, invalid timings, reused secrets,
  live old authority and activation.

- [ ] **Step 2: Run the tests and observe the expected failure**

  Run: `node --test scripts/verify-managed-recovery-receipt.test.mjs scripts/verify-two-venue-milestone-receipt.test.mjs`

  Expected: FAIL because the new verifier/fields do not exist.

- [ ] **Step 3: Implement exact validators**

  Keep commit, UUID, hash, ISO-date and finite-positive timing checks local to the
  verifier. Require both component heads to match the top-level heads and require
  `activation: "not-performed"`.

- [ ] **Step 4: Run both verifier suites**

  Expected: PASS, including every negative mutation.

- [ ] **Step 5: Commit**

  `git commit -s -m "test: define two-venue milestone receipt"`

### Task 2: Record measured recovery and replacement evidence

**Files:**
- Modify: `scripts/test-local-backups.mjs`
- Modify: `scripts/verify-managed-recovery-receipt.mjs`
- Modify: `scripts/verify-managed-recovery-receipt.test.mjs`

**Interfaces:**
- Consumes: the existing real continuous restore, snapshot fallback and guided replacement flow.
- Produces: `continuous.restoreMs`, `snapshotFallback.restoreMs` and a strict `replacement` object.

- [ ] **Step 1: Extend the failing sample/mutation tests**

  Require positive measured timings, distinct old/new installation and recovery-key
  fingerprints, preserved venue/address/hostnames, refused old authority and a fresh
  restorable replacement snapshot.

- [ ] **Step 2: Run the managed receipt suite and observe failure**

  Run: `node --test scripts/verify-managed-recovery-receipt.test.mjs`

- [ ] **Step 3: Instrument the already-executed real operations**

  Measure only the successful continuous retry, fallback restore and guided
  replacement interval. Hash recovery keys before comparison; do not put a key in a
  receipt or log. Capture identifiers and booleans directly from assertions already
  enforced by the runner.

- [ ] **Step 4: Run verifier tests and the managed proof on clean checkouts**

  Run the verifier unit test, then:
  `WAITRON_CHECKOUT=/tmp/waitron-cloud-d25-waitron BACKUP_RECEIPT=/tmp/cloud-backup-receipt.json node scripts/test-postgres.mjs exec node scripts/test-local-backups.mjs`

- [ ] **Step 5: Commit**

  `git commit -s -m "test: measure managed replacement evidence"`

### Task 3: Prove snapshots continue across a real gateway replacement

**Files:**
- Modify: `scripts/test-local-remote.mjs`
- Modify: `scripts/verify-two-venue-milestone-receipt.test.mjs`

**Interfaces:**
- Consumes: `startBackupStorage`, `BackupKeyVault`, `BackupObjects`, `BackupCatalogue` and Waitron's landed capture fixture.
- Produces: `remote.backupContinuity` with two venue-bound before/after points and gateway recovery evidence.

- [ ] **Step 1: Tighten the milestone verifier test first**

  Add mutations for duplicate points, crossed installation IDs, missing post-replacement
  captures and unchanged venue separation.

- [ ] **Step 2: Run the milestone verifier test and observe failure**

- [ ] **Step 3: Add local backup services to the remote fixture**

  Start the existing local storage adapter, pass it into `startPortalFixture`, provision
  one location per paired installation, and launch Waitron with backup state enabled.

- [ ] **Step 4: Capture before and after replacement**

  Stop one server at a time, invoke Waitron's real encrypted capture/upload/publish
  fixtures, restart on its persisted port, and confirm its route recovers. Repeat for
  both venues before and after replacing the real gateway. Record only identifiers,
  capture times and bindings.

- [ ] **Step 5: Run focused receipt tests and the real remote proof**

  Build the local gateway image, then run:
  `WAITRON_CHECKOUT=/tmp/waitron-cloud-d25-waitron REMOTE_RECEIPT=/tmp/cloud-remote-receipt.json node scripts/test-postgres.mjs exec node scripts/test-local-remote.mjs`

- [ ] **Step 6: Commit**

  `git commit -s -m "test: preserve backups across gateway replacement"`

### Task 4: Compose one runnable milestone proof

**Files:**
- Create: `scripts/cloud-two-venue-milestone-receipt.mjs`
- Modify: `package.json`
- Modify: `scripts/verify-two-venue-milestone-receipt.test.mjs`

**Interfaces:**
- Consumes: the three child runner commands and their validated JSON receipts.
- Produces: `pnpm proof:two-venue-milestone` and `CLOUD_MILESTONE_RECEIPT`.

- [ ] **Step 1: Add failing orchestration-shape tests**

  Require exact component order, shared heads, summarized timings and proof labels.

- [ ] **Step 2: Implement the runner**

  Create private temporary receipt files, run transfer, remote and managed-recovery
  phases sequentially with inherited local fixture variables, forward output, read and
  validate all receipts, write the final receipt atomically only on success, and clean
  temporary files in `finally`.

- [ ] **Step 3: Run unit tests and the complete proof**

  Run the verifier tests, then the documented `proof:two-venue-milestone` command
  against clean Cloud and Waitron heads. Verify the final receipt independently.

- [ ] **Step 4: Commit**

  `git commit -s -m "test: compose complete Cloud milestone proof"`

### Task 5: Document the evidence and production limits

**Files:**
- Modify: `docs/local-backups.md`
- Modify: `docs/local-remote-access.md`
- Modify: `docs/waitron-integration-contract.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: the final clean receipt and measured values.
- Produces: one-command operator instructions and an honest first-milestone status.

- [ ] **Step 1: Update the guides and backlog**

  Include exact commands, prerequisites, measured local values, cleanup behavior and
  remaining provider/deployment/DNS/secret/activation/database-recovery gates.

- [ ] **Step 2: Validate docs and focused code**

  Run `git diff --check`, milestone verifier tests and `pnpm typecheck`.

- [ ] **Step 3: Commit**

  `git commit -s -m "docs: record complete local Cloud milestone"`

### Task 6: Finish, land and verify the merge

**Files:**
- Review the complete branch and retained proof/review artifacts.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: reviewed PR, exact-head CI, landed main SHA, exact-merge CI and cleaned feature refs/worktree.

- [ ] **Step 1: Run finish-branch**

  Include the required independent Claude run-it review. Add failing regressions for
  accepted findings and rerun focused checks plus the final clean proof when evidence
  semantics change.

- [ ] **Step 2: Push and wait for exact-head CI**

- [ ] **Step 3: Acquire `~/waitron-campaign-shared/main.lock` and run land-branch**

- [ ] **Step 4: Verify exact-merge CI and record PR/SHA/run receipts in Lane D**
