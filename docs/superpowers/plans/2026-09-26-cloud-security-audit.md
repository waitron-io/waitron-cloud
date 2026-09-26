# Cloud Customer Security Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record customer security decisions atomically and expose a stable owner-scoped JSON audit export.

**Architecture:** A checked, immutable PostgreSQL event table and typed `recordSecurityAuditEvent` writer live in registration, the package that owns the management schema and transaction helper. Existing registration and backup actions call the writer inside their current transactions. `SecurityAuditStore` performs passive owner-authorized cursor reads, and account HTTP exposes it through one exact POST route.

**Tech Stack:** TypeScript, Node.js 24, PostgreSQL, Hono, `node:test`, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-26-cloud-security-audit-design.md`

## Global Constraints

- Record only the six fixed event types from the spec; do not add arbitrary payload or detail storage.
- Events commit or roll back in the same transaction as the action they describe.
- Stable retries produce exactly one immutable event; conflicting reuse fails closed.
- Read access requires a live session and current `is_owner` membership for the named organisation.
- Do not extend session activity during an audit read.
- Audit retention is separate from transient cleanup; do not add a deletion command or cutoff.
- Do not store or return codes, tokens, public keys, leases, credentials, recovery keys or raw errors.
- Use real PostgreSQL tests and signed-off commits. Cloud CI owns the full workspace suite.

## Review Focus

- A repeated or concurrent successful action races at the unique source key; both callers must get one unchanged event.
- An action fails after its primary update but before commit; neither the action nor event may remain.
- Ownership changes while an export is reading; the read must serialize on current membership and the next read must fail.
- Multiple events share one timestamp; cursor pagination must return every event exactly once.
- A caller accidentally supplies request material; the fixed writer contract and schema must make storing it impossible.

---

### Task 1: Immutable audit schema, writer and owner page

**Files:**
- Create: `packages/registration/migrations/022_security_audit.sql`
- Create: `packages/registration/src/security-audit.ts`
- Create: `packages/registration/test/security-audit.test.ts`
- Modify: `packages/registration/src/migrate.ts`
- Modify: `packages/registration/src/index.ts`
- Modify: `packages/registration/test/registration.test.ts`
- Modify: `packages/registration/test/pairing.test.ts`
- Modify: `packages/account-http/test/rate-limit.test.ts`
- Modify: `packages/account-http/test/server.test.ts`

**Interfaces:**
- Produces: `SecurityAuditEventType`, `SecurityAuditActorKind`, `SecurityAuditSubjectKind` fixed unions.
- Produces: `recordSecurityAuditEvent(client: PoolClient, input: SecurityAuditInput): Promise<{id: string; occurredAt: string}>`.
- Produces: `new SecurityAuditStore(pool).page(token, {organisationId, limit, cursor?}): Promise<SecurityAuditPage>`.
- Produces: page event fields `id`, `occurredAt`, `organisationId`, `venueId`, `type`, `actorKind`, `actorId`, `subjectKind`, `subjectId`; response fields `version: 1`, `events`, `nextCursor`.

- [ ] **Step 1: Write failing schema and store tests**

Add real-PostgreSQL tests that import the missing audit API, assert one inserted event has only the fixed fields, assert an identical insert returns the same UUID, assert a mismatched duplicate rejects, assert transaction rollback removes the event, and assert direct `UPDATE` and `DELETE` fail. Add owner/foreign/non-owner fixtures and events with an equal timestamp; assert newest-first pages of limit two return all IDs once, do not change `last_seen_at`, and deny lost ownership. Update migration expectations from 21 to 22 and the production migration-gate list with `022_security_audit.sql`.

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/security-audit.test.ts test/registration.test.ts test/pairing.test.ts`

Expected: FAIL because `security-audit.ts`, migration 022 and the new exports do not exist, and migration assertions still observe 21 rows.

- [ ] **Step 3: Implement schema, typed writer and page store**

Create the checked table, `(event_type, source_id)` unique constraint, organisation/time index, and update/delete rejection trigger. Implement exact UUID/kind inputs, `INSERT ... ON CONFLICT DO NOTHING`, locked read-back and field-for-field conflict verification. Encode cursors as canonical base64url JSON `[occurredAt,id]`, validate their exact shape, fetch `limit + 1`, and hold the `is_owner` membership with `FOR SHARE` while reading organisation-filtered rows.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/security-audit.test.ts test/registration.test.ts test/pairing.test.ts`

Expected: PASS with 22 applied migrations and all writer, immutability, rollback, owner and pagination cases green.

### Task 2: Record pairing, credential and revocation events

**Files:**
- Modify: `packages/registration/src/pairing.ts`
- Modify: `packages/registration/src/installations.ts`
- Modify: `packages/registration/test/pairing.test.ts`
- Modify: `packages/registration/test/installations.test.ts`

**Interfaces:**
- Consumes: `recordSecurityAuditEvent` from Task 1.
- Produces: pairing Cloud/local approval, credential renewal and account/machine revocation events with the source IDs defined by the spec.

- [ ] **Step 1: Write failing action-boundary tests**

Extend the existing real-store tests. Pairing approval must add one `pairing.cloud_approved` row; completion must add one `pairing.local_approved` row; repeating either action must keep the original IDs. Renewal must add one `installation.credentials_renewed` row per operation ID. Account and machine revocation must each record the correct actor kind and exactly one row. Existing expiry, stale-session and permission-failure tests must assert no corresponding event remains.

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/pairing.test.ts test/installations.test.ts`

