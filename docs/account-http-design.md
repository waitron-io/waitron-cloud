# Cloud account HTTP API

Status: implemented, 2026-09-23. See the [run and API guide](../packages/account-http/README.md). The owner approved building browser access to
signup, login and recovery, with request protection and PostgreSQL/Mailpit tests.
The owner approved this written design on 2026-09-23. The
[implementation plan](superpowers/plans/2026-09-23-account-http.md) sequences the work.

## Outcome and boundaries

You can request a verification email, create your first organisation and business,
sign in, inspect your session, sign out and reset a forgotten password through a
same-origin JSON API. Account records and email delivery continue to use the existing
PostgreSQL stores and worker. A reset ends existing sessions as it does today.

Waitron's SQLite storage switch has landed. Shared UI extraction and venue pairing
can now proceed, but this branch implements the account API first. It does not
change Waitron, expose installation approval methods, build screens or deploy a
public service. Cloud management data remains in PostgreSQL.

## Approach

Use Hono and its Node adapter in `packages/account-http`, matching Waitron's HTTP
framework. Keep route handling, cookies, configuration and request protection separate
from the existing account stores. Export an app factory for tests and provide a
small executable server entry point. Account operations retain their current
transaction boundaries; no HTTP handler accepts an account ID as authentication.

A native Node HTTP implementation would avoid framework dependencies but require
more routing and body-handling code. A full frontend framework would tie this work
to screens and shared UI decisions. Hono fits the existing Waitron conventions and
lets us test the account boundary independently.

## Routes

All account routes live under `/api/account`. POST bodies must be JSON objects.

| Method and path | Input | Successful result |
| --- | --- | --- |
| POST `/signup/request` | `email` | 202, `{ status: "accepted" }` |
| POST `/signup/complete` | `token`, `password`, `organisationName`, `legalBusinessName`, `countryCode` | 201, account/organisation/business IDs; no session |
| POST `/login` | `email`, `password` | 200, account ID and cookies; or 202, bounded factor challenge with no cookies |
| GET `/session` | Session cookie | 200, account ID and expiry; no idle extension |
| POST `/session/activity` | Session cookie and CSRF header | 200, refreshed expiry, bounded by the existing absolute lifetime |
| GET `/sessions` | Session cookie | 200, account-scoped live session summaries; no idle extension |
| POST `/sessions/revoke` | Session cookie, CSRF header and session row UUID | 204, idempotent account-scoped revocation |
| POST `/logout` | Session cookie and CSRF header | 204, end the session and clear both cookies |
| POST `/password-reset/request` | `email` | 202, `{ status: "accepted" }` |
| POST `/password-reset/complete` | `token`, `password` | 200, `{ status: "completed" }`; no session |

Reading an email link never consumes its token. Screens will submit those tokens in
POST bodies; the API rejects token-bearing query parameters and does not redirect
to caller-provided URLs. Signup and reset completion do not automatically sign in.
Session activity is explicit so background polling cannot keep a session alive.
Logout with no cookie clears cookies and returns 204; an expired or revoked session
also clears them without changing another session. A live session requires valid
CSRF proof before logout.

## Browser boundary

Serve the API and future portal from one configured origin. Require an exact Origin
match on every POST, including login and unauthenticated requests. Reject missing,
null and foreign origins. Do not enable cross-origin credential access. Validate
request authority against configured hosts, never derive trusted email links from it.

Production uses `__Host-cloud_session`: Secure, HttpOnly, SameSite=Lax, Path=/, no
Domain. A separate `__Host-cloud_csrf` cookie has the same scope but is readable by
the portal, which copies it into `X-CSRF-Token`. The identity store verifies that
header against the session's stored CSRF hash. Never return the session secret in
JSON. Issue fresh cookies on login and clear them with matching scope on logout.
Development uses distinct unprefixed cookies only with an explicitly configured
loopback HTTP origin; production rejects that configuration.

Set no-store, no-referrer and nosniff headers on successes and errors. Do not log
request bodies, cookies, passwords, tokens, query strings or raw database/provider
errors. Return fixed error codes: invalid input, unavailable link, invalid credentials,
unauthenticated, forbidden, rate limited or temporarily unavailable. Unknown and
incorrect login credentials share the same response. Eligible, ineligible and
cooldown email requests share the same accepted response.

