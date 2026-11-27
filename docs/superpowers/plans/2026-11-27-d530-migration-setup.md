# D530 registration migration timeouts

Find and repair the cause so registration shard 5 runs every case within its
existing limits. Keep every assertion, required-case check and deadline, including
the SQL, 30-second test and eight-minute job caps. Leave applied migrations and
production settings alone.

[Main CI attempt 1](https://github.com/waitron-io/waitron-cloud/actions/runs/45979089526/job/140438311840)
logged statement timeouts (`57014`) in `relay-grants.test.ts` (log lines 1515–1618)
and `ses-feedback-bounds.test.ts` (1705–1743). Two relay reports sampled the same
process waiting on the write-ahead log (WAL) lock (`WALWrite`, 8/8 and 7/8).
The lock holder and storage latency are unknown. The commits for the failed job
and [passing PR job](https://github.com/waitron-io/waitron-cloud/actions/runs/45977527377/job/140433041740)
differ only in Markdown. [Earlier failures](../../backlog/worker-scheduling.md#migration-setup-timeout-remains-unexplained-d530)
hit different migrations in shards 1 and 3.

After watcher clearance, copy the package job's runner, setup and cap from
`.github/workflows/ci.yml` into a workflow limited to the scratch branch. Each
matrix job starts one PostgreSQL server through `scripts/test-postgres.mjs`.
File workers in that job share the server. Record runner CPU count and active
file workers. Use `scripts/ci-run-registration-shard.mjs 5` via the existing command.

```sh
node scripts/test-postgres.mjs exec pnpm --filter @waitron-cloud/registration exec node ../../scripts/ci-run-registration-shard.mjs 5
```

Read live `fsync`, `synchronous_commit`, `full_page_writes` and `wal_sync_method`.
Trace `data_directory` and `pg_wal` to their backing mounts. Use the existing
relay sampler for case context. Both fixtures need a bounded server-wide sample
of `pg_stat_activity` wait types and backend roles, including background writers
and checkpointers. Align waits with `pg_stat_io` WAL write and sync times
(`track_wal_io_timing=on` on scratch), checkpoint counters and host disk and CPU
pressure. Retain stage, failure and exit evidence. Sample no query text.

Use one instrumented baseline and one matched control per hypothesis. If needed,
change only file concurrency or apply bounded disk pressure inside the disposable
CI job to reproduce the observed timeout and wait. Under the same conditions,
check whether changing the implicated factor clears them. Use the shared CI
failure rule for timing comparisons. Bring inconclusive evidence to the watcher.

Change only the implicated test setup. Observe a needed regression check fail
first, then pass it and the matched shard. Use `scripts/ci-test-postgres.test.mjs`
for launcher changes and require normal CI for every affected launcher consumer.
Estimate up to 30 code and 30 test lines. Update “Monitoring shutdown fixture
migration timeout (D530)” in `docs/backlog.md` and its linked failure history.
