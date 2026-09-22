# Waitron Cloud backlog

Updated 2026-09-22. The repository has a pnpm foundation and is in product discussion.
No cloud service is implemented. This file owns cloud product and platform work;
Waitron's backlog owns the on-prem application and its side of the integration.

Start with the [product discussion](product-and-platform.md). The
[inherited inventory](reference/2026-08-29-cloud-services-inventory.md) holds the wider
candidate list and previous commercial reasoning. Neither this list nor its order
selects the first service to build.

## Decisions in progress

| Decision | Next step |
| --- | --- |
| Customer model | Support an organisation with several legal businesses and tax identities across countries from the outset. Agree the remaining relationships between people, organisations, businesses, venues and nodes, keeping signup simple for a single business. |
| Cloud staff access | Customer-approved, time-limited support access and an explicitly authorised, audited emergency route are agreed. Define platform roles, eligible approvers, grant scope and enforcement. Possible on-prem SSH support requires separate, explicit customer approval for a limited period. |
| Residency | Define the country policy for operational data, backups, archives, analytics, identities, logs and messages; identify supported launch countries. Verify actual obligations for each market before making customer promises. |
| Cells | Choose the customer placement unit, group size and availability-zone layout. Define acceptable shared dependencies, movement and staged rollout. |
| Provider support | Design for AWS and Google Cloud; choose the first provider and the evidence needed to support the second. Decide separately whether cross-provider failover is wanted. |
| Product packages | Choose services, bundles, usage limits, trial terms and cancellation behaviour after modelling operating costs. |
| Usage policy | Define lookup and other usage units, customer visibility, allowances and excess-use behaviour. Decide which measurements affect pricing and how retries, failed calls, cached results and batches count. |
| Waitron boundary | Agree signup, ownership proof, configuration, credentials, status and version compatibility with the on-prem application. |
| Recovery promise | Specify tolerated data loss, recovery time and promotion authority for each service. Existing Waitron designs use human promotion; automation is not approved by this discussion. |

## Platform work to scope

- **Identity and organisations.** Reuse suitable Waitron user management code and
  behavioural tests; add cloud memberships and permissions for organisations that
  can contain several legal businesses across countries. Include Cloud staff logins
  and platform permissions; implement the agreed support approval and expiry policy.
  Define revocation, audit and emergency authorisation. Review
  database and module dependencies, and establish how security fixes reach both codebases.
- **Subscriptions and billing.** Service catalogue, checkout, invoicing, permitted
  services, usage accounting, trials, failed payment and cancellation.
- **Venue and node registration.** Signup inside Waitron, account linking, ownership
  verification, machine identities, credential renewal, replacement and revocation.
- **Provisioning and placement.** Country/provider/cell registry, repeatable resource
  creation, recovery from partial failures, capacity and customer movement.
- **Provider integration.** Storage, compute, email, notifications, jobs, keys and
  telemetry, with AWS and Google implementations where needed.
- **Operations.** Customer and operator portals, health checks, incidents, audit,
  budgets, quotas, staged releases, maintenance and recovery controls.
- **Service monitoring.** Check representative operations from outside the affected
  cell; track errors, response times, queued work, backup freshness and capacity.
  Define alerts, affected-customer views and rollout pause criteria.
- **Usage metering.** Attribute lookups/API calls, reports, storage, transfers,
  messages and compute to customers and services. Show consumption and allowances,
  track provider costs and define limits. Any billing records need durable capture,
  duplicate handling, reconciliation and a metering-outage policy.
- **Data lifecycle.** Retention, restore checks, export, deletion and access review;
  define what survives subscription termination and for how long.

## Service candidates

