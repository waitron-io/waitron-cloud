# Cloud Usage Metering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record replay-safe, tenant-scoped Cloud usage measurements and show owner-only totals with honest freshness.

**Architecture:** Registration owns a fixed immutable usage ledger, a typed idempotent writer, a bounded source reconciler and passive owner summary reads. Durable backup, operation and alert records are reconciled; overwrite-in-place remote probe observations emit their event atomically. Account HTTP exposes one exact owner route and the existing portal adds a bilingual summary for the selected organisation.

**Tech Stack:** TypeScript, Node.js 26, PostgreSQL, Hono, Lit, Playwright, `node:test`, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-26-cloud-usage-metering-design.md`

## Global Constraints

- Usage is observational only; do not add pricing, allowances, quotas, invoice allocation or service blocking.
- Every event belongs to one organisation and has a fixed type, positive integer quantity and stable source identity.
- Identical retries return one stable event; a mismatched retry fails closed.
- Continuous-stream byte counts and account-level identity mail remain explicitly unmeasured.
- Reconciliation is bounded, serialised and advances freshness only after a source is caught up.
- Summary reads require a live session and current organisation-owner membership without extending activity.
- Do not store object keys, digests, hostnames, email addresses, message IDs, tokens, credentials, recovery keys or raw errors.
- Use real PostgreSQL tests, focused browser assertions and signed-off commits. Cloud CI owns the full workspace suite.

## Review Focus

- A reconciliation batch commits but its reply is lost; repeating it must return the same event IDs and totals.
- An existing event reuses a source identity with a different tenant, quantity or timestamp; the writer must reject it rather than hide corruption.
- A usage insert fails while reconciling; no partial events or newer freshness timestamp may remain.
- Ownership changes while a summary is reading; the current read must serialize and the next read must fail.
- Totals exceed JavaScript's safe integer range; the API and portal must preserve exact decimal strings.

---

### Task 1: Immutable ledger, idempotent writer and bounded reconciler

**Files:**
- Create: `packages/registration/migrations/025_usage_metering.sql`
- Create: `packages/registration/src/usage-metering.ts`
- Create: `packages/registration/src/usage-reconcile-cli.ts`
- Create: `packages/registration/test/usage-metering.test.ts`
- Modify: `packages/registration/src/migrate.ts`
- Modify: `packages/registration/src/index.ts`
- Modify: `packages/registration/test/registration.test.ts`
- Modify: `packages/registration/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: fixed `UsageEventType` and `UsageSourceKind` unions from the design.
- Produces: `recordUsageEvent(client: PoolClient, input: UsageEventInput): Promise<UsageEventReceipt>`.
- Produces: `new UsageReconciler(pool).runOnce(limit?: number): Promise<UsageReconciliationResult>` and `.status()`.
- Produces: `pnpm usage:reconcile --once` and `pnpm usage:reconcile --status`.

- [ ] **Step 1: Write failing migration, writer and reconciliation tests**

Create a real-PostgreSQL fixture with two organisations and venues. Import the missing usage API and assert:

```ts
const first = await transaction(pool, client => recordUsageEvent(client, {
  organisationId, venueId,
  type: 'backup.storage_added_bytes', quantity: 9007199254740993n,
  sourceKind: 'backup_point', sourceReference: pointId,
  occurredAt: '2026-09-26T10:00:00.000Z',
}));
const replay = await transaction(pool, client => recordUsageEvent(client, sameInput));
assert.equal(replay.id, first.id);
assert.equal(await count('usage_events'), 1);
```

Assert a changed tenant, venue, quantity or timestamp for the same key rejects with `usage_conflict`; direct `UPDATE` and `DELETE` fail; a foreign venue is rejected; invalid types, non-positive quantities, unsafe references and ambiguous timestamps are rejected. Update migration expectations from 24 to 25.

