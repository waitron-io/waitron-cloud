# Waitron Cloud backlog

Updated 2026-09-22. The repository has a pnpm foundation and is in product discussion.
No cloud service is implemented. This file owns cloud product and platform work;
Waitron's backlog owns the on-prem application and its side of the integration.

Start with the [product discussion](product-and-platform.md). The
[inherited inventory](reference/2026-08-29-cloud-services-inventory.md) holds the wider
candidate list and previous commercial reasoning. Remote access and backups are the
agreed initial services. The first integration milestone is agreed; detailed
implementation and release scope remain open.

## First working milestone

Use two test venues sharing one cell. Implement and verify in this order:

1. Connect a venue through owner approval, assigned names and venue-scoped credentials.
2. Prove public cloud inspection and staff TLS passthrough, including isolation between
   venues and protection of staff functions from public routes.
3. Upload backups directly to object storage and show the latest recoverable time.
4. Restore onto a replacement from the continuous backup and from a retained snapshot,
   including with continuous data absent. Cover planned hardware replacement and
   recovery after failure through the agreed shared flow.
5. Replace the gateway, measure reconnection time with unchanged customer-facing
   addresses and verify that backups continue.

Next: specify the protocols for connection, the agreed replacement journey and
revocation of a server's Cloud access. Cloud owns registration, routing, storage access
and service status; Waitron owns local integration and recovered
server activation. Inspect reuse candidates against the SQLite design and define the
shared contract and verification responsibilities before implementation. No part of
this milestone is implemented by documenting it.

## Initial focus

- Launch first in Spain on AWS. Verify the region and required services against the
  residency policy before provisioning. Preserve support for other countries and
  Google Cloud in the design; implement and validate those deployments later.
- Make routine customer journeys self-service, aiming to operate without a dedicated
  support team. Cover setup, account management, billing, troubleshooting, backup
  recovery and cancellation with clear status, actionable errors and safe retries.
  Reserve staff intervention for exceptional cases; avoid required manual support steps.
- Build around one owner connecting one venue, or adding several venues in the same
  city. Keep the usual connection flow to one action that verifies both Cloud and
  local permissions.
- Remote access covers owners and staff plus customer-facing pages such as menus
  and bookings. Temporary unavailability is acceptable when the venue server or its
  internet connection is down. Define route permissions and the unavailable-page
  experience; cloud copies and offline booking acceptance are future capabilities.
- Provide self-service recovery onto a replacement server without routine staff assistance.
  Normally restore the latest recoverable continuous Litestream backup. Retained
  snapshots provide point-in-time archives and recovery if continuous backup data
  disappears. Define retention and scheduling, show backup health and alert on interruption.
- Terminate public HTTPS in Cloud for bot and request inspection, then encrypt the
  onward connection. Keep staff traffic encrypted to the venue through a separate
  hostname using TLS passthrough, with network and connection controls in Cloud.
  Test that the public route cannot expose staff functions; define limits and monitor
  false positives. Staff application-level filtering remains at the venue.
- Provide assigned or customer-owned hostnames and automatic Let's Encrypt certificates.
  Prefer local DNS overrides so the registered staff hostname and venue certificate
  work on both LAN and internet paths. Define router-specific setup, address stability,
  resolver recovery and initial bootstrap. Test fresh local connections without internet.
  Google Wifi may require a local custom DNS service, adding a network-wide DNS dependency.
- Evaluate Plex-style public DNS names resolving to private LAN addresses as an option
  that can reduce customer configuration. Test certificate trust, local/remote address
  selection and router rebinding protection. Require a verified offline connection
  path after restart and DNS-cache expiry; local DNS overrides remain the preference.
- Place venues independently in cells, with a shared remote-access gateway per cell
  and separate venue tunnels and credentials. Keep customer-facing addresses stable
  when moving venues. A short remote-access interruption during cell replacement is
  accepted; define the recovery-time target and prove the replacement procedure.
