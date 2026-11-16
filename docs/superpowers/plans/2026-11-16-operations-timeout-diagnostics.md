# Operations timeout: investigative slice

Queued ask, verbatim, in Lane G’s local queue, OPERATIONS-SCALE-TIMEOUT:
> find what the scale case waited on (PostgreSQL lock, connection pool, runner load), using the stage timestamps and blocker samples; fix the cause, not the timeout. Prove it with the evidence the fix addresses. Write the one-page plan first; one PR.

**Cleared investigative slice:** Claude reviewed the draft (172 seconds); the driver accepted its simplifications. The watcher cleared the separate diagnostic PR on 16 November 2026 at 07:57 in Lane G's questions.md: “Yes: land the small diagnostic PR so normal CI keeps the stage timestamps and PostgreSQL wait/blocker samples when the timeout recurs naturally, then fix the cause from that evidence.” This settles the review's UNVERIFIED changed finish line. The original cause, repair and proof of repair stay open. No owner approval of this design is claimed.

The [original failure log](https://github.com/waitron-io/waitron-cloud/actions/runs/43811109636/job/133112892997) contains no stage/wait samples for run 43811109636, attempt 1, job 133112892997. Passing probes include [43818550816](https://github.com/waitron-io/waitron-cloud/actions/runs/43818550816): identity 12, operations 63, 15 samples without blockers. These passes do not reproduce or attribute the original timeout.

**Smallest usable result:** the next real scale-test or status-hook timeout prints its unfinished coarse stage, elapsed time, recent database waits, pool counts and runner load. Successful operations stay silent. Reuse `observeSetup` and its existing bounded sampler; add no monitoring framework.

**Files and approach:**

- `packages/registration/test/fixtures/setup-waits.ts`: give `observeSetup` optional abort observation and fixed stage marks, accepting an initially absent pool and attaching the scale pool once available. Keep existing callers compatible. Report existing safe wait/blocker rows, sample timestamps, pool total/idle/waiting counts, `os.loadavg()` and maximum sampler lateness with its elapsed timestamp, even when no backend row exists. Retain at most eight samples and sixteen stage marks; stay below the existing 24 KB check. On abort, report once and stop/close only the observer without waiting for or cancelling the workload. Remove listeners when work settles so a later normal-completion signal stays silent. Observer failure cannot replace results/errors or change deadlines.
- `packages/operations/test/staff-problem-reports.test.ts`: observe only the scale case, from before `database()` through `finally` cleanup; mark database, bulk insert, CLI read and cleanup. Attach `db.pool` after creation. The CLI gets stage timing only; its own connection/statement deadlines stay unchanged.
- `packages/operations/test/status.test.ts`: observe the existing pool around the complete `beforeEach`, using its context signal. Mark reset (including migration) and reconciliation update. Leave `resetSchema`, `database()` and all other callers unchanged. Keep the inner migration observer; its separate rejection report is allowed. The outer observer emits once.
- `packages/registration/test/setup-wait-diagnostics.test.ts`: extend existing cases for abort handling, metadata, silence and cleanup. Keep current behavioural checks.
- `docs/backlog.md` and this plan: add a short pointer to diagnostic coverage and the still-open root-cause repair. No workflow, production code, migration, assertion or deadline changes.

**Evidence limits:** no backend samples exist until `database()` returns; that stage only narrows the next investigation. Reset does not identify a migration on abort; production migration stages still report on rejection. Cleanup’s schema drop uses the fixture’s separate admin pool and has no backend samples here. Blocker PIDs do not identify another test's origin. Load and sampler lateness do not prove the original cause. Report no SQL, URLs, application names, input values or caught errors.

**TDD after clearance:** with real PostgreSQL, reuse the existing blocked-operation fixture and an in-process `AbortController`. Wait for a real blocked backend, abort while its query remains pending, and require retained blocker/stage evidence plus observer cleanup before releasing the workload. Observe this fail against the current helper, implement minimally, release the lock and await settlement; require one report. Reuse rejection/privacy/unavailable-observer cases. Settle successful work, then abort, and require silence through observer shutdown. For the runbook's asynchronous-silence control, once inject a forbidden late report, observe the silence assertion fail, restore and rerun; commit no mutation machinery. Operations cases own their wiring and retain every existing result assertion. Name every changed check in the PR.

Run on the authorised test host, reading counts; CI owns complete selected suites/typechecking:
```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/setup-wait-diagnostics.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/operations exec node --test --test-timeout=30000 test/staff-problem-reports.test.ts test/status.test.ts
```
Expected added/removed lines: production +0/−0; tests +60–100/−0–5; test support +45–75/−5–10; docs +30–45/−0–5. Growth past 1.5 times the estimate returns to the watcher.
