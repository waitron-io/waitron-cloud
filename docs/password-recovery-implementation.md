# Cloud password recovery and local email

Recover your Cloud password independently of the venue server. Supply your email,
follow a single-use link valid for 30 minutes, choose a new password, then sign in
normally. The portal removes surrounding spaces from your email before checking
and sending it, as it does for sign-in and signup. Spaces inside an address still
produce a field error. Completion changes the password and ends every existing
session in one transaction. Your memberships and platform permissions stay unchanged.

A sign-in retry delay does not disable password recovery. If recovery asks you to
wait, its countdown shows when you can retry.

## Backend boundary

Only enabled accounts with a verified email and an existing password receive reset
links. Unknown, disabled, unverified and passwordless accounts get the same `accepted`
request result. Delivery runs in the background, so provider failures cannot change
that result. Queue failures roll back the request instead of acknowledging lost work.
Per-address cooldown is one minute across workers, including unknown addresses.
Resending does not invalidate a live link or lock the account.

Each random 32-byte token has a SHA-256 verification hash, bound to the account, email
and a fingerprint of its current salted password hash. A successful reset produces
a new salted hash, invalidating every earlier reset link even when the new password
matches the old one. Recheck account eligibility and the binding under locks. Lock
the account before credentials, token and session rows to coordinate with login and
session resolution. Check expiry again after contended writes before committing.

Share signup's email normalisation and new-password validation: 15 Unicode characters
minimum, 1024 UTF-8 bytes maximum. The reset token only changes the password; it never
creates a session or changes verification, suspension or permission state. A lost
completion reply is recovered by signing in with the new password. Queue a notification
containing no password or token in the same transaction. Sending happens afterwards;
a delivery failure cannot undo the reset. A queue failure rolls the reset back.

The [account HTTP API](../packages/account-http/README.md) now adds Origin/CSRF and
cookie protection, IP/token limits and a response-time floor. Before public exposure,
assess timing under deployment load and add compromised-password checks, recovery
screens, ingress controls and the selected extra authentication factors. Password recovery
does not recover MFA. The [email queue](email-delivery-implementation.md) encrypts
the delivery copy of each token and retries pending messages after a restart. Define
retention for request and delivery records, including unknown email addresses.

## Local email viewer

Bundle Waitron's Mailpit version, `axllent/mailpit:v1.31.1`, with loopback-only SMTP
and inbox ports. Use Cloud ports 1125 and 8125 to coexist with Waitron's 1025 and 8025.
Add an explicit local SMTP adapter for signup, reset links and change notifications,
plus commands to start, preview and stop it. No relay or production provider is configured.
The preview uses sample tokens; working account screens are separate work.

## Plan and verification

1. Add a migration and failing tests for generic requests, cooldown, token purpose,
   eligibility changes, replay, concurrent resets, rollback and old-session rejection.
2. Implement recovery using the existing identity helpers and transaction boundary.
   Preserve all signup and session tests while sharing input validation.
3. Prove a login waiting behind a reset cannot issue a session with the old password,
   and a reset waiting behind a login revokes that newly committed session too.
4. Add Mailpit and the local adapter. Exercise signup and recovery over real SMTP and
   inspect captured messages through Mailpit's API in disposable-container tests.
5. Update the backlog, run types and CI, then finish branch review.

The design follows the [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
This recovery slice changes no Waitron files. Its SQLite storage switch landed on
2026-09-23, so subsequent integration work can use the current Waitron interfaces.
