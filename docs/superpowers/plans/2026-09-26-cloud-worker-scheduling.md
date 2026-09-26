# Cloud Worker Scheduling Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure Cloud worker scheduling and notification fan-out locally, then remove the observed scheduling and fan-out query amplification without changing durable worker semantics.

**Architecture:** A shared bounded worker loop separates the 60-second scheduling cadence from one-second idle polling and controls claim concurrency. The existing encrypted outbox gains an atomic bulk service-alert enqueue path. A real PostgreSQL fixture produces a verified JSON receipt for scheduling, polling, fan-out, delivery lag, memory, restart and shutdown.

**Tech Stack:** Node.js 24, TypeScript, PostgreSQL 18, `node:test`, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-26-cloud-worker-scheduling-design.md`

## Global Constraints

- Keep scheduling queries bounded to 100 candidates and keep backup execution concurrency at one.
- Preserve claim IDs, leases, `SKIP LOCKED`, revision fences, retry limits and incident transition semantics.
- Use local PostgreSQL and capture mail only. Do not create cloud resources or send live email.
- Report hardware, fixture counts and measured timings without a production capacity promise.
- Every behavior change starts with a failing test and every commit uses `git commit -s`.

## Review Focus

- A shutdown signal arriving between batches must prevent a new claim while allowing the current claim to finish.
- A scheduling failure or claim failure must retain each command's existing retry or failure behavior.
- Concurrent claim slots must never process the same email, monitor or backup job twice.
- One invalid recipient or failed bulk insert must roll back the incident and the entire notification fan-out.
- A venue or installation row locked ahead of other due work must not starve those other venues.

---

### Task 1: Capture the untuned local baseline

**Files:**
- Create: `scripts/worker-scheduling-receipt.mjs`
- Create: `scripts/verify-worker-scheduling-receipt.mjs`
- Create: `scripts/verify-worker-scheduling-receipt.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `MonitorWorker.schedule()`, `MonitorWorker.runOnce()`, `BackupWorker.schedule()`, `EmailWorker.runOnce()` and `TEST_DATABASE_URL`.
- Produces: schema-versioned JSON with `fixture`, `machine`, `baseline`, `final`, `correctness`, `memory` and `shutdown` sections.

- [ ] Write verifier tests that reject a missing phase, a scheduling batch over 100, lost restart work, a starved unlocked venue, a post-signal claim and non-finite timing or memory values.
- [ ] Run `node --test scripts/verify-worker-scheduling-receipt.test.mjs` and confirm it fails because the verifier does not exist.
- [ ] Implement the verifier and the smallest valid fixture receipt used by its tests.
- [ ] Run the verifier tests and confirm they pass.
- [ ] Add the real PostgreSQL fixture with deterministic counts, isolated schema cleanup and captured mail delivery. Record each phase with `performance.now()`, backlog timestamps and `process.memoryUsage().rss`.
- [ ] Run `node scripts/test-postgres.mjs exec node scripts/worker-scheduling-receipt.mjs --baseline /tmp/cloud-worker-scheduling-baseline.json`, verify the receipt, and retain its timings as the tuning evidence.
- [ ] Commit with `git commit -s -m "test: measure cloud worker scheduling"`.

### Task 2: Separate scheduling cadence from queue polling

**Files:**
- Create: `packages/registration/src/worker-loop.ts`
- Create: `packages/registration/test/worker-loop.test.ts`
- Modify: `packages/registration/src/index.ts`
- Modify: `packages/registration/src/monitor-cli.ts`
- Modify: `packages/registration/src/email-worker-cli.ts`
- Modify: `packages/backups/src/worker-cli.ts`

**Interfaces:**
- Produces: `runWorkerLoop(options)` with `runOnce(signal)`, optional `schedule()`, `signal`, `concurrency`, `scheduleIntervalMs`, `pollIntervalMs`, and injectable clock/wait functions for deterministic tests.
- Consumes: existing worker methods. Backup uses concurrency 1; monitor and email use concurrency 4; scheduling uses 60,000 ms and idle polling uses 1,000 ms.

