# Cloud identity

Use this internal package to verify an email/password login and manage Cloud sessions.
The caller supplies a PostgreSQL client inside a transaction. Cloud registration owns
the combined migration entry point (`pnpm db:migrate`), including identity migration
`002_identity.sql`. Do not call these functions outside the transaction boundary.

`login` returns a fresh 32-byte session token and a separate CSRF token. Store the
session token in a Secure, HttpOnly cookie in the future web adapter; never put it in
a URL or a log. The database stores SHA-256 hashes of both tokens. A database hash is
not a credential accepted by the session resolver.

`resolveSession` checks that the account is enabled, the session has not ended and
both its idle and absolute deadlines are live. Ordinary activity extends the idle
limit by 30 minutes; `withPassiveRead` and `{ touch: false }` prevent background reads
from doing so. The absolute 12-hour deadline never extends. These are internal
defaults to review before public deployment.

`endSession` ends one session and returns false when it was already ended or unknown.
When updating account lifecycle operations, acquire the account lock before locking
its credential or session rows. Callers own their transaction and PostgreSQL pool,
including handling idle-connection errors.

`requirePlatformPermission` checks an explicit platform permission after resolving
the session. Organisation membership grants no platform access. Platform permissions
grant no customer organisation access. The exact platform role catalogue, MFA policy
and customer-approved support grants still need their own implementation.
For operations that change state, pass `{ csrfToken }` as its fourth argument;
an undefined or incorrect `csrfToken` value is rejected. Read-only checks can omit
the options object. The future HTTP adapter must also check the request Origin.

Use `RegistrationStore.approveCloudWithSession(binding, token, csrfToken)` for Cloud
approval. It derives the account from the session, checks the CSRF token and current
organisation membership, and rolls back approval if the session expires during a
permission lock wait. The older account-ID method is only for trusted adapters.

This package exposes no HTTP routes or signup UI. The registration package's
[signup backend](../registration/README.md#cloud-account-signup) verifies email tokens
before creating new customer credentials. Before public use, implement live email
delivery, the web adapter's Origin checks, cookie handling, login/request throttling,
password recovery and the selected additional authentication factors.
Define retention and cleanup for ended and expired sessions before deployment.
Review the inherited password cost against the chosen deployment. No local Waitron
administrator proof is verified here; the complete pairing flow remains a separate
gate before exposing connection endpoints.

The [source map](SOURCE.md) records reuse from Waitron and the security-fix process.
Run the password unit tests with `pnpm --filter @waitron-cloud/identity test`. From
the repository root, `pnpm test` runs these and the identity/approval integration tests
against disposable PostgreSQL, alongside the original registration tests.
