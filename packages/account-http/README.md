# Cloud account API

Use this package to create a Cloud account, sign in and recover a password independently
of a venue server. The JSON API wraps the existing PostgreSQL identity and registration
stores. The optional Lit portal uses the same origin. The pairing API supports the local integration described below. Public deployment
awaits ingress, service-adapter and deployment checks. The real Waitron administrator
adapter is included in the local integration proof.

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

The packaged production server CLI requires `CLOUD_COMPROMISED_PASSWORD_CORPUS` to name an absolute
path to a locally supplied password corpus. Put one lowercase SHA-256 digest on each
line; blank lines and lines beginning with `#` are ignored. The server accepts a corpus
of at most 16 MiB during startup and refuses malformed, empty or
unreadable corpora. It keeps digests in process memory and never sends a password or
digest to an external service. Development may omit the setting, but then screening
is disabled; do not use that mode for public signup.

From the repository root, install dependencies, apply migrations, start the inbox,
then start the API:

```sh
pnpm install --frozen-lockfile
node --env-file=.env packages/registration/src/migrate-cli.ts
pnpm mail:up
pnpm account:serve
```

If you export `DATABASE_URL` in your shell, `pnpm db:migrate` applies the same migrations.
The server refuses startup without migrations `007_account_http.sql` through `015_backup_recovery_requests.sql`; it never applies
migrations itself. Its default listener is `127.0.0.1:3000`.

In another terminal, from the same directory:

```sh
pnpm mail:worker
```

