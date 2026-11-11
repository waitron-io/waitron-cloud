# Registration state

Cloud passkeys use durable five-minute WebAuthn ceremonies and account-scoped
credential rows from migration `019_passkeys.sql`. `PasskeyStore` requests
discoverable, user-verified credentials, verifies the configured portal origin and
RP ID, and consumes every completion challenge once. Enrolment and removal also
require the live session, its CSRF token and the current password. Password reset
continues to end sessions but deliberately leaves passkeys enrolled.

This internal package stores an installation's approved connection to an organisation
and legal business. PostgreSQL transactions coordinate workers, so they can retry
completion without creating duplicate venues or installations.

## Trust boundary

You must verify identities and approvals before calling this package. The low-level RegistrationStore methods remain internal. PairingStore adds the
Cloud half of a signed matching-code exchange; its HTTP adapter lives in account-http.
The real Waitron administrator check and renewable machine credentials are separate work. An installation
key identifier, account ID or local receipt ID is a reference, never a credential.
Do not expose these methods directly as public endpoints.

The surrounding service must supply the authenticated installation's canonical key
identifier. The local approval adapter must verify local administrator authority and
issue a unique receipt bound to the complete request. Browser-facing adapters must use `approveCloudWithSession` with its session and CSRF
tokens. The account-ID approval method is reserved for trusted adapters. This package also checks the
account's current registration permission in PostgreSQL when approving and completing.

The [identity package](../identity/README.md) now supplies password sessions and
explicit platform permission checks, adapted from `pre-sqlite-migration`. The
[account API](../account-http/README.md) implements signup, login and recovery routes.
The pairing endpoints are implemented for local integration. Additional authentication
factors and the platform role catalogue remain open.

## Cloud account signup

Use `SignupStore(pool, outbox)` for the independent Cloud account backend. Its
`request(email)` method saves the verification request and encrypted pending email
in one transaction. It returns `{ status: 'accepted' }`, including during the
one-minute cooldown, without waiting for a mail provider. The worker decrypts the
token for delivery; never include it in a browser response or logs. The current email
parser accepts ASCII dot-atom addresses. International domains must already be
punycode-encoded; raw Unicode domains, quoted addresses and international local parts
need later normalisation/provider support.

Once you have the emailed token, call `complete(token, { password, organisationName,
legalBusinessName, countryCode })`. It returns `{ accountId, organisationId,
legalBusinessId }` after creating all three records and the owner's membership in one
transaction. New passwords require at least 15 Unicode characters and at most 1024
UTF-8 bytes. Names have a 200-character limit. Supply a two-letter country code; this
records a declared country, not verified tax details or a hosting location.

Pass an optional `PasswordScreeningProvider` as the third `SignupStore` constructor
argument to enforce compromised-password screening. The provider receives only the
already bounded candidate password, receives an abort signal, and returns `acceptable`
or `compromised`. Screening fails closed after one second; providers must stop work when
the signal is aborted.
`LocalPasswordCorpus.load(path)` is the implemented provider: it compares a local
lowercase SHA-256 corpus and performs no network request. A compromised result raises
`password_compromised`; a provider failure or invalid result raises
`password_screening_unavailable`. Both happen before password hashing or token
consumption, so the same link remains usable after the person chooses another password
or the provider recovers.

The token expires after 30 minutes and works once. Resending keeps earlier live links
valid, but email uniqueness permits only one signup. A lost success reply is recovered
by signing in with the chosen password through the existing identity API. Replaying
a token cannot create a session, reset a password or add another organisation.

`signup_invalid` identifies malformed input. `verification_unavailable` covers an
unknown, expired or used token and an email that already has an account.
Delivery failures are recorded by the worker. Temporary failures retry automatically;
permanent rejections stop retrying. Database or
queue failures still reject the request and roll back both records. The worker uses
fixed error codes and never persists a provider's error message. See
[reliable account email](../../docs/email-delivery-implementation.md) for the key
configuration, retry limits and local commands.

The integration tests use an in-memory capture mailer and disposable PostgreSQL:

```sh
pnpm test
```

