# Cloud History Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly configured, dry-run-first, resumable cleanup runner for transient Cloud management history.

**Architecture:** `HistoryCleanup` owns validated policy parsing and one dependency-aware PostgreSQL cleanup query per category. Each apply query selects a stable bounded batch with row locks, repeats its safety predicate during deletion, and returns a machine-readable report. A thin CLI loads the policy, verifies migrations, and requires `--apply` before mutation.

**Tech Stack:** TypeScript, Node.js 24, PostgreSQL, `node:test`, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-26-cloud-history-cleanup-design.md`

## Global Constraints

- Do not choose retention periods. Every category is disabled unless its exact RFC 3339 cutoff is present in the operator policy.
- Dry run is the default. Only `--apply` may delete rows.
- Process 1 through 1,000 rows per enabled category and invocation.
- Preserve active authority, pending work, replay guarantees within the configured window, current incidents, failed retryable jobs, active recovery, protected snapshots and referenced rows.
- Use real PostgreSQL tests and signed-off commits. Do not edit fiscal data or golden results.

## Review Focus

- A row changes from terminal to live or becomes referenced while cleanup is selecting it; the repeated predicate must preserve it.
- A session has an unconsumed live registration ceremony; session cleanup must not cascade it.
- A token request has pending encrypted email; request cleanup must leave both rows available to the worker.
- A closed recovery still has replacement or request references; dependency cleanup must be atomic and ordered.
- A deleted snapshot is the venue's last verified snapshot; physical row cleanup must preserve it.

---

### Task 1: Policy parser, report contract and cleanup indexes

**Files:**
- Create: `packages/registration/src/history-cleanup.ts`
- Create: `packages/registration/migrations/021_history_cleanup.sql`
- Modify: `packages/registration/src/migrate.ts`
- Modify: `packages/registration/src/index.ts`
- Test: `packages/registration/test/history-cleanup.test.ts`
- Test: `packages/registration/test/registration.test.ts`
- Test: `packages/registration/test/pairing.test.ts`
- Test: `packages/account-http/test/rate-limit.test.ts`
- Test: `packages/account-http/test/server.test.ts`

**Interfaces:**
- Produces: `parseHistoryCleanupPolicy(value: unknown): HistoryCleanupPolicy` and `HistoryCleanup.run(policy, {apply}): Promise<HistoryCleanupReport>`.
- Produces: category report entries `{cutoff, eligible, blocked, deleted, hasMore}`.

- [ ] **Step 1: Write the failing policy and migration tests**

Add table-driven assertions that reject unknown keys, non-string or timezone-free cutoffs, invalid dates and chunk sizes outside 1 through 1,000. Assert that a valid subset leaves every omitted category disabled. Update migration-count and production migration-gate expectations from 20 to 21.

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/history-cleanup.test.ts test/registration.test.ts test/pairing.test.ts`

Expected: FAIL because the cleanup module and migration 021 do not exist and migration counts remain 20.

- [ ] **Step 3: Implement policy validation, report types and indexes**

Create the ten-key category union, exact-object parser, strict timezone-bearing timestamp validation, immutable parsed policy, and report interfaces. Add migration 021 indexes for the cutoff and status predicates, register it in `migrate.ts`, and export the cleanup API.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/history-cleanup.test.ts test/registration.test.ts test/pairing.test.ts`

Expected: PASS with 21 applied migrations and all parser cases green.

### Task 2: Identity, registration, delivery and operation cleanup

**Files:**
- Modify: `packages/registration/src/history-cleanup.ts`
- Modify: `packages/registration/test/history-cleanup.test.ts`

**Interfaces:**
- Consumes: validated cutoffs and report contract from Task 1.
- Produces: cleanup handlers for sessions, signup requests, password-reset requests, WebAuthn ceremonies, pairing requests, registration operations and email deliveries.

- [ ] **Step 1: Write failing real-PostgreSQL behavior tests**

Insert old and recent rows with live sessions, live registration ceremonies, pending email, terminal email, completed and expired requests, current incident delivery references and idempotent operation results. Assert dry-run leaves every row, apply removes only safe old rows, and terminal service-delivery dependencies are removed with their outbox rows.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/history-cleanup.test.ts`

