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
failure rule for timing comparisons. Keep the scratch workflow and sampler on
the scratch branch. Record each run in Lane J's progress log. Bring the evidence
to the watcher after two hours without a new finding, as the D620 rule requires.

The three scratch runs did not reproduce the statement timeout. On 27 November
at 12:20 CET the watcher cleared one bounded snapshot in the existing setup
observer after a PostgreSQL statement timeout. At 12:39 CET the watcher left WAL
counters to whether they would indicate a specific repair. Cumulative counts cannot
isolate the stall, so capture live processes and their waits. Keep the passing path
and test caps as they are. Use the real statement-timeout and successful-setup cases
in `packages/registration/test/setup-wait-diagnostics.test.ts` and run normal
registration CI. Estimate up to 30 helper lines and 20 test lines. Update the
existing D530 backlog entry and wait for a natural recurrence before choosing a repair.
