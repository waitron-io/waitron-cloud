# Cloud Management Database Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible local PostgreSQL physical-backup and standby-promotion drill that exercises real Cloud operation, lease, worker-claim and tenant-isolation behavior under restricted credentials.

**Architecture:** A Node runner owns disposable Docker resources, creates separate migration/runtime/replication roles, seeds through existing stores, and drives the packaged account and email worker processes. A strict receipt verifier separates the long-running integration proof from fast regression tests.

**Tech Stack:** Node.js 26, PostgreSQL 18, Docker, `pg`, the existing account HTTP and registration packages, Mailpit, and Node's test runner.

**Spec:** `docs/superpowers/specs/2026-09-27-cloud-database-recovery-design.md`

## Global Constraints

- Use only disposable local Docker resources and generated credentials.
- Do not change production deployment credentials or claim production high availability.
- Preserve current migrations, operation identity, lease verification, worker claim fencing and tenant checks.
- Keep migration, runtime and replication authority separate.
- Write tests before implementation and keep the receipt strict enough to reject missing negative controls.

## Review Focus

- A standby that is reachable but has not replayed the target log position must never count as recovered.
- A retry that returns a newly generated lease instead of the stored operation result must fail verification.
- A runtime login with schema creation, role management, replication or promotion permission must fail verification.
- A promoted copy that exposes one venue through another venue's key must fail verification.
- Cleanup must target only the proof's exact containers, volumes and network, including failure paths.

---

### Task 1: Strict recovery receipt

**Files:**
- Create: `scripts/verify-database-recovery-receipt.mjs`
- Create: `scripts/verify-database-recovery-receipt.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the receipt fields defined by the design.
- Produces: `verifyDatabaseRecoveryReceipt(receipt)` and `pnpm test:database-recovery-receipt`.

- [ ] **Step 1: Write the failing verifier tests**

Create one complete version-1 receipt fixture and mutations for a dirty tree, an elevated runtime role, missing replay, nonzero confirmed lag, a changed retry result, an accepted cross-tenant proof, an unreclaimed worker claim and leftover resources.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/verify-database-recovery-receipt.test.mjs`

Expected: FAIL because `verify-database-recovery-receipt.mjs` does not exist.

- [ ] **Step 3: Implement the strict verifier and package commands**

Validate exact schema version, SHA and ISO formats, explicit role booleans, log-sequence strings, zero confirmed lag, all positive and negative controls, finite nonnegative timings, and zero cleanup counts. Add `test:database-recovery-receipt`, `proof:database-recovery` and `verify:database-recovery` scripts.

- [ ] **Step 4: Run the verifier tests**

Run: `pnpm test:database-recovery-receipt`

Expected: every valid/mutation case passes.

- [ ] **Step 5: Commit**

Run: `git add package.json scripts/verify-database-recovery-receipt.mjs scripts/verify-database-recovery-receipt.test.mjs && git commit -s -m "test: define database recovery receipt"`

### Task 2: Physical recovery proof

**Files:**
- Create: `scripts/database-recovery-receipt.mjs`
- Create: `scripts/database-recovery-fixture.ts`
- Test: `scripts/verify-database-recovery-receipt.test.mjs`

**Interfaces:**
- Consumes: `verifyDatabaseRecoveryReceipt(receipt)` from Task 1 and existing registration, installation, email-worker and account-server interfaces.
- Produces: `/tmp/waitron-cloud-database-recovery-receipt.json` and a verified one-line result.

- [ ] **Step 1: Extend the receipt test with runner-source invariants**

Assert that the runner pins `postgres:18-alpine`, creates distinct migration/runtime/replication roles, uses `pg_basebackup`, waits for replay, stops the primary, promotes the standby, drives both packaged service CLIs and cleans exact resource names.

- [ ] **Step 2: Run the source-contract test to verify it fails**

Run: `pnpm test:database-recovery-receipt`

Expected: FAIL because the runner and fixture do not exist.

- [ ] **Step 3: Implement the fixture and runner**

The fixture seeds two signed installations and one encrypted password-change notification, or claims and blocks that notification using `EmailWorker`. The runner owns Docker startup, role creation, migrations and grants, base backup, standby start, log replay checks, response-dropping operation request, primary interruption, promotion, exact retry, lease and isolation requests, claim expiry/recovery through Mailpit, receipt writing, verification and `finally` cleanup.

- [ ] **Step 4: Run the real proof**

Run: `pnpm proof:database-recovery`

Expected: the receipt verifies, the confirmed replay lag is zero, all behavior flags are true and cleanup counts are zero.

- [ ] **Step 5: Re-run fast tests and typecheck**

Run: `pnpm test:database-recovery-receipt && pnpm typecheck`

Expected: both commands pass.

- [ ] **Step 6: Commit**

Run: `git add scripts/database-recovery-receipt.mjs scripts/database-recovery-fixture.ts scripts/verify-database-recovery-receipt.test.mjs && git commit -s -m "test: exercise database recovery"`

### Task 3: Operator guidance and backlog

**Files:**
- Create: `docs/database-recovery.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: the version-1 receipt and measured proof from Task 2.
- Produces: the runnable local operator procedure and precise remaining production gates.

- [ ] **Step 1: Write the documentation**

Explain how to run and verify the drill, what each generated role can do, how to read the replay and timing fields, why application secrets are not recovered from PostgreSQL, and which provider, automation, credential-custody, incompatible-schema and objective decisions remain open.

- [ ] **Step 2: Update the matching backlog entries**

Replace the stale database-recovery gaps under venue registration and operations with the exact local evidence. Keep production database recovery and failover explicitly open.

- [ ] **Step 3: Run focused documentation and behavior checks**

Run: `pnpm test:database-recovery-receipt && pnpm proof:database-recovery && pnpm typecheck && git diff --check`

Expected: all commands pass, the new receipt verifies, and the diff has no whitespace errors.

- [ ] **Step 4: Commit**

Run: `git add docs/database-recovery.md docs/backlog.md && git commit -s -m "docs: explain database recovery drill"`

### Task 4: Finish the branch

**Files:**
- Inspect: every changed path against this plan and the design.

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: a clean signed-off branch ready for the repository finish and land workflows.

- [ ] **Step 1: Check plan coverage and branch state**

Run: `git status --short && git log --format='%h %s%n%(trailers:key=Signed-off-by)' origin/main..HEAD && git diff --check origin/main...HEAD`

Expected: no unintended paths, every commit has a sign-off, and the diff check passes.

- [ ] **Step 2: Run the focused final gate**

Run: `pnpm test:database-recovery-receipt && pnpm proof:database-recovery && pnpm typecheck`

Expected: all commands pass on the final head.

- [ ] **Step 3: Run `finish-branch`**

Use the repository's Codex finish workflow, triage the isolated Claude run-it report, push the branch, open the pull request and wait for successful CI on the exact head.