Seed source rows for backup points, restored snapshot recovery, installation operations and terminal service alerts. Run with `limit: 1`; assert each pass is bounded, repeated passes catch up, identical replay does not change totals and every required source receives `caught_up_at`. Add a constraint that rejects one event, assert the batch rolls back without advancing that source, remove it and assert the next run reconciles the exact missing event.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/usage-metering.test.ts test/registration.test.ts`

Expected: FAIL because migration 025 and the usage API do not exist and migration assertions still observe 24 rows.

- [ ] **Step 3: Implement the migration and typed writer**

Create checked `usage_events` columns for the fixed event/source kinds, `quantity bigint CHECK(quantity>0)`, organisation/venue references, occurrence/recording times and `UNIQUE(event_type,source_kind,source_reference)`. Add the organisation aggregation index and update/delete rejection trigger. Add `usage_reconciliation_sources` rows for `backup_points`, `backup_recoveries`, `installation_operations` and `service_alerts`, with nullable attempted/caught-up timestamps. Add nullable `backup_recoveries.restored_at`; new authenticated restored receipts populate it in Task 2.

Validate UUIDs, exact ISO timestamps, source-reference length/characters and positive `bigint` quantities. Insert with `ON CONFLICT DO NOTHING`, lock/read the prior row and compare every immutable field before returning its original ID.

- [ ] **Step 4: Implement bounded source reconciliation and status**

Acquire `pg_try_advisory_xact_lock(hashtext(current_schema()), hashtext('cloud_usage_reconciliation'))`. For each required source, select at most `limit` missing fixed events in deterministic `(occurred_at, source_reference, event_type)` order and pass them through `recordUsageEvent`. Set `last_attempted_at` for a successful source scan and set `caught_up_at` only when fewer than `limit` candidates were returned. Keep the batch in one transaction so an exception rolls back events and timestamps.

Use these source mappings:

```ts
backup_points snapshot publish -> storage_added_bytes + upload_bytes at captured_at
backup_points deleted_at       -> storage_removed_bytes at deleted_at
backup_recoveries restored_at  -> restore_bytes using joined point.size
installation_operations        -> installation_completed quantity 1
service_alert_deliveries        -> one terminal outcome from email_outbox.status
```

The CLI accepts only `--once` or `--status`, checks all migrations, uses a two-connection pool, prints JSON and redacts database errors.

- [ ] **Step 5: Run the focused tests to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/usage-metering.test.ts test/registration.test.ts`

Expected: PASS with 25 applied migrations, stable event receipts, bounded source passes, rollback on failure and truthful reconciliation status.

- [ ] **Step 6: Commit the core ledger**

Run: `git add package.json packages/registration && git commit -s -m "feat: add replay-safe Cloud usage ledger"`

Expected: the signed-off commit succeeds.

### Task 2: Source timestamps, atomic probe events and cleanup guards

**Files:**
- Modify: `packages/backups/src/recovery.ts`
- Modify: `packages/backups/test/recovery.test.ts`
- Modify: `packages/remote-access/src/probe-observations.ts`
- Modify: `packages/remote-access/test/probe-observations.test.ts`
- Modify: `packages/registration/src/history-cleanup.ts`
- Modify: `packages/registration/test/history-cleanup.test.ts`
- Modify: `packages/registration/test/usage-metering.test.ts`

**Interfaces:**
- Consumes: `recordUsageEvent` from Task 1.
- Produces: first-write `backup_recoveries.restored_at` for authenticated restored receipts.
- Produces: one `operation.monitoring_probe` event per accepted public/staff observation.
- Produces: cleanup eligibility that preserves a source row until its fixed usage events exist.

- [ ] **Step 1: Write failing source-boundary tests**

Extend recovery tests so `restored` sets `restored_at` once, a replay preserves the first timestamp and `read`/`info` never set it. Extend probe tests so one accepted result records two count-one events, the same result replay leaves two, an older observation leaves both observation and totals unchanged, and a deliberately rejected usage insert rolls back the observation update before a retry succeeds.

