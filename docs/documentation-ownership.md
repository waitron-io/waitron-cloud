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
