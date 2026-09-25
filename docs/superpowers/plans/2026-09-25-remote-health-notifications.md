# Remote Health Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show revision-current remote route evidence in the portal and send opt-in bilingual incident and recovery email through the existing encrypted queue.

**Architecture:** Extend the current installation overview with redacted public/staff probe facts and render them beside the durable incident state. Make the six D2 remote incident kinds notifiable through the current transition, delivery and permission-recheck path, carrying only check and certificate timestamps as evidence.

**Tech Stack:** Node.js 24, TypeScript, PostgreSQL, Lit, Playwright, Mailpit, `node:test`, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-25-remote-health-notifications-design.md`

## Global Constraints

- Do not edit Waitron, deploy infrastructure or send live customer mail.
- Reuse `venue_incidents`, `service_alert_deliveries`, `email_outbox` and account alert preferences; add no second alert framework.
- Expose no hostname, certificate fingerprint, internal address, route secret, raw probe error or internal exception.
- Stale or missing probe evidence is unknown, never healthy.
- Recheck owner permission, opt-in state, current installation, service and route immediately before transport.
- Every production behavior starts with an observed failing test.

## Review Focus

- A failed public route while installation contact remains fresh appears as a public-route problem, not a disconnected venue.
- An old monitor check or open probe-stale incident cannot render a prior success as healthy.
- Route removal, revocation, opt-out or ownership loss after enqueue cancels transport.
- Recovery reaches only recipients whose matching opening was accepted, without duplicate transition mail.
- Responses and messages cannot carry another venue's evidence or D2's raw failure/fingerprint fields.

---

### Task 1: Redacted remote evidence in the account API

**Files:**
- Modify: `packages/account-http/src/venue-overview.ts`
- Modify: `packages/account-http/test/installations.test.ts`

**Interfaces:**
- Consumes: current installation revision, `remote_probe_observations`, active placement/hostnames and open `venue_incidents`.
- Produces: `monitoring.remoteChecks.public|staff` with `status`, `checkedAt` and `certificateNotAfter`, plus the six remote incident kinds.

- [ ] Add an installation HTTP test that inserts current public/staff observations and remote incidents, asserts the redacted response, then proves a foreign account cannot read it.
- [ ] Run `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/installations.test.ts` and verify the missing remote evidence fails.
- [ ] Extend the scoped overview query and response mapping with current-revision observations and service-gated remote incidents.
- [ ] Re-run the focused test to green and commit the slice with sign-off.

### Task 2: Portal failure, unknown and recovery presentation

**Files:**
- Modify: `apps/portal/src/installation-types.ts`
- Modify: `apps/portal/src/alert-screen.ts`
- Modify: `apps/portal/src/locale.ts`
- Modify: `apps/portal/test/monitoring-browser.test.ts`
- Modify: `apps/portal/test/installation-controller.test.ts`

**Interfaces:**
- Consumes: the Task 1 `monitoring.remoteChecks` and incident union.
- Produces: bilingual public/staff status, check time, certificate expiry and self-service next steps.

- [ ] Add type-validation tests for the new exact incident/evidence union and rejection of malformed or extra-state values.
- [ ] Extend the real browser fixture to show a failed public route, healthy staff route, stale unknown state, certificate warning and later recovery in English and Spanish.
- [ ] Run the focused controller/browser tests and verify they fail because the response validator and copy do not support remote evidence.
- [ ] Add the minimal types, rendering and translated copy; keep raw failure and fingerprint data out of the type.
- [ ] Re-run the focused tests, accessibility checks and phone overflow assertions to green, then commit with sign-off.

### Task 3: Remote incident and recovery email

**Files:**
- Modify: `packages/registration/src/service-alert.ts`
- Modify: `packages/registration/src/monitoring.ts`
- Modify: `packages/registration/src/email-outbox.ts`
- Modify: `packages/registration/src/account-mail.ts`
- Modify: `packages/registration/test/service-alert.test.ts`
- Modify: `packages/registration/test/monitoring.test.ts`

**Interfaces:**
- Consumes: all remote incident transitions and their current observation.
- Produces: validated `ServiceAlert` payloads with optional `checkedAt` and `certificateNotAfter`, plus route-specific English/Spanish mail.

- [ ] Add payload/rendering tests for all six remote kinds, both languages, timestamp evidence and rejection of malformed evidence.
- [ ] Add PostgreSQL tests that assert open/recovery enqueueing, one message per revision, recovery only after accepted opening, and cancellation after opt-out, ownership loss, route removal or revocation.
- [ ] Run the focused registration tests and verify remote incidents produce no messages.
- [ ] Make remote kinds notifiable, attach only bounded timestamp evidence, and update the live delivery query to require the matching active service and route.
- [ ] Re-run service-alert, monitoring and email-outbox tests to green, then commit with sign-off.

### Task 4: Mailpit/browser proof and operator documentation

**Files:**
- Modify: `apps/portal/test/monitoring-browser.test.ts`
- Modify: `docs/local-monitoring.md`
- Modify: `docs/local-remote-access.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a local Mailpit receipt, desktop/phone screenshots in both themes, runnable behavior documentation and a narrowed backlog entry.

- [ ] Extend the browser journey so Mailpit captures a remote opening and recovery in both languages, then prove opt-out and revocation suppress later delivery.
- [ ] Run the focused portal test through `scripts/test-postgres.mjs` with Mailpit and verify every asserted message and screen state.
- [ ] Inspect English/Spanish at desktop and phone widths in light and dark themes, save screenshots under ignored `apps/portal/dist`, and run axe/overflow assertions.
- [ ] Document remote portal evidence, alert opt-in/deduplication/suppression, local commands and remaining live-provider limits; narrow the Service monitoring backlog entry.
- [ ] Run focused package tests and typechecks, inspect the diff, run guard-deletion controls for stale-to-unknown and delivery authority, and commit with sign-off.
- [ ] Run `finish-branch`, resolve findings, push, wait for exact-head CI, land under the shared lock and verify exact-merge CI.