They exercise signup, login, concurrent links, delivery failure and a fresh-process
completion. Mailpit captures local SMTP delivery. The production SMTP adapter is
tested against a local authenticated TLS server. The account HTTP routes are implemented;
a live provider is not configured. The
[signup plan](../../docs/cloud-signup-implementation.md) records the public deployment
gates. `email_verified_at` records proof for this flow; the older trusted provisioning
path owns its verification policy. `is_owner` records the initial customer owner and
does not imply platform permission or introduce a full organisation role catalogue.

## Password recovery

Use `PasswordRecoveryStore(pool, outbox)` with the same queue. Supply the same optional
`PasswordScreeningProvider` as its third constructor argument. The worker's mailer implements `sendPasswordReset`
with the same `{ email, token, expiresAt }` shape as signup and `sendPasswordChanged`
with `{ email }`. `createLocalAccountMailer()` implements the worker's delivery interfaces and
delivers to Cloud's loopback-only Mailpit. See the [local inbox commands](../../README.md#local-email-inbox).

`createSmtpAccountMailer(config)` supplies the same methods for production relays.
The worker passes an optional second argument, `{ deliveryId, signal }`, containing
its queue UUID and cancellation signal. The SMTP adapter returns
`{ transport: 'smtp', messageId }`; existing capture/local adapters may return nothing.
The worker saves receipts only while it still owns the claim. Use the
[production email guide](../../docs/production-email-implementation.md) for relay
configuration, retry classification and the live-delivery requirements.

`request(email)` returns `{ status: 'accepted' }` for eligible, unknown, disabled,
unverified and passwordless accounts, during cooldown, and when delivery fails. Only
enabled accounts with verified email and an existing password receive a reset link.
Normalised addresses have a shared one-minute cooldown. Unknown addresses also have
request records but no usable account binding or queued email. Delivery runs in the
background. Public response timing still needs assessment because database paths differ.

`complete(token, newPassword)` returns `{ status: 'completed' }` after changing the
password, consuming the token, ending all that account's sessions and queuing a
password-change notification in one transaction.
It does not issue a session. Sign in normally afterwards, including after a lost reply.
Passwords and screening follow signup's policy. `recovery_invalid` identifies an invalid email or
new password; `reset_unavailable` covers malformed tokens, unknown, expired, consumed
or invalidated links and accounts
that are no longer eligible. Account email, verification and permissions do not change.
Compromised or unavailable screening leaves the password, sessions and reset link unchanged.

Reset links last 30 minutes. A password-hash fingerprint invalidates every earlier link
after a password change, including resetting to the same password. Resending a request
keeps live links usable. Completion checks the account's current email and verification,
so an old link cannot change a different email's password or re-enable a disabled account.
The account lock serialises completion with login; a login committed first is revoked,
and an old-password login waiting behind reset must fail its credential recheck.

Emails are sent after commit. The queue encrypts recipients and tokens, retries failures
and discards expired or invalidated links. A notification queue failure rolls back the
reset; a later delivery failure cannot undo it. The [history cleanup command](../../docs/history-cleanup.md)
can remove terminal request and delivery metadata after you configure exact cutoffs.
Security-audit retention remains separate. Password reset is not MFA recovery. The
account API implements HTTP protections; recovery screens and the
[remaining deployment requirements](../../docs/password-recovery-implementation.md)
are separate work.

## Customer security audit

Migration `022_security_audit.sql` adds the immutable `security_audit_events` table.
Pairing Cloud/local approvals, installation credential renewals and revocations, and
backup recovery/replacement approvals append fixed-shape events inside the transaction
that changes authority. Repeated successful operations keep one stable event ID; an
event conflict or insert failure rolls the protected action back.
Credential-renewal event sources combine the installation with its installation-scoped
operation ID, so separate installations may reuse the same operation UUID.

`SecurityAuditStore.page` passively resolves the session, requires current organisation
ownership and returns a newest-first cursor page. The table deliberately has no arbitrary
payload column, so callers cannot persist codes, tokens, public keys, leases or recovery
credentials. The [customer guide](../../docs/security-audit.md) documents the HTTP export
and its limits. The transient history-cleanup command never deletes these rows; audit
retention and account deletion require a separate policy.

## Temporary support grants

