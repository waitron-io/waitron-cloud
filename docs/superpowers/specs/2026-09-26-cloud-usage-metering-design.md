# Cloud usage metering design

## Outcome

Cloud owners need an honest view of the service usage that Cloud can already observe. This change records tenant-attributed storage bytes, transfer bytes, completed operations, monitoring probes and terminal administrative alert outcomes. It shows totals and measurement freshness in the account portal.

The result is an operational measurement ledger, not a billing ledger. It does not choose prices, free allowances, quotas, invoice allocation, provider costs or a retention period. It never blocks an account action, password reset or service because a customer crossed an invented limit.

## Event model

`usage_events` is an immutable ledger. Each event has a generated stable UUID, organisation and optional venue, a fixed event type, a positive integer quantity, a fixed source kind and bounded source reference, the source occurrence time and the database recording time. There is no arbitrary metadata or error-text column. A service-alert source has exactly one outcome event, and its terminal outbox status cannot change after it becomes a reconciliation source.

The first event types are:

- `backup.storage_added_bytes` and `backup.storage_removed_bytes` for a retained snapshot;
- `backup.upload_bytes` for a published retained snapshot;
- `backup.restore_bytes` for a snapshot recovery that the replacement target reports restored;
- `operation.installation_completed` for a durable installation operation result;
- `operation.monitoring_probe` for each accepted public or staff functional-probe observation; and
- `message.service_alert_sent`, `message.service_alert_failed`, `message.service_alert_expired` and `message.service_alert_cancelled` for terminal, tenant-bound alert delivery outcomes.

The event type implies its unit: the four backup events use bytes and the operation/message events use a count of one. Quantities must be positive. Current retained storage is added bytes minus removed bytes; the other totals are cumulative and are never used as a balance or entitlement.

A unique `(event_type, source_kind, source_reference)` key makes producer retries idempotent. An identical retry returns the original event ID. Reuse of that key with a different tenant, venue, quantity or occurrence time fails closed instead of rewriting history. Database triggers reject event updates and deletes.

## What is measured

Retained snapshot rows contain an observed byte size, so publication produces both a storage-add event and an upload event. A completed object deletion produces a storage-remove event. A snapshot recovery produces a restore-transfer event only after the authenticated target reports the operation restored. The recovery row gains a first-write `restored_at` timestamp so reconciliation does not infer completion time from request creation.

Managed continuous streams expose a generation and recovery point but not transferred or retained byte counts to Cloud. This change reports them as not measured rather than estimating them. Cloud also does not proxy the object-store download, so the snapshot restore total is the known snapshot size associated with the target's successful restored receipt, not a claim about provider egress billing.

Every durable `installation_operations` result counts as one completed operation. Each newer accepted `remote_probe_observations` update counts as one monitoring operation. The probe source reference contains the installation, public/staff service and exact checked-at timestamp, so a retried observation cannot increment the total twice.

Only `service_alert` deliveries have an unambiguous organisation through their incident and venue. Their terminal sent, failed, expired or cancelled state becomes one outcome event. Signup, password-reset and password-changed mail is account-level or pre-account and may span multiple organisations; it is excluded rather than attributed arbitrarily. The portal explains this boundary.

## Recording and reconciliation

`recordUsageEvent(client, input)` validates the fixed contract, checks that the venue belongs to the organisation, inserts idempotently and verifies an existing duplicate field for field. It accepts a caller's PostgreSQL transaction so an ephemeral source can be recorded atomically.

Probe observations overwrite their prior row, so the accepted observation and its usage event commit in the same transaction. If the usage write fails, the observation update rolls back and freshness cannot imply that it was recorded. Retrying the same observation produces one event.

The other sources are durable rows. `UsageReconciler.runOnce(limit)` scans them in bounded batches and reconstructs missing events:

- retained snapshot publication and deletion from `backup_points`;
- restored snapshot transfers from `backup_recoveries` plus `backup_points`;
- completed management operations from `installation_operations`; and
- terminal service-alert outcomes from `service_alert_deliveries`, `email_outbox`, incidents and venues.

It serialises workers with a database advisory transaction lock. Each source has `last_attempted_at` and `caught_up_at` state. A source advances `caught_up_at` only when the scan proves fewer than the batch limit remain. A failed transaction writes no events and advances no state. Re-running after an interruption or lost reply fills the gap, while the event uniqueness rule suppresses duplicates.

History cleanup must not remove an installation operation, terminal alert delivery, restored recovery or backup tombstone while its required usage event is missing. This keeps the durable source available for reconciliation without extending the customer's service authority.

The CLI runs one bounded pass by default and can print status. Deployment scheduling remains an operations decision; this change documents the command but does not deploy a worker or create live resources.

## Owner totals and freshness

`UsageStore.summary(token, input)` accepts an organisation UUID. It resolves the session without extending activity, holds a current owner membership through the read, filters every event by that organisation and rechecks the session before returning.

`POST /api/account/usage/read` requires the exact portal Origin, session cookie, CSRF token, normal account rate allowance and exact JSON `{organisationId}`. Its schema-versioned response contains decimal strings so totals cannot lose precision:

- current, added and removed retained-snapshot bytes;
- uploaded and restored snapshot bytes;
- completed installation-operation and monitoring-probe counts;
- sent, failed, expired and cancelled service-alert counts;
- the latest event time; and
- `measuredThrough`, the oldest `caught_up_at` across required reconciliation sources, or `null` until every durable source has completed a pass. This is scan freshness rather than an event-time completeness boundary because a source transaction can commit after a pass with an older occurrence time.

The account portal adds a usage section for the selected organisation. It labels the totals as measurements, shows the oldest completed source scan, distinguishes stale/not-yet-measured data from zero, and states that continuous-stream bytes, account-level identity mail and pre-metering restore history are not included. The section follows the existing English/Spanish, responsive and theme-aware portal patterns.

## Failure and privacy rules

- Every event has one organisation; reads and totals never combine organisations.
- A source-key collision with different event content is an integrity error.
- A reconciliation failure rolls back the batch and does not advance freshness.
- A lost successful reconciliation reply is safe to retry and does not double count.
- Owner removal serialises with a summary read; the next read is denied.
- No event stores object keys, digests, hostnames, email addresses, message IDs, tokens, credentials, recovery keys or raw provider errors.
- No total changes rate limits, password recovery, service availability, invoice data or fiscal records.

## Verification

Real PostgreSQL tests prove immutability, tenant/venue binding, stable duplicate IDs, conflicting duplicate rejection, bounded restartable reconciliation, lost-reply replay, source cleanup guards, failure rollback and freshness. Source tests prove restored timestamps and exact probe retry behavior. Account HTTP tests prove exact input, Origin/CSRF/session enforcement, passive owner reads, current ownership, cross-tenant denial and precision-safe strings.

Portal controller and browser tests cover loading, unavailable/not-yet-measured states, large byte totals, English/Spanish copy and organisation switching. The finished screen is inspected at desktop and phone widths in supported themes. Focused package tests and affected typechecks are the local gate; Cloud CI owns the full workspace suite.
