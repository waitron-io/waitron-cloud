# Scheduled usage reconciliation

D31 adds an unattended local worker for the existing observational usage ledger.
It does not change billing, usage identities, tenant ownership or scan-freshness semantics.

Use `usage:reconcile --watch`; preserve `--once` and `--status`. Reuse
`runWorkerLoop` with one awaited pass and a fixed delay after success, lock contention
or failure. `CLOUD_USAGE_INTERVAL_MS` defaults to 60000 and accepts 1000–240000;
`CLOUD_USAGE_BATCH_SIZE` defaults to 100 and accepts 1–1000 events per source.
Run the first pass immediately. A fixed retry delay bounds retry frequency; avoiding
immediate backlog draining also bounds database load. Existing PostgreSQL transaction
and advisory lock protect competing processes. A ten-second transaction timeout
bounds an active pass; shutdown interrupts idle waiting and lets that pass settle.

The local Compose usage service runs persistently, restarts unless stopped and receives
only its database URL and the two explicit usage settings. Startup waits only for
bootstrap/migrations; readiness requires the usage process to be running. Existing
operations status reports unknown until every source catches up, then current/stale
using its configured threshold. Failed passes leave freshness unchanged and therefore
become stale; log a fixed failure message without database error details. This is a
freshness alarm, not an immediate durable record of every failed attempt.

Prove real PostgreSQL behavior through CLI children: bounded passes, two workers,
rollback, forced interruption, restart catch-up, duplicate suppression, tenant separation,
SIGTERM during a pass and idle waiting, and configuration refusal. A disposable local
Compose proof must show automatic progress, stale operations status after stopping,
and recovery after restart, with exact-project cleanup. No live resources are involved.
