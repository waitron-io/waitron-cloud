# Temporary Customer-Approved Support Grants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a disabled-by-default durable support-grant core that preserves separate customer approval and platform eligibility, enforces expiry and revocation around protected database work, and records redacted customer audit events.

**Architecture:** Registration owns a new checked PostgreSQL grant table and `SupportGrantStore`. The store reuses customer sessions, organisation ownership and existing platform-permission rows, while configuration supplies the eligible permission names and exact grantable actions. Authorization wraps a caller callback in one transaction with before-and-after authority checks and fixed-shape security-audit events.

**Tech Stack:** TypeScript, Node.js 26, PostgreSQL 18, `node:test`, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-27-temporary-support-grants-design.md`

## Global Constraints

- Grant approval never creates an account or platform permission.
- Eligibility permissions and grantable actions default to empty and are exact configured identifiers.
- Do not add fixed staff roles, an emergency route, SSH, impersonation or an enabled production action.
- Approval, revocation, protected database work and their audit events share their respective transactions.
- Recheck wall-clock expiry, original approver ownership and platform eligibility after protected work.
- Audit exports omit reason text, action names, request parameters, callback results and secrets.
- Use real PostgreSQL tests and signed-off commits. Cloud CI owns the full workspace suite.

## Review Focus

- A caller uses the default empty configuration; approval and authorization must both fail closed.
- A grant waits on a row lock until after expiry; the callback must not commit.
- The original approver loses ownership while protected work is waiting; the work and audit event must roll back.
- A platform account loses its configured eligibility permission after approval; later access must fail.
- An organisation-wide grant is presented for a foreign organisation or a venue-specific grant for another venue; both must fail without revealing whether the grant exists.

---

### Task 1: Durable checked grant schema and fixed audit shapes

**Files:**
- Create: `packages/registration/migrations/026_support_grants.sql`
- Modify: `packages/registration/src/migrate.ts`
- Modify: `packages/registration/src/security-audit.ts`
- Modify: `packages/registration/test/security-audit.test.ts`
- Modify: migration-count consumers whose literal count is behavioral input

**Interfaces:**
- Produces: `support_grants` with immutable approval fields and one-way revocation fields.
- Produces: audit types `support.granted`, `support.revoked`, `support.accessed`; actor kind `platform_account`; subject kind `support_grant`.

- [ ] **Step 1: Write the failing schema and audit tests**

Add a real-PostgreSQL audit test that records each support event, reads it through `SecurityAuditStore.page`, and asserts the fixed response keys exclude `reason`, `actions`, `parameters`, `result`, tokens and fixture secret text. Extend migration assertions to expect `026_support_grants.sql` and 26 applied migrations.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/security-audit.test.ts test/registration.test.ts`

Expected: FAIL because migration 026 and the support audit unions do not exist.

- [ ] **Step 3: Implement the migration and audit shapes**

Create checked UUID foreign keys, a non-empty sorted distinct `text[]` action scope, bounded reason, `expires_at > created_at`, paired nullable revocation fields, and indexes for organisation and platform-account lookups. Extend the audit table checks with a migration-safe drop/re-add constraint and extend the TypeScript shape table with exact actor/subject/venue requirements.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/security-audit.test.ts test/registration.test.ts`

Expected: PASS with 26 migrations and only fixed redacted audit fields.

### Task 2: Approval, retry and early revocation

**Files:**
- Create: `packages/registration/src/support-grants.ts`
- Create: `packages/registration/test/support-grants.test.ts`
- Modify: `packages/registration/src/index.ts`

**Interfaces:**
- Produces: `SupportGrantConfig { eligibilityPermissions: readonly string[]; grantableActions: readonly string[] }`.
- Produces: `SupportGrantStore.approve(sessionToken, csrfToken, input): Promise<SupportGrant>`.
- Produces: `SupportGrantStore.revoke(sessionToken, csrfToken, grantId): Promise<SupportGrant>`.
- Produces: `SupportGrantError` with fixed codes `invalid_input`, `permission_denied`, `not_configured`, `grant_unavailable`, `grant_conflict`, `grant_expired`, `grant_revoked`.

- [ ] **Step 1: Write failing approval and revocation tests**

Use real accounts, sessions, organisations, venues and `platform_permissions`. Assert the default store rejects approval; configured approval requires an enabled existing platform account with a matching configured permission, current owner session/CSRF, tenant-bound venue, a future explicit expiry, a non-empty configured sorted scope and a bounded reason. Assert an identical UUID retry returns the original row, a changed retry conflicts, a foreign tenant cannot observe it, any current owner can revoke it once, and grant/revoke each append one audit event.

- [ ] **Step 2: Run the test to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/support-grants.test.ts`

