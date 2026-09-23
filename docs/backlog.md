# Waitron Cloud backlog

Updated 2026-09-23. The repository has a pnpm workspace and internal PostgreSQL
registration state, internal password sessions, session-backed Cloud approval and an
email-verification signup backend that creates the first organisation and business.
Cloud password recovery and an encrypted PostgreSQL email queue are implemented
internally, with a retry worker, authenticated TLS SMTP delivery and Mailpit for local
email capture. The account HTTP API now provides signup, login, session activity,
logout and recovery with shared request limits, Origin/CSRF checks and bounded
network handling. Live provider/sender configuration and account screens remain open.
No public cloud service is deployed. This file owns cloud product and platform work;
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

The [integration contract](waitron-integration-contract.md) now maps the existing
interfaces to proposed connection, configuration, backup, replacement and revocation
operations, with ownership and acceptance checks. Registration persistence is implemented
with real PostgreSQL concurrency and process-restart tests. Password sessions and
session-backed Cloud approval are implemented. The independent Cloud signup backend
now verifies email tokens and creates the first organisation, business and owner
membership together. Password recovery now changes credentials and ends existing
sessions atomically. The same transaction queues encrypted emails for a worker that
retries failures and resumes after crashes. Local Mailpit tests cover SMTP delivery
and a separate worker process. Authenticated TLS SMTP now covers production transport,
bounded cancellation, retry classification and accepted-message receipts. Next: configure
and prove live provider delivery, build account/recovery screens, and validate production
ingress and deployment controls before exposure. The account HTTP adapter is implemented.
The owner confirmed the SQLite storage switch landed on 2026-09-23. Waitron-side
work can resume. Build the local administrator adapter and matching-code exchange, including bound proof
and first-contact trust, before exposing public registration endpoints. Recheck the
new SQLite capture/restore interfaces before integrating backups; do not build a new
PostgreSQL backup adapter for Waitron. The full two-venue milestone remains unproved.
The [registration plan](registration-implementation-plan.md) now sequences persistence,
identity reuse, the bound approval exchange and a two-installation connection proof.
The normal connection journey and PostgreSQL for Cloud management data are agreed.
The internal package uses one management database and tests concurrent completion
and restart against PostgreSQL. Proof encoding and initial trust remain to be settled before exposing
public endpoints. Country partitioning, database availability and per-cell storage
remain deployment work; existing services must tolerate a management outage within
the credential and revocation rules still to be defined.

