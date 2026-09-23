# Cloud account API

Use this package to create a Cloud account, sign in and recover a password independently
of a venue server. The JSON API wraps the existing PostgreSQL identity and registration
stores. Browser screens, venue pairing and public deployment are separate work.

## Run locally

You need Node.js 24+, pnpm 9.15.0, Docker for Mailpit, and a development PostgreSQL
database. Copy `.env.example` to `.env` if you do not already have one, then set:

```dotenv
DATABASE_URL=postgresql://cloud:replace-password@localhost:5432/cloud
CLOUD_PORTAL_ORIGIN=http://localhost:3000
CLOUD_EMAIL_ACTIVE_KEY_ID=local-v1
CLOUD_EMAIL_KEYS={"local-v1":"replace-with-64-hex-characters"}
CLOUD_HTTP_RATE_KEY=replace-with-a-different-64-hex-character-key
```

Generate each key separately with `openssl rand -hex 32` and save it in your ignored
`.env`. Keep the email key across restarts so the worker can decrypt queued messages.
The API and worker must use the same database and email key ring.

From the repository root, install dependencies, apply migrations, start the inbox,
then start the API:

```sh
pnpm install --frozen-lockfile
node --env-file=.env packages/registration/src/migrate-cli.ts
pnpm mail:up
pnpm account:serve
```

If you export `DATABASE_URL` in your shell, `pnpm db:migrate` applies the same migrations.
The server refuses startup without migration `007_account_http.sql`; it never applies
migrations itself. Its default listener is `127.0.0.1:3000`.

In another terminal, from the same directory:

```sh
pnpm mail:worker
```

