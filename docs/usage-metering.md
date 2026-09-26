# Measure Cloud service usage

Cloud needs a trustworthy account of the work it performs before you can use those measurements for capacity planning or a future commercial policy. The usage ledger records facts that the existing services already know. It does not charge a customer, enforce an allowance or change service access.

## What Cloud records

Each event belongs to one organisation and, when the source has one, one venue. The event also names a fixed source kind and source reference. That pair makes a retry return the original event instead of increasing a total twice.

The current ledger records:

- snapshot bytes added to and removed from retained storage;
- snapshot bytes uploaded and restored;
- completed installation operations;
- accepted public and staff monitoring probes; and
- service-alert messages that reached a terminal `sent`, `failed`, `expired` or `cancelled` state.

The snapshot storage total is bytes added minus bytes removed. The transfer totals count snapshot publication and completed snapshot restores. A monitoring result contributes one event for each accepted public or staff observation. Replayed or older observations do not add another event.

Continuous-backup stream bytes are not available from the current durable sources, so they are excluded. Account-level identity mail is excluded because it has no organisation or venue attribution. Restored snapshot bytes begin with receipts written after migration `025_usage_metering.sql`; older recovery rows do not contain a trustworthy restored time and are not backfilled. The portal says so explicitly instead of presenting incomplete history as complete coverage.

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

The command performs one pass and exits. Your deployment scheduler must run it repeatedly. This repository does not create that schedule or any live infrastructure.

## Retry failures safely

One database transaction covers a pass. If any event write fails, the pass records neither partial events nor a newer reconciliation time. Run the same command again after correcting the failure.

A retry with the same type, source kind and source reference returns the existing event. A service-alert source reference can have only one terminal outcome, and the database prevents a terminal outbox status from changing. Reusing a key with a different organisation, venue, quantity, outcome or occurrence time is a conflict and stops the transaction. Treat that as source corruption to investigate. Do not discard or rewrite the earlier event.

History cleanup preserves a backup tombstone, restored recovery, installation operation or terminal alert delivery until its required usage events exist. Reconcile before expecting those source records to become eligible for deletion. Usage events themselves are immutable and are outside the transient-history cleanup policy.

## Read owner totals

The account portal calls `POST /api/account/usage/read` with the selected organisation ID. The route requires the portal Origin, the session cookie, the session CSRF token and current owner membership. It returns decimal strings so a large byte total does not lose precision in JavaScript.

These totals are measurements only. They do not define billable units, free allowances, prices, invoices, excess-use behavior or a metering-outage policy. Decide those rules from operating-cost and abuse evidence before connecting any measurement to service enforcement.
