# Cloud worker scheduling measurement design

## Purpose

Cloud's local workers already use durable database claims, leases and revision fences, but their small-fixture tests do not show how scheduling and notification delivery behave with a larger backlog. The monitor and backup command loops also run a full scheduling sweep before every claim. An incident transition inserts each recipient's encrypted email and delivery row through separate sequential queries.

This change adds a reproducible local PostgreSQL measurement and removes only bottlenecks that the measurement exposes. It does not set a production capacity target or change incident, retry, lease, recovery, revocation or delivery semantics.

## Chosen approach

Use one executable fixture against the repository's disposable PostgreSQL container. It creates deterministic test venues, backup candidates and opted-in owners, then records these phases separately:

1. Monitor and backup scheduling sweeps, including the number and duration of bounded sweeps.
2. Monitor polling with due venues and a locked venue ahead of claimable work.
3. One incident's encrypted email fan-out to many owners.
4. Email backlog delivery with bounded concurrent claims, including oldest-message lag.
5. Restart completion, process memory and graceful shutdown without a new post-signal claim.

The receipt includes schema version, fixture counts, machine details, timings, peak resident memory and assertions. A separate verifier rejects missing phases, unbounded batches, isolation failures, lost work and invalid shutdown evidence. The default fixture is large enough to expose query amplification but remains a local engineering measurement.

Two alternatives were rejected. Query-plan-only evidence cannot measure encryption, transaction and delivery costs. A synthetic in-memory benchmark would miss PostgreSQL locks and lease behavior. Production telemetry is useful later, but it would require deployment and real customer traffic, which this campaign does not authorise.

## Scheduling loop

Add a small shared loop helper used by the monitor, backup and email command runners. Scheduling runs at startup and then at a fixed 60-second cadence, independent of the one-second idle poll. Monitor and email work run in a fixed bounded batch of four concurrent claims. Backup work stays at one claim because restore verification is intentionally resource-heavy.

The helper checks shutdown before each batch and never starts another claim after the signal. Already claimed work finishes normally. The backup worker continues receiving the signal so its verifier can cancel. A failed monitor observation remains isolated and retryable; command-specific error reporting stays unchanged.

`--once` keeps its current contract: schedule once where applicable, process at most one item and print status.

## Notification fan-out

Extend the encrypted outbox with a service-alert batch enqueue operation. It validates and encrypts every recipient in memory, then inserts the messages in one parameterised PostgreSQL statement. The monitor inserts the matching delivery records in one statement in the same transaction.

Generated IDs preserve the existing one-message-per-recipient mapping. Existing unique keys continue to enforce one delivery for each incident revision and account. Any validation, encryption or insert failure rolls back the incident transition and every queued message. Plaintext recipients and alert data remain absent from PostgreSQL outside the authenticated ciphertext and fixed relational identifiers already required for authority checks.

## Correctness boundaries

- Scheduling limits remain 100 candidates per query. Repeated sweeps remain idempotent.
- Claim ordering, `SKIP LOCKED`, claim IDs, lease expiry and revision fences remain unchanged.
- A locked or slow venue cannot prevent another due venue from completing.
- Restarts reclaim or continue durable work without recreating a transition.
- Email remains at least once within its retry and expiry bounds. Bounded concurrency does not claim one row twice.
- Shutdown starts no new claim after the signal. In-flight work follows its existing completion or cancellation contract.
- The fixture uses only local PostgreSQL and a capture mailer. It sends no live email and creates no cloud resources.

## Verification and documentation

Unit tests drive the shared loop and batch-enqueue APIs first. Real PostgreSQL tests cover atomic fan-out, concurrent claims, locked-row fairness and restart. The executable receipt records the baseline before tuning and the final result on the same machine and fixture counts. Documentation reports both measurements as local observations, not production promises, and updates the Service monitoring and Data lifecycle backlog entries.