Open [Mailpit](http://localhost:8125) to read messages. Use `pnpm mail:status` to inspect
queue counts. Email links target `/signup` and `/reset-password`, which are future
screens. For now, copy their token into the completion request's JSON body; opening
the link does not complete signup or reset a password.

## Make an account request

Every POST requires `Content-Type: application/json` and an `Origin` header exactly
matching `CLOUD_PORTAL_ORIGIN`. Requests must reach that configured host and port.
There is no cross-origin credential access. For local development:

```sh
curl -i http://localhost:3000/api/account/signup/request \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' \
  --data '{"email":"owner@example.test"}'
```

The response is `202` with `{"status":"accepted"}`. Account existence and the
per-address email cooldown do not change this result. Delivery happens in the worker.

All paths below have the `/api/account` prefix. Examples use placeholders for emailed
tokens and generated IDs. Each body must contain exactly the listed string fields;
activity and logout take `{}`. Query parameters are rejected, so tokens belong only
in completion bodies.

| Request | JSON body | Successful response |
| --- | --- | --- |
| POST `/signup/request` | `{"email":"owner@example.test"}` | 202 `{"status":"accepted"}` |
| POST `/signup/complete` | `{"token":"<emailed token>","password":"a long unique password","organisationName":"Casa Norte","legalBusinessName":"Casa Norte SL","countryCode":"ES"}` | 201 `{"accountId":"<uuid>","organisationId":"<uuid>","legalBusinessId":"<uuid>"}` |
| POST `/login` | `{"email":"owner@example.test","password":"a long unique password"}` | 200 `{"accountId":"<uuid>"}`, with session and CSRF cookies |
| GET `/session` | No body; session cookie | 200 `{"accountId":"<uuid>","expiresAt":"<ISO timestamp>"}` |
| POST `/session/activity` | `{}`, session cookie and `X-CSRF-Token` | 200 `{"accountId":"<uuid>","expiresAt":"<ISO timestamp>"}` |
| POST `/logout` | `{}`, session cookie and `X-CSRF-Token` | 204, clearing both cookies |
| POST `/password-reset/request` | `{"email":"owner@example.test"}` | 202 `{"status":"accepted"}` |
| POST `/password-reset/complete` | `{"token":"<emailed token>","password":"a different long password"}` | 200 `{"status":"completed"}` |

Signup and reset completion issue no session: sign in afterwards. Reset ends all
existing sessions. A token works once; if a completion response is lost, try signing
in with your chosen password. Retrying the token cannot create another account or
session. See [signup and recovery rules](../registration/README.md#cloud-account-signup)
for password, token and account eligibility requirements.

## Browser sessions

On HTTPS, the server sets `__Host-cloud_session` with Secure, HttpOnly, SameSite=Lax
and Path=/, without Domain. Your portal cannot read this cookie. It can read the
separate `__Host-cloud_csrf` cookie and copy its value into `X-CSRF-Token` for activity
and logout. The server checks that proof against the current session, so a token from
another session does not work. Duplicate session cookie names are rejected.

Loopback HTTP development uses `cloud_session` and `cloud_csrf` without Secure.
Production requires HTTPS. Always serve the API and portal from the same configured
origin and let the browser send cookies; never put a session token in a URL or log.

GET `/session` does not extend the idle deadline. Send explicit activity when the
person is using the portal. Activity extends the 30-minute idle lifetime within the
12-hour absolute lifetime. Logout without a live session still clears the cookies;
a live session requires its CSRF proof. Background polling cannot keep it alive.

## Limits and errors

All responses disable caching and referrer forwarding, and set `nosniff`. Errors use
`{"error":"<code>"}` with fixed codes rather than database or submitted values:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_input`, `link_unavailable` | Invalid shape, ambiguous cookies or unusable completion token |
| 401 | `credentials_invalid`, `unauthenticated` | Login failed or no usable session |
| 403 | `forbidden` | Wrong origin/host or missing/incorrect session CSRF proof |
| 404 / 405 | `not_found` / `method_not_allowed` | Unknown path or wrong method |
| 408 / 413 / 415 / 431 | `invalid_input` | Receive timeout, body too large, unsupported encoding/type or headers too large |
| 429 | `rate_limited` | Shared request allowance exhausted; obey `Retry-After` |
| 503 | `temporarily_unavailable` | Database failure, admission limit or shutdown; retry after the advertised delay |

Bodies are limited to 16 KiB, including streamed bodies, and headers to 8 KiB.
Header/body receive deadlines are five seconds, checked by Node at one-second
intervals; the body reader also has a five-second deadline. Each process permits
200 connections and eight simultaneous account operations. Additional operations
receive 503 with `Retry-After: 1`.

PostgreSQL counters apply across all API instances and survive restarts:

| Scope | Allowance |
| --- | --- |
| All routes, per client IP | 120 per minute |
| Login, per IP / normalised email | 10 per minute / 30 per 15 minutes |
| Each signup/reset email-request route, per IP | 10 per 15 minutes |
| Each signup/reset completion route, per IP and token | 10 per 15 minutes |

Successes and failures both count once a request reaches a limit. Login checks the
IP limit first; requests it refuses do not consume the email allowance. This prevents
an already-blocked IP from spending another person's address allowance. Requests
admitted by IP limits can still exhaust that address allowance, so distributed
attacks also need the deployment's ingress controls. The existing shared per-address email cooldown
is one minute. Login and email-request responses wait at least 300 ms after body
reading; this reduces simple timing differences but does not guarantee equal timing
under contention. Deployment load and timing checks remain required.

Rate identities are HMAC digests, a keyed hash of the scope and IP, email or token.
Use one persistent `CLOUD_HTTP_RATE_KEY` across all instances. Changing it creates
new allowances immediately; coordinate changes across instances and do not treat
rotation as seamless counter preservation. The CLI deletes up to 1,000 expired
counters each minute without overlapping cleanup runs.

## Deploy behind a proxy

Set `NODE_ENV=production`, an HTTPS `CLOUD_PORTAL_ORIGIN`, the database and both key
settings. The Node listener serves HTTP; terminate TLS at your ingress and protect
the ingress-to-API connection according to your deployment. `CLOUD_HTTP_HOST` and
`CLOUD_HTTP_PORT` override the loopback defaults. Changing the bind address does not
change the trusted public origin.

By default, only the socket peer determines the rate identity; forwarded headers
are ignored. Set `CLOUD_HTTP_TRUSTED_PROXY_IPS` to a comma-separated list of exact proxy
peer IPs only when that proxy replaces `X-Forwarded-For` with one validated client
address. Lists, malformed values and missing values from a trusted peer are rejected.
Wildcards, network ranges and multi-hop chains are unsupported. IPv4-mapped IPv6 is
normalised, and IPv6 clients share an allowance within each /64 network.

The CLI pool permits ten clients, waits up to five seconds for a connection and
limits SQL statements to ten seconds. SIGINT or SIGTERM stops admission and allows
up to ten seconds for HTTP connections to drain, then closes remaining connections.
The CLI has an eleven-second hard shutdown deadline if database work still prevents
exit. A client disconnect does not prove a transaction rolled back: recover a lost
response through the normal signup/reset login or retry rules.

Before public use, complete browser screens and their browser tests, live provider
and sender verification, delivery-event handling, compromised-password screening,
MFA policy, ingress bot controls, production secrets, retention rules and deployment
load/timing checks. The [backlog](../../docs/backlog.md) tracks these separately from
Waitron pairing and shared UI extraction, which are now unblocked by SQLite.

## Verify changes

```sh
pnpm typecheck
node scripts/test-postgres.mjs --filter @waitron-cloud/account-http test
pnpm test
```

These commands use disposable PostgreSQL and Mailpit containers. Tests complete the
account journey through captured email, exercise shared counters across connections,
and send real slow, oversized and interrupted HTTP requests. They inspect cookie
attributes and send Cookie headers explicitly; they do not test browser cookie policy.
