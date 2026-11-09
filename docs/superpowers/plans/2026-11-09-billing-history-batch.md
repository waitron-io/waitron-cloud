# D617: Measure and batch billing history reads

Review correction (watcher, 9 November 15:53; finding 4): step 2’s one-off instrumentation is removed after saving its receipts; step 4 checks composite account/venue scope, recording individual predicates equivalent under database constraints as such.

Keep the authenticated venue’s display unchanged while removing per-charge database roundtrips
under shared locks. The watcher’s 9 November queue asks: measure synthetic long history, then
one batched query, keeping every assertion. This page needs watcher approval before building.

Source reading, not measurement: `packages/registration/src/billing-display-machine.ts:41` selects
IDs then issues four queries per charge, including two in `billing-payments.ts:11`.

**Files and budget** (paths under `packages/registration/`):
`src/billing-display-machine.ts`, about 70 changed lines; `src/billing-payments.ts`, about 20;
append to `test/billing-display-machine.test.ts`, about 180; `docs/backlog.md`, about 5.
No new fixture, README, benchmark system or schema. Target 270 code/test lines; RUNNER controls growth.

1. **Baseline and RED.** Keep helpers in the existing test. Seed valid synthetic events, prices,
   charges, lines, attempts and hosted days using direct SQL inserts, preserving constraints.
   Normal CI compares 12 and 120 contiguous monthly charges; 0 has its own unpaid expectation.
   Use the same charge ID in sibling businesses/organisations with conflicting attempts, plus
   sibling venues, multiple rows, sparse zero-cent days and repaired retries/refunds; only the
   newest charge may remain unresolved. Attempts/days grow with charges.
   Delegate every query to real PostgreSQL and count dispatches through signed
   `BillingDisplayMachine.read`; assert constant counts and independent expected replies.
   Export `facts` only from its internal module, not `index.ts`; compare complete facts against
   the existing `readFrozenCharge` plus the two old queries, detecting duplicated/foreign rows,
   mapping, ordering, timestamps and empty arrays. Observe query-growth RED before batching.
2. **Measure once outside normal CI.** Opt in with `BILLING_HISTORY_MEASURE=1` for 0/12/120/1200
   histories (1200 is stress, not a realistic lifetime). Warm once and collect five samples:
   SQL counts, elapsed time and first-parent-lock completion through COMMIT, labelled
   client-observed lock-held duration. SQL identification is allowed; SQL-text assertions and
   timing thresholds are not. Retain baseline before editing; repeat identical samples afterward.
3. **GREEN.** One SELECT joins independently grouped, scope-filtered derived tables by charge ID;
   no per-charge correlated/LATERAL aggregates. Include hosted-day eligibility in the set-based
   shape. Scope every aggregate by organisation/business; lines/days also by venue, retaining
   hosted-day lines and omitted-zero-line eligibility. Order each array and charges explicitly.
   Extract the existing pure frozen-charge row mapping unchanged and reuse it; preserve numeric,
   date and timestamp conversions. Keep projector/types, transaction, locks and authority untouched.
   Inspect `EXPLAIN (ANALYZE, BUFFERS)` at stress size for repeated history scans.
4. **Verify and finish.** Through `scripts/test-postgres.mjs`, run unchanged named machine,
   projection, proof and billing-payments test files plus additions; CI owns the full package.
   Deliberately omit each tenant predicate in a disposable candidate and require failure.
   Record measured before/after counts/timings and plan shape; investigate no improvement.
   Update only launch item 3’s history clause, retaining production qualification. Then finish-branch.

Stop for watcher before changing fiscal/tax calculations, immutable records, existing checks,
schema, business rules, authentication, locks or pagination. No provider calls or production claim.
