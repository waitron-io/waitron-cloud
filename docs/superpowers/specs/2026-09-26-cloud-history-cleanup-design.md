# Cloud history cleanup design

## Outcome

Cloud operators need a controlled way to remove transient historical records before the management database grows without bound. The cleanup must not invent legal retention periods, erase active authority, break retry or idempotency guarantees, or make a protected backup disappear.

This change adds one PostgreSQL-backed cleanup runner. You give it a policy file with exact RFC 3339 cutoff timestamps. It reports what is eligible by default and changes data only when you add `--apply`. An omitted category is disabled, so installing the code cannot start deletion.

## Policy and operator contract

The policy is a JSON object with a `cutoffs` object and an optional `chunkSize` from 1 through 1,000. The accepted cutoff keys are:

- `sessions`
- `signupRequests`
- `passwordResetRequests`
- `webauthnCeremonies`
- `pairingRequests`
- `registrationOperations`
- `emailDeliveries`
- `backupJobs`
- `recoveryHistory`
- `backupTombstones`

Each supplied value is an exact RFC 3339 timestamp with a timezone. There are no default cutoffs. Unknown keys, invalid dates, dates without an explicit timezone, duplicate CLI modes and invalid chunk sizes fail before a database mutation.

Run `pnpm history:cleanup -- --policy ./history-cleanup.json` for a dry run. Add `--apply` to delete at most one chunk from each enabled category. The command prints a schema-versioned JSON report containing the mode, cutoff, eligible count, blocked count, deleted count and whether eligible rows remain. Re-run the same command until every enabled category reports `hasMore: false`.

## Safety model

Every apply category runs in its own short transaction. Candidate rows are selected in stable order with `FOR UPDATE SKIP LOCKED`, then the delete repeats the eligibility predicate. This makes a run resumable and prevents a cleanup worker from waiting behind a live worker or deleting a row whose state changed after selection.

The runner takes a transaction-scoped advisory lock for each category. Two cleanup processes can make progress without deleting the same row. Normal application workers remain authoritative because the runner skips their locked rows and rechecks current state.

Deletion eligibility is deliberately narrower than age alone:

- Sessions must already be ended or expired by the existing 30-minute idle or 12-hour absolute policy. A live WebAuthn registration ceremony blocks deletion.
- Signup and password-reset requests must be consumed or expired. A pending or processing email with the same token blocks deletion.
- WebAuthn ceremonies must be consumed or expired.
- Pairing and registration request rows must be completed or expired. This retains replay results until the configured cutoff.
- Installation operation results are deleted only after their configured cutoff. Revocation records and hostname-change records remain audit history and are not part of transient cleanup.
- Email rows must be terminal. A service-alert delivery is removed in the same transaction before its outbox row. Pending and processing delivery work is never eligible.
- Only completed backup jobs are eligible. Pending, running and failed jobs remain available to workers or explicit retry.
- Recovery history must be closed and expired. The runner removes an approved request and completed replacement reference before its recovery operation. Active operations and incomplete replacements remain.
- A backup point must already be an object-store tombstone with `deleted_at` set. It must not have any recovery reference, and it must not be the latest surviving verified snapshot for its venue. Verification rows and completed verify jobs are removed before the point, followed by its already-cleaned capture row when nothing refers to it.

`venue_incidents`, `venue_monitors`, `remote_probe_observations` and active backup catalogue rows are current-state tables with bounded keys, not append-only history. Cleanup reports their classification in the operator documentation and does not delete them. The same is true of installation revocations, hostname changes and security audit data. A later retention decision can add a separate category without weakening this runner.

## Database access and indexes

Cleanup lives in `@waitron-cloud/registration` because that package owns the management schema and migrations. The runner accepts a PostgreSQL `Pool`; it does not depend on portal or HTTP state. A migration adds partial or ordered indexes for the eligibility scans. It changes no fiscal or customer-facing data semantics.

The CLI requires `DATABASE_URL` and `--policy`. It uses the same migration gate as the other production CLIs, so an unmigrated database fails closed.

## Verification

Real PostgreSQL tests create old and recent rows for every category. They prove dry-run immutability, exact cutoffs, chunked restart, foreign-key order, preservation of live sessions and ceremonies, pending email and jobs, current incidents, active recovery, protected snapshots and rows locked by another worker. A separate CLI test proves that apply requires an explicit flag and that invalid policy files fail without writes.

The focused registration suite and workspace typecheck are the local gate. Cloud CI owns the full workspace suite.