- Keep stored backups and portal recovery independent of gateway machines. Test
  recovery with the gateway absent. Keep account management separate from traffic
  handling so a portal outage does not immediately interrupt established connections
  or backups; define credential expiry and revocation during that outage.
- Keep support for multiple legal businesses and countries in the underlying model.
  Detailed international administration, separate-approver workflows and ownership
  transfers can wait until needed. Each venue belongs to one organisation at a time.

## Decisions in progress

| Decision | Next step |
| --- | --- |
| Customer model | Support an organisation with several legal businesses and tax identities across countries from the outset. A venue belongs to one organisation at a time. Focus signup on one owner with one venue or several venues in the same city; defer the ownership-transfer workflow. |
| Cloud staff access | Customer-approved, time-limited support access and an explicitly authorised, audited emergency route are agreed. Define platform roles, eligible approvers, grant scope and enforcement. Possible on-prem SSH support requires separate, explicit customer approval for a limited period. |
| Residency | Spain is the first deployment country. Define the country policy for operational data, backups, archives, analytics, identities, logs and messages; verify AWS service locations and actual obligations before making customer promises. |
| Cells | Venues are independently placed, with a shared gateway per cell and stable customer-facing addresses on movement. Short remote-access interruptions during cell replacement are accepted. Define group size, availability-zone layout, recovery-time target and tested replacement. Specify shared dependencies, movement and staged rollout; keep backups and portal recovery independent of gateway machines. |
| Provider support | AWS is the first provider, deploying in Spain. Select and verify the required region and services. Keep Google Cloud as a future target and define the evidence needed to support it. Decide separately whether cross-provider failover is wanted. |
| Product packages | Remote access and backups are the initial services. Define their release scope, bundles, usage limits, trial terms and cancellation behaviour after modelling operating costs. |
| Usage policy | Define lookup and other usage units, customer visibility, allowances and excess-use behaviour. Decide which measurements affect pricing and how retries, failed calls, cached results and batches count. |
| Waitron boundary | Signup inside Waitron, distinct Cloud and local staff logins, explicit identity linking and an independent Cloud portal are agreed. Venue linking requires Cloud permission to add venues and local administrator approval; one person or different people may provide them. Define the approval exchange, ownership proof, already-linked venue handling, configuration, credentials, status and version compatibility. |
| Server lifecycle | One guided replacement flow covers planned upgrades and server failure, preserving venue, subscription and customer-facing addresses. Use fresh installation credentials, verify restored data before trading, retire old credentials and follow Waitron's activation rules. Specify final-backup handover, concurrent requests, interrupted replacement and a returning old server. Define connection and standalone revocation, including the latter's effects on subscriptions, retained backups and reconnection. |
| Recovery promise | Specify tolerated data loss, recovery time and promotion authority for each service. Existing Waitron designs use human promotion; automation is not approved by this discussion. |
| Backup recovery | Self-service restoration is agreed; staff intervention is an exceptional fallback. Use continuous backups for the latest recoverable version and retained snapshots for archives or missing continuous data. Define retention, snapshot scheduling and independent snapshot storage/deletion controls; test recovery with continuous data absent. |

## Platform work to scope

- **Identity and organisations.** Reuse suitable Waitron user management code and
  behavioural tests; add cloud memberships and permissions for organisations that
  can contain several legal businesses across countries. Include Cloud staff logins
  and explicit links between distinct Cloud and local identities; local till staff
  need no Cloud account. Support one Cloud login managing several authorised venues
  and separate platform permissions. Implement the agreed support approval and expiry policy.
  Define revocation, audit and emergency authorisation. Review
  database and module dependencies, and establish how security fixes reach both codebases.
- **Subscriptions and billing.** Service catalogue, checkout, invoicing, permitted
  services, usage accounting, trials, failed payment and cancellation.
