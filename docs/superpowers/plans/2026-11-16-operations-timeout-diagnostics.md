# Operations timeout: proposed investigative slice

Queued ask, verbatim, in `/Users/clintongormley/waitron-campaign-g/queue.md`, OPERATIONS-SCALE-TIMEOUT:
> find what the scale case waited on (PostgreSQL lock, connection pool, runner load), using the stage timestamps and blocker samples; fix the cause, not the timeout. Prove it with the evidence the fix addresses. Write the one-page plan first; one PR.

**Decision pending:** this proposes investigation, NOT the queued root-cause repair. The original ask remains incomplete. After Claude's plan review, the WATCHER must clear this changed immediate finish line before any build. No owner plan approval is claimed.

The supplied receipt (`/Users/clintongormley/waitron-campaign-g/receipts/operations-scale-timeout/diagnosis.md`) records missing samples for 43811109636/attempt1/job133112892997 at 594365b32. Passing probes, including 43818550816 (identity 12, operations 63; 15 samples without blockers), neither reproduce nor attribute that failure. Repetition cannot recover missing evidence.

**Smallest usable result:** normal CI retains bounded stage/wait evidence in memory for the real scale case and status `beforeEach`, emitting only on rejection or test-context abort. A recurrence can identify the unfinished stage and observed database/pool waits. Missing samples cannot establish runner load or absence of blockers. Attribution, repair and evidence proving that repair remain outstanding; keep the work in one PR.

**Exact files and responsibilities:**

- `packages/registration/test/fixtures/setup-waits.ts`: extend `observeSetup` with optional `AbortSignal`, fixed stage marks and opt-in observation of existing pools as they become available. Reuse its bounded PostgreSQL sampler; keep existing calls compatible.
- `packages/account-http/test/fixtures.ts`: optional observation plumbing exposes existing setup/admin pools before queries and marks setup/migration/cleanup. Preserve ownership, query order and default behaviour; enable only for the scale case.
- `packages/registration/test/fixtures/reset-schema.ts`: optional plumbing marks schema reset separately from migration; reuse the outer observation instead of nesting another sampler/report. Other callers remain unchanged.
- `packages/operations/test/staff-problem-reports.test.ts`: wrap only the scale case, including database creation and `finally` cleanup; mark setup, bulk insertion, CLI read and cleanup. Scope child observation using a unique synthetic `PGAPPNAME`, never a broad database scan; keep child/query ownership unchanged.
- `packages/operations/test/status.test.ts`: pass hook-context signal and observe only `beforeEach`, distinguishing reset, migration and reconciliation update.
- `packages/registration/test/setup-wait-diagnostics.test.ts`: own observer lifecycle, bounds, privacy and timeout behaviour. Operations files retain their existing behavioural assertions and own stage wiring.
- `docs/backlog.md` and this plan: record investigative coverage, evidence limits and the unfinished repair.

Keep the existing sampler limits, deadlines and safe row fields (`setup-waits.ts:6–28`); retain timing/pool counts separately. Cap stage transitions at 16, retain sample timestamps and elapsed time, and keep reports below 24 KB. Report no SQL, URLs, input values, application names or caught errors. Pool counts distinguish queued acquisition from observed backend waits. Observation failure marks evidence unavailable without replacing results. On abort, finalize once without awaiting workload settlement: stop sampling, detach listeners, drain bounded observer work and close only observer connections. Later callback rejection/settlement cannot duplicate reporting. Never cancel/retry workload or alter assertions, caps, production queries, migrations or workload deadlines.

**TDD and verification, after clearance:** extend the existing diagnostic cases first. With real PostgreSQL, hold a lock and trigger an actual Node test-context timeout in an isolated child; assert retained blocker/stage evidence and observer cleanup while the workload query remains blocked. Release the lock, await workload completion and assert exactly one report. Watch this fail because abort currently cannot report before callback settlement, then implement minimally and rerun green. Reuse existing rejection, hostile-error, unavailable-observer, bounds and success-silence cases; add stage/pool metadata checks without weakening checks. Verify success through cleanup, including no later signal-triggered report. Once, disable timeout observation temporarily: the retained-report assertion must fail; restore and rerun green. Record that control, without permanent mutation machinery.

Focused commands (use the campaign's authorised test host):
```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/setup-wait-diagnostics.test.ts test/sql-setup-diagnostics.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/operations exec node --test --test-timeout=30000 test/staff-problem-reports.test.ts test/status.test.ts
```
Read test counts; CI owns full selected package suites and workspace typechecking. Add no workflow, service, runtime artifact, schema-fixture framework, unrelated consumer observation or new helper. Expected added/removed lines: production +0/−0; tests +140–210/−8–20; test support +100–170/−20–35; docs +55–65/−0–5. Confirm actual counts after implementation.
