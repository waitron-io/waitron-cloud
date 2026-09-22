# Registration state

This internal package stores an installation's approved connection to an organisation
and legal business. PostgreSQL transactions coordinate workers, so they can retry
completion without creating duplicate venues or installations.

## Trust boundary

You must verify identities and approvals before calling this package. There is no
HTTP endpoint, browser login flow, local proof verifier or machine credential issuer here. An installation
key identifier, account ID or local receipt ID is a reference, never a credential.
Do not expose these methods directly as public endpoints.

The surrounding service must supply the authenticated installation's canonical key
identifier. The local approval adapter must verify local administrator authority and
issue a unique receipt bound to the complete request. Browser-facing adapters must use `approveCloudWithSession` with its session and CSRF
tokens. The account-ID approval method is reserved for trusted adapters. This package also checks the
account's current registration permission in PostgreSQL when approving and completing.

The [identity package](../identity/README.md) now supplies password sessions and
explicit platform permission checks, adapted from `pre-sqlite-migration`. The public
web adapter, additional authentication factors and platform role
catalogue remain to be implemented.

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

The token expires after 30 minutes and works once. Resending keeps earlier live links
valid, but email uniqueness permits only one signup. A lost success reply is recovered
by signing in with the chosen password through the existing identity API. Replaying
a token cannot create a session, reset a password or add another organisation.

`signup_invalid` identifies malformed input. `verification_unavailable` covers an
unknown, expired or used token and an email that already has an account.
Delivery failures are recorded by the worker and retried automatically. Database or
queue failures still reject the request and roll back both records. The worker uses
fixed error codes and never persists a provider's error message. See
[reliable account email](../../docs/email-delivery-implementation.md) for the key
configuration, retry limits and local commands.

The integration tests use an in-memory capture mailer and disposable PostgreSQL:

```sh
pnpm test
```

They exercise signup, login, concurrent links, delivery failure and a fresh-process
completion. Mailpit now captures local SMTP delivery; production email and HTTP routes
are not connected. The
[signup plan](../../docs/cloud-signup-implementation.md) records the public deployment
gates. `email_verified_at` records proof for this flow; the older trusted provisioning
path owns its verification policy. `is_owner` records the initial customer owner and
does not imply platform permission or introduce a full organisation role catalogue.

## Password recovery

Use `PasswordRecoveryStore(pool, outbox)` with the same queue. The worker's mailer implements `sendPasswordReset`
with the same `{ email, token, expiresAt }` shape as signup and `sendPasswordChanged`
with `{ email }`. `createLocalAccountMailer()` implements the worker's delivery interfaces and
delivers to Cloud's loopback-only Mailpit. See the [local inbox commands](../../README.md#local-email-inbox).

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
Passwords follow signup's policy. `recovery_invalid` identifies an invalid email or
new password; `reset_unavailable` covers malformed tokens, unknown, expired, consumed
or invalidated links and accounts
that are no longer eligible. Account email, verification and permissions do not change.

Reset links last 30 minutes. A password-hash fingerprint invalidates every earlier link
after a password change, including resetting to the same password. Resending a request
keeps live links usable. Completion checks the account's current email and verification,
so an old link cannot change a different email's password or re-enable a disabled account.
The account lock serialises completion with login; a login committed first is revoked,
and an old-password login waiting behind reset must fail its credential recheck.

Emails are sent after commit. The queue encrypts recipients and tokens, retries failures
and discards expired or invalidated links. A notification queue failure rolls back the
reset; a later delivery failure cannot undo it. Define production audit and cleanup
for requests and delivery metadata before deployment. Password reset is not MFA
recovery. HTTP protections and recovery screens are covered in the
[implementation plan](../../docs/password-recovery-implementation.md).

## State and completion

`start(binding)` records the binding after an organisation and legal business have
been selected. The earlier browser journey that selects them is still to be built.
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