- **Venue and node registration.** Implement the agreed signup from Waitron, creating
  a new customer's organisation and first legal business from confirmed details.
  Require Cloud approval from someone permitted to add venues and local administrator
  approval before linking. Start with one owner providing both approvals in a single
  action. Preserve the policy allowing different approvers; design that workflow when
  needed. Enforce one organisation per venue. Define handling
  for existing links, machine identities, credential renewal, replacement and revocation.
  Keep venue identity stable across replacement and issue fresh installation credentials.
  Test that restoring data alone does not grant primary authority and that a returning
  old server follows Waitron's recovery rules. Cloud revocation alone does not establish
  that an offline server has stopped trading.
  Implement the shared replacement flow for planned upgrades and failure recovery.
  Verify the final backup after stopping writes during a planned handover. For failure
  recovery, show the recovery point and potential data loss, and require confirmation
  that the old server is taken out of service under Waitron's recovery rules. Preserve
  venue, subscription and addresses; test interrupted activation and route changes.
- **Provisioning and placement.** Country/provider/cell registry, repeatable resource
  creation, recovery from partial failures, capacity and customer movement.
  Place venues independently, preserve their addresses on movement and test replacement
  against an explicit recovery-time target. Define how established connections and
  backups continue during a portal outage, including credential expiry and revocation.
- **Provider integration.** Storage, compute, email, notifications, jobs, keys and
  telemetry, with AWS and Google implementations where needed.
- **Operations.** Customer and operator portals, health checks, incidents, audit,
  budgets, quotas, staged releases, maintenance and recovery controls.
  Customer portal login and account recovery must work when the venue server is
  unavailable, so customers can manage services and recovery independently.
- **Self-service journeys.** Define completion and failure paths for setup, account
  and billing changes, diagnostics, restore and cancellation. Verify customers can
  complete routine flows without staff, including recovery from interrupted operations.
  Give exceptional failures useful diagnostics for investigation under the support policy.
- **Service monitoring.** Check representative operations from outside the affected
  cell; track errors, response times, queued work, backup freshness and capacity.
  Define alerts, affected-customer views and rollout pause criteria.
- **Usage metering.** Attribute lookups/API calls, reports, storage, transfers,
  messages and compute to customers and services. Show consumption and allowances,
  track provider costs and define limits. Any billing records need durable capture,
  duplicate handling, reconciliation and a metering-outage policy.
- **Data lifecycle.** Retention, restore checks, export, deletion and access review;
  define what survives subscription termination and for how long.

## Initial services and future candidates

| Service | Design work still needed |
| --- | --- |
| Remote access (initial) | Public HTTPS terminates in Cloud for bot inspection; staff uses a separate hostname with TLS passthrough and network controls. Share a gateway within each cell, with separate venue tunnels and credentials. Define and test route/session isolation, traffic limits and legitimate automated-client handling. Provide assigned/custom domains and automated certificates; implement the preferred local DNS overrides with router-specific setup and offline/recovery tests. Decide the bootstrap role of waitron.local. Temporary unavailability while the venue is offline and short interruptions during cell replacement are accepted; define and test the cell recovery-time target. |
| Backups (initial) | Implement self-service restore onto a replacement server, normally using the latest recoverable Litestream backup. Provision scoped storage access, show recovery-point time and backup health, alert on interruption, define retention and test restore against each provider selected for launch. Coordinate safe replacement activation with Waitron. |
| SQLite snapshots (initial backup service) | Retain point-in-time archives that remain restorable if continuous backup data disappears. Define scheduling, consistency, retention and independent storage/deletion controls. Provide explicit snapshot selection and prove restoration with continuous backup data absent. |
| Failover to cloud | Allocate a replacement instance, coordinate promotion with Waitron, connect devices, stream the new primary and support return to the venue. |
| Hosted Waitron | Provision isolated operational instances, local print connectivity, upgrades, capacity and cloud-only recovery. |
| Bookings and public pages | Initial remote access may be unavailable while the venue is offline. Future independent cloud hosting needs rules for accepting reservations and synchronising them with the venue; include menus, ordering and payment-page candidates. |
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
