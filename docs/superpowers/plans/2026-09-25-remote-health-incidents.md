# Remote Health Incidents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist revision-bound remote probe evidence and classify route, stale-probe and certificate-expiry transitions in the existing durable monitor.

**Architecture:** Remote access validates and stores probe output under installation locks. Registration reads only current evidence while holding its existing venue monitor lock and writes non-notifying incident transitions. The probe CLI awaits storage; D3 remains responsible for portal copy and alert delivery.

**Tech Stack:** Node.js 24, TypeScript, PostgreSQL, `node:test`, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-25-remote-health-incidents-design.md`

## Global Constraints

- Do not edit Waitron or create live infrastructure.
- Old route results must not overwrite a replacement, hostname change or revocation.
- Missing or stale evidence is unknown, never healthy.
- Preserve existing contact and snapshot incident behavior and tests.
- Do not enqueue the new incident kinds for customer email; D3 owns notifications.
- Every production behavior starts with an observed failing test.

## Review Focus

- A failed result after a prior success retains certificate and last-success evidence while current state becomes failed.
- Results at or before the stored timestamp cannot roll state backward.
- A revision or hostname changed while a probe was running rejects the late result.
- A fresh route failure opens even while `last_contact_at` remains current.
- Expired certificates remain distinguishable from merely expiring certificates through `not_after`.

---

### Task 1: Revision-fenced probe evidence

**Files:**
- Create: `packages/registration/migrations/017_remote_probe_observations.sql`
- Create: `packages/remote-access/src/probe-observations.ts`
- Create: `packages/remote-access/test/probe-observations.test.ts`
- Modify: `packages/registration/src/migrate.ts`
- Modify: `packages/registration/test/registration.test.ts`
- Modify: `packages/remote-access/package.json`

**Interfaces:**
- Consumes: `RemoteProbeResult` and the current installation/placement/hostname rows.
- Produces: `RemoteProbeObservationStore.record(result): Promise<boolean>` and current rows in `remote_probe_observations`.

- [ ] Write a PostgreSQL test that imports the missing store and asserts success/failure history, ordering, restart, concurrency, replacement and revocation behavior.
- [ ] Run it through `scripts/test-postgres.mjs` and record the expected missing-module failure.
- [ ] Add migration 017, register it, export the store, and implement the minimal locked upsert.
- [ ] Re-run the focused test and registration migration tests to green.
- [ ] Commit the evidence slice with sign-off.

### Task 2: Await persistence in the bounded runner

**Files:**
- Modify: `packages/remote-access/src/probe-runner.ts`
- Modify: `packages/remote-access/src/probe-cli.ts`
- Modify: `packages/remote-access/test/probe-runner.test.ts`

**Interfaces:**
- Consumes: `RemoteProbeObservationStore.record`.
- Produces: an awaitable `result` callback contract; the CLI completes a result only after its row commits.

- [ ] Add a runner test whose delayed result callback proves the run does not resolve early and whose rejection proves persistence failure is surfaced.
- [ ] Run the test and record the early-resolution or swallowed-rejection failure.
- [ ] Await the callback and wire the observation store into the CLI.
- [ ] Re-run remote-access tests and typecheck to green.
- [ ] Commit the runner slice with sign-off.

### Task 3: Durable remote incident classification

**Files:**
- Modify: `packages/registration/migrations/017_remote_probe_observations.sql`
- Modify: `packages/registration/src/monitoring.ts`
- Modify: `packages/registration/src/service-alert.ts`
- Modify: `packages/registration/src/monitor-cli.ts`
- Modify: `packages/registration/test/monitoring.test.ts`

**Interfaces:**
- Consumes: current `remote_probe_observations`, active placement, configuration revision and configured thresholds.
- Produces: public/staff route-failure, probe-stale and certificate-expiring incident transitions with email enqueue disabled.

- [ ] Add PostgreSQL tests for fresh failure/recovery with current contact, stale/absent evidence, certificate boundaries, suppression, concurrent workers and restart.
- [ ] Run the focused monitoring test and record the missing incidents.
- [ ] Add incident constraints/types, threshold validation and monitor classification with non-notifying transitions.
- [ ] Re-run monitoring and service-alert tests to green.
- [ ] Commit the monitoring slice with sign-off.

### Task 4: Operator documentation and completion gate

**Files:**
- Modify: `docs/local-monitoring.md`
- Modify: `docs/local-remote-access.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: the final CLI configuration and evidence/incident semantics.
- Produces: runnable local instructions and an accurate remaining-work ledger.

- [ ] Document defaults, environment variables, persistence, stale/unknown behavior and D3's notification boundary.
- [ ] Narrow the Service monitoring backlog entry to remaining work.
- [ ] Run focused PostgreSQL tests for remote access and monitoring, package typechecks, then the package suites required by the changed behavior.
- [ ] Inspect the diff, run mutation controls for the revision fence and stale-success guard, and commit with sign-off.
- [ ] Run `finish-branch`, resolve findings, push, wait for exact-head CI, then land under the shared lock and verify exact-merge CI.
