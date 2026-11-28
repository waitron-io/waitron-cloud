# D530 disposable PostgreSQL waits in CI

The Lane J queue asks to “find what the setup waits on (storage, how many shards share one database server, fsync and WAL settings of the test PostgreSQL) and fix the cause under ~/waitron-campaign-shared/ci-failure-rule.md. Keep every check and deadline; a retry is not a repair. One-page plan for the watcher first.” On 28 November at 11:56 CET the watcher cleared measuring and reducing disk flushes in the same pull request, conditional on checking the test server’s consumers.

The [27 November failure](https://github.com/waitron-io/waitron-cloud/actions/runs/45979089526/job/140438311840) observed repeated waits to write the log. The [28 November failure](https://github.com/waitron-io/waitron-cloud/actions/runs/46134889343/job/140947986646) hit the same PostgreSQL error through a fixture without sampling. The [targeted disk-pressure run](https://github.com/waitron-io/waitron-cloud/actions/runs/46136915887/job/140954154748) passed all 278 cases. The reported wait justifies reducing disk flushes in CI. Its underlying storage cause still needs evidence.

Set `track_wal_io_timing=on`, `fsync=off`, `synchronous_commit=off` and `full_page_writes=off` on the disposable server started by `scripts/test-postgres.mjs`. Each shard starts its own server. On wrapped-command failure, read bounded `pg_stat_io` write-ahead log counters and `pg_stat_activity` before cleanup with one short Docker exec. Exclude query text and connection details. Preserve the original exit result and existing limits. This gives every caller failure evidence without polling.

Backups’ daemon-outage test starts its own server. The database-recovery and schema-upgrade receipts and Kubernetes proofs likewise provision separate databases. The relay migration’s logical dump reads and restores through this launcher without restarting it. Preserve those proofs, migrations and all production settings.

Run `scripts/ci-test-postgres.test.mjs` red then green for the settings, failure-only output, original status and cleanup when the report is unavailable. Verify live settings and both exit paths on the approved Debian box, and run the affected mail fixture and relay migration cases. CI owns the full jobs. Update the D530 details and index in `docs/backlog/` and `docs/backlog.md`. The Sent reports test’s separate deadline is outside this slice. Watch subsequent CI for recurrence.

Estimate 30 production lines, 50 test lines and 12 backlog lines.