Open [Mailpit](http://localhost:8125) to read messages. Use `pnpm mail:status` to inspect
queue counts. To open email links in the portal, run `pnpm portal:build`, set
`CLOUD_PORTAL_ASSETS_DIR=apps/portal/dist` and restart `pnpm account:serve`. The server
loads exactly `index.html`, `app.js` and `app.css` at startup. Missing configured
assets prevent startup; omitting the setting retains the API-only server.

The portal serves `/`, `/signup`, `/login`, `/forgot-password`, `/reset-password`
and `/account`, plus `/connect` for pairing and `/recover` for snapshot recovery. Unknown paths return 404. Static GET/HEAD requests retain host checks
and connection limits but do not consume database counters or the eight account
operation slots. Rebuild and restart after frontend changes.

New email links carry their token and language in the URL fragment. The portal
removes them before rendering and sends a token only in the completion POST body.
Opening a link never completes signup or resets a password automatically. Previously
issued query-token links still work on the two completion pages; their initial HTTP
request contains the token, so do not log query strings at an ingress. Reloading a
scrubbed completion page requires reopening the email or requesting another link.

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
tokens and generated IDs. Each body requires the listed string fields; activity
and logout take `{}`. Signup request, reset request and reset completion also accept
an optional `"locale":"en"` or `"locale":"es"`. Omission means English. Request
locale selects the link email; reset-completion locale selects the password-change
notification. Other fields and unsupported languages are rejected. API query
parameters remain rejected, so tokens belong only in completion bodies.

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
| 400 | `invalid_input`, `link_unavailable`, `password_compromised` | Invalid shape, ambiguous cookies, unusable completion token or a password present in the configured corpus |
| 401 | `credentials_invalid`, `unauthenticated` | Login failed or no usable session |
| 403 | `forbidden` | Wrong origin/host or missing/incorrect session CSRF proof |
| 404 / 405 | `not_found` / `method_not_allowed` | Unknown path or wrong method |
| 408 / 413 / 415 / 431 | `invalid_input` | Receive timeout, body too large, unsupported encoding/type or headers too large |
| 429 | `rate_limited` | Shared request allowance exhausted; obey `Retry-After` |
| 503 | `temporarily_unavailable` | Database or password-screening failure, admission limit or shutdown; retry after the advertised delay |

Bodies are limited to 16 KiB, including streamed bodies, and headers to 8 KiB.
Header/body receive deadlines are five seconds, checked by Node at one-second
intervals; the body reader also has a five-second deadline. Each process permits
200 connections and eight simultaneous account operations. Additional operations
receive 503 with `Retry-After: 1`.

PostgreSQL counters apply across all API instances and survive restarts:

| Scope | Allowance |
| --- | --- |
| API routes, per client IP | 120 per minute |
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

A bounded local contention run on an 18-core Apple M5 Pro admitted exactly 10 of 12
same-IP logins and exactly 30 of 31 same-address logins across two API instances. The
last request used the correct password and was still refused, which demonstrates the
targeted lockout trade-off rather than a quota bypass. Across two isolated runs, eight
concurrent password hashes took 23 to 52 ms each. Known and unknown failed-login
responses took 314 to 327 ms and 315 to 326 ms respectively, so both stayed above
the response floor. These are local measurements, not deployment capacity or timing
promises.

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

Before public use, complete live provider and sender verification, delivery-event handling, corpus sourcing and update operations,
MFA policy, ingress bot controls, production secrets, retention rules and deployment
load/timing checks. The [backlog](../../docs/backlog.md) tracks these separately from
Waitron pairing and shared UI extraction, which are now unblocked by SQLite.

## Verify changes

```sh
pnpm typecheck
node scripts/test-postgres.mjs --filter @waitron-cloud/account-http test
ABUSE_RECEIPT=/tmp/cloud-abuse-boundaries.json pnpm test:abuse
node scripts/verify-cloud-abuse-receipt.mjs /tmp/cloud-abuse-boundaries.json
pnpm test
```

These commands use disposable PostgreSQL and Mailpit containers. Tests complete the
account journey through captured email, exercise shared counters across connections,
and send real slow, oversized and interrupted HTTP requests. API tests inspect HTTPS
cookie attributes and use explicit Cookie headers. The portal suite adds real browser
cookie/session journeys over loopback HTTP, phone layouts, both themes and accessibility.
Production TLS ingress and browser cookie behavior at the deployed HTTPS origin still
need deployment verification.

The abuse run stays on disposable local services. It records the repository state,
hardware, quota outcomes and timing ranges in JSON. The verifier rejects incomplete
receipts and impossible relationships. Do not point this command at a public or
customer service.

## Pair a venue

The [version 1 pairing contract](../../docs/superpowers/specs/2026-09-23-venue-pairing-design.md)
binds an installation key, local venue, environment and chosen Cloud business.
Use this for local integration testing. Cloud verifies signatures and Cloud permission;
the implemented Waitron adapter checks a real local administrator before starting and
before signing completion.

Machine POSTs use `/api/pairing/start`, `/api/pairing/status` and
`/api/pairing/complete`. Send only `payload` and `signature`, encoded as base64url,
without an Origin header. Generate the Ed25519 key on the installation; sign the
canonical bytes from `pairingPayload` with Node's `sign(null, bytes, privateKey)`.
Never send the private key. The signature covers the Cloud origin, action, request UUID,
public key, venue UUID, environment, matching code or chosen business, and current time.
The signature is accepted within 60 seconds; retry later with a fresh signature over
the same request. Start accepts `test` or `production` environment.

The signed start supplies an eight-digit random matching code, which Waitron displays
locally. Cloud stores its digest. From a signed-in Cloud browser, use:

| Request | Body | Result |
| --- | --- | --- |
| GET `/api/account/pairing/businesses` | Session cookie | `{businesses:[{organisationId,organisationName,legalBusinessId,legalBusinessName,countryCode}]}` |
| POST `/api/account/pairing/inspect` | `requestId`, `code` | Bound local venue and current approval state |
| POST `/api/account/pairing/approve` | `requestId`, `code`, `organisationId`, `legalBusinessId` | Approval bound to the current account and chosen business |

Both browser POSTs require the exact portal Origin, session cookie and its
`X-CSRF-Token`. They do not renew the session. Start and approval do not create an
installation. Waitron polls signed status, shows the selected names locally and requires
local administrator confirmation before signing complete with the selected IDs.
Completion returns `registration` and state `complete`; services remain unconfigured.
The same request returns that registration on retry, including after expiry, unless
the installation has been revoked. A different key or business cannot take it over.

Pairings expire after ten minutes. Five wrong codes close browser confirmation of
that request, including completed requests. For unfinished pairing, start a new UUID/code.
The authenticated machine can still retrieve its completed registration. Existing approval cannot change account or
business. Account permission is checked again before linking. The five-attempt count
is shared across processes and IPs. Additional allowances are ten starts per 15 minutes
per IP and key, 60 status/completion calls per minute per IP and key, and 30 browser
pairing calls per minute per account, inside the overall API limit.
Unsigned start attempts also consume their IP allowance. Venues sharing an internet
address share that limit; an untrusted forwarding proxy can collapse customers into
one address. A one-second status poll uses half the overall per-IP minute allowance,
so prefer explicit refresh or a slower interval.

The local abuse experiment starts 12 distinct venues concurrently behind one address.
Exactly 10 start and two receive 429, including when two API instances race. Five
guesses using unrelated request UUIDs leave the real request's failure count at zero.
Five concurrent wrong codes against a known UUID serialize to exactly five and close
that request. This prevents unlimited code guesses but lets someone who learns a
pending UUID deny that one pairing. Keep the UUID out of logs and choose ingress or
request-reissue mitigation before changing the five-attempt rule.

Invalid signatures return 401 `invalid_proof`; missing permission returns 403
`permission_denied`. Unavailable requests, mismatched bindings, absent approval and
registration conflicts return 400 with fixed codes. Database failures return 503.
None of these replies echoes request bodies. Keep request bodies, codes and signatures
out of ingress logs. This slice issues no renewable machine credentials; those follow
in the installation lifecycle task.

## Installation access and status

Pairing registers the installation. To enable its control API, set
`CLOUD_INSTALLATION_ISSUER_KEY` to an Ed25519 private key in PKCS8 DER, encoded as
unpadded base64url. Generate a separate key and keep it in your ignored configuration:

```sh
node --input-type=module -e 'import {generateKeyPairSync} from "node:crypto"; console.log(generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"der"}).toString("base64url"))'
```

Keep this key across API restarts and use the same key on every API instance. Omitting
it leaves pairing available but makes installation routes return 503. Rotation needs
a coordinated trust-key rollout; this implementation accepts only the current issuer.
Do not replace the key casually: outstanding leases would stop being accepted.

Machine POSTs to `/api/installations/renew`, `/configuration`, `/report` and `/revoke`
carry the signed envelope defined in the
[installation contract](../../docs/superpowers/specs/2026-09-24-installation-lifecycle-design.md).
They have no browser Origin or session cookie requirement. Cloud checks the stored
installation key before charging its allowance: 30 requests per minute per installation,
60 per IP, within the shared 120-per-IP API allowance. A one-hour lease also binds
configuration and report requests to the venue, environment and control audience.
Renewal and revocation use the installation key directly, so an expired lease does
not prevent either operation. Revocation refuses subsequent renewals.

From the account portal, you can inspect your organisation's installations. The
account API provides GET `/api/account/installations` and POST
`/api/account/installations/revoke` with `{"installationId":"<uuid>"}`. Both require
a live customer membership; the POST additionally requires ownership, the exact
Origin and CSRF token. Platform permissions alone do not grant access. Account routes
allow 30 requests per minute per account and return status without installation keys,
lease signatures or adapter configuration. Revocation records the actor, time, reason
and result while keeping the venue and service records.

The three service states begin unconfigured. Internal provisioning can advance a
configuration revision. Installation reports cannot configure services, and a report
for an old revision is refused. Health becomes unknown after five minutes without a
fresh observation. A healthy report is not proof of a restorable backup. The local
integration runner exercises the protocol with synthetic observations; the next service
adapters must supply actual measurements and separately scoped authority.

## Browse snapshots

Open **View snapshots** on a venue card to inspect your retained snapshot history. You
must own the organisation. Choose a snapshot to see its capture time, verification
result, retention class and ordinary expiry date. The list shows up to 50 snapshots;
use **Older snapshots** for the next page or **Latest snapshots** to start again.
Switching organisation or account clears the open catalogue.

POST `/api/account/backups/list` accepts `{"venueId":"<uuid>"}` and an optional
`"cursor":"<nextCursor>"` from the preceding response. Send the session cookie, exact
Origin and CSRF token. This read does not renew your session. This endpoint allows 30 requests
per account per minute across API workers, separately from other endpoint limits. A cursor belongs to one venue, including
when its boundary snapshot is subsequently deleted.

The response contains `venueId`, `points`, `nextCursor`, `defaultPointId` and
`continuousRecoveryAvailable:false`. Each point includes only `id`, `capturedAt`,
`verification`, `retention`, `expiresAt` and `protection`. Protection is `fallback`,
`recovery` or null; `recovery` takes precedence when both protections apply. It describes retention, separately from current verification.
Object locations, keys, source node identities and download authority are excluded.
Only undeleted snapshots appear; an unprovisioned venue has an empty list.

Daily snapshots have 30-day ordinary retention and monthly snapshots have 12 calendar
months, calculated in UTC for both display and cleanup. The last snapshot that passed verification remains protected even if a later
check fails; before any verification succeeds, the newest snapshot is kept. Active,
unexpired recovery operations also prevent deletion. Expiry dates do not guarantee
when deletion occurs. There is no customer deletion action in this screen.

Continuous backups normally provide the newest recovery point; snapshots are archives
and a fallback. The screen selects the latest currently verified snapshot when it is
on the page. To start guided snapshot recovery, open the `/recover` link from the
replacement server and enter its matching code. The local test flow authorises a
verified snapshot and lets Waitron download, validate and stage its existing cold
restore. Complete continuous server replacement and production activation still
require the remaining Waitron contract.

## Service alert preferences

`GET /api/account/alerts` returns your current `{enabled, locale}` preference (disabled
and English by default). `POST` accepts exactly `{enabled: "on" | "off", locale: "en" |
"es"}` with the current session, exact Origin and CSRF proof. Both share a 30-request
per-account, per-minute allowance and do not renew passive sessions. Venue overview
responses include bounded monitoring evidence for your current organisation memberships.
See [local monitoring](../../docs/local-monitoring.md) for thresholds and delivery rules.

## Installation snapshot delivery

The optional [authenticated capture adapter](../../docs/authenticated-captures.md) adds
`backup-reserve` and `backup-publish` machine endpoints. Configure its storage authority
explicitly; customer browser sessions cannot obtain upload grants.

## Guided snapshot recovery

The configured capture adapter also supplies temporary recovery read authority. Owner
POST routes under `/api/account/recovery/` require the same live session, exact Origin
and CSRF proof as other account changes. `inspect` and `close` accept `requestId` and
`code`; `approve` also accepts `pointId`, `oldServerUnavailable:"true"` and
`acceptDataLoss:"true"`. The browser receives status and snapshot identifiers only.

Replacement POST routes under `/api/recovery/` require signed fresh-key proof and reject
browser Origin headers. `start` and `status` carry matching request proof; `info`, `read`
and `restored` carry operation proof. New requests allow ten calls per fifteen minutes
per IP and proven key. Other machine calls share thirty per minute per IP and proven
key; owner calls allow thirty per minute per account. The global IP allowance also applies.
Execution rechecks authority after any provider wait. Expiry uses the database clock.

Recovery has the same measured shared-address and known-ID trade-offs as pairing.
Twelve concurrent fresh-key starts behind one address admit 10 and refuse two. Random
UUID guesses do not spend a real request's code budget, while five concurrent wrong
codes against its known UUID close it and refuse the subsequent correct code. Issue a
fresh recovery request after that refusal; do not raise the guess allowance without a
deployment threat assessment.

See the [wire contract](../../docs/superpowers/specs/2026-09-24-customer-recovery-design.md)
and [local walkthrough](../../docs/local-backups.md#recover-a-test-venue-without-copying-keys).
These endpoints refuse production venues and continuous records. Recovery reports do
not enrol a replacement, change routing or establish permission to trade.