Migration `026_support_grants.sql` adds customer-approved, expiring grants for an
existing platform account. `SupportGrantStore` keeps customer approval separate from
platform eligibility. Its eligibility-permission and grantable-action configuration
defaults to empty, so the core is disabled until both catalogues are explicitly
supplied. Approval never creates a platform account or permission.

`approve` requires a live owner session and CSRF token, an existing enabled platform
account with one configured permission, a tenant-bound optional venue, configured
actions and an explicit future expiry. `revoke` lets any current organisation owner
end the grant early. `authorize` runs protected PostgreSQL work in one transaction and
checks expiry, revocation, the original approver's ownership and platform eligibility
before and after the callback. Keep external side effects outside that callback because
PostgreSQL cannot roll them back.

The three fixed audit events expose no reason, action parameters, callback result or
session material. No HTTP route or production support action uses this primitive yet.
See [temporary support grants](../../docs/temporary-support-grants.md) for the adapter
example, errors and remaining platform-policy boundary.

## Usage metering

Migration `025_usage_metering.sql` adds an immutable, organisation-scoped usage ledger.
`recordUsageEvent` makes retries idempotent by fixed event type, source kind and source
reference. `UsageReconciler.runOnce()` fills events from durable snapshot, recovery,
installation-operation and service-alert sources in one bounded transaction. Accepted
monitoring probes write their events atomically with the observation because their source
row is overwritten in place.

Run `pnpm usage:reconcile --once` with `DATABASE_URL` for one pass, or use
`pnpm usage:reconcile --status` to inspect source freshness. Scheduling is the surrounding
deployment's responsibility. Reconcile before transient-history cleanup so the guarded
source records can become eligible for deletion. The
[usage metering guide](../../docs/usage-metering.md) defines the recorded units, exclusions,
failure behavior and owner summary. These measurements do not implement billing or limits.

## State and completion

`start(binding)` records the binding after an organisation and legal business have
been selected. PairingStore records the earlier Cloud approval; the confirmation screens follow separately.
The binding contains an operation UUID, installation key identifier, local venue UUID,
environment, organisation UUID and legal-business UUID. UUIDs use lowercase canonical
text. Key identifiers and environments must already be canonical; this package does
not parse certificates or determine which key formats the protocol will accept.

A request expires after ten minutes, measured by PostgreSQL. This internal default is
subject to the approval protocol's final policy. Repeating `start` never extends it.
An operation ID is scoped to its installation key; changing other binding fields is
an error. A different installation cannot consume the request or its approval receipt.

`approveLocal` and `approveCloud` persist the approvals. For a new registration,
`complete` locks the request, checks both approvals and current permission, and records it in the
same transaction as its venue, installation and service rows. Permission rows remain
locked until commit. Expiry is checked after lock waits using wall time. A completed
request can return its original result after expiry, provided its installation remains
active. Retrieving that recorded result is independent
of the original approver's current permission; it cannot issue credentials or create
another link. New completions always require current Cloud permission.

Local venue UUIDs are unique within an environment in this registry. A conflicting
organisation, legal business or installation is rejected rather than silently taking
over the record. The approval protocol must establish the provenance of that local
identifier; knowing it grants no access. Server replacement and resolving cloned
local identities require a separate flow. An installation key can belong to only one
venue, and this slice permits one installation per venue, including revoked records.
The replacement implementation will need an explicit migration for installation history.

`configuration(authenticatedInstallationKey)` returns only the matching active
installation's registration and three service states. Remote access, continuous
backup and retained snapshots all start as `unconfigured`. This is a state projection;
versioned network configuration, machine credentials and provisioning come later.
A query already in flight may finish as revocation commits. Later queries are denied.

## Development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

The test command requires Docker. It starts PostgreSQL 18 and Mailpit on random loopback
ports, creates random test schemas and removes its containers and volumes afterwards. It
never uses `DATABASE_URL`. To use your own disposable PostgreSQL instance, set
`TEST_DATABASE_URL`, `MAILPIT_TEST_URL` and `MAILPIT_TEST_SMTP_PORT`, then run
`pnpm test:registration`. Use a disposable inbox as well as a disposable database.