The [Cloud account HTTP API](../packages/account-http/README.md) is implemented and
tested against PostgreSQL, Mailpit and real sockets. Shared account controls are
implemented in [Waitron PR #519](https://github.com/clintongormley/waitron/pull/519).
Next, arrange private package distribution and build Cloud account screens and browser tests. Pairing
remains a separate exchange requiring both Cloud and local administrator proof.

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
  Use Cloud-managed recovery keys by default for the stream and managed snapshots:
  an authorised owner must not need the original server or a separately saved backup
  key. Preserve the existing owner-held key model for customer-managed archives.
  Normally restore the latest recoverable continuous Litestream backup. Retained
  snapshots provide point-in-time archives and recovery if continuous backup data
  disappears. Start with daily snapshots retained for 30 days and monthly snapshots
  for 12 months, plus longer paid retention for selected snapshots. Validate costs and
  define prices, schedule details and continuous-backup retention. Show backup health
  and alert on interruption.
  While the backup subscription is active, protect the last verified snapshot from
  automatic expiry and mark it as out of date when backups stop. Verify a new snapshot
  before allowing it to replace the protected copy.
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
| Backup recovery | Self-service restoration is agreed; staff intervention is an exceptional fallback. Use continuous backups for the latest recoverable version and retained snapshots for archives or missing continuous data. Start with daily snapshots for 30 days, monthly snapshots for 12 months and longer paid retention for selected snapshots. Preserve the last verified snapshot against automatic expiry while subscribed, marking it out of date when backups stop. Use Cloud-managed recovery without a saved owner key; validate the inherited hourly stream snapshot/30-day retention baseline and define verification, schedule details, extended-retention terms and prices, and independent storage/deletion controls. Test recovery with continuous data absent. |

## Platform work to scope

- **Shared UI.** [Waitron PR #519](https://github.com/clintongormley/waitron/pull/519)
  implements `@waitron/ui-core` in Waitron with seven account controls, theme tokens
  and common helpers. Existing `@waitron/ui` imports re-export the same implementation;
  venue controls and brand delivery remain in Waitron. The runtime package depends on
  Lit rather than `@waitron/shared`. A built tarball installs outside the workspace and
  passes declaration, Chromium form, theme and accessibility checks. Both UI packages
  retain coverage and weekly mutation gates. The [approved design](superpowers/specs/2026-09-23-shared-ui-extraction-design.md)
  and [execution plan](superpowers/plans/2026-09-23-shared-ui-extraction.md) record the boundary.
  Next, select and configure private distribution, publish a version and pin it in
  Cloud's manifest and lockfile before building account screens. No package has been
  published and Cloud does not depend on it yet. Read the first weekly mutation scores
  after the split in Waitron; the extraction verifies the wiring and coverage, not the
  new full mutation scores.
- **Identity and organisations.** Password helpers and management-session behaviours
  have been adapted with a pinned source map, PostgreSQL tests, hashed session/CSRF
  tokens, passive polling and separate platform permission checks. Session-backed
  Cloud approval derives the account from the live session in its transaction.
  The signup backend now issues hashed, expiring email tokens with a shared per-address
  cooldown and creates a verified customer account, named organisation, first legal
  business and owner membership atomically. It grants no platform access. The email
  adapter is tested with capture/failure adapters and SMTP through local Mailpit.
  Password recovery now uses expiring single-use tokens bound to the account, email
  and current password hash; completion invalidates older links and revokes all existing
  sessions without changing permissions. Unknown/ineligible accounts and delivery
  failures receive the same accepted result. Notifications follow commit and cannot
  undo a successful reset. Recovery requires verified email and an existing password;
  define recovery for legacy unverified and passwordless accounts separately.
  Configure live email delivery and implement public signup/recovery screens, MFA/passkeys
  and the platform role catalogue before public use. Shared login/request limits, secure
  cookies and Origin/CSRF checks are implemented in the account API. Validate ingress
  bot controls, trusted proxy settings and browser behaviour before deployment. Define
  session, signup-request and password-reset-request retention and cleanup, including
  reset records for unknown addresses, and measure them against the
  expected deployment size. Add a compromised-password check before public signup.
  The PostgreSQL email queue now saves signup/reset messages and password-change
  notifications with their state changes. It encrypts recipients and tokens, retries
  at most eight times, expires links, fences late worker acknowledgements, and purges
  encrypted payloads on completion. Tests cover rollback, concurrency, worker crashes,
  lost keys, invalidated links and SMTP. The [production SMTP adapter](production-email-implementation.md)
  now uses verified TLS and authentication, closes timed-out/cancelled sockets, classifies
  retryable/permanent failures and stores stable Message-IDs on acceptance. Production
  requires explicit relay configuration; status checks need only database access.
  Invalid optional receipt metadata is discarded after a successful send, avoiding
  a repeat delivery; local tests cover cancellation before the socket opens.
  Prefer Spain for administrative email processing. SES has no Spain endpoint in the
  checked endpoint list; Acumbamail is a Madrid-hosted candidate, not a selected account.
  Next, select the provider and verify its processing locations, retention and tracking
  controls; configure the sender and prove live delivery. Implement authenticated
  bounce/complaint ingestion, suppression reconciliation and delivery alerts for that
  provider before public use.
  Provision separately held encryption keys and document rotation/restore before
  production; the code accepts an active key plus retained older keys. A send timeout
  or crash after provider acceptance may duplicate an email. Define retention/cleanup
  for terminal delivery metadata and security audit events. The HTTP adapter applies
  a 300 ms response floor to login/email requests, but deployment timing and load
  measurements must still assess account/cooldown differences under contention.
  Its rate key must be shared across instances; rotation starts new allowances.
  Login now checks its IP allowance before charging the email allowance, so an
  already-blocked IP cannot spend another person's address allowance. Admitted
  attempts across IPs can still exhaust an address allowance; assess targeted
  lockout mitigation with the public ingress policy before launch.
  Test follow-up: add independent HTTP assertions for the 1024-byte password limit
  and early declared Content-Length refusal. The underlying guards work; current
  tests independently prove the streamed-body bound but not these early checks.
  Review the inherited password cost for deployment and apply the source map's
  security-fix process to both repositories. Further reuse should take code and
  behavioural tests from `pre-sqlite-migration`, pinned to
  `c9d80c59a30ab1ae7a4acc0a6999e6a342de924e` in the registration plan. Adapt its
  PostgreSQL schema and dependencies; add cloud memberships and permissions for
  organisations that can contain several legal businesses across countries. Include Cloud staff logins
  and explicit links between distinct Cloud and local identities; local till staff
  need no Cloud account. Support one Cloud login managing several authorised venues
  and separate platform permissions. Implement the agreed support approval and expiry policy.
  Define revocation, audit and emergency authorisation. Review
  database and module dependencies, and establish how security fixes reach both codebases.
- **Subscriptions and billing.** Service catalogue, checkout, invoicing, permitted
  services, usage accounting, trials, failed payment and cancellation.
- **Venue and node registration.** Implement the agreed signup from Waitron now that its
  SQLite storage switch has landed. The Cloud account backend creates a new customer's organisation
  and first legal business; connect it to the Waitron journey using confirmed details.
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
  Registration persistence now records bound approvals and results with transactional
  completion, expiry, retries, permission rechecks and separate service states. Real
  PostgreSQL tests cover concurrent workers and process restart. Next, implement the
  actual local proof verifier, browser adapter and credential lifecycle; IDs alone
  are not authentication. The owner approved matching-code confirmation between
  signed-in local Waitron and Cloud. Define code/proof formats, expiry, attempt limits
  and canonical request binding; implement the Waitron-side administrator check and
  prove two real installations cannot exchange or replay their approvals. Replace the initial one-installation-per-venue constraint with an
  explicit history model when building replacement. Validate local-venue identifier
  provenance and handling of cloned identities in the approval flow. When replacement
  gains a UI, define the permitted diagnostics for an already-linked or revoked
  installation; this slice rejects a different installation as a registration conflict.
  Terminated database connections and lost replies have regression tests; actual
  database failover and recovery under deployment credentials still need proof.
- **Provisioning and placement.** Use Kubernetes for orchestration when needed;
  cluster provisioning and manifests are deferred until there is a service to deploy
  and a concrete operational need. Country/provider/cell registry, repeatable resource
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
  Implement the starting snapshot policy: daily for 30 days, monthly for 12 months
  and longer paid retention for selected snapshots. Define snapshot timing, monthly
  selection and missed-snapshot handling; validate storage costs before pricing.
  Validate the inherited continuous-backup retention baseline. Protect the last verified snapshot from automatic
  expiry while the backup subscription is active. Specify verification before a newer
  snapshot takes its place; test failed new snapshots and interrupted cleanup. Explicit
  deletion and cancellation policies remain open.
  Carry forward the existing topology's proposed hourly stream snapshots and 30-day
  stream retention as a baseline to validate. Implement Cloud-managed recovery-key
  custody and authorised delivery, respecting the existing external vault-key design.
  Implement the integration contract's mapped backup contents, manifests, module
  restore hooks and per-secret handling after checking the incoming SQLite interfaces.
  Test key rotation with retained snapshots and recovery
  after loss of the original server without an owner-held backup key. See the
  [existing-design reconciliation](documentation-ownership.md#backup-and-recovery-design-reconciliation).
  Cloud registration credentials must respect Waitron's different node-identity rules
  for stream and archive restores. Keep the on-prem-archive-to-cloud vault re-encryption
  follow-up explicit; it is not proved by an ordinary backup download.
  The inspected archive format includes TLS private keys and backup settings, so
  reconcile capture with venue-only staff TLS key custody and fresh Cloud installation
  credentials before using it for managed Cloud backups. Implement restore verification
  separately from file-upload freshness; keep verifier runs from activating a primary
  or contacting fiscal/payment services. Define the external-key format extension
  rather than assuming it exists in the inspected manifest v1.

## Initial services and future candidates

| Service | Design work still needed |
| --- | --- |
| Remote access (initial) | Public HTTPS terminates in Cloud for bot inspection; staff uses a separate hostname with TLS passthrough and network controls. Share a gateway within each cell, with separate venue tunnels and credentials. Define and test route/session isolation, traffic limits and legitimate automated-client handling. Provide assigned/custom domains and automated certificates; implement the preferred local DNS overrides with router-specific setup and offline/recovery tests. Decide the bootstrap role of waitron.local. Temporary unavailability while the venue is offline and short interruptions during cell replacement are accepted; define and test the cell recovery-time target. |
| Backups (initial) | Implement self-service restore onto a replacement server, normally using the latest recoverable Litestream backup. Provision scoped storage access, show recovery-point time and backup health, alert on interruption, define retention and test restore against each provider selected for launch. Coordinate safe replacement activation with Waitron. |
| SQLite snapshots (initial backup service) | Retain daily snapshots for 30 days and monthly snapshots for 12 months, with longer paid retention for selected snapshots. Each must remain restorable if continuous backup data disappears. Protect the last verified snapshot from automatic expiry while subscribed; verify a newer copy before replacing it and show stale backup health. Define schedule details, consistency, extended-retention terms and prices, and independent storage/deletion controls. Provide explicit snapshot selection and prove restoration with continuous backup data absent. |
| Failover to cloud | Allocate a replacement instance, coordinate promotion with Waitron, connect devices, stream the new primary and support return to the venue. |
| Hosted Waitron | Provision isolated operational instances, local print connectivity, upgrades, capacity and cloud-only recovery. |
| Bookings and public pages | Initial remote access may be unavailable while the venue is offline. Future independent cloud hosting needs rules for accepting reservations and synchronising them with the venue; include menus, ordering and payment-page candidates. |
| Invoice archive | Define the archived objects and access grants, including owner-approved AEAT/advisor access, retention, download and customer exit. Have hosting/archive questions reviewed for the launch country. |
| Analytics and reports | Choose ingestion, supported source versions, country and cell placement, search/aggregation engine, scheduled reports and group reporting. Elasticsearch is a candidate. |
| Multiple venues | Define group visibility, permitted changes and how central catalogue/configuration changes are delivered and acknowledged. |
| Messaging | Prefer a Spain-hosted provider for administrative email; configure the implemented TLS SMTP adapter, notification channels, sender identities, preferences, delivery failures and message location policy. |
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
