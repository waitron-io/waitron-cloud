# Waitron and Cloud integration contract

Status: implementation proposal, 2026-09-22. This translates the agreed
[product requirements](product-and-platform.md) into responsibilities and exchanges.
It does not declare endpoints implemented or replace Waitron's recovery rules.

The first milestone connects two test venues to one cell, proves remote-access
isolation, restores both backup types and replaces the gateway. Start with venue
registration; services can then use the same identities and permissions.

SQLite is expected to land soon. Target that implementation; the older PostgreSQL
source below is a reference for existing contracts, not a reason to build another
adapter. Registration, permissions and service configuration can proceed independently.
Recheck the concrete SQLite capture/restore interfaces after landing before wiring
the backup operations to Waitron.

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
| Start replacement | Authorised account, venue, planned/failure mode, selected recovery point and replacement installation identity | Cloud records one active replacement operation per venue and gives the replacement limited restore access. Return the recovery timestamp and progress; do not route traffic or activate trading yet. |
| Complete replacement | Waitron restore/compatibility results and activation evidence, with the required owner confirmations | Waitron applies its recovery rules. Cloud coordinates old-credential retirement and routing, recording each step. After an uncertain reply, query operation state before retrying activation. |
| Revoke installation | Authorised account, target installation and reason | Cloud withdraws its service permissions and reports enforcement progress. Define expiry and active-session behaviour for each credential type; do not promise instantaneous revocation of all provider credentials. Local offline trading is unaffected by this operation alone. |

The registration response must distinguish a linked venue from a ready service.
Remote access, continuous backup and retained snapshots each have their own setup
and health state. A failed backup setup must not be displayed as a working backup
because the tunnel connected successfully.

## Data and secrets crossing the boundary

| Item | Contract |
| --- | --- |
| Continuous replica | Waitron writes the Litestream replica directly to its assigned object-store scope. Recovery needs a selected generation and evidence of the restorable end point. Cloud must not invent that timestamp from upload time. Provider-specific conditional-write and recovery tests remain required. |
| Retained snapshot | Waitron creates a consistent, independently recoverable artifact using its manifest and module contributions. Cloud retains, catalogues and verifies it under the agreed daily/monthly policy. Do not expose a raw SQLite file as a complete server backup unless all required state is accounted for. |
| Configuration and module-owned state | Waitron declares the exact captured contents and missing-optional-file rules. The inspected archive captures `backup.env` and `modules.json` when present. Restore must reconcile Cloud access settings with the new installation rather than reactivate obsolete credentials. |
| Backup decryption and vault keys | Cloud-managed recovery delivers only the required key versions to the authorised target through a protected channel. Key references in catalogue metadata are not secret values. Keep old key versions usable while retained backups require them. Preserve customer-managed archive key custody. |
| Machine and TLS keys | Issue fresh Cloud installation credentials. Do not copy retired machine credentials into an active target. Staff TLS keys retain the proposed venue-only custody; define fresh certificate provisioning separately from recovery of application secrets. |

Waitron's [state-secret list](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/state-secrets.ts)
currently includes the vault key, trading identity and TLS CA/leaf files. Its
[optional-state list](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/backup-optional-state.ts)
includes backup settings. Do not upload that archive unchanged under the managed
Cloud policy until per-secret capture rules reconcile those contents with fresh
installation credentials and venue-only staff TLS key custody.

The external vault-key marker described in the fiscal-certificate design is not a
field in the inspected `BackupManifest` v1. Cloud must negotiate support with Waitron,
not infer it from the hosting location. The existing on-prem-to-cloud vault
re-encryption follow-up remains required for that restore target.

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
