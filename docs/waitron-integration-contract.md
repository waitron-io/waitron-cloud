# Waitron and Cloud integration contract

Status: complete two-venue milestone proved locally, updated 2026-09-27. This translates the agreed
[product requirements](product-and-platform.md) into responsibilities and exchanges.
It does not declare endpoints implemented or replace Waitron's recovery rules.

The first milestone connects two test venues to one cell, proves remote-access
isolation, restores both backup types and replaces the gateway. Start with venue
registration; services can then use the same identities and permissions.

The owner confirmed that SQLite landed on 2026-09-23. Recheck its concrete
capture/restore interfaces before wiring backup operations to Waitron. The older
PostgreSQL source below remains a reference for historical contracts. Registration,
permissions and service configuration can proceed against the current SQLite application.

## Local implementation update, 2026-09-27

Pairing, lifecycle and the shared remote gateway now have executable local proofs.
The [managed-backup proof](local-backups.md) adds actual Waitron SQLite streams and archives,
protected key versions, scoped encrypted storage, immutable publication, verified
restore records, retention and owner-bound snapshot recovery. The catalogue exposes
snapshot capture times and signed continuous recovery times through the customer
catalogue and guided recovery screens.

The proof excludes actual source Cloud credentials/staff TLS keys and drops captured
backup destination settings on the disposable replacement. It invokes Waitron's
validation, SQLite restore/migration and module hooks without starting workers.
The same two-venue proof configures Waitron's stream supervisor, verifies each signed
pointer in Cloud, stops both originals, interrupts and retries Waitron's cold restore,
and matches the restored database head to its source. Deleting the other continuous
prefix leaves its neighbour unchanged and its verified snapshot still restores.
Owner-confirmed test-snapshot replacement now preserves the
venue and history, imports fresh installation credentials, retires old Cloud access
and updates the remote placement. The complete milestone runner composes the transfer,
real remote-access and managed-recovery phases into one strict receipt. A clean run
replaced the local gateway while both venues published encrypted snapshots before and
afterward, preserved route and venue separation, refused the old recovery authority,
used fresh recovery authority and restored a snapshot published by the replacement.
Its measured gateway, cell-movement, continuous-restore, snapshot-restore and managed-
replacement times are recorded in [the executable proof](local-backups.md#run-the-proof).

This is local evidence. Live provider storage and DNS, production deployment and secret
custody, automatic tunnel/certificate installation, management-database recovery and
trading activation remain outside this exchange. Cloud's recovery grant is not
permission to trade. The historical source map below
remains useful for ownership but does not describe the current SQLite runtime.

## What already exists

The source baseline is Waitron commit `4ce2db502173d87d14d2e1aad5dc92b19be38363`.
The entries below describe inspected source and designs. No runtime tests were run
for this document; behaviour must be verified during implementation.

| Source | Reuse boundary |
| --- | --- |
| [Archive manifest](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/backup-manifest.ts) | `BackupManifest` v1 records creation time, environment and applied schema version per module. It has no Cloud ownership, recovery-key reference or SQLite stream generation fields. Keep Cloud catalogue metadata outside this format until Waitron versions an extension. |
| [Module contributions](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/packages/module/src/module.ts) and [restore hook](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/packages/module/src/restore.ts) | Modules declare non-database state and restore hooks. Waitron owns collection, migrations and hook execution; Cloud does not recreate that logic. |
| [Storage interface](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/storage-backend.ts) | The archive interface provides put/get/list/delete; its destination type currently contains only local filesystem storage. Cloud storage and Litestream replication need their own integration work. |
| [Restore consumer](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/restore.ts) and [compatibility gate](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/restore-gate.ts) | The inspected archive consumer uses PostgreSQL. Its gate rejects environment mismatch and newer schemas for modules the target runs; absent target modules are ignored by that gate. Preserve behavioural tests while adapting to SQLite; do not infer a different policy from older prose. |
| [Backup status](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/backup-status.ts) | Freshness comes from destination object modification times. This does not establish the last recoverable transaction or prove restoration. Cloud needs separate recovery and verification evidence. |
| [Adoption](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/adopt.ts) | This enrolls a standby through the primary's management credentials. It is not the new Cloud organisation-linking flow. Reuse appropriate identity checks without treating subscription as standby adoption. |
| [Waitron backlog, Cloud integration](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/docs/backlog.md#cloud-integration-and-sqlite-work) | Waitron owns local signup, first-contact trust and retirement of `@waitron/tunnel`. Use the inherited WireGuard direction as the integration baseline; the current package is not the default Cloud transport. Shared gateways and the public/staff TLS split follow the newer Cloud decisions. |

The [recovery design reconciliation](documentation-ownership.md#backup-and-recovery-design-reconciliation)
covers encryption, externally held vault keys, stream/archive identity rules and
the proposed hourly stream snapshots with 30-day retention.

## Identity and authority

Cloud owns organisation, legal-business, venue, installation and cell identifiers.
An installation is a registered machine with its own credentials; replacing one
does not create a new venue. Map these identifiers explicitly to Waitron's local
venue and node identifiers. Never derive permission from matching email addresses,
tax identifiers, hostnames or a caller-supplied venue id.

Linking requires both Cloud permission to add the venue and local administrator
approval. Bind both approvals to one expiring operation, the selected organisation,
the local venue and the installation's public identity. The normal owner completes
both in one guided action. Machine secrets stay outside the browser and logs.

Waitron owns the local approval check. Cloud verifies the Cloud permission and the
binding of the local approval to this operation. Specify and test the first-contact
trust exchange before production use: an arbitrary self-signed claim of local
administrator status is insufficient. Define the proof format, expiry, replay
protection and recovery from lost replies as part of the registration slice.

Cloud owns permission to use its services. Waitron owns permission to become the
active primary. A Cloud login, restore grant or fresh machine credential alone
must not activate trading or change fiscal identity.

## Exchanges to implement

### Agreed connection journey

1. You open Cloud services while signed into the local Waitron administrator account.
2. Waitron creates a short-lived connection request tied to that installation.
3. You sign into Cloud, choose your organisation and confirm the venue.
4. The local server retrieves the approval through an outbound connection and completes
   registration. Cloud does not need an inbound route to the venue for this exchange.
5. Waitron shows remote-access and backup setup separately. Registration alone does
   not imply either service is ready.

Both approvals must refer to the same request. Expired or replayed approvals are
rejected. If a reply is lost, retrying must return the existing registration rather
than create another. The Cloud proof encoding and durable exchange now follow the
[pairing contract](superpowers/specs/2026-09-23-venue-pairing-design.md). The local
administrator adapter and real two-installation journey follow next. Until that adapter
lands, the local half is asserted by the installation signature; Cloud does not independently
verify a local administrator role. Public deployment remains gated on the complete flow.

### Operation boundaries

These are logical operations, not final HTTP paths. Version the wire contract
independently of the application release and reject unsupported capabilities before
changing either side. Each mutation carries an operation id scoped to its actor and
venue. Retrying the same request returns its recorded result; reusing the id for a
different request is rejected. Resume after failure from recorded progress.

| Operation | Input and authority | Result and responsibility |
| --- | --- | --- |
| Connect installation | Local venue identity, installation public identity, environment, supported contract version and both bound approvals | Cloud records the venue link and installation once. Return an operation id and service setup status. An existing link to another organisation is a conflict, not an implicit transfer. |
| Fetch service configuration | Authenticated active installation and its last applied configuration revision | Cloud returns its own venue/cell assignment, public and staff names, WireGuard peer configuration and permitted service capabilities. Waitron applies a revision and reports success or an actionable failure. Private keys should be generated at the endpoint that uses them. |
| Obtain storage access | Authenticated installation, venue and requested upload capability | Cloud supplies bounded access to the assigned storage location. Restore read access and snapshot deletion require separate authority. Direct uploads remain independent of gateway availability. |
| Report service status | Authenticated installation, configuration revision, observation time and progress | Cloud records tunnel state, backup progress and errors with a receive time. A stale report becomes unknown/out of date, not healthy. Scope usage reports to this installation and venue. |
| Publish recovery point | Upload completion, object identity, digest/size, capture time, backup kind, source identity, format/module versions and key-version references | Cloud verifies storage completion and records an immutable catalogue entry bound to the authenticated venue. An upload report alone does not make it a verified recovery point. |
| Start replacement | Authorised account, venue, planned/failure mode, selected continuous generation or snapshot and replacement installation identity | Cloud records one active replacement operation per venue and gives the replacement limited restore access. Return the recovery timestamp and progress; do not route traffic or activate trading yet. |
| Complete replacement | Waitron restore/compatibility results and activation evidence, with the required owner confirmations | Waitron applies its recovery rules. Cloud coordinates old-credential retirement and routing, recording each step. After an uncertain reply, query operation state before retrying activation. |
| Revoke installation | Authorised account, target installation and reason | Cloud withdraws its service permissions and reports enforcement progress. Define expiry and active-session behaviour for each credential type; do not promise instantaneous revocation of all provider credentials. Local offline trading is unaffected by this operation alone. |

The registration response must distinguish a linked venue from a ready service.
Remote access, continuous backup and retained snapshots each have their own setup
and health state. A failed backup setup must not be displayed as a working backup
because the tunnel connected successfully.

## Data and secrets crossing the boundary

| Item | Contract |
| --- | --- |
| Continuous replica | Waitron writes the Litestream replica directly to its assigned object-store scope. Cloud verifies Waitron's signed pointer and freezes that generation for recovery. Its `writtenAt` is the recoverable time; Cloud does not invent a time from an upload. The local SeaweedFS proof covers exact prefix isolation and recovery, while the selected production provider still needs the same conditional-write and recovery checks. |
| Retained snapshot | Waitron creates a consistent, independently recoverable artifact using its manifest and module contributions. Cloud retains, catalogues and verifies it under the agreed daily/monthly policy. Do not expose a raw SQLite file as a complete server backup unless all required state is accounted for. |
| Configuration and module-owned state | Waitron declares the exact captured contents and missing-optional-file rules. The current archive captures `backup.env` and `modules.json` when present. Managed archive restore discards `backup.env`, because a replacement must not resume the source destination. |
| Backup decryption and application vault keys | Cloud-managed recovery delivers only the required backup-key version to the authorised target. The encrypted Waitron state currently carries `secrets.env`, which holds the application vault key. The version 3 local receipt proves that this file does not contain the backup recovery key and that the vault state survives both restore paths. Preserve customer-managed archive key custody. |
| Machine and TLS keys | Issue fresh Cloud installation credentials. `cloud-connection.json` and the separate `cloud-staff.*` certificate files stay outside both the required and optional archive state. The local CA and server keys under `tls/` remain part of Waitron's recovery state; they are not the Cloud staff TLS key. |

Waitron's current [state-secret list](https://github.com/clintongormley/waitron/blob/005f791c239aae9ac21cb5a8f52895c604889611/apps/server/src/state-secrets.ts)
includes the application vault key, trading identity and local TLS CA/leaf files. Its
[optional-state list](https://github.com/clintongormley/waitron/blob/005f791c239aae9ac21cb5a8f52895c604889611/apps/server/src/backup-optional-state.ts)
includes backup settings. The managed restore consumer removes those settings before
placement. Cloud machine authority and staff TLS files are not members of either list.

The current stream and archive consumers both recover the source local node identity.
Waitron's restore hooks then mint the fresh fiscal series and chain required by that
recovery. This supersedes the older design split that expected a stream restore to
claim a new local node. Cloud still registers the replacement as a new installation
with a new machine key and tunnel key. A Cloud installation identity is not a Waitron
node identity, and neither one authorises trading by itself.

The version 3 managed-recovery receipt tests these boundaries with real Waitron
consumers. It restores an older key-version snapshot after rotation, compares the
application vault state byte for byte, proves both recovered local node IDs, and
checks that the replacement does not inherit `backup.env`, Cloud machine authority
or staff TLS material. The replacement then registers with a fresh installation and
machine public key.

### External vault archive compatibility dependency

No archive extension is needed for the current managed path because its encrypted
Waitron state contains the application vault key. A future hosted target that keeps
that key in an external secrets service needs the named `external-vault-archive-v2`
compatibility dependency before it can capture or restore an archive safely:

1. Waitron versions the manifest and marks `secrets.env` as externally supplied.
   The manifest carries only an opaque key reference and binding metadata, never key
   bytes or provider credentials.
2. Capture refuses an archive that both embeds `secrets.env` and declares it external.
   Restore refuses an external declaration unless its resolver supplies the exact
   venue-bound key before any database or identity placement.
3. Cloud authorises delivery separately from archive decryption, rewraps the vault key
   for the target installation and records the referenced version. Source Cloud
   machine credentials and staff TLS keys remain excluded.
4. Waitron keeps version 1 archives readable through their existing bundled-secret
   path. An on-premises archive moves to an external-key target only through an
   explicit re-encryption operation; ordinary download is not that operation.

`BackupManifest` v1 has no external-secret declaration. Do not infer one from a hosting
location or omit `secrets.env` without the versioned contract above.

## Recovery, verification and failure handling

Normal recovery selects the latest recoverable continuous state. A retained snapshot
recovers to its own capture time; it is not advanced by applying the stream afterwards.
Waitron validates compatibility and required secrets before changing the target,
then performs the migrations and module hooks appropriate to that restore path.
Inspection of an older recovery point must not roll back a live ledger.

For planned replacement, stop writes and confirm the final recoverable state reaches
the replacement before activation. For failure recovery, show the recovery timestamp
and obtain the existing confirmations about the old server and any other local
candidate primary. Interrupted activation needs reconciliation, not a second promotion.
Only move the public/staff routes after the new target is ready under Waitron's rules.

A verification record names the exact artifact/generation, digest where applicable,
key versions, verifier version, time and outcome. File presence or a matching digest
is insufficient to claim a successful restore. Define an isolated restore check
through Waitron's validation code; it must not activate a primary, contact fiscal or
payment services, or send customer notifications. The full replacement test separately
proves authorised activation. Until the required check passes, report verification
as pending or failed and preserve the previously verified snapshot.

Automatic expiry keeps the last verified snapshot while the backup subscription is
active. Cleanup must recheck protection when deleting and tolerate concurrent new
snapshots or verification failures. Key deletion must respect the same retained
dependencies. Explicit deletion and cancellation policies remain open.

## First implementation slice and acceptance checks

Start with registration state and the approval exchange using two isolated test
installations. Define the proof format and first-contact trust in that slice before
adding public endpoints. Build durable operations, scoped identity checks and
configuration revisions before provisioning real customer services.
The [registration implementation plan](registration-implementation-plan.md) orders
that work and identifies which identity components can be reused.

Use failing behavioural tests first. The initial slice must prove:

- Missing, expired, replayed or mismatched approval cannot link an installation.
- Retrying after a lost reply returns the same link; concurrent requests cannot
  create duplicate links or move a venue between organisations.
- One installation cannot fetch another venue's configuration or credentials.
- Revocation prevents new service grants; replacement credentials do not activate
  Waitron or silently revive the old installation.

Then implement the gateway and backup exchanges against the agreed Spain/AWS target.
Prove both restore paths, missing continuous data, key rotation with an older snapshot,
failed verification, interrupted cleanup, gateway loss and a returning old server.
The integration with Waitron's SQLite capture/restore interfaces and source-side
networking work belong in Waitron;
do not replace them with a Cloud-only implementation of the engine.

## Staff certificate exchange, version 1

You can send a staff CSR to Cloud without sharing the appliance's TLS private key.
The account server exposes this local integration only when
`CLOUD_STAFF_CERTIFICATES=1`; it also requires an installation issuer and refuses
production-environment installations. Enable the database staff worker with it.
Both endpoints use the existing `waitron-cloud-machine-v1` signed envelope and a
current control lease. POST to `/api/installations/staff-certificate-submit` or
`/api/installations/staff-certificate-status`; the signed action is the final path
segment. Browser Origin headers are refused. Use HTTPS outside the loopback proof.
The existing 60-second proof window, one-hour lease, bounded body and per-IP and
per-installation limits apply. No provider credential or filesystem path is accepted.

For submit, use a durable UUID as the envelope's operation ID and sign this exact
JSON body (the envelope carries its JSON encoding as a string):

```json
{
  "version": 1,
  "hostname": "staff-v-00000000-0000-4000-8000-000000000001.example.test",
  "revision": 2,
  "csr": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----\n",
  "previousRequestId": null
}
```

Take hostname and revision from the current installation configuration. Generate the
CSR with Waitron's `cloud-certificate.ts csr STATE_DIR HOSTNAME FILE` command. Its
signature, RSA key size and single exact hostname must pass the existing Cloud CSR
checks. Keep the full submit body and operation ID until you know the result. After
a lost reply, sign that same body and ID with a fresh proof timestamp and live lease.
This does not create another request or restart issuance. The reply reflects the
current state, so a retry may already contain the finished chain.

Cloud keeps one request row per installation. For a later request, set
`previousRequestId` to the ID you are replacing and choose a new operation ID.
Only one concurrent replacement wins. Reusing the current ID with different input, colliding with another installation's
current ID, sending an old predecessor, or reading a superseded ID returns HTTP 409
`conflict`. Always generate a fresh UUID for new work. Cloud keeps no historical
ID ledger: deliberately reusing a superseded ID with the current predecessor is
a new request, and the retained chain must still match its current CSR key. A retry
of a superseded submission cannot restore it. Keep the old installed chain while a
new request is pending; Cloud also retains its previous chain internally until a
validated replacement commits, but does not return it for the new request.

For status, sign `{"version":1,"requestId":"<submission UUID>"}` with a fresh
operation ID. Both actions return this shape, with `certificate` present only when
state is `ready`:

```json
{
  "version": 1,
  "installationId": "00000000-0000-4000-8000-000000000002",
  "requestId": "00000000-0000-4000-8000-000000000003",
  "hostname": "staff-v-00000000-0000-4000-8000-000000000001.example.test",
  "revision": 2,
  "csrDigest": "<SHA-256 hex of the submitted PEM bytes>",
  "state": "ready",
  "certificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
}
```

Every read checks the stored installation key, lease binding, revocation, placement,
hostname and configuration revision again. Another installation cannot read this
request even if it knows its ID. Invalid action-body fields are HTTP 400. Malformed or oversized signed envelopes,
bodies beyond the existing 4096-character signed-body limit, and invalid proofs or
leases are 401. If the envelope is too large, reduce it; renewing a lease cannot fix
its size. Revoked, production-environment or unconfigured authority is 403; stale configuration is 409. Pending
includes work waiting, retrying or parked after the reconciler's eight failures.
Use operator reconciler status to distinguish these states; do not poll without a
backoff. A fresh predecessor-bound request can retry a parked target.

Before installing, the appliance must compare installation ID, request ID, hostname,
revision and CSR digest with its still-current local intent, then use the existing
`cloud-certificate.ts install` command. That command checks hostname, validity and
private-key matching and atomically replaces its certificate file. It does not
establish trust in an arbitrary supplied issuer; obtain the chain through the
trusted Cloud HTTPS origin. Cloud uses the configured ACME issuer and rechecks
hostname, key and validity before publication. Issuance does not mean the appliance
has installed or reloaded the chain.

The Cloud exchange and optional database staff reconciler mode are implemented.
The Waitron dependency is an adapter that persists pending request IDs, signs these
two actions, renews its lease, polls with backoff, discards replies after local
configuration/revocation/key changes, invokes the install command and reloads TLS.
Its process scheduling and crash recovery are not supplied by this Cloud change.
The local proof calls the existing Waitron commands explicitly.

## Fiscal allocation and reconciliation endpoint

Cloud now implements the [fiscal registry HTTP contract](fiscal-allocation-registry.md#call-the-account-service-and-recover-a-lost-reply).
Your full Cloud session can reserve, consume, abandon, inspect and import signed
paper facts through the six account POST routes. Missing production custody,
entitlement, independent continuity or signing capabilities still refuse.

An installation can report signed Cloud or paper evidence through
`/api/installations/fiscal-allocations/report`. Cloud verifies its current key and
active registration lease under revocation locks. The result records matching,
conflicting or previously unimported evidence; it never activates the installation
or releases an occupied identity. An exact retry recovers the retained result
when the outside append survived a failed PostgreSQL commit.

The [joint HTTP/client test](fiscal-allocation-registry.md#qualify-the-pinned-waitron-client)
now exercises the real Cloud PostgreSQL service with the separately pinned Waitron
adapter. Its consumed packet passes local manual preparation and its committed
result returns as a signed machine report. Waitron owns and lands its adapter
independently. Preserve the complete consumed
receipt and local authenticated recovery checks. Cloud operator attribution is
not local operator authentication, and no registry call belongs on the sale path.

## Translate all, version 1

Owner-approved design; Cloud store, worker and four HTTP routes are implemented, with
translation off by default. Submit still uses the existing 16 KiB, five-second reader;
its larger request limits, consent enforcement, retention and joint qualification remain
open. Keep the operator flag off until those gates pass. The bounded-collect
prerequisite is documented on 2026-10-16 in the
[paging amendment](superpowers/plans/2026-10-16-translation-collect-pages.md).
The bound preserves the existing input limits;
design approval does not claim runtime qualification or release readiness. The product design is in
[the Cloud spec](superpowers/specs/2026-10-14-translate-all-design.md) and in Waitron's
`docs/superpowers/specs/2026-10-14-translate-all-design.md`. This section is the wire contract
both sides build against; both specs and both plans point here and do not restate it differently.
The paging amendment supersedes conflicting collect examples in the original Cloud plan.

Four machine actions use the existing `waitron-cloud-machine-v1` envelope and a current control
lease: POST to `/api/installations/translation-submit`, `translation-status`,
`translation-collect` and `translation-release`. The signed action is the final path segment.
The existing 60-second proof window, one-hour lease, per-installation and per-IP limits, and the
refusal of browser Origin headers apply. While Cloud's operator has the service switched off, all
four answer 503 `temporarily_unavailable`.

### Request limits

| Action | Whole HTTP request at most | Received within |
|---|---|---|
| submit | 2,113,536 bytes (twice the 1 MiB job, plus 16 KiB) | 60 s |
| status, collect, release | 16,384 bytes | 5 s |

Every other account body reader refuses a body over 16,384 bytes or one not received within
5 seconds. When translation is enabled, the server permits 60 seconds to receive a request;
the readers preserve the shorter deadline for other actions. Headers retain their five-second
deadline. Submit gets its own limits because `body` travels as a JSON string inside the envelope: the job is JSON text, and
escaping JSON text adds at most one backslash per character, so its escaped form is at most twice
its size. A request over its size limit is refused with 413 (`translation_job_too_large` for
submit, `invalid_input` for the others); one not received in time with 408.

The owner approved submit admission of **4 requests in flight, at most 1 per client address**,
outside the 8 places shared by other account requests. Refuse excess submits before reading their
bodies with 503 `temporarily_unavailable` and `Retry-After: 1`; existing rate limits still apply.

Every successful collect response is at most **16,777,216 UTF-8 bytes (16 MiB) for the complete JSON
body**, including every field, the UUID and `nextCursor`. Serialize compact JSON with no formatting
whitespace. Count bytes after decoding any HTTP content encoding; compression never increases the
allowance. Never drop fields, names or corrections, or truncate text, to make a page fit.

### Seeing the service

The `configuration` reply returns exactly three services today, and Waitron refuses any other
count. A `configuration` request whose signed body is exactly `{"servicesVersion":2}` receives four
services: the three it receives today and this one:

```json
{ "service": "content_translation", "state": "ready", "configuration": {}, "health": "unknown", "failure": null, "observedAt": null }
```

Services are matched by name; their order in the list is not significant. A `configuration` body
of `{}` keeps receiving exactly three; any other `configuration` body is an invalid proof (401).
`renew` and `report` replies are unchanged and always carry three, so the box keeps the
`content_translation` entry from its last version-2 `configuration` reply.

`state: "ready"` means the service is available to this installation; any other state means it is
not. Every connected installation has it `ready` until the allowance replaces free use. A ready
`content_translation` never makes a venue monitored, alerted or shown with services: every Cloud
reader that asks whether an installation has a service switched on, or lists its services to the
portal, counts only the three original services.

### Submit: a signed fingerprint of a larger body

A job body is larger than the 4,096-character signed body allows, so submit sends it beside the
envelope:

```json
{ "payload": "...", "signature": "...", "body": "<the job as a JSON string>" }
```

The outer request is read by the reader every account route uses: a request not sent as
`application/json` is refused with 415 `invalid_input`, and one whose body is not a JSON object
with 400 `invalid_input`. A JSON object must hold exactly those three keys, each a string; any other
object is an invalid envelope (401). The same rules hold for status, collect and release, whose
outer request holds `payload` and `signature` only. The signed body is the fingerprint, not the job, with exactly these keys:

```json
{ "version": 1, "jobSha256": "<SHA-256 hex of the UTF-8 bytes of body>", "jobBytes": 183402 }
```

`jobSha256` is lowercase hex; `jobBytes` is the whole number of UTF-8 bytes, not characters
(`Cigaló` is 7 bytes). Cloud checks, in this order:

1. the envelope, proof and lease (401);
2. `jobBytes` over 1,048,576: 413 `translation_job_too_large`, before anything is hashed;
3. `jobBytes` and `jobSha256` against `body`, before parsing it: a mismatch is 401 like any other
   invalid proof;
4. the job's fields (400 `invalid_request`), and more than 1,000 items (413
   `translation_job_too_large`);
5. a submit operation ID already used by this installation: with the same fingerprint, Cloud
   returns that job's submit reply (with its current state) and checks nothing further; with a
   different fingerprint, 409 `conflict`;
6. the installation's `content_translation` service is `ready` (else 403 `permission_denied`),
   the venue's consent (403 `translation_consent_required`), no open job for the venue (409
   `translation_job_running`), and the monthly cap (409 `translation_limit_reached`).

The job:

```json
{
  "version": 1,
  "country": "ES",
  "languages": { "default": "ca", "enabled": ["ca", "es", "en"] },
  "items": [
    {
      "ref": "variant:812",
      "kind": "variant",
      "family": "product:640",
      "category": "TAP BEERS",
      "staffName": "PINTA",
      "existing": { "en": "Pint" },
      "missing": ["ca", "es"]
    }
  ],
  "houseStyle": [
    { "kind": "product", "staffName": "CARAJILLO", "names": { "ca": "Cigaló", "es": "Carajillo" } }
  ]
}
```

Every key shown is required and no other key is allowed. Lengths are counted as JavaScript string
length. A job that breaks any rule below is refused with 400 `invalid_request`.

- `version` is 1. `country` is two capital letters naming a region.
- `languages.enabled` holds 1 to 20 distinct language tags (`ca`, `es`, `pt-BR`) and includes
  `languages.default`.
- `items` holds 1 to 1,000 entries, context items included; more is 413.
- `ref` is the box's own identifier for the item, 1 to 128 characters, unique in the job, opaque to
  Cloud.
- `kind` is one of Waitron's nine `TranslationGapKind` values: `product`, `variant`,
  `option_list`, `option_label`, `extra_list`, `menu`, `section`, `included_menu`, `unit`.
- `family`, 1 to 128 characters, names the item a variant, options label or menu section belongs
  to; it equals `ref` for an item that heads its own family. The box lists a family's head before
  its members.
- `category` is the family head's category, or `null`. A product has one category, so it is a
  product's own and a variant's product's; every other kind sends `null`. 1 to 500 characters.
- `staffName` is 1 to 500 characters.
- `existing` holds the venue's text in enabled languages that are not missing, each 1 to 500
  characters; the service never changes it.
- `missing` lists distinct enabled languages to write, none of them in `existing`.
- **Context items.** `missing` may be empty only for an item that heads the family of another item
  in the same job that has languages to write (its `ref` equals that item's `family`). The box sends
  a head this way when it sends a member of the family but not the head itself: a product whose
  names are complete while its variants' are not, an options list whose labels are missing, a menu
  whose sections are missing. Cloud gives it to the model as context and never returns names or a
  failure for it. At least one item in a job has languages to write.
- `houseStyle` holds 0 to 300 saved names, each with `kind`, `staffName` (1 to 500 characters) and
  `names`, mapping enabled languages to 1 to 500 characters.

`total`, `done` and `failed` count only items with languages to write.

**The cap.** The owner approved **US$5 per venue per calendar month (UTC)** as the temporary safety
cap. Pricing, the replacement monthly allowance and billing remain separate release gates.
Cloud estimates a job's cost from `total` at a stored rate per item. If the estimate
exceeds what is left of the venue's cap for the calendar month (UTC), submit is refused:

```json
{ "error": "translation_limit_reached", "fits": 6 }
```

Every account-http refusal is `{"error":"<code>"}` (`packages/account-http/src/app.ts:98`); this
one adds `fits`, the whole number (0 or more, below `total`) of items that would fit. The worker
also stops a running job once its actual cost reaches the cap (status `reason: "limit_reached"`).

Keep the full submit body and operation ID until the result is known. After a lost reply, sign the
same fingerprint with the same operation ID, a fresh proof time and a live lease: Cloud returns the
same job rather than making another.

The reply:

```json
{ "version": 1, "jobId": "00000000-0000-4000-8000-000000000010", "state": "queued", "total": 358 }
```

### Status, collect and release

Status and release each sign exactly `{"version":1,"jobId":"<uuid>"}` with a fresh operation ID.
Collect signs exactly those fields with an optional `cursor`, for example
`{"version":1,"jobId":"00000000-0000-4000-8000-000000000010","cursor":2}`.
Omitting `cursor` means 0. Other fields or invalid action bodies are 400 `invalid_request`.

After proof and lease validation, look up the job scoped to the signing installation before
checking cursor validity or range. An unknown or foreign job is always 404
`translation_job_not_found`, including with an invalid cursor. For an owned job, a supplied cursor
must be a JSON number that is a safe integer with `0 <= cursor < total`; null, strings, booleans,
fractions, negative, unsafe and out-of-range values are 400 `invalid_request`. Validate the cursor
before applying collect's state rules. `total` excludes context items. Any positive offset in range
is allowed; it need not be a previously returned page boundary. An opaque or encrypted token adds
no authority: the offset is already signed and installation-scoped.

**Status** returns:

```json
{ "version": 1, "jobId": "...", "state": "running", "total": 358, "done": 180, "failed": 0 }
```

`state` is one of:

- `queued` and `running`: not finished;
- `done`: every item with languages to write has a result;
- `partly_done`: some have a result and the rest failed;
- `failed`: none has a result;
- `collected`: released by the box;
- `expired`: the body and results were deleted 24 hours after the job finished, or 24 hours after
  it was submitted if it never finished.

A `partly_done` or `failed` status also carries `reason`, one of this list:

| State | `reason` | Meaning | Waitron shows |
|---|---|---|---|
| `partly_done` | `limit_reached` | The cap stopped the job. | `content.suggestion_limit_reached` (`fits` 0) |
| `partly_done` | `provider_failed` | Some batches failed at the provider. | how many could not be done |
| `failed` | `provider_unavailable` | Every batch failed at the provider. | `content.suggestion_service_unavailable` |
| `failed` | `consent_required` | Consent is unavailable when the worker leases or resumes the job. Earlier batches are withheld; cost already spent is retained. | `content.suggestion_consent_required` |
| `failed` | `limit_reached` | The cap was reached before any item was done. | `content.suggestion_limit_reached` (`fits` 0) |

Poll every five seconds at most.

**Collect**, by state: `done` or `partly_done` returns one page; `queued`, `running` or
`failed` is 409 `translation_not_ready`; `collected` or `expired` is 410 `translation_expired`.

```json
{
  "version": 1,
  "jobId": "00000000-0000-4000-8000-000000000010",
  "state": "partly_done",
  "results": [
    {
      "ref": "variant:812",
      "names": { "ca": "Pinta", "es": "Pinta" },
      "placeholder": false,
      "corrections": []
    },
    {
      "ref": "product:977",
      "names": { "ca": "Zurito", "es": "Zurito", "en": "Zurito (small draught beer)" },
      "placeholder": false,
      "corrections": [ { "field": "internal", "wrong": "ZURRITO", "right": "ZURITO" } ]
    }
  ],
  "failed": ["product:1021"],
  "nextCursor": null
}
```

The response has exactly `version`, `jobId`, `state`, `results`, `failed` and `nextCursor`.
Build one immutable terminal list from the original submitted items, filtered to those with
nonempty `missing`, in submit order. Each entry is either its complete result or its failed ref.
Worker completion order, batch order and object-key order cannot change that list. The cursor is
an offset into this filtered list, not into `results` alone or the unfiltered input.

Starting at that offset, return the **largest nonempty consecutive segment** whose complete
serialized response fits 16 MiB. Split that segment into `results` and `failed`, each preserving
submit order. `nextCursor` is the offset immediately after the segment, or `null` at the end.
Measure with the candidate's actual `nextCursor`, including `null` on the last page. An item is
atomic: its names, placeholder flag and corrections stay together and unchanged. The
[single-item bound](superpowers/plans/2026-10-16-translation-collect-pages.md#single-item-size-proof)
uses the existing 1 MiB job bound, without adding a language-tag length restriction. Never
drop data to make a page fit.

A complete walk starts at 0 and follows `nextCursor` until null. Every item with languages to
write appears exactly once across that walk, in `results` or in `failed`; context items appear in
neither. Repeating the same cursor returns the identical semantic page while the job is retained,
even with a fresh operation ID. Collect never deletes data or extends retention.

`names` holds only languages listed in the item's `missing`, each 1 to 500
characters. `placeholder: true` comes with empty `names`. An item carries at most 10
`corrections`; `field` is `internal` or an enabled language code, and `wrong` and `right` are 1 to
500 characters and differ. A correction to a language the venue entered is a suggestion only. The
box must drop:

- a result whose `ref` it did not send with languages to write;
- a name for a language that was not missing.

The box must read at most 16 MiB of decoded JSON per page, regardless of `Content-Length` or
compression, and reject an oversized or incomplete response. Do not concatenate response strings
or keep an unbounded in-memory collection. Persist each validated page into Waitron's existing
durable suggestion reconciliation, deduplicate refs per job, and save the next cursor with the
page's durable writes. Crash retries may safely fetch and reconcile the same page again. Mark
the walk complete only after the null-cursor page is durably stored and all `total` refs are
accounted for. A release or expiry between pages returns 410 `translation_expired` for the next
valid collect; retain the partial/incomplete distinction and never report those pages as a full
job or release on their behalf.

**Release** tells Cloud the box has durably stored **every page**, and is sent only after that
complete walk. A `failed` job has no collectable pages and keeps its existing release path. Cloud
does not infer durable client storage from a collect call. The release state rules remain:
`done`, `partly_done` or
`failed` deletes the job's body and results and returns
`{"version":1,"jobId":"...","state":"collected"}`; `collected` returns the same reply again;
`queued` or `running` is 409 `translation_not_ready`; `expired` is 410 `translation_expired`.

**Joint release gate:** Waitron lane B **A689-21** needs a real pagination loop and durable
completion check. At Waitron commit `8eb93dbf3a0583f479d96b5bf0bc214d974ba080`,
`apps/server/src/cloud-translation.ts`, `collectTranslation`, makes one request and ignores
`nextCursor`. Lowering its byte reader
alone could accept page one and silently release the remaining pages. Do not go live until pinned
Cloud and Waitron candidates jointly prove multi-page collection, crash/reply-loss retry,
deduplication, bounded decoded reads and release only after durable completion.

### Consent

The account owner agrees, or withdraws, on the portal's account page, `<Cloud origin>/account`,
in the venue's entry (owners only). Waitron's dialog links there when submit is refused with
`translation_consent_required`.

### Refusals

| HTTP | Code | When | Waitron's code |
|---|---|---|---|
| 400 | `invalid_request` | A job field, or a status, collect or release signed body, breaks a rule above. | `cloud.request_invalid` |
| 400, 415 | `invalid_input` (existing) | The outer request is not a JSON object (400) or not sent as `application/json` (415). | `cloud.request_invalid` |
| 401 | `invalid_proof` (existing) | The envelope, proof or lease is invalid, including a submit whose `body` does not match `jobSha256` or `jobBytes`. | `cloud.unavailable` |
| 403 | `translation_consent_required` | The venue's account owner has not agreed to the named language-model providers. | `content.suggestion_consent_required` |
| 403 | `revoked`, `permission_denied` (existing) | The installation is revoked, or `content_translation` is not `ready` for it. | `cloud.unavailable` |
| 403 | `forbidden` (existing) | The request carries a browser Origin header. | `cloud.unavailable` |
| 404 | `translation_job_not_found` | Another installation's job, or an unknown ID. | `content.suggestion_expired` |
| 408 | `invalid_input` (existing) | The request was not received within its time limit. | `cloud.unavailable` |
| 409 | `conflict` | A submit operation ID reused with a different fingerprint. | `cloud.request_invalid` |
| 409 | `translation_job_running` | A job is already queued or running for the venue. | `content.suggestion_job_running` |
| 409 | `translation_limit_reached` | The estimate exceeds what is left of the cap. Carries `fits`. | `content.suggestion_limit_reached` |
| 409 | `translation_not_ready` | Collect or release in a state listed above. | `cloud.unavailable` |
| 410 | `translation_expired` | Collect of a `collected` or `expired` job, or release of an `expired` one. | `content.suggestion_expired` |
| 413 | `translation_job_too_large` | Submit: `jobBytes` over 1,048,576, more than 1,000 items, or a request over 2,113,536 bytes. | `cloud.request_invalid` |
| 413 | `invalid_input` (existing) | A status, collect or release request over 16,384 bytes. | `cloud.request_invalid` |
| 429 | `rate_limited` (existing) | A per-installation or per-IP limit. | `cloud.unavailable` |
| 503 | `temporarily_unavailable` (existing) | Cloud has the service switched off. | `cloud.unavailable` |

### Shared test vectors

The first implementation task on each side adds the signing test vectors to this section, generated
from fixed keys:

- a valid submit;
- the same submit with one byte of `body` changed;
- a `jobBytes` that does not match;
- a replayed operation ID with a different fingerprint.

Waitron's signer and Cloud's verifier both test against them.

The vectors are one JSON document, generated by Cloud's
`packages/translation/test/make-submit-vectors.ts` and committed as
`packages/translation/test/submit-vectors.json`. Its inputs are the keys, issuer, lease, origin,
installation ID and proof time of `packages/registration/test/installation-vector.json`; Waitron's
`apps/server/test/cloud-installation-vector.json` is byte-identical to it (`cmp`, 2026-10-14), and
Ed25519 signatures are deterministic, so either side's signer reproduces the same bytes. The
document holds:

- `origin`, `installationId`, `operationId`, `issuedAt`, `publicKey`, `issuerPublicKey`,
  `issuerKeyId`, and `lease` as an object (the envelope signs `JSON.stringify(lease)`);
- `cases`, in this order, each `{ "name", "expect", "envelope": { "payload", "signature", "body" } }`,
  all signed as `translation-submit` with the one `operationId`
  (`52345678-1234-4234-8234-123456789abc`) and `issuedAt`:
  - `valid` (`expect: "accepted"`): the job example above, with staff name `PINTA`;
  - `changed_body` (`"401 invalid_proof"`): the valid envelope with `PINTA` changed to `PINTO` in
    `body`;
  - `wrong_length` (`"401 invalid_proof"`): the valid body, signed with `jobBytes` one more than its
    length;
  - `replayed_operation` (`"409 conflict after valid"`): the same job with staff name `CANYA`, its own
    fingerprint, and the valid case's operation ID.

The job text is `JSON.stringify` of the example's keys in the order shown, with no spaces. Cloud's
first task pastes the generated document below this paragraph as the section's only `json` block;
a test on each side compares its copy with it.

```json
{
  "origin": "https://cloud.example.test",
  "installationId": "22345678-1234-4234-8234-123456789abc",
  "operationId": "52345678-1234-4234-8234-123456789abc",
  "issuedAt": 1800000000000,
  "publicKey": "MCowBQYDK2VwAyEAiojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w",
  "issuerPublicKey": "MCowBQYDK2VwAyEAgTl3Dqh9F19Wo1Rmw0x-zMuNipG07jeiXfYPW4_Js5Q",
  "issuerKeyId": "R96ljqAPrpQX7hnXZ1W_72kImQIRMu_7BP4fnk8MgFk",
  "lease": {
    "payload": "WyJ3YWl0cm9uLWNsb3VkLWFjY2Vzcy12MSIsImh0dHBzOi8vY2xvdWQuZXhhbXBsZS50ZXN0IiwiUjk2bGpxQVBycFFYN2huWFoxV183MmtJbVFJUk11XzdCUDRmbms4TWdGayIsIjEyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjMyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsInRlc3QiLCJNQ293QlFZREsyVndBeUVBaW9qajNYUUo4Wlg5VXRzdFBMcGRjc3BuQ2I4ZGxCSWI4M1NJQWJRUGIxdyIsMTgwMDAwMDAwMDAwMCwxODAwMDAzNjAwMDAwLCJjb250cm9sIl0",
    "signature": "ox6VbdFkKUpIk_kcVJx22X_bo-zbhOFwEw9oXFJTwaj9so7ueA5xmk66vRnbMM22Q0Hx5pc9UG00I1ieO0lACQ"
  },
  "cases": [
    {
      "name": "valid",
      "expect": "accepted",
      "envelope": {
        "payload": "WyJ3YWl0cm9uLWNsb3VkLW1hY2hpbmUtdjEiLCJodHRwczovL2Nsb3VkLmV4YW1wbGUudGVzdCIsInRyYW5zbGF0aW9uLXN1Ym1pdCIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjUyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsMTgwMDAwMDAwMDAwMCwie1wicGF5bG9hZFwiOlwiV3lKM1lXbDBjbTl1TFdOc2IzVmtMV0ZqWTJWemN5MTJNU0lzSW1oMGRIQnpPaTh2WTJ4dmRXUXVaWGhoYlhCc1pTNTBaWE4wSWl3aVVqazJiR3B4UVZCeWNGRllOMmh1V0ZveFYxODNNbXRKYlZGSlVrMTFYemRDVURSbWJtczRUV2RHYXlJc0lqRXlNelExTmpjNExURXlNelF0TkRJek5DMDRNak0wTFRFeU16UTFOamM0T1dGaVl5SXNJakl5TXpRMU5qYzRMVEV5TXpRdE5ESXpOQzA0TWpNMExURXlNelExTmpjNE9XRmlZeUlzSWpNeU16UTFOamM0TFRFeU16UXROREl6TkMwNE1qTTBMVEV5TXpRMU5qYzRPV0ZpWXlJc0luUmxjM1FpTENKTlEyOTNRbEZaUkVzeVZuZEJlVVZCYVc5cWFqTllVVW80V2xnNVZYUnpkRkJNY0dSamMzQnVRMkk0Wkd4Q1NXSTRNMU5KUVdKUlVHSXhkeUlzTVRnd01EQXdNREF3TURBd01Dd3hPREF3TURBek5qQXdNREF3TENKamIyNTBjbTlzSWwwXCIsXCJzaWduYXR1cmVcIjpcIm94NlZiZEZrS1VwSWtfa2NWSngyMlhfYm8temJoT0Z3RXc5b1hGSlR3YWo5c283dWVBNXhtazY2dlJuYk1NMjJRMEh4NXBjOVVHMDBJMWllTzBsQUNRXCJ9Iiwie1widmVyc2lvblwiOjEsXCJqb2JTaGEyNTZcIjpcIjIyOTMyM2E2YjBhMzBlN2FmZWZhMTkzYjFmOTEyM2I3ZTc2NDFlYjcwYTMxYjBmMjQzZDVhNDMzY2UxNjUwNGRcIixcImpvYkJ5dGVzXCI6MzQ2fSJd",
        "signature": "9M2i_bRCLsDofwfGwSnXJR583jbjUPjGyOGzArliMcY_B4wgj4w_lLOog4SZFQG7isJxenH8IRflnMfHuZH5CA",
        "body": "{\"version\":1,\"country\":\"ES\",\"languages\":{\"default\":\"ca\",\"enabled\":[\"ca\",\"es\",\"en\"]},\"items\":[{\"ref\":\"variant:812\",\"kind\":\"variant\",\"family\":\"product:640\",\"category\":\"TAP BEERS\",\"staffName\":\"PINTA\",\"existing\":{\"en\":\"Pint\"},\"missing\":[\"ca\",\"es\"]}],\"houseStyle\":[{\"kind\":\"product\",\"staffName\":\"CARAJILLO\",\"names\":{\"ca\":\"Cigaló\",\"es\":\"Carajillo\"}}]}"
      }
    },
    {
      "name": "changed_body",
      "expect": "401 invalid_proof",
      "envelope": {
        "payload": "WyJ3YWl0cm9uLWNsb3VkLW1hY2hpbmUtdjEiLCJodHRwczovL2Nsb3VkLmV4YW1wbGUudGVzdCIsInRyYW5zbGF0aW9uLXN1Ym1pdCIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjUyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsMTgwMDAwMDAwMDAwMCwie1wicGF5bG9hZFwiOlwiV3lKM1lXbDBjbTl1TFdOc2IzVmtMV0ZqWTJWemN5MTJNU0lzSW1oMGRIQnpPaTh2WTJ4dmRXUXVaWGhoYlhCc1pTNTBaWE4wSWl3aVVqazJiR3B4UVZCeWNGRllOMmh1V0ZveFYxODNNbXRKYlZGSlVrMTFYemRDVURSbWJtczRUV2RHYXlJc0lqRXlNelExTmpjNExURXlNelF0TkRJek5DMDRNak0wTFRFeU16UTFOamM0T1dGaVl5SXNJakl5TXpRMU5qYzRMVEV5TXpRdE5ESXpOQzA0TWpNMExURXlNelExTmpjNE9XRmlZeUlzSWpNeU16UTFOamM0TFRFeU16UXROREl6TkMwNE1qTTBMVEV5TXpRMU5qYzRPV0ZpWXlJc0luUmxjM1FpTENKTlEyOTNRbEZaUkVzeVZuZEJlVVZCYVc5cWFqTllVVW80V2xnNVZYUnpkRkJNY0dSamMzQnVRMkk0Wkd4Q1NXSTRNMU5KUVdKUlVHSXhkeUlzTVRnd01EQXdNREF3TURBd01Dd3hPREF3TURBek5qQXdNREF3TENKamIyNTBjbTlzSWwwXCIsXCJzaWduYXR1cmVcIjpcIm94NlZiZEZrS1VwSWtfa2NWSngyMlhfYm8temJoT0Z3RXc5b1hGSlR3YWo5c283dWVBNXhtazY2dlJuYk1NMjJRMEh4NXBjOVVHMDBJMWllTzBsQUNRXCJ9Iiwie1widmVyc2lvblwiOjEsXCJqb2JTaGEyNTZcIjpcIjIyOTMyM2E2YjBhMzBlN2FmZWZhMTkzYjFmOTEyM2I3ZTc2NDFlYjcwYTMxYjBmMjQzZDVhNDMzY2UxNjUwNGRcIixcImpvYkJ5dGVzXCI6MzQ2fSJd",
        "signature": "9M2i_bRCLsDofwfGwSnXJR583jbjUPjGyOGzArliMcY_B4wgj4w_lLOog4SZFQG7isJxenH8IRflnMfHuZH5CA",
        "body": "{\"version\":1,\"country\":\"ES\",\"languages\":{\"default\":\"ca\",\"enabled\":[\"ca\",\"es\",\"en\"]},\"items\":[{\"ref\":\"variant:812\",\"kind\":\"variant\",\"family\":\"product:640\",\"category\":\"TAP BEERS\",\"staffName\":\"PINTO\",\"existing\":{\"en\":\"Pint\"},\"missing\":[\"ca\",\"es\"]}],\"houseStyle\":[{\"kind\":\"product\",\"staffName\":\"CARAJILLO\",\"names\":{\"ca\":\"Cigaló\",\"es\":\"Carajillo\"}}]}"
      }
    },
    {
      "name": "wrong_length",
      "expect": "401 invalid_proof",
      "envelope": {
        "payload": "WyJ3YWl0cm9uLWNsb3VkLW1hY2hpbmUtdjEiLCJodHRwczovL2Nsb3VkLmV4YW1wbGUudGVzdCIsInRyYW5zbGF0aW9uLXN1Ym1pdCIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjUyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsMTgwMDAwMDAwMDAwMCwie1wicGF5bG9hZFwiOlwiV3lKM1lXbDBjbTl1TFdOc2IzVmtMV0ZqWTJWemN5MTJNU0lzSW1oMGRIQnpPaTh2WTJ4dmRXUXVaWGhoYlhCc1pTNTBaWE4wSWl3aVVqazJiR3B4UVZCeWNGRllOMmh1V0ZveFYxODNNbXRKYlZGSlVrMTFYemRDVURSbWJtczRUV2RHYXlJc0lqRXlNelExTmpjNExURXlNelF0TkRJek5DMDRNak0wTFRFeU16UTFOamM0T1dGaVl5SXNJakl5TXpRMU5qYzRMVEV5TXpRdE5ESXpOQzA0TWpNMExURXlNelExTmpjNE9XRmlZeUlzSWpNeU16UTFOamM0TFRFeU16UXROREl6TkMwNE1qTTBMVEV5TXpRMU5qYzRPV0ZpWXlJc0luUmxjM1FpTENKTlEyOTNRbEZaUkVzeVZuZEJlVVZCYVc5cWFqTllVVW80V2xnNVZYUnpkRkJNY0dSamMzQnVRMkk0Wkd4Q1NXSTRNMU5KUVdKUlVHSXhkeUlzTVRnd01EQXdNREF3TURBd01Dd3hPREF3TURBek5qQXdNREF3TENKamIyNTBjbTlzSWwwXCIsXCJzaWduYXR1cmVcIjpcIm94NlZiZEZrS1VwSWtfa2NWSngyMlhfYm8temJoT0Z3RXc5b1hGSlR3YWo5c283dWVBNXhtazY2dlJuYk1NMjJRMEh4NXBjOVVHMDBJMWllTzBsQUNRXCJ9Iiwie1widmVyc2lvblwiOjEsXCJqb2JTaGEyNTZcIjpcIjIyOTMyM2E2YjBhMzBlN2FmZWZhMTkzYjFmOTEyM2I3ZTc2NDFlYjcwYTMxYjBmMjQzZDVhNDMzY2UxNjUwNGRcIixcImpvYkJ5dGVzXCI6MzQ3fSJd",
        "signature": "1c-X-l8TG37Zh7EsruFa9i7Fbshp4a3VJBLfv8ktHgsXNAiVvtq31w9DxgabzGYjd5Yzl5g1fWcNBW6geeklAg",
        "body": "{\"version\":1,\"country\":\"ES\",\"languages\":{\"default\":\"ca\",\"enabled\":[\"ca\",\"es\",\"en\"]},\"items\":[{\"ref\":\"variant:812\",\"kind\":\"variant\",\"family\":\"product:640\",\"category\":\"TAP BEERS\",\"staffName\":\"PINTA\",\"existing\":{\"en\":\"Pint\"},\"missing\":[\"ca\",\"es\"]}],\"houseStyle\":[{\"kind\":\"product\",\"staffName\":\"CARAJILLO\",\"names\":{\"ca\":\"Cigaló\",\"es\":\"Carajillo\"}}]}"
      }
    },
    {
      "name": "replayed_operation",
      "expect": "409 conflict after valid",
      "envelope": {
        "payload": "WyJ3YWl0cm9uLWNsb3VkLW1hY2hpbmUtdjEiLCJodHRwczovL2Nsb3VkLmV4YW1wbGUudGVzdCIsInRyYW5zbGF0aW9uLXN1Ym1pdCIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjUyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsMTgwMDAwMDAwMDAwMCwie1wicGF5bG9hZFwiOlwiV3lKM1lXbDBjbTl1TFdOc2IzVmtMV0ZqWTJWemN5MTJNU0lzSW1oMGRIQnpPaTh2WTJ4dmRXUXVaWGhoYlhCc1pTNTBaWE4wSWl3aVVqazJiR3B4UVZCeWNGRllOMmh1V0ZveFYxODNNbXRKYlZGSlVrMTFYemRDVURSbWJtczRUV2RHYXlJc0lqRXlNelExTmpjNExURXlNelF0TkRJek5DMDRNak0wTFRFeU16UTFOamM0T1dGaVl5SXNJakl5TXpRMU5qYzRMVEV5TXpRdE5ESXpOQzA0TWpNMExURXlNelExTmpjNE9XRmlZeUlzSWpNeU16UTFOamM0TFRFeU16UXROREl6TkMwNE1qTTBMVEV5TXpRMU5qYzRPV0ZpWXlJc0luUmxjM1FpTENKTlEyOTNRbEZaUkVzeVZuZEJlVVZCYVc5cWFqTllVVW80V2xnNVZYUnpkRkJNY0dSamMzQnVRMkk0Wkd4Q1NXSTRNMU5KUVdKUlVHSXhkeUlzTVRnd01EQXdNREF3TURBd01Dd3hPREF3TURBek5qQXdNREF3TENKamIyNTBjbTlzSWwwXCIsXCJzaWduYXR1cmVcIjpcIm94NlZiZEZrS1VwSWtfa2NWSngyMlhfYm8temJoT0Z3RXc5b1hGSlR3YWo5c283dWVBNXhtazY2dlJuYk1NMjJRMEh4NXBjOVVHMDBJMWllTzBsQUNRXCJ9Iiwie1widmVyc2lvblwiOjEsXCJqb2JTaGEyNTZcIjpcImY2NGQ5ZTdhNzU4MWMzZjUzZjk0MjgwYmFmNDVkYmY1NWVhZGZjMjkwZmE0N2U0NWNlZWUyODcyODA0YjFiNTlcIixcImpvYkJ5dGVzXCI6MzQ2fSJd",
        "signature": "vUNrsO7iA8YetktzhIoAzXMVToakQ4Erj6u3LlDJdFy5UwuA5Q_jfhMl2RsFrTgb-90rEYK2GFT9viUG8KoPCA",
        "body": "{\"version\":1,\"country\":\"ES\",\"languages\":{\"default\":\"ca\",\"enabled\":[\"ca\",\"es\",\"en\"]},\"items\":[{\"ref\":\"variant:812\",\"kind\":\"variant\",\"family\":\"product:640\",\"category\":\"TAP BEERS\",\"staffName\":\"CANYA\",\"existing\":{\"en\":\"Pint\"},\"missing\":[\"ca\",\"es\"]}],\"houseStyle\":[{\"kind\":\"product\",\"staffName\":\"CARAJILLO\",\"names\":{\"ca\":\"Cigaló\",\"es\":\"Carajillo\"}}]}"
      }
    }
  ]
}
```
