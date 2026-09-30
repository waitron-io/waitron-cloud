# On-prem transactional email relay, version 1

Status: version 1 Cloud/Waitron contract, scoped on 2026-09-30. The internal
local-proof grant, reservation, signed admission and encrypted queue are implemented.
No relay worker is installed. Normal startup exposes no relay routes. Production remains disabled until the decisions and proofs
below are complete.

You should be able to send ordinary Waitron account emails after connecting a free
Cloud account, without buying remote access or backups. The relay accepts a small
set of account messages from an authorised installation. Cloud owns delivery;
Waitron still owns the account action and decides whether its token or code works.

## What exists today

These are source observations, not executed relay guarantees. The inspected Cloud
base is `5dae08dff38661c590c3c7a891f4c5a866911ba4`; the inspected Waitron base is
`0fbcde00151f47b5e300d4adad8d297f92d3bed3`. No provider terms or location claims are
made here. The [account SMTP guide](production-email-implementation.md) describes
the existing transport; its historical provider research needs a separate decision.

| Boundary | Current consumer and gap |
| --- | --- |
| Waitron caller | [`management-api.ts`](https://github.com/clintongormley/waitron/blob/0fbcde00151f47b5e300d4adad8d297f92d3bed3/apps/server/src/management-api.ts) builds `/manage/account?token=…&purpose=…` and an email fragment for invitations/resets. [`me-api.ts`](https://github.com/clintongormley/waitron/blob/0fbcde00151f47b5e300d4adad8d297f92d3bed3/apps/server/src/me-api.ts) sends email-change codes with the profile URL. Both call `AccountEmailSender`, returning `Promise<void>`; neither result is a durable Cloud delivery receipt. |
| Waitron transport | [`boot.ts`](https://github.com/clintongormley/waitron/blob/0fbcde00151f47b5e300d4adad8d297f92d3bed3/apps/server/src/boot.ts) wires both callers through [`resolveEmailDelivery`](https://github.com/clintongormley/waitron/blob/0fbcde00151f47b5e300d4adad8d297f92d3bed3/apps/server/src/email-delivery.ts): configured SMTP, practice/development capture, or unconfigured. [`account-email.ts`](https://github.com/clintongormley/waitron/blob/0fbcde00151f47b5e300d4adad8d297f92d3bed3/apps/server/src/account-email.ts) renders invitation, password-reset and email-change templates. A durable Cloud client and explicit transport selection are missing. |
| Machine identity | [`installation-proof.ts`](../packages/registration/src/installation-proof.ts) signs origin, action, installation, operation ID, time, lease and body. The action list now includes the three explicit email operations. [`installations.ts`](../packages/registration/src/installations.ts) separates preliminary authentication from a transaction that locks and rechecks authority. Preliminary signature verification alone is insufficient for relay admission. |
| Cloud queue | [`email-outbox.ts`](../packages/registration/src/email-outbox.ts) encrypts payloads with separately supplied keys and leases worker claims. Its verification/reset liveness queries read Cloud account tables; they cannot validate an on-prem token. The existing `sent` result means transport acceptance, not inbox delivery. |
| Usage | [`usage-metering.ts`](../packages/registration/src/usage-metering.ts) records organisation-scoped observations. It does not supply a free-service account balance. The [address scope](address-lookup-scope.md#the-cloud-account-owns-the-allowance-provider-calls-remain-separate) proposes a separate, explicit Cloud account attribution shared by installations. |

Keep Cloud account recovery and service alerts separate from this new relay. They
have different authority and liveness checks and must not consume an on-prem grant.

## Authority belongs to an installation and a consenting account

Propose a versioned `transactional_email` grant issued through an authenticated Cloud
session, with the normal Origin and CSRF protections. The consenting, verified,
enabled Cloud account must currently own the installation's organisation in version
1. This owner-only default needs approval before enablement; broader membership
policy remains a separate decision. The grant binds account, organisation, venue,
installation, environment, revision, permitted message classes, verified management
origin and expiry. Cloud derives these identifiers from its records, not the request.
A local staff ID or matching recipient email never substitutes for Cloud identity.

All grants charged to one account share its allowance, across venues and
installations. Re-pairing, a second installation or changing the request's account ID
cannot reset that balance. A new owner needs fresh consent; historical charges keep
their original account attribution. Reject owner removal, account disablement,
installation revocation/replacement, grant expiry and old grant revisions. Recheck
these under the same database locks as admission and allowance reservation, and
again before provider handoff. If authority cannot be read, defer within the message
expiry; do not assume permission. Never grant email because a paid service is active.

A free email grant needs an independently verified management origin, including a
customer-managed endpoint when the venue has no paid Cloud route. Domain control
and an HTTPS endpoint check must be part of grant setup. A private LAN origin needs
an explicit verification design before support; do not silently accept arbitrary
URLs. Remote access is not a prerequisite, and delivery does not prove the recipient
can reach the venue. The setup screen must explain that local access may be needed.

## Only three message classes

Version 1 allows `invitation`, `password_reset` and `email_change`. Each request has
one recipient and structured template fields. Reject arbitrary subject/body/HTML,
attachments, CC/BCC, caller-selected headers, envelope sender, reply-to, provider
credentials and marketing, receipts or bulk notices. A later class needs a versioned
schema and its own authority review.

Cloud controls the fixed sender and template revision, validates text lengths and
escapes display names. Use a verified Cloud sender domain; the venue name may appear
as bounded template text, never as sender authority. Cloud constructs links from the
grant's verified management origin and fixed paths. Invitations/resets carry the
Waitron token for `/manage/account`, with the class as purpose and recipient in the
fragment. Email change carries a code and uses `/`; no caller-provided action URL is
accepted. An optional privacy link must come from reviewed grant configuration, not
message text. Cloud must not fetch message-supplied links.

Waitron checks the local actor, recipient and action before creating a request. It
retains single-use, expiry and supersession checks when the action is consumed.
Cloud cannot independently prove that an authenticated but compromised venue really
requested a password reset. Fixed templates, narrow origins and bounded recipient
traffic reduce that abuse; they do not eliminate it. Suspend the grant when detected.

## Proposed wire exchange

The proposed routes are `POST /v1/installations/email/submit`, `/status` and `/cancel`.
They are installed only when you inject local-proof relay configuration into the
account app/server. The machine catalogue includes `email-submit`, `email-status`
and `email-cancel`, with negative cross-action tests. They reuse the
signed `waitron-cloud-machine-v1` envelope over HTTPS and its current time window,
key-bound lease and origin checks. Each signed body's `version` is `1`. Unsupported
versions and unknown fields fail before queueing.

Persist a UUID `messageId` with the local action before the first network attempt.
For submit, use it as the signed `operationId`; retain it across restart and lost
responses. Re-sign with a fresh time/lease without changing the body. Status/cancel
have separate operation IDs and identify the message in their signed bodies. The
idempotency key is `(installationId, messageId)`, scoped to the authenticated
installation; a different body under that key returns `409 message_conflict`.

This illustrative decoded body uses synthetic values, not a runnable request:

```json
{
  "version": 1,
  "messageId": "09aac7cc-d729-465d-96bc-88c2dd9f087b",
  "grantId": "f4ce07b9-0126-4a5f-a77a-704d9351e259",
  "grantRevision": 1,
  "class": "password_reset",
  "recipient": "ana@example.test",
  "displayName": "Ana",
  "locale": "es-ES",
  "timeZone": "Europe/Madrid",
  "expiresAt": "2026-10-01T10:15:00.000Z",
  "token": "synthetic-action-token"
}
```

The example token is deliberately not valid. The implemented validator accepts
Waitron's current canonical 43-character base64url token (32 random bytes) and
six-digit email-change code. The source check on 2026-09-30 found invitation
expiry at 24 hours, reset/change at 30 minutes and code expiry at 10 minutes. Invitation/reset require a token and forbid code fields.
Email change requires `code` and `codeExpiresAt`, forbids token, and expires at the
earlier code/action deadline. Permit the supported English/Spanish locale variants
and validated time zones; do not change Waitron's token format to fit Cloud's existing
43-character account-token validator.

Proposed protocol bounds: at most 4,096 UTF-8 bytes for the serialized body within
the current machine-envelope limit; one normalised email up to 254 bytes; display
name up to 200 Unicode code points; token up to 512 ASCII bytes; code up to 64 ASCII
bytes. Reject controls in all header-relevant fields. Reject past expiries and
expiries over 24 hours away; those upper bounds need compatibility tests against all
three Waitron actions, not truncation. A shorter action deadline always wins.

Commit the message, keyed body fingerprint and one allowance reservation together.
Use a separately keyed fingerprint because a plain hash of an email-change code
would permit guessing from a database copy. Bind encrypted content to the message,
installation, grant revision and class. Return `202` only after durable commit:

```json
{"version":1,"messageId":"09aac7cc-d729-465d-96bc-88c2dd9f087b","state":"queued","statusRevision":1}
```

After rechecking current authority, a matching replay returns the same message identity
and current state (`200`), with
no second queue row or reservation. A signed status request contains only version
and message ID. Respond with state, monotonically increasing status revision,
expiry, a bounded retry delay where relevant and fixed reason code; never echo
recipient, token, code or raw provider response. Cancel has the same body as status;
an exact cancel retry returns the current state without repeating a transition.
Cancel moves only unstarted work to `cancelled`; otherwise return the observed state.
Refuse unauthorised reads before
revealing whether the message exists. Proposed errors: `400 invalid_message`,
`401 invalid_proof`, `403 relay_disabled` or `grant_unavailable`, `409 message_conflict`,
`429 rate_limited` or `allowance_exhausted`, and `503 relay_unavailable`. Give bounded
`Retry-After` guidance for temporary refusal. A missing status is not proof that a
concurrent submit failed; retry the original submit ID.

## Queueing and uncertain delivery

Waitron needs a durable local submission record tied to its account action. Never
hold its database write lock across a Cloud call. After a crash it must recover the
same identity and fields, stop locally expired work and reconcile Cloud status.
Treat the old `Promise<void>` success and UI `emailVerificationSent` semantics as a
migration dependency: accepted into a queue must be labelled “Queued”, not “Delivered”.
An uncertain Cloud reply must not trigger automatic direct-SMTP fallback or a new ID.

Reuse the Cloud queue's encryption, separate key ring, bounded leases, cancellation
signal and TLS adapter patterns through a distinct relay payload and liveness path.
Do not insert on-prem tokens into Cloud signup/reset tables. Missing encryption keys
must fail closed. Keep recipients, tokens, codes and rendered content encrypted at
rest, including local durable storage and backups; keep keys outside database
backups. Clear ciphertext at terminal completion. Choose metadata retention before
production, and keep deduplication tombstones for the full accepted-message/retry
window so cleanup cannot allow the same live request twice. Fingerprint-key rotation
must retain verification for that window too.

Proposed states are `queued`, `sending`, `accepted`, `uncertain`, `failed`, `expired`
and `cancelled`. Provider acceptance is terminal for sending; it means the relay
accepted the message, not that it reached an inbox. A bounce or complaint is a
separate, authenticated delivery outcome, never an instruction to resend. The
customer view may say “Accepted by mail service”, “Delivery could not be confirmed”,
“Expired” or “Could not send”, with English and Spanish wording and a next action.
Public password-reset responses stay generic and reveal neither account existence
nor relay status. Owners see only their current authorised venue/grant summaries.

Before handoff, recheck lease/claim ownership, grant authority, suppression and
message deadline. Retry known pre-acceptance connection failures or temporary SMTP
refusals using the existing bounded policy as a starting point: eight attempts,
30-second exponential delays capped at 900 seconds, within expiry. Test the existing
15-second adapter / 20-second worker / 60-second lease ordering for this payload.
Permanent refusal ends the message. A timeout/disconnect after DATA, or a worker
crash after provider acceptance but before recording it, is `uncertain`. Default to
no automatic resend of uncertain work unless a selected provider offers a proven
idempotent submission/query mechanism. An expired `sending` claim is conservatively
uncertain unless durable evidence establishes that no handoff began.

This differs from the current Cloud worker, which may retry an ambiguous failure.
A stable Message-ID helps investigation but does not guarantee deduplication.
Reconcile only with authenticated provider evidence bound to that message. A later
user-requested resend uses a new local action and message ID, invalidates the old
action where appropriate, and warns that the first message may still arrive.
Revocation/cancel prevents unstarted work, but cannot recall an in-flight message;
retain its uncertain/accepted outcome instead of falsely reporting cancellation.
Cloud cannot synchronously revalidate a token on an offline venue. Expiry and a
best-effort cancel suppress stale mail; Waitron's consume check remains decisive.

## Allowances, abuse and status

For production, recommend one customer unit per durably admitted message, retained for every later
outcome, including uncertainty. This simple rule needs owner approval alongside the
password-reset limit policy; it is not current pricing or an implemented entitlement.
Rejected admissions cost zero customer units; exact retries cost zero extra units.
Track provider attempts, acceptances, refusals and uncertainty separately for cost
and reliability. Do not equate an organisation usage event with an account debit.

Use `(accountId, service, allowancePeriod, installationId, messageId)` as the unique
customer debit key and `(installationId, messageId, attemptNumber)` for operational
attempts. Snapshot attribution and period at admission; retries after a period reset
stay on the original debit. Never accept attribution from the payload. Serialize
concurrent account reservations across all installations, with explicit UTC period
boundaries and a shared policy version. The size and reset interval remain open.

Admission also needs independent, shared limits for ingress, installation, grant,
account and recipient; cap queued bytes, worker concurrency and provider expenditure.
Use keyed recipient identities for short-lived abuse counters, never raw addresses
or unkeyed address hashes in metrics. Replays consume ingress capacity but no new
allowance. Apply pre-authentication limits without letting a forged installation ID
spend that installation's budget. Authenticate bounce/complaint events, deduplicate
them, suppress affected destinations and keep operator diagnostics free of message
content. Metrics use fixed classes/outcomes, not recipient or message-ID labels.

Do not choose password-reset excess behaviour implicitly. The owner must choose
refusal with a recovery alternative, a separately bounded reset reserve, or another
explicitly budgeted policy. No unlimited bypass. Show allowance use/remaining only
when a real policy exists; keep Cloud account recovery independent so exhausting a
venue's relay allowance cannot lock its owner out of Cloud.

## Ownership and bounded implementation slices

| Slice | Owner and required proof before proceeding |
| --- | --- |
| 1. Grants and allowance core | Cloud: explicit account consent, origin verification, revocation and concurrent account reservations. PostgreSQL tests for two accounts, multiple installations, owner removal, period rollover and duplicate admission. No public send route yet. |
| 2. Version 1 admission and status | Cloud: signed actions/routes, encrypted relay records, keyed replay checks and access-filtered status. Real HTTP tests for bad versions/keys/actions, stale leases/grants, foreign IDs, exact retry and lost response after commit. |
| 3. Relay worker | Cloud: bounded claims, expiry, suppression, accepted/uncertain outcomes and safe diagnostics. Local SMTP fixture tests for permanent/temporary refusal, post-DATA disconnect, process death, key rotation and two-worker fencing. No live delivery. |
| 4. Durable caller and screens | Separate Waitron item: local action/outbox boundary, explicit Cloud transport, action-to-template mapping, cancellation, safe error handling, restart and bilingual status. Preserve existing local-capture and configured-SMTP choices. Test both management and profile callers, including an offline venue and expired action. |
| 5. Joint local receipt | Both repositories: two installations/accounts, cross-tenant refusals, lost replies, quota contention, revocation racing handoff, link/code consumption and complete fixture cleanup. No activation of paid services. |
| 6. Production enablement | Owner and Cloud operations: resolve the decisions below and run a separately authorised provider proof, then a capped opt-in rollout with rollback. |

For every slice, start with failing behaviour tests and preserve the existing account
mail tests. Adversarial cases must include header/HTML injection, a phishing origin,
reused operation ID with a new recipient, database-only guessing of a short code,
forged account attribution, restored old installation credentials, payload-key loss,
and abuse by a valid compromised installation. Delete critical guards in disposable
checkouts to show those tests fail. Slice 1 tests the grant and reservation boundaries below. The remaining cases
are acceptance requirements for their owning slices, not completed relay proofs.

The Waitron profile caller currently logs raw exception text in its email-send catch
(`me-api.ts` at the pinned revision above), while management logs fixed fields. Before
wiring relay errors, replace that path with bounded diagnostics under a separately
authorised Waitron change and test with a secret-bearing exception. This is a source
finding; actual sensitive-log exposure has not been reproduced in this scope.

## Use the disabled grant core locally

An ordinary startup installs no usable relay capability. `new RelayGrantStore(pool)`
refuses approvals and reservations, including reservations against existing grants.
There is no production constructor mode, HTTP grant endpoint or delivery worker.
The signed message routes require explicit local-proof constructor configuration. Cloud account emails and paid-service configuration remain independent.
The core is in `packages/registration/src/relay-grants.ts`; importing it alone does
not enable it. Migration 031 creates empty tables with grants disabled by default.

For a disposable proof, you must supply `mode: 'local-proof'`, a consent version,
a trusted `verifyOrigin` adapter, and every allowance field. The allowance fields
are `version`, positive `units`, `periodSeconds`, a canonical UTC `epoch`,
`excess: 'refuse'` and `debit: 'retain'`. These choices are explicit test settings,
not approved production policy. Only installations whose stored environment is
`test` qualify. The approving Cloud session must pass CSRF validation and belong
to a currently enabled, email-verified organisation owner. A future browser route
must also enforce the normal HTTP Origin check before calling this core.

The origin adapter receives an installation ID, canonical HTTPS management origin
and a fresh challenge. It must independently prove domain control and the HTTPS
endpoint, and return that exact binding with both checks successful and an expiry.
The request cannot submit its own proof. The adapter is trusted operator code;
no production adapter or private-LAN verification policy exists. Current tests
supply synthetic evidence and prove refusal of wrong, missing or expired bindings.
They do **not** prove public DNS/HTTPS verification. A production adapter must add
bounded network calls, redirect/address restrictions and real domain-control tests
before enablement. No hostname is fetched by this core.

You approve an installation with explicit `consent: true`, the configured consent
version, an expiry, management origin and `expectedRevision` (zero initially).
The core derives account, organisation, venue, environment and installation key
from stored authority. A successful local approval enables that grant and returns
its revision. Reapproval requires the current revision and advances it, so changing
the origin invalidates old submissions. Revocation disables the grant; it remains
available even when the store's admission switch is off. A current owner can revoke
a grant after its original owner or installation loses authority.

Reservations require an open transaction and a separately authenticated installation
ID and public key. An autocommit client receives `transaction_required` before any
write, so a missing `BEGIN` cannot silently bypass the account lock or commit an
orphan charge. The method takes only grant ID/revision, message ID and an opaque
keyed replay binding. It does not authenticate machine signatures itself. The message store verifies
the signed envelope and lease again while holding the reservation transaction's
authority locks. A per-message lock comes first, followed by the existing
account/membership/venue/installation/grant/account-allowance order. The local
proof exercises admission alongside owner revocation and replacement. Never construct the
authenticated identity from message fields.
Insert the encrypted queue record in that transaction and roll back both on failure.
The core returns derived account/period attribution and whether this is a replay.
Only new reservations may create queue records.

One account's installations share the configured period allowance. Exact retries
retain their original period and consume no new unit, including after a restart or
period boundary. A changed replay binding or grant revision conflicts. Revoked,
expired, replaced or key-changed installations and grants, lost ownership, disabled
accounts and lost email verification cannot reserve, even on replay. A new owner
needs fresh consent; earlier reservations retain the original account attribution.
Reservations are retained regardless of subsequent outcome. There is no cleanup or
refund operation in this slice.

Policy definitions are immutable by version. An account is bound to the first
policy it uses, so a second process or new installation cannot reset its balance by
changing the version, limit or period. Changing that binding needs a separately
specified upgrade policy; do not edit the rows to reset an exhausted allowance.
Deadlines and UTC periods are checked with database time after lock waits.

Run the focused proof from the repository root:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test \
  test/relay-grants.test.ts test/account-mail.test.ts test/email-outbox.test.ts \
  test/schema-compatibility.test.ts test/registration.test.ts \
  ../account-http/test/relay-disabled.test.ts
```

This exercises PostgreSQL concurrency, rollover, rollback, process restart,
authority changes and expiry after contention, plus the unchanged Cloud account
mail tests. The HTTP test starts the normal server and confirms that the proposed
relay routes return 404 and queue no mail. It sends no relay message. The separate admission suite enables only local-proof
routes over loopback HTTP and writes encrypted queue records.

## Exercise signed admission locally

You can inject `relay: {mode: 'local-proof', grants, payloadKeys, replayKeys}` into
`startAccountServer`, with a lease issuer and the explicit grant configuration
above. Both key rings use `{activeKeyId, keys}` with separately supplied 32-byte
hex keys. There is no CLI/environment enablement switch. Production installations
remain refused by the grant core. The test fixture in
`packages/account-http/test/fixtures/relay.ts` supplies synthetic accounts, grants
and keys; it is not production configuration.

Run the real HTTP/PostgreSQL proof from the repository root:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node \
  --test --test-timeout=30000 test/relay-messages.test.ts test/relay-disabled.test.ts
```

Submit is `202` after commit and `200` for an exact replay. Each successful reply
contains only version, message ID, state, status revision, effective expiry and a
fixed reason (initially `null`). The status and cancel routes use the same shape.
Missing and foreign IDs both return `403 grant_unavailable`. The tests exercise
all three classes, authority loss, concurrent account allowance, rollback, a new
process, key rotation/loss and cancellation. No SMTP call is made.

Recipients, names, tokens, codes and the verified management origin are encrypted
with AES-256-GCM. Authentication binds ciphertext to installation, message, grant,
revision, class and encryption key ID. Replay fingerprints use HMAC with a separate
key ring and include the complete signed body. Keep old payload and fingerprint
keys until all corresponding records and retry tombstones can be retired. Missing
keys and invalid ciphertext fail closed with `503 relay_unavailable`; status never
returns plaintext. Cancellation still clears unreadable queued content.

Cancellation and observed expiry clear queued ciphertext and advance the status
revision once. They keep the original reservation and replay tombstone. Cancellation
cannot change `sending` or later states. No automatic cleanup or retention period
is installed; choose those before production, and retain tombstones throughout the
accepted retry window. The worker slice owns unattended expiry and delivery states.

The local routes reuse 60 requests/minute per source and 30/minute per authenticated
installation. Forged proofs cannot spend another installation's request limit.
These fixture bounds and the explicitly configured account allowance are not an
approved production abuse policy. Per-recipient/grant budgets, aggregate queued
bytes, suppression and provider spending controls remain production prerequisites.

## Decisions before production

Keep the relay disabled by default globally and per grant, including after upgrades
and restores. Local proof mode may send only to disposable capture fixtures. An
operator kill switch stops new admissions and unstarted work, preserves truthful
in-flight outcomes and leaves Cloud account recovery independent. Enablement needs:

- A selected provider, verified sender, authenticated delivery-event contract and
  evidence for ambiguity handling, suppression and disabled tracking/link rewriting.
- An approved processing and storage location, subprocessors, transit/recipient
  boundaries, queue/audit/deduplication retention and account-deletion handling.
  Spain is the stated preference, not a claim of legal sufficiency or provider choice.
- The consenting-account/membership policy, free grant lifecycle and origin proof for
  customers without paid remote access, including any private-LAN origin support.
- Allowance amount, reset interval, debit/refund rule, recipient and provider budgets,
  and explicit password-reset-limit behaviour with a usable recovery alternative.
- Key custody/rotation, tested rate and worker bounds, owner-visible status, abuse
  response, and the joint Cloud/Waitron compatibility receipt on pinned revisions.

Cloud owns this contract and its backlog. Waitron must link it when its separately
queued caller work begins; this document does not authorise edits to that repository.