Extend cleanup tests with old installation operations, alert deliveries, restored recoveries and deleted backup points that lack usage rows. Assert cleanup reports them blocked and deletes none; reconcile, rerun cleanup and assert the original eligible rows can be removed while usage events remain.

- [ ] **Step 2: Run source tests to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/recovery.test.ts`

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/probe-observations.test.ts`

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/history-cleanup.test.ts test/usage-metering.test.ts`

Expected: FAIL because restored timestamps, probe usage events and cleanup guards are absent.

- [ ] **Step 3: Persist the first restored receipt and meter accepted probes**

Change the authenticated restored update to:

```sql
UPDATE backup_recoveries
SET status='restored', restored_at=COALESCE(restored_at,clock_timestamp())
WHERE id=$1
```

After each newer public/staff observation upsert reports `rowCount === 1`, call `recordUsageEvent` in the same transaction with quantity `1n`, venue organisation, the exact checked-at time and source reference `${installationId}:${service}:${checkedAt}`. Do not record ignored stale/replayed observations.

- [ ] **Step 4: Guard source cleanup until reconciliation**

Add `EXISTS` requirements for the source's exact event types before selecting an installation operation, terminal alert delivery, restored recovery or backup tombstone for deletion. Count missing events as blocked work in the existing cleanup report instead of silently deleting their only reconciliation source.

- [ ] **Step 5: Run source tests to verify GREEN**

Repeat the three RED commands.

Expected: PASS with one restored timestamp, exact probe events and cleanup blocked only until reconciliation.

- [ ] **Step 6: Commit source integration**

Run: `git add packages/backups packages/remote-access packages/registration && git commit -s -m "feat: reconcile usage from Cloud services"`

Expected: the signed-off commit succeeds.

### Task 3: Passive owner summary and HTTP boundary

**Files:**
- Create: `packages/account-http/src/usage.ts`
- Create: `packages/account-http/test/usage.test.ts`
- Modify: `packages/account-http/src/app.ts`
- Modify: `packages/registration/src/usage-metering.ts`
- Modify: `packages/registration/test/usage-metering.test.ts`

**Interfaces:**
- Produces: `new UsageStore(pool).summary(token, {organisationId}): Promise<UsageSummary>`.
- Produces: `POST /api/account/usage/read` with exact input `{organisationId}`.
- Produces: a version-1 response whose numeric totals are decimal strings and whose timestamps are ISO strings or `null`.

- [ ] **Step 1: Write failing summary and HTTP tests**

Seed both tenants with every fixed event type, including a quantity above `Number.MAX_SAFE_INTEGER`. Assert the store returns only the requested organisation, exact decimal strings, current storage as additions minus removals, grouped message outcomes, latest event time and `measuredThrough: null` until all required sources have caught up. Assert reads leave `cloud_sessions.last_seen_at` unchanged and deny a lost-owner membership.

At HTTP level assert POST, exact Origin, session and CSRF are required; unknown fields, malformed UUIDs and a foreign organisation are rejected; normal account rate limiting applies; and response JSON contains no source references or fixture secrets.

- [ ] **Step 2: Run owner/API tests to verify RED**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/usage-metering.test.ts`

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/usage.test.ts`

Expected: FAIL because the summary implementation and HTTP route do not exist.

- [ ] **Step 3: Implement the passive owner summary**

Resolve the session with `touch: false`, hold the matching `is_owner` membership `FOR SHARE`, aggregate only `organisation_id=$1`, convert every PostgreSQL bigint with `String`, and recheck the session before return. Compute `measuredThrough` as the minimum non-null `caught_up_at` only when every required source has one; otherwise return `null`.

- [ ] **Step 4: Implement the exact HTTP route**

Follow the security-audit route pattern: exact path `/api/account/usage/read`, POST only, exact portal Origin, exact one-field body, secure session cookie, CSRF, passive identity resolution for the account-scoped allowance and `UsageStore.summary`. Map invalid input to 400, absent/currently revoked ownership to 403 and unexpected failures to the existing redacted 503.

- [ ] **Step 5: Run owner/API tests and affected types to verify GREEN**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/usage-metering.test.ts`

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/usage.test.ts test/server.test.ts test/rate-limit.test.ts`

Run: `pnpm --filter @waitron-cloud/registration --filter @waitron-cloud/backups --filter @waitron-cloud/remote-access --filter @waitron-cloud/account-http typecheck`

Expected: all commands PASS.

- [ ] **Step 6: Commit the owner API**

Run: `git add packages/registration packages/account-http && git commit -s -m "feat: expose owner-scoped usage totals"`

Expected: the signed-off commit succeeds.

### Task 4: Bilingual portal, operator documentation and backlog closure

**Files:**
- Create: `apps/portal/src/usage-types.ts`
- Create: `apps/portal/src/usage-controller.ts`
- Create: `apps/portal/src/usage-screen.ts`
- Create: `apps/portal/test/usage-controller.test.ts`
- Create: `apps/portal/test/usage-browser.test.ts`
- Create: `docs/usage-metering.md`
- Modify: `apps/portal/src/app.ts`
- Modify: `apps/portal/src/screens.ts`
- Modify: `apps/portal/src/locale.ts`
- Modify: `apps/portal/src/styles.css`
- Modify: `apps/portal/test/accessibility.test.ts`
- Modify: `packages/registration/README.md`
- Modify: `packages/account-http/README.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: version-1 usage summary from Task 3 and `InstallationController.selectedOrganisation`.
- Produces: `UsageController.account`, `.organisation`, `.load` and a read-only account usage section.

