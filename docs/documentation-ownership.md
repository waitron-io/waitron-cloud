# Documentation ownership

Waitron Cloud owns the commercial cloud product, its infrastructure and its backlog.
Waitron owns the application running at a venue or inside a hosted instance. Shared
protocols need a named home and links from both repositories.

The 2026-09-22 move uses Waitron commit
[`830cf71fe854`](https://github.com/clintongormley/waitron/commit/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10).
Historical wording is preserved, with provenance notes, relocated relative links and
trailing whitespace removed.
The old paths in Waitron contain forwarding documents so existing references still
have a destination. Publish the Cloud documents before landing those forwarding
documents in Waitron; the cross-repository links target the canonical `main` paths.

## Cloud documents moved here

| Document | How to use it |
| --- | --- |
| [Cloud services inventory](reference/2026-08-29-cloud-services-inventory.md) | The complete earlier brainstorm, including candidate services and commercial principles. Product priorities and legal/technical claims need current decisions or verification. |
| [Cloud gateway handoff](reference/2026-09-21-cloud-ingress-wireguard-gateway-design.md) | A proposed shared entry point and WireGuard design. It is explicitly unreconciled with the older topology. |
| [Cloud storage model](reference/2026-07-31-cloud-storage-model-design.md) | Historical cloud storage, archive and analytics reasoning. Later decisions superseded its shared-store and PostgreSQL assumptions. |
| [Relay decision](reference/2026-09-05-relay-decision.md) | Records the earlier per-venue cloud endpoint and TLS-forwarding decision. Moving it does not approve the newer gateway alternative. |

The current [product discussion](product-and-platform.md) and [cloud backlog](backlog.md)
own the new work. Historical headings such as "approved" describe their original
status and are not approval of this product discussion.

## Shared and Waitron documents that remain there

| Topic | Reason and home |
| --- | --- |
| SQLite, Litestream, promotion and rejoin | These govern the same Waitron engine on prem and in the cloud. Keep the [topology design](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md), storage-swap work and prototype results in Waitron. |
| Backups and local restore | The node creates and restores the data. Its storage/backend contract remains in Waitron; Cloud owns the managed service and provider provisioning. |
| Old cloud-mirror implementation plans | These describe Waitron packages and historical implementation receipts, including replaced replication mechanisms. Their filenames alone do not make them Cloud service plans. |
| Box maintenance and remote support | The [discussion](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md) also governs local OS accounts and recovery. Cloud support-service questions are extracted into this backlog. |
| Fiscal and advisor material | Core filing and local compliance remain in Waitron. Cloud archive, access and hosting questions are tracked here and refer to the original advisor material. |
| Device hardware and kiosk mode | Local behaviour remains in Waitron; cloud-managed enrolment is a candidate here. |

## Backlog split

Cloud service provisioning, cloud-only redundancy, trials, production provider
validation, cloud recovery orchestration, managed devices and cloud hosting/archive
questions now have entries in the Cloud backlog. Waitron retains its integration
tasks and links to those entries.

Shared unfinished work stays visible on both sides through references. In particular,
moving a provider-validation or promotion follow-up does not discharge its test gate.
The cloud subscription journey starts inside Waitron, so its UI and local credential
handling will need corresponding Waitron changes once the contract is agreed.
Cloud owns the [free address lookup scope](address-lookup-scope.md), provider and
account allowance decisions; Waitron owns the editable venue form and country-pack
validation that any suggestion must pass.

## Backup and recovery design reconciliation

Read existing Waitron decisions before treating a Cloud question as new. The following
reconciliation uses Waitron commit `4ce2db502173d87d14d2e1aad5dc92b19be38363`.
These are design receipts, not verification of runtime behaviour.

| Source | Existing decision and current Cloud interpretation |
| --- | --- |
| [Backup and restore regime, section 3](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/docs/superpowers/specs/2026-09-04-backup-restore-regime-design.md) | Back up the whole database and module-owned extra state, with a versioned manifest and restore hooks. Owner-managed archives use a recovery key. Preserve that contract while reconciling its older PostgreSQL and filesystem-media assumptions with the SQLite work. |
| [Fiscal certificate distribution, sections 4.1–4.3](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/docs/superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md) | Cloud supplies cloud-node vault keys through a secrets service after machine authentication. Externally keyed node backups exclude that vault key. Re-encrypting an on-prem archive's vault for a cloud target is a separate follow-up; record it in the integration contract rather than assuming restore is complete. |
| [Recovery-key wizard, section 3.5](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/docs/superpowers/specs/2026-09-09-backup-recovery-key-wizard-design.md) | Owners save the archive recovery key. This remains the customer-managed archive path. The new Cloud-managed recovery default does not silently take custody of those keys. |
| [SQLite/Litestream topology, sections 0.3 and 7](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md) | Provider encryption under a per-venue key is already chosen for the continuous stream. Hourly stream snapshots and 30 days' retention are an existing proposal to validate. Stream and archive recovery are separate paths; an archive is not fast-forwarded with stream changes. |
| [Historical shared storage model, section 6](reference/2026-07-31-cloud-storage-model-design.md) | Its rule that Cloud never holds the recovery key ring is superseded for the managed Cloud backup service by the current account-based recovery decision. Preserve the historical source; do not apply that rule to the new service. |

The current Cloud decisions add independently recoverable retained snapshots to the
managed service, with daily/monthly retention and protection for the last verified
snapshot. This supersedes the topology's section 7.1 assumption that the managed
service stores only the stream and no additional database copy. Customer-managed
extra copies remain optional.

Cloud-managed recovery now covers the stream and managed snapshots without a
separately saved owner key. It must preserve the distinction between backup decryption,
application vault access and permission to activate a server. The topology's original
section 7.5 split is superseded by the landed consumers: both restore paths recover the
source local node identity and run Waitron's restore hooks, while Cloud registers a
replacement as a distinct installation with fresh credentials. Its point-in-time
inspection path must not become an in-place rollback of a live ledger.

The [integration contract](waitron-integration-contract.md) now maps inspected interfaces,
backup contents, per-secret custody, manifests and restore hooks to proposed Cloud
operations. It includes key rotation and old snapshots, the externally keyed target
and a lost original server in the verification plan. Recheck concrete interfaces when
the incoming SQLite work lands before implementing the backup adapter.
Cloud owns the managed service and key-delivery contract; Waitron owns capture,
restore and activation. Update the Waitron integration docs alongside implementation
so the two repositories do not acquire competing recovery protocols.

## Coordinate work with the Waitron campaigns

Before choosing an integration task, check Waitron's active campaign queues, worktrees
and pull requests as well as its main branch. On the development machine, Lane A's
queue is `~/waitron-campaign/queue.md` and Lane B's is
`~/waitron-campaign-b/queue.md`. Read their latest progress entries and compare the
active branch changes with your proposed work. Code under review may already provide
the interface you need even though it has not reached main.

Reuse Waitron's stream restore engine, cold-restore checks and bucket setup journey.
Cloud owns managed storage provisioning, scoped credentials, owner authorisation and
integration with those interfaces. Keep that division when selecting work so the two
repositories do not implement competing restore paths.