Expected: FAIL because `SupportGrantStore` does not exist.

- [ ] **Step 3: Implement minimal approval and revocation**

Validate exact object keys and bounded identifiers. Resolve the session in the transaction, lock the owner membership, platform account and configured permission rows, use `clock_timestamp()` for expiry, insert or compare the complete immutable grant, and record `support.granted`. Revoke under a current-owner lock, set revocation fields only when absent, record `support.revoked`, and re-resolve the session before commit.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/support-grants.test.ts`

Expected: PASS with stable retries, tenant isolation and one-way revocation.

### Task 3: Transactional support authorization

**Files:**
- Modify: `packages/registration/src/support-grants.ts`
- Modify: `packages/registration/test/support-grants.test.ts`

**Interfaces:**
- Produces: `SupportGrantStore.authorize<T>(input, protectedAction: (client: PoolClient) => Promise<T>): Promise<T>`.
- Input fields: `grantId`, `platformAccountId`, `organisationId`, `venueId`, `action`, `operationId`.

- [ ] **Step 1: Write failing authorization tests**

Assert a matching configured grant commits a marker row and one `support.accessed` event. Assert replay with the same operation UUID preserves one event. Assert wrong identity/action/organisation/venue, removed action configuration, early revocation, disabled platform identity, removed eligibility and removed original-owner permission leave no marker. Hold the grant row past expiry and assert the callback never commits. Hold a callback-owned marker lock, remove the original approver's ownership before release, and assert the final recheck rolls back the marker and event.

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/support-grants.test.ts`

Expected: FAIL because `authorize` does not exist.

- [ ] **Step 3: Implement before-and-after enforcement**

Lock the grant, compare every bound field, check current configuration, query wall-clock validity, lock the enabled platform account plus a configured permission, and lock the original approver's enabled owner membership. Check wall time again immediately before running the callback, repeat wall-clock and both authority checks afterward, record the idempotent access audit event using a source identity bound to the grant, operation, action and requested venue, and commit only when all checks remain true.

- [ ] **Step 4: Run focused tests and mutation controls**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/support-grants.test.ts test/security-audit.test.ts`

Expected: PASS. In a disposable copy, remove the final approver recheck and run the changed-permission wait test; expected FAIL because the marker commits when it must roll back. Restore the disposable copy only.

### Task 4: Documentation, backlog and affected verification

**Files:**
- Modify: `packages/registration/README.md`
- Create: `docs/temporary-support-grants.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Documents: disabled defaults, configuration boundary, approval/revocation calls, transactional callback requirement, error meanings, audit redaction and deferred role/action/transport decisions.

- [ ] **Step 1: Document the runnable core and remaining boundary**

Show a TypeScript example with explicit eligibility permission and action configuration, approval, authorization and revocation. State that no route or production action uses the primitive yet. Update the Cloud staff access backlog entry to mark the grant core complete while retaining the platform role/action catalogue, eligible-approver policy, emergency route, SSH and active-session termination as open work.

- [ ] **Step 2: Verify focused behavior and affected types**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/support-grants.test.ts test/security-audit.test.ts test/registration.test.ts`

Run: `pnpm --filter @waitron-cloud/registration --filter @waitron-cloud/account-http typecheck`

Expected: both commands PASS.

- [ ] **Step 3: Commit the implementation**

Run: `git add packages docs scripts && git commit -s -m "feat: add temporary support grant core"`

Expected: the signed-off commit succeeds and the worktree is clean.