Expected: FAIL because successful actions currently create no security audit rows.

- [ ] **Step 3: Insert events inside existing transactions**

Record Cloud pairing approval after the bound approval update, local approval after the trusted local receipt is accepted during completion, renewal before its durable operation result commits, and revocation beside the existing revocation record. Derive organisation and venue IDs from rows locked by the action; never copy request bodies, codes, keys or result JSON.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/pairing.test.ts test/installations.test.ts`

Expected: PASS with exact event counts and unchanged action/replay behavior.

### Task 3: Record recovery and replacement approvals

**Files:**
- Modify: `packages/backups/src/recovery-request.ts`
- Modify: `packages/backups/src/replacement.ts`
- Modify: `packages/backups/test/recovery-request.test.ts`
- Modify: `packages/backups/test/replacement.test.ts`

**Interfaces:**
- Consumes: `recordSecurityAuditEvent` from Task 1.
- Produces: `recovery.approved` and `replacement.approved` rows committed with their existing owner-authorized actions.

- [ ] **Step 1: Write failing recovery tests**

Assert concurrent/repeated recovery approval leaves one event with the approving account and venue organisation. Assert rejected code, missing confirmation, changed ownership and an expiry while waiting leave no event. Assert replacement completion leaves one event, its concurrent replay keeps the same event ID, and the existing verified-snapshot rollback test leaves no replacement event.

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/recovery-request.test.ts test/replacement.test.ts`

Expected: FAIL because recovery and replacement transactions do not yet append security events.

- [ ] **Step 3: Insert events inside backup transactions**

Record recovery approval after `BackupRecovery.start` has created or validated the bound operation and before the request transaction commits. Record replacement approval after the completed result is stored and final current/session checks pass. Use the current recovery venue and organisation plus the resolved account; do not store snapshot, stream, key or confirmation payloads.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/recovery-request.test.ts test/replacement.test.ts`

Expected: PASS with exactly one event for each successful approval and zero after rejected/rolled-back actions.

### Task 4: Owner HTTP export, documentation and backlog closure

**Files:**
- Create: `packages/account-http/src/security-audit.ts`
- Create: `packages/account-http/test/security-audit.test.ts`
- Create: `docs/security-audit.md`
- Modify: `packages/account-http/src/app.ts`
- Modify: `packages/account-http/README.md`
- Modify: `packages/registration/README.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `SecurityAuditStore.page` from Task 1.
- Produces: `POST /api/account/security-audit/read` with exact JSON input `{organisationId, cursor?, limit?}` and schema-versioned JSON output.

- [ ] **Step 1: Write failing HTTP tests**

Create two organisations and event pages through the real app. Assert the route requires POST, exact Origin, session and CSRF; rejects unknown fields, invalid UUID/cursor and limits outside 1 through 100; returns only the owner's organisation; denies a non-owner after membership change; and produces JSON containing none of the fixture's code, token, public key or credential strings.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/security-audit.test.ts`

Expected: FAIL with `404 not_found` because the route is not registered.

- [ ] **Step 3: Implement route and documentation**

Parse a bounded exact JSON object, require portal Origin and CSRF, resolve the session through `SecurityAuditStore`, apply the existing account rate allowance, and return its page unchanged. Document the event inventory, local-authority-reference limitation, cursor use, privacy boundary, immutability and absence of a retention policy. Update the identity, registration approval and recovery audit backlog text to name what is covered and what remains outside this operational trail.

- [ ] **Step 4: Verify focused behavior and affected types**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/security-audit.test.ts test/pairing.test.ts test/installations.test.ts`

Run: `pnpm --filter @waitron-cloud/registration --filter @waitron-cloud/backups --filter @waitron-cloud/account-http typecheck`

Expected: both commands PASS.

- [ ] **Step 5: Commit the implementation**

Run: `git add packages docs && git commit -s -m "feat: add customer security audit history"`

Expected: signed-off commit succeeds and the worktree is clean.
