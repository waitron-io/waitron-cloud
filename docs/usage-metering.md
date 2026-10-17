# Measure Cloud service usage

Cloud needs a trustworthy account of the work it performs before you can use those measurements for capacity planning or a future commercial policy. The usage ledger records facts that the existing services already know. It does not charge a customer, enforce an allowance or change service access.

## What Cloud records

Each event belongs to one organisation and, when the source has one, one venue. The event also names a fixed source kind and source reference. That pair makes a retry return the original event instead of increasing a total twice.

The current ledger records:

- snapshot bytes added to and removed from retained storage;
- snapshot bytes uploaded and restored;
- completed installation operations;
- accepted public and staff monitoring probes; and
- service-alert messages that reached a terminal `sent`, `failed`, `expired` or `cancelled` state; and
- translation items completed, input tokens, output tokens and cost in micro-dollars (one million per US dollar).

The snapshot storage total is bytes added minus bytes removed. The transfer totals count snapshot publication and completed snapshot restores. A monitoring result contributes one event for each accepted public or staff observation. Replayed or older observations do not add another event.

Continuous-backup stream bytes are not available from the current durable sources, so they are excluded. Account-level identity mail is excluded because it has no organisation or venue attribution. Restored snapshot bytes begin with receipts written after migration `025_usage_metering.sql`; older recovery rows do not contain a trustworthy restored time and are not backfilled. The portal says so explicitly instead of presenting incomplete history as complete coverage.

Translation measures are `translation.items_completed`, `translation.input_tokens`,
`translation.output_tokens` and `translation.cost_micro_usd`. The worker records them in
the job's finishing transaction, keyed by the job ID, so retrying completion does not count
it twice. They survive release and expiry and are not reconstructed by the reconciler.
The translation safety cap is separate from these usage totals and from any future billing
policy. See [menu translation](../packages/translation/README.md).

## Reconcile durable sources

The source tables remain the record of work performed by backups, registration and administrative alert delivery. Run one bounded reconciliation pass after applying all migrations:

```sh
DATABASE_URL=postgresql://cloud:replace-password@localhost:5432/cloud \
  pnpm usage:reconcile --once
```

A successful pass prints JSON. `acquired` is `false` when another reconciler holds the database lock. When it is `true`, each source reports how many missing events it recorded and whether that source is caught up:

```json
{"acquired":true,"sources":{"backup_points":{"recorded":12,"caughtUp":true},"backup_recoveries":{"recorded":0,"caughtUp":true},"installation_operations":{"recorded":4,"caughtUp":true},"service_alerts":{"recorded":8,"caughtUp":true}}}
```

Inspect reconciliation state without changing it:

```sh
DATABASE_URL=postgresql://cloud:replace-password@localhost:5432/cloud \
  pnpm usage:reconcile --status
```

Each source reports its last attempted pass and its last proven caught-up time. The customer summary uses the oldest caught-up time only after all four durable sources have completed a pass. Until then, `measuredThrough` is `null` and the portal labels the totals as incomplete. Despite its schema name, this value is scan freshness, not an event-time completeness boundary. A transaction can start before a scan, commit afterwards and contain activity whose occurrence time is older than the scan. That event appears during a later pass.

`--once` performs one pass and exits. To keep reconciling, run the worker:

```sh
DATABASE_URL=postgresql://cloud:replace-password@localhost:5432/cloud \
  pnpm usage:reconcile --watch
```

The worker runs a pass immediately, then waits 60 seconds after each completed pass.
It uses the same delay after a failure or a busy database lock, so retries cannot spin
continuously. Each source contributes at most 100 missing events per pass. More work
waits for the next pass. Separate workers use the existing database lock; a worker
that does not acquire it reports `acquired: false` and waits.

Set `CLOUD_USAGE_INTERVAL_MS` to a whole number from 1000 to 240000 and
`CLOUD_USAGE_BATCH_SIZE` to a whole number from 1 to 1000 to change these bounds.
Invalid settings refuse startup. These settings apply to `--watch`; `--once` keeps
its 100-event-per-source pass. PostgreSQL bounds each CLI transaction to ten seconds.
On SIGINT or SIGTERM, the worker stops waiting immediately or lets its active pass
commit or roll back before closing its connections. A pass that exceeds the deadline
rolls back and retries after the configured delay.

The [local deployment](local-deployment.md) runs this worker automatically. Its
`usage-reconciler` service restarts unless you explicitly stop it. This does not
create a production deployment. Run `pnpm proof:scheduled-usage` to exercise its
signal path with a transaction blocked by a real PostgreSQL row lock. The receipt
compares committed events and all four source timestamps before and after the
blocked stop, then checks that restart catches up two organisations without duplicates.
Compose allows fifteen seconds to stop; the transaction deadline remains ten seconds.
The proof requires a normal exit before that grace period expires.

## Retry failures safely

One database transaction covers a pass. If any event write fails, the pass records neither partial events nor a newer reconciliation time. In one-shot mode, run the same command again after correcting the failure. The watch
worker retries automatically and logs a fixed message without the database error's
potentially private details.

The existing [operations status](operations-status.md) reports usage as `unknown`
until every source has caught up, then `current` or `stale`. A failed pass leaves the
last successful freshness receipt unchanged, so repeated failures become `stale`
after the configured threshold (300 seconds by default). It does not record an
immediate durable failure flag. Keep the interval below that threshold, allowing
room for pass runtime and backlog catch-up.

A retry with the same type, source kind and source reference returns the existing event. A service-alert source reference can have only one terminal outcome, and the database prevents a terminal outbox status from changing. Reusing a key with a different organisation, venue, quantity, outcome or occurrence time is a conflict and stops the transaction. Treat that as source corruption to investigate. Do not discard or rewrite the earlier event.

History cleanup preserves a backup tombstone, restored recovery, installation operation or terminal alert delivery until its required usage events exist. Reconcile before expecting those source records to become eligible for deletion. Usage events themselves are immutable and are outside the transient-history cleanup policy.

## Read owner totals

The account portal calls `POST /api/account/usage/read` with the selected organisation ID. The route requires the portal Origin, the session cookie, the session CSRF token and current owner membership. It returns decimal strings so a large byte total does not lose precision in JavaScript.

These totals are measurements only. They do not define billable units, free allowances, prices, invoices, excess-use behavior or a metering-outage policy. Decide those rules from operating-cost and abuse evidence before connecting any measurement to service enforcement.