Tests use independent database connections and observe blocked workers through
`pg_stat_activity`. Separate Node processes prove that pending approvals and committed
results survive application restarts. Terminated database connections must reject the
transaction without killing the process, and its pool must remain usable. These are
connection-failure tests, not database failover tests. The application that owns the
pool must also handle its idle-connection `error` events.

To apply the schema to a development database, set `DATABASE_URL` in your shell and run:

```sh
pnpm db:migrate
```

Migrations run in a transaction under a database advisory lock, which makes concurrent
migration runners wait their turn. Applied SQL files are checked against recorded
hashes; add another migration instead of editing a file that has been applied.
The library does not migrate on import. Registration assumes existing accounts and
organisations; call `SignupStore` explicitly to create them through email proof.
Deployment credentials and database privileges remain to be designed before public use.

After you choose deployment-specific retention cutoffs, preview bounded transient-history
cleanup with `pnpm history:cleanup -- --policy <path>`. The command changes nothing unless
you add `--apply`. See [Bound management history](../../docs/history-cleanup.md) for the
policy format, category guards and repeat-until-complete procedure.

## Signed pairing

The pairing, machine-proof and access-lease functions use the pinned
`@waitron-io/contract@0.2.9` release from Waitron. The existing Cloud exports remain;
Cloud keeps issuer-key parsing, configured trust and fixed wire vectors. Shared
format checks live in Waitron's signing tests; Cloud retains its trust, action and
consumer checks. Follow the [shared-package update guide](../../docs/shared-ui-release.md#prepare-private-signing-packages-for-disposable-tests)
before changing the pin.

Use `verifyPairingProof(payload, signature, origin, action)` before calling the machine
methods of `PairingStore`. It accepts the canonical version 1 Ed25519 format in the
[pairing design](../../docs/superpowers/specs/2026-09-23-venue-pairing-design.md).
The HTTP adapter applies host, origin, body, session and persistent rate checks.
A signed machine request alone is not local administrator proof: the real Waitron
adapter must guard start and completion with its local administrator session.
The matching code plus local confirmation joins that session to the Cloud approval.

PairingStore saves the selected account and business and wraps RegistrationStore in
one transaction at completion. RegistrationStore may borrow that transaction's client;
its caller then owns commit, rollback and release. Failed-code increments commit before
the refusal is returned. Neither code nor timestamp retries extend the pairing expiry.
Tests cover separate workers and processes, contention expiry, permission loss, revoked
results, and upgrade from the seven-migration schema with an existing installation.

PairingStore requires separately supplied verification keys for code checks. See
[pairing key configuration, upgrade and rotation](../../docs/pairing-code-keys.md).
Signed status and completion keep their existing machine-proof and approval checks.

## Venue-level relay checks in test fixtures

Use the explicit `test-venue-levels` permission mode for venue-level billing fixtures.
Pass it as the third argument to `RelayGrantStore` and `RelayWorker`, or the sixth
argument to `RelayMessages`. Their default remains `existing`; the account HTTP
app passes its selected mode to message admission.

Mail remains available at registered, connected and hosted levels. Each approval,
message admission and handoff reads the venue policy before locking its installation.
You still need a verified owner, explicit consent, verified origin, a current grant
and an available account allowance. A billing transition creates no mail grant and
cannot bypass an operator stop. For private fixtures, worker commands select this
mode with `CLOUD_VENUE_SERVICE_LEVELS=test` and `CLOUD_TEST_SERVICE_PLANS=0`.
Conflicting or invalid flags refuse startup before database work. The checked-in
deployment keeps the mode dormant; production release qualification remains open.

## Monthly allowances in test fixtures

Add `{mode:'test',calendar:'UTC'}` as the fourth argument to `RelayGrantStore` or
`RelayWorker`, or the seventh argument to `RelayMessages`, to exercise monthly
allowances with `test-venue-levels`. The account app and listener accept the same
value as `allowances`. Publish your synthetic limits through `AllowanceConfigStore`
before admitting work; there are no production size defaults.

For account and translation worker commands, set `CLOUD_TEST_ALLOWANCES=1` and
`CLOUD_ALLOWANCE_CALENDAR=UTC` alongside the venue-level flags above. Invalid or
incomplete combinations refuse before database connections. Leave both allowance
variables absent to preserve the existing behavior. The dedicated test runtime
forwards these options only to its existing service consumers and keeps translation
and external provider credentials disabled.

Relay admission commits one spent monthly unit with its original reservation and
queue row. Delivery, cancellation, failure and expiry retain that unit. Replays and
worker restarts check the original debit rather than spending from another month.
The existing relay policy, owner, consent, origin, grant, lease and operator-stop
checks still apply. Translation holds the requested items when queuing a job and
spends them under its current worker lease before a provider call; its separate
money safety cap remains in force. These adapters do not enable production billing.

The full allowance guard set runs nightly. To check it directly, run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=240000 test/billing-allowance-guards.nightly.ts
```

The wrapper checks two trial rules and fourteen service, traffic and ownership
guards. In an installed disposable candidate, each check runs the named behavior,
changes one guard, requires the expected assertion failure, restores the original
bytes and runs the behavior again. The operational-traffic check uses an isolated
rendered HAProxy and PostgreSQL fixture with real TLS probes over three controlled
UTC dates. It requires Docker. Missing cases, skipped tests, setup failures and
undetected changes refuse qualification. Upgrade and two-backup recovery remain
separate checks; passing the guard wrapper does not qualify either recovery path.

To check the current release and both backup paths, run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=360000 test/billing-allowance-upgrade-recovery.test.ts
```

Schema receipt version 11 uses `--mail-handoff` to bind the exact 47-to-50
predecessor and clean candidate. It retains every allowance and feedback check,
and requires existing local blocks to survive without a guessed scope after
upgrade and both backup paths. Populated mail-attempt and mapping recovery are
not claimed here. Historical versions 9 and 10 retain their strict 47-to-48 and
47-to-49 pairs.
The proof interrupts the migration, checks complete rollback, then retries with
concurrent consumers stopped. It restores the old backup to an empty, unenabled
allowance schema, and separately restores a populated new backup. Matching external
keys and signed spool bytes retain configuration revisions, held/spent/released
units, unfinished-call markers, reporter identity, gaps and exact traffic totals.
Replaying pending or older spool checkpoints cannot add bytes or reset identity.
Wrong keys and foreign owners refuse access. Historical proofs 1–9 keep their
original schema pairs; their wrappers execute the original installed release.
These are local PostgreSQL and synthetic-account checks, not a live recovery or
production billing qualification.


## Keep mail attempts bound before a future provider handoff

A provider event can arrive after you have erased a mail payload. Migration 049
adds a separate attempt ledger with opaque tags and keyed recipient references,
so you can retain the binding without retaining the address, body or token.
`admitMailAttempt` checks the current queue claim and commits no mail itself.
Its caller must commit the transaction before SMTP starts. You can supply the
optional internal `ses: {config, recipientKeys}` worker setting to exercise that
boundary with synthetic qualification. Ordinary startup does not enable SES.

Each call to `lockMailScope`, `admitMailAttempt`, `recipientIsSuppressed` and
`bindProviderId` requires an open transaction. Commit admission before SMTP.
Bind the provider receipt in a later transaction after SMTP returns; authenticated
feedback uses its own transaction. These transactions share a database lock for the
schema, country, provider account and region, covering both mail purposes and all
key versions. Keep every persisted key available with the same material after
rotation. Missing, changed or revoked material refuses admission. Admission holds
the retained key rows through commit, so a later revocation waits for that decision.
Recipient references close before admission returns; later additions and rewrites
refuse. An incomplete reference set cannot commit. Operator audit rows are append-only. Provider IDs
bind on their first observation and cannot be replaced or shared by attempts
within a provider account and region. They remain separate from RFC Message-ID.

Run the populated upgrade and focused persistence checks against a disposable
PostgreSQL database:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/ses-feedback-migration.test.ts test/mail-attempts.test.ts test/recipient-suppression.test.ts test/migration-history.test.ts test/schema-compatibility.test.ts
```

The store accepts policy revisions through 2147483647, matching its SQL column;
larger qualified revisions refuse with a fixed configuration diagnostic.

These checks qualify local storage and locking. Task 5 also carries committed
admission into the account TLS adapter and keeps provider receipts separate from
RFC Message-ID. The internal standalone relay SES adapter uses the same bounded
TLS transport; its receipt settlement never changes the relay queue outcome.
It is not exported through the package or selected by worker configuration.
Local-proof relay SMTP and its outcome strings retain their contract. Internal
queue polling and audited removal are implemented below. Provider qualification
and production wiring remain separate. No live sender or AWS resource is enabled.

## Block a recipient before transport starts

A suppression decision must share the same database turn as handoff admission.
Otherwise a worker can send between checking the block and claiming the message.
The optional SES setting makes both workers commit their original-recipient
attempt before opening transport. Account handoff locks current request and
credential authority first; alerts retain their owner, preference, incident,
installation and service checks. Relay handoff keeps control, message, authority
and existing local suppression locks before the shared scope lock. Both sample
database time again after waits. Feedback needs only the shared scope lock.

A confirmed block finishes account work as `failed/delivery_rejected` and relay
work as `failed/refused`. Missing retained keys refuse transport without claiming
that the recipient is blocked. A block committed after admission cannot recall
that send. Account retries keep their original Message-ID and receive fresh
attempt tags; relay uncertainty still refuses automatic resend.

For an explicitly scoped local worker, trusted `suppress` also records a mapping
in `mail_legacy_suppression_scopes` and its current lifetime in
`mail_legacy_suppression_lifetimes`. Shared lookup joins that lifetime to the
still-present local block. Migration 050 leaves older local blocks unmapped because
you cannot infer their country or provider from a keyed digest. The mapping stays
immutable for reconciliation. This writer API adds no removal authority.
The legacy relay gate is global: an ES-scoped trusted block also refuses FR relay
mail, while shared account-mail lookup uses only its explicit country mapping.
Migration 051 gives each local block its own lifetime identity and records which
immutable mappings belong to it. Deleting a local block and later adding the same
digest without a scope cannot revive old country mappings. A new explicitly scoped
block records mappings for its new lifetime. The original mapping evidence remains.
A local decision made without a country stays marked for that lifetime, including
when a scoped writer later touches the same row. Migration 051 treats every old
local row as unknown-origin because old mappings cannot prove its initial scope.
Those rows keep the global gate closed; this interface cannot clear them.

Missing retained relay keys leave queued ciphertext and its original expiry intact,
with no SMTP handoff or attempt. The failed claim occupies worker capacity until
its 60-second lease expires. Account configuration failures use the existing bounded
retry policy. Qualify both operational outcomes before production wiring. A revoked
retained key also rolls back a trusted manual block and its mappings together;
the owner's separately approved key-retirement and recovery design remains required.

Run the handoff and migration races against disposable PostgreSQL:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/mail-handoff-suppression.test.ts test/mail-handoff-migration.test.ts test/email-outbox.test.ts test/relay-worker.test.ts test/relay-operator-stop.test.ts test/password-recovery.test.ts test/service-alert.test.ts
```

## Apply parsed feedback without changing sending state

Feedback can arrive before an SMTP receipt or after payload erasure. Use
`applySesFeedback(pool, config, recipientKeys, event)` to commit the provider
binding, event and any recipient block together. The helper owns its transaction.
Only a trusted queue consumer may supply the parsed event. The internal
`SesFeedbackWorker` commits feedback before acknowledging it; malformed input,
conflicts and database failures leave the message for replay. Configuration
validation and parsing do not authenticate AWS.

An unknown or mismatched binding records an `ignored` receipt with `unresolved`.
A different recipient or provider ID records `conflict` with `binding_conflict`.
Missing, changed or revoked retained key material throws `mail_keys_unavailable`
without committing a receipt. You can retry after restoring missing or changed
material. Revocation is irreversible in the current schema: any revoked key closes
feedback and admission for the entire scope, even for attempts that used other
keys. No supported recovery path exists yet; do not enable this store in production.
A redacted complaint uses the sealed single-recipient binding. It never looks up
a current contact address or tries to recover an erased token.

The same SNS ID and content returns `duplicate`. Changed content under that ID
returns `conflict` and retains the original receipt. A repeated semantic event
with a new SNS ID also returns `duplicate`; its new transport receipt is recorded
as `ignored` with `non_blocking`, while the original event and blocks stay intact.
Distinct bounce, complaint and provider-suppression reasons remain separate.
Delivery, temporary and unclassified events add no block and never clear one.
Sending, debit and reservation records are not changed.

Late feedback still applies after a policy or configuration revision advances,
provided country, provider account, region, purpose and configuration set match.
You keep the original sealed recipient and admission revisions; a settings upgrade
cannot discard its late bounce or complaint. Other binding and key checks remain.

Key retirement and recovery need a separately approved design before production.
The feedback design promises refusal for required keys; the current full stop also
covers an unrelated revoked key in the same scope. That difference must be settled
before enablement. The sending paths and queue consumer have no production
startup connection.

For local transport qualification, `createSesFeedbackQueue` uses the pinned SQS
SDK to sign requests for the validated queue and region. It receives one message
with a ten-second poll and sixty-second visibility. Each receive or delete has
a fifteen-second deadline, including credential lookup, and uses one request.
Aborting the caller or closing the adapter cancels pending work. Errors expose
fixed diagnostics instead of envelopes, receipt handles or provider replies.
The local tests inject synthetic credentials and transport replies; they do not
qualify IAM, encryption or dead-letter transfer. The worker shares a five-second
budget across database acquisition, lock waits and transaction work, including
commit. Failed connections are discarded; a client acquired after expiry cannot
process feedback. Transaction-local limits also stop stalled server work without
changing later borrowers' settings. A timed-out pool request is discarded when
it returns. The standalone CLI supplies the connection and cleanup limits below.
The worker admits at most two concurrent operations. You can inspect
`worker.status(sample)` using a trusted operational sample with `observedAt`
(Unix milliseconds), `queueAgeSeconds`, `deadLetterCount`,
`configurationRevision` and `configurationDrift`. The sample must come from your
operational collector, never from a feedback envelope. Provider collection is
not wired yet; without a fresh sample the report cannot say `ready`.

Readiness requires successful polls from both slots. A failed slot stays failed
until that slot succeeds; progress in the other slot cannot hide it. A receive
or delete older than fifteen seconds, processing older than five seconds, or
an aborted consumer closes readiness. Polls and samples expire after a conservative
35 seconds. A healthy slot can also report stale while its peer finishes a long
batch and the next poll waits; this is not a bound on every two-slot cycle. Future samples and backwards
activity timestamps also refuse readiness. These are local freshness budgets;
queue-age and rate alert thresholds remain D103's separate decision. A large
queue age or dead-letter count is reported without selecting an alert threshold.

Exact replays of stored binding conflicts also remain unacknowledged. The store's
`duplicate` result means it has already seen that envelope. The worker also checks
the saved result in the same transaction before allowing deletion.

The report's `observedAt` is the producer's observation time. An independent
reader must age that timestamp rather than retaining an old `ready` value when
output stops. Production collector freshness and alert delivery still need D104
qualification.
The report includes aggregate poll and commit ages, active consumers, fixed
failure codes, queue age, dead-letter count and the configured revision. A commit
remains visible when deletion fails, because the next delivery must replay that
durable result. Drift or a different sampled revision closes readiness. No
envelope, recipient, receipt handle or arbitrary collector field enters the
report. Neither this internal adapter nor the worker is exported from the
package's public entry point.

The standalone `pnpm --dir packages/registration ses:feedback` command runs two
consumer slots outside normal services; `--once` settles one batch before exiting.
Startup requires `CLOUD_SES_FEEDBACK_CONSUMER=enabled`, `DATABASE_URL`,
`CLOUD_SES_FEEDBACK_CONFIG_FILE`, `CLOUD_MAIL_RECIPIENT_KEYS` and
`CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID`. The consumer uses SQS credentials through
the standard SDK chain, without SMTP credentials. A supplied file cannot qualify
its own settings. Spain's default policy still refuses these flows, so this code
does not enable production consumption.

Read aggregate JSON statuses from standard output. You can supply your trusted
collector's JSON through `CLOUD_SES_FEEDBACK_HEALTH_SAMPLE_FILE`; missing, invalid
or stale samples cannot produce readiness. Binding and sample files must be
regular files of at most 64 KiB. Provider metric collection, separate dead-letter
health permissions and D104's external alert channel remain deployment work.
The command does not read dead-letter messages or replay them.

SIGINT and SIGTERM stop new receives and abort queue requests. Active database
work may commit within its existing five-second budget, but shutdown leaves that
message for replay. Connection establishment and pool cleanup each have a
five-second limit, sharing the overall twenty-second shutdown grace. Normal
shutdown drains naturally. If a broken driver retains a live handle, the process
deadline forces a failing exit within that grace. A failed one-shot batch or
cleanup also exits with a fixed diagnostic. Local command fixtures cover signals,
lock waits, restart, death after commit and simulated redrive after five poison
receives. A completed one-shot run reports stopped after cleanup. Cancelling
healthy polls or deletion adds no failure code, while earlier genuine failures
remain visible. These fixtures do not establish provider encryption, IAM or
real dead-letter transfer.

Run the local health cases and their PostgreSQL durability checks:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/ses-feedback-health.test.ts test/ses-feedback-health-durability.test.ts test/ses-feedback-shutdown.test.ts test/ses-feedback-supervision.test.ts test/ses-feedback-cli.test.ts
```

Run the focused PostgreSQL checks, including competing consumers and process death
immediately before and after commit:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/ses-feedback-store.test.ts
```

## Reconcile a manual email unblock

Removing a local block while SES still refuses the destination would reopen the
queue without repairing delivery. The internal `MailSuppressionAdmin` therefore
keeps both stores blocked until you complete an audited operation. It has no
production route, permission provisioner or AWS adapter. Live provider tooling
and the `mail.suppression.unblock` permission need separate operator authority.

Trusted construction supplies one validated SES scope, retained shared and local
recipient keys, and a regional provider query/removal port. `inspect` checks your
real session, CSRF token and platform permission, then returns the current revision.
`request` binds that revision, your account, a short reason code and the prior
evidence to a new operation. Audit records contain keyed references, without the
recipient address or either credential. The revision covers the whole scope, so
an unrelated new blocker can require you to start another operation.

`reconcile` receives the destination again, verifies its original keyed references
and queries and removes BOUNCE and COMPLAINT through the trusted port. Provider work
runs outside database locks; the service waits at most fifteen seconds. A second query
checks the resulting state. The returned object has private process identity,
operation/scope/revision binding and a five-minute lifetime. Caller JSON and an
object copied from another process cannot replace it. After a restart, obtain fresh
evidence for a still-pending operation. A committed result remains readable by its
original authorised operator if its acknowledgement was lost.
The provider port must honour its abort signal. A timeout cannot confirm that an
external operation stopped, and produces no evidence that permits a clear.

`finish` takes the local suppression lock before the shared scope lock, rechecks
your authority, the revision and all prior blockers, and commits the audit outcome
with both store changes. Both provider reasons must be absent. Before any provider
call, the operation must still be pending and every local block must have a known,
matching origin. Each call has an immutable committed intent and a separate
immutable result, so another query cannot erase the reasons previously removed.
An intent without a result records uncertain work after a crash; it is no proof
of provider completion. Historical audit evidence never extends permission to clear. Provider failure,
partial removal, expired evidence, a new blocker, an unmapped local row or a mapping
to another scope keeps the block. Evidence that expires during a database write
rolls back that transaction. A completed blocked operation needs a new request;
repeating it returns the recorded outcome.

Clearing creates no mail or attempts and restores no erased payload or token.
Transport and semantic feedback evidence survive removal: old duplicates stay
duplicates, while genuinely new blocking feedback can block the destination again.
The global legacy relay gate, retained-key refusal and separate production
key-retirement design remain in force.

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/mail-suppression-admin.test.ts test/mail-suppression-migration.test.ts test/security-audit.test.ts test/password-recovery.test.ts
```

Schema receipt version 12 adds `--mail-reconciliation` for the exact 47-to-51
pair, preserving earlier receipt versions. It checks empty reconciliation tables
and distinct local block identities on both backup paths. Populated two-country
mapping upgrades and interrupted migration retries have separate database tests.