- [ ] Write failing tests proving startup scheduling, polling without repeated sweeps, a later cadence sweep, four bounded concurrent claims, no post-signal claim and completion of already-started work.
- [ ] Run `node --test packages/registration/test/worker-loop.test.ts` and confirm the expected missing-module failure.
- [ ] Implement the minimal loop helper and export it.
- [ ] Run the worker-loop test and confirm it passes.
- [ ] Change the three continuous CLIs to use the helper while preserving `--once`, status, retry and fixed diagnostic behavior.
- [ ] Run the focused CLI, monitoring, outbox and backup worker tests through `scripts/test-postgres.mjs`.
- [ ] Commit with `git commit -s -m "perf: separate worker scheduling from polling"`.

### Task 3: Batch encrypted incident notification fan-out

**Files:**
- Modify: `packages/registration/src/email-outbox.ts`
- Modify: `packages/registration/src/monitoring.ts`
- Modify: `packages/registration/test/email-outbox.test.ts`
- Modify: `packages/registration/test/monitoring.test.ts`

**Interfaces:**
- Produces: `EmailOutbox.enqueueServiceAlerts(client, messages)` returning generated outbox IDs in input order.
- Consumes: validated service-alert messages and the existing `service_alert_deliveries` unique constraint inside the monitor transaction.

- [ ] Write a failing PostgreSQL test for multiple encrypted service alerts inserted atomically in one call, including invalid-input rollback.
- [ ] Run the focused outbox test and confirm the method is missing.
- [ ] Implement validation, encryption and one parameterised bulk insert while keeping `enqueue()` behavior unchanged for other message kinds.
- [ ] Run the focused outbox test and confirm it passes.
- [ ] Write a failing monitor test for many owners that asserts one delivery per owner, no plaintext storage, no duplicate transition after restart and complete rollback on delivery insertion failure.
- [ ] Run it and confirm the existing sequential path does not meet the batch-query assertion.
- [ ] Change the monitor transition to bulk enqueue and bulk delivery insertion.
- [ ] Run monitoring and outbox tests and confirm they pass.
- [ ] Commit with `git commit -s -m "perf: batch service alert fan-out"`.

### Task 4: Record final measurements and operational guidance

**Files:**
- Modify: `scripts/worker-scheduling-receipt.mjs`
- Modify: `scripts/verify-worker-scheduling-receipt.test.mjs`
- Modify: `docs/local-monitoring.md`
- Modify: `docs/email-delivery-implementation.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: the same fixture counts and hardware used for the baseline.
- Produces: `/tmp/cloud-worker-scheduling-receipt.json` plus documented commands, limits and measured observations.

- [ ] Run the final fixture and verifier, confirming bounded sweeps, unlocked-venue progress, complete restart delivery and no post-signal claim.
- [ ] Add any verifier regression found while inspecting the final receipt and watch that mutation fail before restoring the receipt.
- [ ] Document fixture counts, hardware, baseline/final timings, memory, shutdown behavior and the distinction between scheduling cadence and polling.
- [ ] Update the Service monitoring and Data lifecycle backlog paragraphs with the exact local evidence and remaining production measurement work.
- [ ] Run affected package typechecks and focused PostgreSQL tests.
- [ ] Commit with `git commit -s -m "docs: record worker scheduling measurements"`.

### Task 5: Finish the branch

**Files:**
- Inspect all changed files and retained receipt artifacts.

- [ ] Run focused clean-tree verification and confirm `git status --short` contains no unexpected files.
- [ ] Use the Codex `finish-branch` skill, triage its whole-branch review, push and wait for exact-head CI.
- [ ] Acquire the shared `main.lock`, use the Codex `land-branch` skill, verify cleanup and release only the lock this lane acquired.
- [ ] Confirm exact-merge CI names the squash SHA, then update Lane D queue and progress receipts.
