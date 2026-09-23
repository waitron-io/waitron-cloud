# Installation credentials and service status

Programme task 3. The owner delegated implementation decisions and authorised local
integration, review and landing without another approval pause.

## What you get

After connecting a venue, Waitron obtains renewable Cloud access and shows each
service separately. You see the last successful Cloud contact, credential expiry,
configuration revision and remote-access, continuous-backup and snapshot state.
A connection never implies those services work. A stale observation reads Unknown.

As the organisation owner, you can stop an installation's Cloud access from Cloud.
A local manager can request the same operation from Waitron. Both surfaces require
an explicit confirmation. This permanently retires that installation's Cloud access;
it keeps the venue, retained backups and subscription records. It neither stops
local trading nor cancels a subscription. Recovering or replacing the server is the
later replacement flow, not implicit revival of a revoked key.

## Identity and credentials

The paired Ed25519 key is the durable installation identity. It remains in the
node-local private file. Cloud issues a signed one-hour access lease bound to the
installation, public key, venue, environment, issuer and control audience. The lease
is public proof bound to the key, not a bearer secret: every machine request also
proves possession of the private key. Neither a registration ID nor a copied lease
grants access on its own.

Cloud signs with an operator-configured Ed25519 issuer key. Its identifier is a
SHA-256 fingerprint of its public key. The existing pinned HTTPS Cloud origin is
Waitron's trust boundary for receiving leases. Future gateway verifiers receive
trusted public issuer keys through operator configuration, never from the lease.
The local fixture supplies its own test key; it changes no production configuration.

The lease payload is canonical UTF-8 JSON containing an ordered array:
`["waitron-cloud-access-v1", origin, keyId, leaseId, installationId, venueId,
environment, publicKey, issuedAt, expiresAt, "control"]`.
Its envelope is `{payload, signature}`, both unpadded base64url. Verify the issuer,
algorithm, canonical representation, exact field shapes, audience and expiry.

Machine requests use another ordered array:
`["waitron-cloud-machine-v1", origin, action, installationId, operationId,
issuedAt, lease, body]`. Here `lease` is the canonical JSON lease envelope or empty
for renewal/revocation, and `body` is canonical JSON of the action's validated input.
Sign the exact bytes with the installation key. Reject unknown versions, actions,
extra fields, mismatched IDs and signatures outside a 60-second clock window.
Use bounded request/reply bodies, timeouts and rate limits; never follow redirects.

## Persistence and authority

Renewal proves the active installation key, including after lease expiry. Lock the
installation before granting access; revocation uses the same lock. Recheck wall
clock after waits. Mutation operation IDs are unique within the installation and
store the validated semantic request digest and result. A retry with a fresh request
timestamp and a renewed valid lease returns the recorded result; a changed body conflicts.
The digest covers the action and body, while every replay validates current authority. Replayed renewal
returns the original lease and expiry. A new operation obtains a new lease.

Configuration and observations are separate records. Configuration has a monotonically
increasing revision and three explicit service setup states. Only trusted Cloud
provisioning code changes desired configuration. This task starts all three services
Unconfigured; the next tasks provide their actual configuration. No public arbitrary
configuration writer is added.

Reports name the applied revision and up to three known services, each with bounded
health (`unknown`, `healthy`, `degraded`, `failed`) and an allowlisted failure code.
Version 1 requires this exact JSON property order, no whitespace, and explicit null
when there is no failure: `{"revision":0,"observedAt":0,"services":[{"service":"remote_access","health":"healthy","failure":null}]}`.
The fixed three-service configuration is a versioned contract; adding another service
requires capability/version negotiation with older Waitron installations.

Store server receive time separately from the installation's observation time.
Reject future/older revisions and do not let older reports replace newer observations.
Both receipt and observation must be less than five minutes old; an old observation
received recently still reads Unknown. Machine request clocks must be within 60 seconds. An
installation report never verifies restorability or makes an unconfigured service Ready.

Cloud account reads use a live session and organisation membership. Revocation
requires `is_owner`, CSRF and the exact Origin, with a fresh session check after
contention. Platform permissions alone do not grant customer access. The local
operation requires a live `system.manage` session; background refreshes never renew
that human session. Record revocation actor, reason, time and operation result.

## Waitron integration and failure handling

Extend node-private state with the lease, pending operation, applied revision and
last Cloud response. Reuse one local operation gate and durable file writes. Persist
mutation intent before sending, then reconcile the result after restart or a lost
reply. A local stop request waits for the write gate, rechecks permission, then supersedes
any pending configuration or renewal request before contacting Cloud. An unavailable Cloud service keeps the prior configuration with an explicit
stale/unavailable status; it must not be mistaken for revocation. A revoked response
withdraws local Cloud authority without altering local primary or fiscal state.

Run a bounded background refresh while the server runs, renewing with ten minutes
left and reporting status independently of browser activity. Shutdown cancels its
wait/network work. The local status route returns cached state only. The browser's
Refresh action is explicit activity and can retry a failed exchange.

Revocation immediately blocks new control-plane operations and grants. Task 4 will
apply separately scoped gateway authority, refresh normal revocation within one
minute and bound management-outage fallback by its lease expiry. Task 5 will enforce
separate storage credentials. Do not claim those adapters enforce revocation before
they exist. Established services must not query management on every data request.

## Acceptance

Use real PostgreSQL for renewal/revocation races, expired-lock waits and restart
recovery. Test forged/copied leases, cross-installation requests, changed operation
inputs, stale reports, permission loss and revoked pairing retries. Retain the two
real Waitron server journey, adding independent config/status, renewal with a lost
reply/restart and revocation. Keep English/Spanish copy and browser accessibility.
No live AWS deployment, fiscal activation, customer data or external mail is involved.