Expected: FAIL because the seven category handlers report no deletions.

- [ ] **Step 3: Implement the seven handlers**

Use category-scoped transactions, advisory locks, stable candidate ordering, `FOR UPDATE SKIP LOCKED`, repeated eligibility predicates and dependency-first deletes. Compute blocked counts for old rows withheld by live ceremonies or pending email.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/history-cleanup.test.ts`

Expected: PASS with exact eligible, blocked and deleted counts.

### Task 3: Backup jobs, recovery history, tombstones and restart races

**Files:**
- Modify: `packages/registration/src/history-cleanup.ts`
- Modify: `packages/registration/test/history-cleanup.test.ts`

**Interfaces:**
- Consumes: category transaction and reporting helpers from Task 2.
- Produces: cleanup handlers for completed backup jobs, closed recovery history and deleted backup tombstones.

- [ ] **Step 1: Write failing PostgreSQL tests for dependency order and races**

Create a venue with pending, running, failed and completed jobs; active and closed recoveries; an incomplete and completed replacement; a deleted point with verifications; and a protected latest verified snapshot. Hold an eligible row lock from a second pool. Assert one-row chunks resume after restart, locked rows are skipped, active or referenced rows survive, and dependency rows disappear before their parent.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/history-cleanup.test.ts`

Expected: FAIL because backup categories report no deletions.

- [ ] **Step 3: Implement backup handlers**

Delete only completed jobs past the cutoff. For closed expired recovery operations, delete the approved request and completed replacement before the operation in one transaction. For tombstones, delete verification rows and completed verify jobs, then the already-deleted unreferenced non-protected point and its cleaned capture when unreferenced.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/history-cleanup.test.ts`

Expected: PASS, including restart, foreign-key and row-lock assertions.

### Task 4: CLI, operator documentation and backlog closure

**Files:**
- Create: `packages/registration/src/history-cleanup-cli.ts`
- Create: `docs/history-cleanup.md`
- Modify: `packages/registration/package.json`
- Modify: `package.json`
- Modify: `packages/registration/README.md`
- Modify: `docs/backlog.md`
- Modify: `packages/registration/test/history-cleanup.test.ts`

**Interfaces:**
- Consumes: `parseHistoryCleanupPolicy` and `HistoryCleanup.run`.
- Produces: `pnpm history:cleanup -- --policy <path> [--apply]` and its schema-v1 JSON receipt.

- [ ] **Step 1: Write failing CLI tests**

Run the CLI against the disposable test schema with a temporary policy file. Assert default dry-run output and unchanged rows, explicit apply deletion, migration refusal, unreadable or malformed policy failure, and no secrets or row contents in stderr.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/history-cleanup.test.ts`

Expected: FAIL because the CLI and package scripts do not exist.

- [ ] **Step 3: Implement the CLI and documentation**

Load the JSON policy from `--policy`, require `DATABASE_URL`, verify the schema migration ledger, invoke dry-run unless `--apply` is present, and print one JSON report. Document a runnable policy, repeat-until-complete operation, category inventory and rollback limitation. Update the four named backlog areas with the implemented boundary and leave legal retention and audit retention decisions open.

- [ ] **Step 4: Verify focused behavior and types**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/history-cleanup.test.ts`

Run: `pnpm --filter @waitron-cloud/registration typecheck`

Expected: both commands PASS.

- [ ] **Step 5: Commit the implementation**

Run: `git add packages/registration package.json docs/history-cleanup.md docs/backlog.md docs/superpowers && git commit -s -m "feat: add bounded cloud history cleanup"`

Expected: signed-off commit succeeds and the worktree is clean.
