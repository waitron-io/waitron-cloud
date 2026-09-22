# Cloud identity and session-backed approval

This slice gives Cloud registration a real account session. Reuse the password and
management-session behaviours from Waitron tag `pre-sqlite-migration`, commit
`c9d80c59a30ab1ae7a4acc0a6999e6a342de924e`, adapting the SQL and permissions for Cloud.

## Boundary

The identity package verifies passwords, issues opaque session tokens, checks expiry
and suspension, ends sessions and checks explicit platform permissions. Organisation
registration permission stays in the existing membership table. Neither permission
set implies the other. The original slice uses trusted test/setup credentials.
The subsequent [signup backend](cloud-signup-implementation.md) creates customer
credentials after email proof. The [recovery backend](password-recovery-implementation.md)
now resets passwords and revokes existing sessions. Production delivery, public account
routes, MFA and passkeys remain integration work before public use.

Store only hashes of session and CSRF tokens. Keep Waitron's 30-minute sliding idle
limit and passive-polling distinction. Add a 12-hour absolute limit for this internal
implementation. Confirm deployment policy before exposing login. Background reads
never extend either deadline. Database wall time governs expiry after lock waits.

Use asynchronous scrypt with the source's hash format and parameters, preserving its
behavioural tests and adding strict malformed-hash validation. Record copied sources
and adaptations so later security fixes can be checked in both repositories.

Session-backed Cloud approval must resolve the authenticated account, validate the
session's CSRF token and recheck its organisation permission in the same transaction
that records approval. No caller-supplied account ID can override that identity.
The future HTTP layer must additionally enforce its allowed Origin, secure cookies,
request limits and login throttling. This package does not expose HTTP endpoints.

The owner approved matching-code confirmation for first pairing: show a short code
inside signed-in local Waitron and confirm the same code in Cloud. The code must be
bound to the installation, venue and selected organisation, with expiry and attempt
limits. It is not a machine credential. The detailed proof and code formats, local
adapter and browser journey still need implementation.

Local approval still requires the real Waitron administrator flow and that
first-contact exchange. A signed installation challenge proves possession
of a key; it does not by itself prove local administrator authority. Do not enable
public connection endpoints until the local adapter and complete pairing flow are
implemented and tested together.

## Checks

1. Copy/adapt the source password tests, then implement compatible password hashing.
2. Add PostgreSQL tests for login, generic credential failure, token hashing, logout,
   idle/absolute expiry, passive reads, suspension and separate platform permissions.
3. Add session-backed approval tests for missing/expired sessions, wrong CSRF tokens,
   wrong organisations and permission loss. Keep the existing registration tests.
4. Review the complete branch and run CI before landing. Prove real local approval
   and the browser journey in the following integration slice.
