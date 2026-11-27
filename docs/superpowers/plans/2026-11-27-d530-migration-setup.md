# D530 registration migration timeouts

Repair the reproduced test setup failure so registration shard 5 can run every
case within its existing limits. Keep every assertion, required-case check and
deadline, including the SQL, 30-second test and eight-minute job caps. Leave
applied migrations and production settings alone.

[Main CI attempt 1](https://github.com/waitron-io/waitron-cloud/actions/runs/45979089526/job/140438311840)
logged PostgreSQL statement timeouts (`57014`) in the relay schema reset, relay
migrations 035 and 045, and SES feedback migrations 016 and 045. Two samples
showed the same PostgreSQL process waiting on the write-ahead log lock
(`WALWrite`, 8/8 and 7/8), with no listed SQL blockers. The lock holder and
storage latency are unknown. The [passing PR job](https://github.com/waitron-io/waitron-cloud/actions/runs/45977527377/job/140433041740)
differs only in Markdown. [Earlier failures](../../backlog/worker-scheduling.md#migration-setup-timeout-remains-unexplained-d530)
and Lane G's passing serial cases inform reproduction.

After watcher clearance, use the approved test box for the serial control.
Use a scratch GitHub workflow limited to its branch for the exact shard, copying
the package job's runner, setup, command and cap from `.github/workflows/ci.yml`.
Each matrix job starts its own PostgreSQL container through
`scripts/test-postgres.mjs`. File workers in one shard share that server across
schemas. Record actual file concurrency and any shared host workloads.

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=30000 --test-concurrency=1 test/relay-grants.test.ts test/ses-feedback-bounds.test.ts
node scripts/test-postgres.mjs exec pnpm --filter @waitron-cloud/registration exec node ../../scripts/ci-run-registration-shard.mjs 5
```

Read live `fsync`, `synchronous_commit`, `full_page_writes`, `wal_sync_method`
and `track_wal_io_timing`. Resolve the database and log paths to their backing
mounts. Reuse `packages/registration/test/fixtures/setup-waits.ts`. On scratch,
keep bounded samples of PostgreSQL waits and SQL blockers, WAL writes and syncs
from `pg_stat_io`, disk latency and CPU scheduling during the failing window.
Reproduce the timeout and wait, then change one evidenced factor under matched
conditions and check that the timeout and prolonged wait disappear. Apply the
shared CI failure rule's runner health checks to timing comparisons. A passing
retry leaves the cause open.

Change the implicated launcher, shard runner or setup fixture. Run its existing
focused checks (`scripts/ci-test-postgres.test.mjs`, `scripts/ci-registration-shards.test.mjs`
or `packages/registration/test/setup-wait-diagnostics.test.ts` respectively).
Observe any needed regression check fail first, then pass it and the matched
shard. Budget 5–30 code lines and up to 30 test lines. Update `docs/backlog.md`
and `docs/backlog/worker-scheduling.md` with the evidence. Bring an inconclusive
probe or a repair outside this scope back to the watcher.
