# D57: Shared relay admission bounds

Status: implemented local mechanism; production configuration remains open. Read the
[implementation plan](../plans/2026-10-12-relay-admission-bounds.md) with this design.

## Purpose and scope

Different accounts can currently submit to the same recipient without sharing an
abuse budget. Retained encrypted payloads also need a shared storage ceiling.
D57 adds PostgreSQL recipient counters, grant counters and aggregate payload-byte
accounting across API instances. Account allowance units and source/installation
ingress limits stay unchanged. Exact retries reserve nothing extra; conflicting
replays retain `409 message_conflict`.

Cloud owns this mechanism under [documentation ownership](../../documentation-ownership.md),
the [relay contract](../../transactional-email-relay-contract.md) and transactional-email
[backlog entry](../../backlog.md#free-services-for-open-source-waitron).
Production thresholds remain reserved to the owner. No provider, Waitron caller,
campaign, production enablement or production default values belong to this work.

## Explicit configuration and counters

Require `bounds` in injected `RelayAdmissionConfig`; normal startup still has no
relay configuration or routes. Required `RelayBoundsConfig` fields are `version`,
`epoch` (canonical UTC window origin), `windowSeconds`, `recipientLimit`, `grantLimit`,
`queuedPayloadBytes`, `maxCounterRows`, and separate `recipientKeys: RelayKeyConfig`.
Require positive safe integers, at least three counter-storage rows, valid dates
and key IDs, the existing policy-version syntax, and 32-byte hex keys with an available active key. Reject unknown
fields, missing fields, future epochs at use, and malformed configuration.

Design choices: fixed windows shared by both counters, all three message classes
combined, and PostgreSQL time sampled after lock waits. The recipient identity is
a keyed fingerprint, HMAC-SHA256 over `['relay-recipient-budget-v1', normalisedRecipient]`, independent
of account, installation and grant. Never persist raw recipients outside existing
ciphertext. Count grants by stable grant ID, across revisions. A successful new
admission increments each counter once; cancellation/delivery never refunds it.

Persist one immutable policy definition per schema. Compare every configured
instance against it, excluding active key selection and supplied key-ring membership.
Changing version, limits, epoch or duration fails closed rather than resetting
budgets. Policy replacement is outside D57.

For each window, pin one recipient key ID and a separately tagged HMAC key verifier
in PostgreSQL. Every instance uses that pinned key, regardless of its active key.
Verify supplied material matches every live pinned key; a missing or changed key
returns `503 relay_unavailable`. Active rotation affects only a later window; its
first admission selects the shared key under the admission lock. Overlapping rings
allow different active IDs across instances. After expiry, old budget keys can be
retired independently of payload/replay/suppression keys.

Use `relay_bounds_policy`, `relay_bounds_windows` and `relay_bounds_counters`;
counter rows have `(window, kind, subject, count)`, indexed expiry and uniqueness.
`maxCounterRows` bounds window and counter rows together. Prune expired
rows before admitting; reject new rows at capacity. Add an opt-in
`relayAdmissionCounters` history-cleanup category for idle periods, using the same
admission lock and database expiry checks. Cleanup never deletes live counters,
messages or reservation/replay tombstones. An unscheduled idle fixture can retain
expired rows, but cannot grow beyond its configured ceiling.

## Atomic admission and precise bytes

Preserve `RelayMessages.execute`'s message-identity and grant/authority lock order.
After `RelayGrantStore.reserve` and locked signature/lease verification, acquire one
schema-scoped transaction advisory lock to check shared policy and live keys.
For a new message, reserve both counters and insert sealed ciphertext.
Recheck deadlines after waiting. Derive grant identity from locked authority,
never caller attribution. Replays check configuration but skip increments.
Budget refusal returns `429 rate_limited`; unavailable configuration returns `503`.

The INSERT can wait again on the byte tally. After it completes, sample fresh
PostgreSQL time and reverify the signed proof, lease, installation/grant deadlines
and message expiry before commit. Do not acquire new authority or message locks
after the tally: reuse already locked authority and verified lease data. If the
reserved counter window ended during the wait, roll back the whole admission with
`503 relay_unavailable` and a one-second retry hint; do not transfer or commit an
old-window reservation. Existing proof/authority error codes remain unchanged.

Migration `034_relay_admission_bounds.sql` adds a nonnegative `bigint` one-row tally,
`relay_queue_bytes`. Its exact invariant is
`sum(COALESCE(octet_length(relay_messages.payload), 0))` across all rows.
Count the actual stored buffer: 12-byte nonce, 16-byte authentication tag and
UTF-8 encrypted JSON including management origin. Exclude database/index overhead,
plaintext, wire/base64 size and other email queues. Queued and sending payloads,
including claimed, delayed, expired-but-retained and unreadable content, count.

An AFTER INSERT/UPDATE/DELETE trigger applies the payload-length difference through
an atomic conditional tally update. Positive growth requires the persisted cap;
no policy means growth fails closed. Zero differences need no tally lock; decreases
remain possible above cap. Missing tally/underflow fails closed. AFTER TRUNCATE
resets accounting for disposable fixture cleanup. Clearing/removing payload releases
bytes exactly once. Any refusal or later failure rolls back counters, account
reservation, tally and message together.

Workers never take the admission lock. Every production message mutation touches
one message, takes its existing row/authority locks first and the byte tally last;
afterward it acquires no other message or authority lock. Preserve existing worker
ordering. This avoids a tally-holder waiting on a worker's message row.
Bulk maintenance requires stopped consumers.

Seed the tally from existing ciphertext while consumers are stopped. Do not rewrite
payloads or fabricate historical recipient/grant counts: those budgets start at
first configured use. Existing bytes may exceed a chosen local cap; refuse growth
until payload clearing creates room. Keep release-manifest name/digest gates,
transactional migration retry and separate-backup recovery conventions.

Expose only aggregate byte/count status and fixed errors. No address, digest, key
or message labels in metrics or diagnostics. The [executed local checks](../../transactional-email-relay-contract.md#exercise-shared-admission-bounds)
cover HTTP/PostgreSQL contention, worker paths, rotation, rollback and guard deletion.