- [ ] **Step 1: Write failing controller and browser tests**

Controller tests must prove one load per selected organisation, generation fencing after account/organisation switches, retry-after handling and exact preservation of large decimal strings. Browser tests must seed totals and assert English/Spanish labels, byte formatting, message outcome separation, fresh/not-yet-measured copy, excluded continuous-stream/identity-mail explanation, organisation isolation and keyboard/accessibility behavior.

- [ ] **Step 2: Run portal tests to verify RED**

Run: `pnpm --dir apps/portal exec node --test test/usage-controller.test.ts test/usage-browser.test.ts`

Expected: FAIL because the usage controller and screen do not exist.

- [ ] **Step 3: Implement the portal section**

Add a controller following existing passive read controllers. Synchronise it whenever installation loading or organisation selection changes. Render semantic definition lists for current snapshot storage, uploaded/restored bytes, completed operations/probes and sent/failed/expired/cancelled alerts. Format bytes from `BigInt` without converting the stored decimal to `Number`; render exact whole-byte fallback text for values beyond the formatter's safe range. Show a `<time>` for `measuredThrough`, a distinct pending measurement message when null and the two explicit exclusions.

- [ ] **Step 4: Document operation and close the backlog item**

Document event meanings, exclusions, one-pass/status CLI commands, scheduling responsibility, freshness semantics, retry/conflict behavior, cleanup ordering and absence of billing/enforcement. Update only the Usage metering and matching monitoring/API usage backlog text with the local proof and exact production follow-ups.

- [ ] **Step 5: Verify portal, focused services and documentation**

Run: `pnpm --dir apps/portal test`

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/usage-metering.test.ts test/history-cleanup.test.ts`

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/recovery.test.ts`

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/probe-observations.test.ts`

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/usage.test.ts`

Run: `pnpm typecheck`

Expected: all commands PASS with no warnings or unhandled rejections.

- [ ] **Step 6: Inspect the rendered portal**

Run the existing local portal fixture with seeded English and Spanish usage data. Inspect desktop 1280 px and phone 390 px widths in light and dark themes. Confirm no horizontal overflow, clipped totals, raw identifiers, source references or secrets; preserve screenshots or browser assertions as the visual receipt.

- [ ] **Step 7: Commit the portal and documentation**

Run: `git add apps/portal docs packages/account-http packages/registration && git commit -s -m "feat: show measured Cloud usage"`

Expected: the signed-off commit succeeds and `git status --short` is empty.
