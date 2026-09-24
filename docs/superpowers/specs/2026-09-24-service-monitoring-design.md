# Local venue monitoring and service alerts

Show owners when a connected test venue has stopped contacting Cloud or its snapshots
need attention. Run from the management database independently of the venue. These are
contact and catalogue checks; external availability probes and production deployment
remain separate work.

## Signals and persisted transitions

A bounded scheduler creates up to 100 missing monitor rows. Each run claims one due
venue using a row lock and SKIP LOCKED, observes its current installation and configured
services, and commits the result, incident transition and email queue records together.
Check each venue once a minute. Skip locked installations and retry failed observations
after 30 seconds, preserving their last-check time and continuing with other venues. No network calls happen under this transaction.
A check older than five minutes is unknown in the portal, even if its last result was
healthy. The worker CLI reports due venues, active incidents and oldest check.

Monitor configured test installations only. Open disconnected after 15 minutes without
control contact; for no prior contact start the grace when monitoring first observes a
configured service. Open snapshot-stale after 48 hours without a currently verified
snapshot, giving newly configured snapshot service the same initial grace. Open
verification-failed when the latest available snapshot remains failed for five minutes.
Record and clear the failure grace when its point or outcome changes. Conditions are
independent; show each active incident with its start time and last check.

Revocation, removal of a service or leaving the test environment suppresses its incidents
and invalidates pending messages without sending a healthy recovery. A later enabling
starts a new grace for missing contact or snapshot data; known older evidence retains its age. A healthy observation resolves an incident; reopening increments a
durable revision. Repeated scans and concurrent monitors produce one transition only.
Do not describe a successful snapshot as full continuous-server recovery.

## Email preference and delivery

One account preference enables service emails for venues the account currently owns,
with English or Spanish selected in the portal. Use the current language at transport
handoff; changing language does not cancel a pending notice. Default off. Permission removal,
disabled accounts, unverified/changed email, opt-out and superseded incident revisions
cancel queued notices when rechecked before transport dispatch. Emails contain fixed
issue descriptions, the venue ID and a link to the signed-in account portal, with no
keys, storage addresses or backup content. Snapshot recovery remains a portal action.

Extend the existing encrypted outbox with service_alert. Return its generated message
ID when enqueueing so a unique incident/revision/account ledger can bind queue records.
The monitor inserts the ledger and encrypted message in the same transaction. Recovery
mail targets only owners whose opening message was actually marked sent. A new owner
or someone opting in mid-incident gets current portal status and future transitions;
there is no retrospective mail blast. A pending opening message cancels after recovery.
SMTP's existing uncertain-acceptance duplication limit still applies; do not claim
exactly-once delivery. Rechecking permission cannot retract a provider-accepted message.

## Portal and API

Extend venue overview with checkedAt, freshness and active fixed incident kinds; derive
membership from the current session as today. Add authenticated GET/POST account alert
preferences with exact Origin, CSRF, strict body validation, shared account rate limit
and current-session recheck. Keep polling passive. Show a compact bilingual preference
control and actionable incident copy. Stale monitoring shows unknown, with the previous
incident evidence retained. No support-staff workflow is introduced.

## Implementation and evidence

1. Add migration 013 (registry/startup guards and counts too), monitor engine and real
   PostgreSQL failing tests for thresholds, concurrency, restart, recover/reopen,
   configuration and revocation. Implement the smallest state machine that passes.
2. Trace every mail-kind consumer, add encrypted notices and live permission checks,
   test deduplication and suppressed delivery, and send both languages through Mailpit.
3. Add preference API and portal incident display; cover membership/session boundaries,
   both languages, phone layout and accessibility with existing browser fixtures.
4. Add a local monitor CLI and status, update runbook/backlog, run focused checks, then
   finish-branch with one isolated Claude run-it review and current-head green CI.
   Land and remove the worktree and branches under the existing owner authorization.