## Request limits and failure handling

Limit bodies to 16 KiB while reading, including chunked bodies. Reject unsupported
content types, invalid JSON, arrays, unknown fields and wrong field types before
calling stores. Bound header/body receive times and the number of simultaneous
account operations so slow clients and password hashing cannot create unlimited work.

Use PostgreSQL rate counters shared by all API instances, through migration 007.
Apply limits before password hashing or delivery enqueue. Start with these defaults:

- All account routes: 120 requests per minute per client IP.
- Login: 10 attempts per minute per IP and 30 per 15 minutes per normalised address.
- Signup/reset email requests: 10 per 15 minutes per IP for each route; the existing
  shared per-address one-minute email cooldown still applies.
- Signup/reset completion: 10 attempts per 15 minutes per IP and per token for each route.

Counters include successes and failures, independently of whether an account exists.
Login checks the IP allowance before charging the email allowance, so traffic already
refused by the IP limit cannot cheaply lock another person out of their account.
A blocked request returns 429 with Retry-After. Fail closed with 503 if the limiter
cannot use PostgreSQL. Store HMAC identifiers using a dedicated deployment key,
not plaintext IPs, email addresses or tokens. Expired counters have bounded cleanup.
Test concurrent requests through separate app instances, including the window boundary.
These application limits complement the eventual public edge's bot and traffic controls.

Use the socket peer as the client address by default. A deployment may explicitly
list trusted proxy IPs; only those peers may supply one validated client IP in
X-Forwarded-For. Reject malformed or multi-hop forwarded values from trusted peers,
and ignore forwarded values from other peers. Normalise IPv4-mapped IPv6 addresses
and group IPv6 addresses by /64 so spelling changes do not reset limits. Proxy
configuration must match the deployed ingress before internet exposure.

Keep identical public response bodies and apply a minimum 300 ms response duration
to login and email-request routes after receiving the body. Retain the login store's
dummy password derivation for unknown accounts. Measure eligible/ineligible/cooldown
paths in tests; the floor reduces simple timing differences but does not prove
constant-time behaviour under database contention. Load and timing assessment remains
a public-deployment requirement.

## Verification and rollout

Use TDD with real PostgreSQL and HTTP requests. Complete signup through Mailpit,
then prove login, cookie attributes, session reads/activity, CSRF rejection, logout,
password reset, old-session rejection and new-password login. Preserve existing
account/session concurrency tests. Include missing/foreign Origin, duplicate cookies,
oversized chunked bodies, forged proxy headers, limiter races, exhausted counters,
database failure, generic errors and secret-free responses. Run a separate server
process to verify environment configuration, startup failure and graceful shutdown.

Keep the default listener on loopback. Provide documented local commands and a
production configuration contract, with explicit database/key/origin settings.
Do not run migrations automatically at server startup. Finish with one whole-branch
Claude review and current-head CI, then land under the owner's standing instruction.

Live email activation, provider delivery events, screens, compromised-password
screening, production factor policy, ingress bot controls, production secrets and deployment/load
proof remain recorded launch requirements. This branch does not declare the portal
ready for public signup.

## Sources and reuse

Inspected Waitron at `cb809f1b5` on 2026-09-23: `packages/server-kit/package.json`
uses Hono; `management-cookie.ts`, `read-json-body.ts` and `request-screens.ts`
provide relevant conventions. Its SQLite completion is recorded in `d0ff14157`.
Cloud retains its own cookie names, random session tokens and PostgreSQL stores.

- [Hono Node adapter](https://hono.dev/docs/getting-started/nodejs)
- [Hono body limits](https://hono.dev/docs/middleware/builtin/body-limit)
- [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

## Optional authenticator protection

The [authenticator guide](authenticator-app.md) defines the implemented password
second step, account controls, separate key configuration and shared limits. Challenge
tokens never grant session access. Password reset keeps the factor and saved codes;
activation, replacement, removal and regeneration end all sessions. Passkeys remain
independent. Production factor allowances and history retention require explicit policy.
