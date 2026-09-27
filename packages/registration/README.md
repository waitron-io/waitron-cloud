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