| Service | Design work still needed |
| --- | --- |
| Remote access | Reconcile the shared gateway handoff with the per-venue endpoint decision; define tunnels, domains, TLS termination and customer isolation. |
| Continuous backup | Provision scoped storage access for Litestream, surface freshness and interruption, define retention and test restore against each provider. |
| SQLite snapshots | Define scheduled and retained recovery points, consistency, customer restore controls and relation to the continuous stream. |
| Failover to cloud | Allocate a replacement instance, coordinate promotion with Waitron, connect devices, stream the new primary and support return to the venue. |
| Hosted Waitron | Provision isolated operational instances, local print connectivity, upgrades, capacity and cloud-only recovery. |
| Bookings and public pages | Define booking availability and the authority for accepting reservations when the venue is offline; include menus, ordering and payment-page candidates. |
| Invoice archive | Define the archived objects and access grants, including owner-approved AEAT/advisor access, retention, download and customer exit. Have hosting/archive questions reviewed for the launch country. |
| Analytics and reports | Choose ingestion, supported source versions, country and cell placement, search/aggregation engine, scheduled reports and group reporting. Elasticsearch is a candidate. |
| Multiple venues | Define group visibility, permitted changes and how central catalogue/configuration changes are delivered and acknowledged. |
| Messaging | Administrative email via SES or another provider, notification channels, sender identities, preferences, delivery failures and message location policy. |
| Automated upgrades | Treat cloud services, cloud-hosted Waitron and on-prem installations separately; choose rollout groups, compatibility, maintenance windows, pause and recovery behaviour. |
| Monitoring | External venue health and backup/filing/device signals, functional cloud-service checks, performance, customer alerts and incidents. Platform usage metering also tracks consumption, limits and costs. |

Further candidates remain in the complete inventory: loyalty and gift cards,
e-receipts, opening-hours publishing, accounting/delivery connectors, AI-assisted
reports, benchmarking and commercial payment-rate agreements. None is implied to
be an initial release commitment.

## Items transferred from Waitron

The source is [Waitron's backlog at `830cf71fe854`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/backlog.md).
Its section titled "The cloud primary" mixed cloud services with core SQLite work.
The [ownership map](documentation-ownership.md) records what remains in Waitron.

- **Cloud provisioning and trial onboarding.** Own the service that creates a
  customer's resources and supplies configuration and credentials to Waitron, plus
  the hosted trial entry path. The integration contract remains unsettled.
- **Cloud-only redundancy.** Choose the failure and recovery model for a hosted
  primary. The old backlog's managed-Postgres framing is historical; the current
  Waitron design targets SQLite and Litestream.
- **Production object-store proof.** Run the conditional-write and recovery checks
  against the actual AWS and Google storage targets selected. The existing
  [prototype results](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/research/2026-09-16-sqlite-failover-prototype.md)
  concern MinIO. They do not establish either production provider's behaviour.
- **Promoted cloud generation and current pointer.** Coordinate proof that a promoted
  instance streams its own generation and a replacement follows `current.json`.
  The inherited prototype did not cover that path. Cloud provisioning/recovery and
  Waitron's streaming engine both participate; settle the contract before assigning
  implementation tasks or claiming the gap is closed.
- **Remote support.** On-prem SSH support is a candidate capability requiring
  explicit customer approval for a specific server and limited period, separately
  from cloud data access. Scope the connection mechanism, server permissions, audit,
  early revocation and termination of active sessions on expiry. The
  [maintenance discussion](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)
  remains an unapproved implementation proposal and also covers local OS maintenance.
- **Managed devices.** Android Management API enrolment is a cloud candidate.
  Device hardware, kiosk behaviour and the local operating-system image remain
  Waitron work.
- **Archive and hosting advice.** Review the cloud assumptions in Waitron's advisor
  questions and the historical storage document's section 8a before a fiscal archive
  design. Do not treat migrated legal conclusions as a current assessment.

Waitron retains the SQLite storage change, safe promotion and rejoin behaviour,
on-prem mirrors, fiscal filing recovery, offline log growth, local credentials,
box image networking and the end-to-end selling proof. These cloud entries do not
declare those core prerequisites implemented.
