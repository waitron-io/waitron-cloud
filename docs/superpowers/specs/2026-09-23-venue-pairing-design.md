# Venue pairing design

Status: implementation design, 2026-09-23. The owner authorised autonomous design,
implementation, finish and landing of five ordered local integration tasks.
This is task 1. Task 2 adds the real Waitron administrator screen and Cloud confirmation
screen; task 3 adds renewable installation credentials/status; tasks 4 and 5 connect
local gateways and object storage. No live AWS deployment is authorised by this plan.

## Connect the server you are using

You start from Waitron while signed in as a local administrator. Waitron generates an
Ed25519 key on the server, a request UUID and an eight-digit matching code, keeping the
private key on disk with restricted permissions. Cloud receives a signed start request.
You open Cloud, sign in, enter the code shown locally and choose your business. Cloud
records the account's approval. Back in Waitron, you confirm the returned organisation
and business, and Waitron signs completion while checking your local administrator
session again. Registration leaves all services unconfigured.

This is user-mediated first contact: the code and the local confirmation connect the
two authenticated sessions. A self-signed machine claim alone creates no registration.
Cloud cannot attest who administers an arbitrary machine; the real Waitron adapter must
check local authority before starting and before signing completion. Task 2 proves that
boundary with real local sessions. Keep public deployment gated on that proof.

## Wire version 1

Machine endpoints: POST `/api/pairing/start`, `/status`, `/complete`. JSON contains only
`payload` and `signature`, base64url-encoded bytes. Payload is an ordered JSON array:
`["waitron-cloud-pair-v1", origin, action, requestId, publicKey, localVenueId,
environment, code, organisationId, legalBusinessId, issuedAt]`.
The public key is Ed25519 SPKI DER, encoded as base64url. Sign the exact payload bytes.
Origin and action are checked against the receiving server/path. Timestamp is integer
Unix milliseconds within 60 seconds. UUIDs are lower-case canonical UUIDs. Environment
is `test` or `production`. Start supplies code and empty organisation/business; status
supplies empty code/organisation/business; complete supplies empty code and chosen IDs.
All calls carry the original venue/environment/key binding. Reject extra fields,
unsupported versions, noncanonical encodings, algorithms and oversized bodies.

The request expires after ten minutes, measured after database lock waits. Duplicate
signed start requests return the original expiry. Status is read-only. Completion is
idempotent: repeated requests return the existing installation, including after pairing
expiry, unless revoked. Replaying a signed request within its timestamp window cannot
change its action or binding or create new authority. A machine signs a fresh timestamp
when retrying later. Machine replies contain no reusable bearer credentials.

Browser endpoints under `/api/account/pairing`: GET `/businesses`, POST `/inspect`,
POST `/approve`. Inspect and approve require session, same origin and CSRF; body is
requestId/code, with organisationId/legalBusinessId additionally for approval. Business
choices come only from the account's current permitted memberships. Code guessing is
limited to five failures per request, durably across workers/IPs, plus account/IP rate
limits. Store only the code digest. Do not return venue information before code proof.
Once approved, the selected business/account cannot change. Local completion rechecks
Cloud permission before committing any registration.

## Persistence and transaction boundary

Add `pairing_requests` with immutable machine binding, code digest, expiry, failed-code
count, approved account/organisation/business, and completed result. Row locks serialize
approval/completion/retry. Reuse RegistrationStore inside the same PostgreSQL transaction
so pairing and existing approval/venue/installation rows commit or roll back together.
The internal constructor may borrow an already transactional client; public HTTP never
accepts an account ID as authentication. Preserve existing registration tests.

Database/transport failures produce generic errors. Host/Origin checks, body limits,
account admission limits and persistent rate limits apply to the new routes. Browser
cookies are never accepted as machine proof; machine signatures cannot approve a Cloud
account choice. Machine requests with an Origin header are refused. No request payload,
code, signature, cookie or key is logged. Public TLS remains required outside loopback.

## Acceptance

Real PostgreSQL tests cover two installations, both approvals, altered signatures and
bindings, wrong origins/actions/versions/keys, code guessing across processes, expiry,
CSRF, membership removal, concurrent completions and restart/lost-reply retries.
A pre-migration database upgrades through the new migration without changing old rows.
Task 1 tests the Cloud HTTP boundary with generated machine keys; task 2 must use actual
Waitron sessions. Task 3 owns ongoing machine authentication and configuration access.
