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

- [x] Add `packages/registration/test/usage-reconcile-cli.test.ts`: run real CLI children
  against an isolated migrated schema; expect automatic repeated passes, bounded batch
  counts, retries after rollback, restart recovery, lock exclusion, exact tenant totals,
  clean signal exit and sanitized invalid-config failures. Run via
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=30000 test/usage-reconcile-cli.test.ts`;
  observe missing watch mode fail before changing production code.
- [x] Extend `usage-reconcile-cli.ts` with explicit watch mode, validated settings,
  transaction deadline, signal lifecycle, shared loop and fixed retry delay. Run new
  tests plus `usage-metering.test.ts` and `worker-loop.test.ts`; typecheck. Commit signed off.
- [x] Add failing deployment checks, then wire Compose/runtime and update readiness,
  lifecycle/proof one-shot waits and their fixtures. Preserve all other assertions.
  Run `pnpm test:local-stack`.
- [x] Add and run a disposable scheduled-usage Compose proof, recording automatic
  event/freshness advance, stopped-worker staleness, restart catch-up and cleanup.
  Update usage/deployment docs and both backlog entries with the measured scope.
- [ ] Finish: clean candidate, Claude run-it review, triage, normal push, exact-head CI.
  Land under the shared lock, refresh main dependencies, remove this worktree/branches,
  record exact-merge CI. Leave C55 parked until C54's overlap clears.

## Validation receipts (2026-09-29)

Watch CLI initially refused the new mode; then 20 usage/worker tests passed, with
existing ledger assertions unchanged. The cumulative-statement deadline case passed
in 10.27 s; removing the transaction deadline in a disposable clone let the same pass
commit in 12.34 s and failed its zero-events assertion. Typechecking passed.

All 42 local deployment checks passed. Compose 5.1.0's `wait` refused an already-exited
successful disposable job; startup now checks recorded job exit states instead.
The full-stack proof at `d1f639d323ae14e7831dd6892b0dc3c8efae0560` passed install,
restart and recreation in 9557/9089/18958 ms, with zero owned resources left.
The usage proof at `b3d7f7610cdd1d47f00e1adb60704086e0d362cd` recorded two
organisations automatically, held pending work while stopped with four stale sources,
and recorded a third organisation after restart. Both receipts named clean trees.

The 504-second Claude run-it review found no blocker and five improvement points.
All were addressed: a cumulative deadline control, backend-loss regression, named
startup refusal for a restarting worker, a discriminating readiness fixture, and
preserving the original proof error when cleanup also fails. Driver deletion controls
failed for the connection-error handler and required usage service. Final focused
checks: 22 PostgreSQL/loop tests, 44 deployment checks and package typechecking passed.
