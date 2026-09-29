# Scheduled usage reconciliation implementation plan

> Execute inline with the executing-plans skill under the unattended campaign authorisation.

**Goal:** Keep durable usage sources reconciled without manual commands.
**Architecture:** Existing bounded transaction/lock plus the shared worker loop; persistent local service.
**Tech stack:** Node 26, PostgreSQL 18, pnpm, Docker Compose.
**Spec:** `docs/superpowers/specs/2026-09-29-scheduled-usage-design.md`.

## Constraints and review focus

Preserve one-shot/status behavior, existing ledger assertions and freshness semantics.
No new migration, billing, live resources or private diagnostic values. Exercise failure
mid-pass, shutdown while busy, competing processes, invalid timing and deployment startup
(the old startup waits for usage to exit and would hang with a persistent worker).

## Tasks

- [ ] Add `packages/registration/test/usage-reconcile-cli.test.ts`: run real CLI children
  against an isolated migrated schema; expect automatic repeated passes, bounded batch
  counts, retries after rollback, restart recovery, lock exclusion, exact tenant totals,
  clean signal exit and sanitized invalid-config failures. Run via
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=30000 test/usage-reconcile-cli.test.ts`;
  observe missing watch mode fail before changing production code.
- [ ] Extend `usage-reconcile-cli.ts` with explicit watch mode, validated settings,
  transaction deadline, signal lifecycle, shared loop and fixed retry delay. Run new
  tests plus `usage-metering.test.ts` and `worker-loop.test.ts`; typecheck. Commit signed off.
- [ ] Add failing deployment checks, then wire Compose/runtime and update readiness,
  lifecycle/proof one-shot waits and their fixtures. Preserve all other assertions.
  Run `pnpm test:local-stack`.
- [ ] Add and run a disposable scheduled-usage Compose proof, recording automatic
  event/freshness advance, stopped-worker staleness, restart catch-up and cleanup.
  Update usage/deployment docs and both backlog entries with the measured scope.
- [ ] Finish: clean candidate, Claude run-it review, triage, normal push, exact-head CI.
  Land under the shared lock, refresh main dependencies, remove this worktree/branches,
  record exact-merge CI. Leave C55 parked until C54's overlap clears.
