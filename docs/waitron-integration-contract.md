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

Waitron's local recovery adapter and the joint HTTP/client qualification remain
to be implemented in their separately owned tasks. Preserve the complete consumed
receipt and local authenticated recovery checks. Cloud operator attribution is
not local operator authentication, and no registry call belongs on the sale path.

## Translate all, version 1

Designed 2026-10-14; not implemented. The product design is in
[the Cloud spec](superpowers/specs/2026-10-14-translate-all-design.md) and in Waitron's
`docs/superpowers/specs/2026-10-14-translate-all-design.md`. This section is the wire contract
both sides build against.

Four machine actions use the existing `waitron-cloud-machine-v1` envelope and a current control
lease: POST to `/api/installations/translation-submit`, `translation-status`,
`translation-collect` and `translation-release`. The signed action is the final path segment.
The existing 60-second proof window, one-hour lease, per-installation and per-IP limits, and the
refusal of browser Origin headers apply.

### Seeing the service

The `configuration` reply returns exactly three services today, and Waitron refuses any other
count. A `configuration` request whose signed body carries `"servicesVersion": 2` receives a fourth
entry, `content_translation`, in the same shape as the other three. A request without it keeps
receiving exactly three. Every connected installation has `content_translation` switched on until
the allowance replaces free use.

### Submit: a signed fingerprint of a larger body

A job body is larger than the 4,096-character signed body allows, so submit sends it beside the
envelope:

```json
{ "payload": "...", "signature": "...", "body": "<the job as a JSON string>" }
```

The signed body is the fingerprint, not the job:

```json
{ "version": 1, "jobSha256": "<SHA-256 hex of the UTF-8 bytes of body>", "jobBytes": 183402 }
```

Cloud checks `jobBytes` and `jobSha256` against `body` before parsing it. A body over 1 MiB, or
holding more than 1,000 items, is refused with 413 `translation_job_too_large`. The job:

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

- `ref` is the box's own identifier for the item, opaque to Cloud.
- `family` names the item a variant, options label or menu section belongs to; it equals `ref`
  for an item that heads its own family.
- `category` is the family head's first category, or `null`.
- `missing` lists the languages to write; `existing` holds the venue's text in other languages,
  which the service never changes.
- `houseStyle` holds at most 300 saved names.

Keep the full submit body and operation ID until the result is known. After a lost reply, sign the
same fingerprint with the same operation ID, a fresh proof time and a live lease: Cloud returns the
same job rather than making another.

The reply:

```json
{ "version": 1, "jobId": "00000000-0000-4000-8000-000000000010", "state": "queued", "total": 358 }
```

### Status, collect and release

Each signs `{"version":1,"jobId":"<uuid>"}` with a fresh operation ID.

**Status** returns:

```json
{ "version": 1, "jobId": "...", "state": "running", "total": 358, "done": 180, "failed": 0 }
```

`state` is one of `queued`, `running`, `done`, `partly_done`, `failed`, `collected` or `expired`.
Poll every five seconds at most.

**Collect**, once the state is `done` or `partly_done`, returns:

```json
{
  "version": 1,
  "jobId": "...",
  "state": "done",
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
  "failed": ["product:1021"]
}
```

`names` holds only languages listed in the item's `missing`. `placeholder: true` comes with empty
`names`. `corrections[].field` is `internal` or a language code; a correction to a language the
venue entered is a suggestion only. The box must drop:

- a result whose `ref` it did not send;
- a name for a language that was not missing.

**Release** tells Cloud the box has stored the results. Cloud deletes the job's body and results and
returns `{"version":1,"jobId":"...","state":"collected"}`. Release is idempotent. An uncollected
job's body and results are deleted 24 hours after it finished, and its state becomes `expired`.

### Refusals

| HTTP | Code | When | Waitron's code |
|---|---|---|---|
| 400 | `invalid_request` | A body field is invalid. | — |
| 401 | (existing) | The envelope, proof or lease is invalid. | `cloud.unavailable` |
| 403 | `translation_consent_required` | The account has not agreed to the named language-model providers. | `content.suggestion_consent_required` |
| 403 | (existing) | The installation is revoked or not entitled. | existing Cloud codes |
| 404 | `translation_job_not_found` | Another installation's job, or an unknown ID. | — |
| 409 | `translation_job_running` | A job is already queued or running for the venue. | `content.suggestion_job_running` |
| 409 | `translation_limit_reached` | The estimate exceeds what is left of the cap. Carries `fits`, how many items would fit. | `content.suggestion_limit_reached` |
| 409 | `translation_not_ready` | Collect before `done` or `partly_done`. | — |
| 410 | `translation_expired` | The results were deleted after 24 hours. | `content.suggestion_expired` |
| 413 | `translation_job_too_large` | Over 1 MiB or 1,000 items. | — |

A `failed` job's status carries `"reason": "provider_unavailable"`; Waitron shows it as
`content.suggestion_service_unavailable`.

### Shared test vectors

The first implementation task on each side adds the signing test vectors to this section, generated
from fixed keys:

- a valid submit;
- the same submit with one byte of `body` changed;
- a `jobBytes` that does not match;
- a replayed operation ID with a different fingerprint.

Waitron's signer and Cloud's verifier both test against them.
