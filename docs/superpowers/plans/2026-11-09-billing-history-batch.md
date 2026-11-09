# Billing history batch implementation plan

Goal: bound database roundtrips and measure shorter lock-held reads while preserving exactly the authenticated, venue-scoped display. Authority: D617 watcher request; no separate spec.

Read-only findings: `billing-display-machine.ts:40–53` selects IDs then makes four queries per charge; `billing-payments.ts:11–21` supplies two. `billing-display.ts:11–14` requires full `FrozenCharge` facts. These are source findings, not measurements.

## Files and budget

Paths below are under `packages/registration/` unless absolute from repository root.

- Code: `src/billing-display-machine.ts`, ≤140 changed lines, replacing only history loading inside `facts`.
- Tests: append to `test/billing-display-machine.test.ts` (≤180 lines); add `test/billing-display-history-fixture.ts` (≤180 lines) for synthetic seeding and delegating query instrumentation. Preserve every existing assertion.
- Documentation: `docs/backlog.md`, ≤10 lines; `packages/registration/README.md` only if stale, ≤15 lines. Target ≤500 code/test lines, hard ceiling about 1,000; no metrics system.

## Execute after approval

- [ ] Gate: one Claude plan read via `~/workspace/tools/claude-seat.sh review-branch`, then watcher approval before building. No provider CLI access; later tests use only the authorized test box. Read TDD skill before code.
- [ ] Baseline/RED: seed valid synthetic histories of 0/12/120/1200 charges with identical current outcomes; include sibling venues/businesses/organisations, multiple lines/attempts/days, refunds/retries and sparse zero-cent allocations. Through exported `BillingDisplayMachine.read` with signed proof/lease, collect every actual SQL dispatch, including transaction control, using a test-only wrapper that delegates to real PostgreSQL. Exclude seeding; use `performance.now()` for total elapsed and first parent-lock completion through COMMIT completion, labelled client-observed lock-held duration. Warm once; record five samples/size and medians. Collect all sizes before asserting constant roundtrips and independently expected complete replies; observe failure from query growth, never SQL-text assertions or timing thresholds.
- [ ] GREEN: replace ID selection/loop with one SELECT over the same eligible charges, using separately aggregated lines, attempt state/succeeded_at and consumed hosted days to prevent join multiplication. Retain organisation/business predicates throughout, venue filters, OR eligibility for omitted lines, ordering, empty arrays, explicit date/timestamp and numeric conversions. Map locally to unchanged `BillingDisplayFacts`; leave `readFrozenCharge`, projector and types untouched. If disproportionate duplication/shared-mapper refactoring is needed, stop: recommend four fixed bulk queries (headers, lines, attempts, days) for watcher approval; do not claim one query.
- [ ] Run unchanged machine/projection/proof tests plus additions:

`node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/billing-display-machine.test.ts test/billing-display.test.ts test/billing-display-proof.test.ts`

Retain scope, post-lock proof/lease/key checks, refunds/retries, sparse days and reader/writer concurrency. Repeat identical measurements after GREEN. Record counts, timings and commands in PR; investigate absent lock-duration improvement without weakening checks.
- [ ] Update only launch item 3's history clause in `docs/backlog.md` with measured local results and remaining production qualification. Finish: focused tests pass, current-head CI full registration suite passes, then `finish-branch` review. No public performance promise before measurement.

Stop for watcher if any schema/migration, fiscal/tax calculation, immutable record, expected fiscal value, business/auth/lock/gating/pagination change or relaxed assertion becomes necessary.
