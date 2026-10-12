# Waitron Cloud backlog

Updated 2026-10-12. The repository has a pnpm workspace and internal PostgreSQL
registration state, internal password sessions, session-backed Cloud approval and an
email-verification signup backend that creates the first organisation and business.
Cloud password recovery and an encrypted PostgreSQL email queue are implemented
internally, with a retry worker, authenticated TLS SMTP delivery and Mailpit for local
email capture. The account HTTP API now provides signup, login, session activity,
logout and recovery with shared request limits, Origin/CSRF checks and bounded
network handling. The bilingual account portal now covers signup, sign-in, sign-out
and password recovery, served by that API with real browser and Mailpit tests.
The account venue overview groups one organisation at a time, shows business context,
connection/service state and separate latest/verified snapshot capture times. Verified
snapshots older than 48 hours are labelled out of date. Owners can browse paginated snapshot history, verification and retention details, including
protected copies. The local durable worker now verifies real Waitron restores, retries failures and
cleans expired snapshots and abandoned captures. The local monitor now persists contact,
snapshot and remote-route incidents, shows stale checks as unknown, and queues opt-in
bilingual alerts with permission and current-route rechecks.
Live provider/sender configuration and public deployment remain open.
No public cloud service is deployed. This file owns cloud product and platform work;
Waitron's backlog owns the on-prem application and its side of the integration.

Start with the [product discussion](product-and-platform.md). The
[launch evidence boundary](launch-evidence.md) separates the completed local milestone
from the provider, policy and live tests still required before public exposure. The
[inherited inventory](reference/2026-08-29-cloud-services-inventory.md) holds the wider
candidate list and previous commercial reasoning. Remote access and backups are the
agreed initial services. The first integration milestone is complete locally; the
production release scope remains open.

## First working milestone

The [combined local receipt](launch-evidence.md#read-the-local-evidence-narrowly)
now verifies these steps with two test venues. Repeat them against the selected
deployment before treating the milestone as launch evidence:

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
and prove live provider delivery and validate production
ingress and deployment controls before exposure. The account HTTP adapter is implemented.
The owner confirmed the SQLite storage switch landed on 2026-09-23. Waitron-side
work can resume. The Cloud matching-code API now verifies signed installation requests and stores bound
Cloud approvals. Its [wire contract](superpowers/specs/2026-09-23-venue-pairing-design.md)
uses local confirmation of the chosen business. Both confirmation screens and the
Waitron manager adapter now pass the [local two-installation proof](local-pairing.md),
including restart and lost-completion recovery. Installation credential renewal,
configuration, observations and revocation now work through key-bound one-hour leases.
The account and Waitron screens show English/Spanish status and explicit stop-access
confirmation. PostgreSQL and real two-server tests cover renewal/revocation races,
lost replies, worker restart and venue isolation. The [local remote-access proof](local-remote-access.md)
now uses real WireGuard/HAProxy, two Waitron servers, ACME DNS validation, browser bot
challenges, local DNS, gateway replacement, revocation and expiring route authority.
Operator placement and customer
remote setup now has owner-only English/Spanish screens for assigned names, custom DNS
changes, readiness and local-network guidance. A PostgreSQL-backed local reconciler now
publishes signed routes and renews public/staff certificates through explicit filesystem,
DNS and ACME adapters. Its receipt covers duplicate workers, expired-lease restart,
bounded failure, failed-renewal retention and hostname/lease fences; focused filesystem
tests cover atomic replacement while Waitron keeps the staff private key.
An explicitly enabled, test-installation-only version 1 signed exchange now carries staff CSRs and chains through
PostgreSQL without shared files. An opt-in reconciler mode fences replacement, revision,
revocation and expired claims; the two-installation local proof uses Pebble and
Waitron's unchanged CSR/install CLI. Live provider DNS, production key storage/deployment
and automatic appliance setup remain open. Waitron still needs a durable exchange client,
local stale-result checks, polling, lease renewal and TLS reload. The [local backup proof](local-backups.md)
now provides encrypted scoped storage, protected key versions, an immutable snapshot catalogue,
restore verification, retention and owner-bound recovery operations. Two real Waitron
snapshots restore independently of deleted Litestream data, including after key rotation.
These remain local integrations. The customer snapshot catalogue and matching-code
recovery approval screens are implemented for verified test snapshots. The replacement
setup downloads and validates the selected archive, stages it and runs Waitron cold restore
without copying keys or inheriting the old backup destination;
installation-authenticated capture delivery, upload-credential renewal and scheduled
snapshots with durable local retries are implemented locally. Owner-confirmed replacement
now imports fresh Cloud credentials, retains installation history and updates remote
placement. Two real Waitron venues now stream into separate provider-owned prefixes;
Cloud verifies their signed pointers, freezes one generation and restores its exact
database head after an interrupted attempt. Deleting the other stream leaves its
neighbour unchanged and its verified snapshot fallback restores. The complete milestone
runner now composes the transfer, real remote-access and managed-recovery phases and
validates one strict receipt. Its clean 2026-09-27 run replaced the gateway in 14,967 ms,
reconnected a moved venue in 1,570 ms, restored continuous data in 1,743 ms and a retained
snapshot in 1,432 ms, completed managed replacement in 8,346 ms, refused the old recovery
authority and restored a fresh post-replacement snapshot. The phases use separately
isolated local fixtures; the receipt binds them to the same clean Cloud and Waitron heads
rather than pretending that their disposable installation identifiers are shared. These
are local measurements, not service objectives. Live provider and DNS checks, production
deployment and secret custody, provider-native management-database recovery, planned final-write handover,
automatic tunnel/certificate installation and activation remain open.
The [registration plan](registration-implementation-plan.md) now sequences persistence,
identity reuse, the bound approval exchange and a two-installation connection proof.
The normal connection journey and PostgreSQL for Cloud management data are agreed.
The internal package uses one management database and tests concurrent completion
and restart against PostgreSQL. Proof encoding and user-mediated first contact are specified and implemented on the
Cloud side. The Waitron adapter checks live manager permission and serving-primary status before
completion. Public deployment remains gated by the service-adapter and ingress work below. Country partitioning, database availability and per-cell storage
remain deployment work; existing services must tolerate a management outage within
the scoped credential and revocation rules defined in the installation lifecycle spec.

The [Cloud account HTTP API](../packages/account-http/README.md) is implemented and
tested against PostgreSQL, Mailpit and real sockets. Shared account controls are
implemented in [Waitron PR #519](https://github.com/clintongormley/waitron/pull/519).
Cloud now pins the private shared UI release and verifies it in Chromium.
The [account portal design](superpowers/specs/2026-09-23-account-portal-design.md)
is implemented with English/Spanish signup, login and recovery, simple business
setup, same-origin serving and real browser/email tests. The
[implementation plan](superpowers/plans/2026-09-23-account-portal.md) records the delivery.
Email links use fragments; legacy query links remain accepted. Browser tests cover
committed writes with lost replies, session expiry, retry delays and account isolation.
Next, configure live mail delivery and the deployment/account-security controls below. Pairing
remains a separate exchange requiring both Cloud and local administrator proof.

## Initial focus

- Launch first in Spain on AWS. AWS documents Europe (Spain) as `eu-south-2` and
  lists candidate services for the initial architecture, but no Waitron account or
  resource has been configured. Use the [launch evidence boundary](launch-evidence.md)
  to select each service against the adopted residency policy before provisioning.
  Preserve support for other countries and Google Cloud in the design; implement and
  validate those deployments later.
- Make routine customer journeys self-service, aiming to operate without a dedicated
  support team. Cover setup, account management, billing, troubleshooting, backup
  recovery and cancellation with clear status, actionable errors and safe retries.
  Reserve staff intervention for exceptional cases; avoid required manual support steps.
- Build around one owner connecting one venue, or adding several venues in the same
  city. Keep the usual connection flow to one action that verifies both Cloud and
  local permissions.
- Remote access covers owners and staff plus customer-facing pages such as menus
  and bookings. Temporary unavailability is acceptable when the venue server or its
  internet connection is down. The public gateway now returns a concise English or
  Spanish unavailable page, with light/dark and phone layouts, a retry link, a
  30-second retry hint and no caching. Clients requesting JSON receive a generic
  error with the same 503 status. Real HTTP and Chromium tests cover failed venue
  responses, lost connections, language/content preferences and all eight visual
  states. Wider route permissions, cloud copies and offline booking acceptance
  remain open.
- Complete self-service recovery onto a replacement server without routine staff assistance.
  The local continuous and verified-snapshot paths now share a matching-code owner
  approval flow. Continuous recovery freezes verified pointer evidence and releases a
  bounded recovery kit; snapshot recovery uses scoped download authority. A separate
  owner-confirmed Cloud replacement issues fresh installation and tunnel keys.
  Production activation remains separate work.
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
  The durable local reconciler now issues and renews both certificate kinds through the
  existing DNS/ACME adapter contract and publishes signed cell routes. Repeat this with
  live provider DNS, production key storage and deployed workers. The signed Cloud
  CSR/chain transport and database staff reconciler are implemented locally; Waitron
  still needs the durable client and automatic install/reload path described in the
  integration contract. The private key remains in Waitron.
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

## Free services for open-source Waitron

Provide address lookup and transactional email delivery to open-source Waitron users
with a Cloud login, without requiring a paid subscription. Keep setup self-service.
These services should make ordinary account and address tasks easier even when a
venue does not subscribe to remote access or backups.

- **Address lookup.** Offer free geographic address lookup and completion to help
  fill out addresses correctly. The [2026-09-30 scope note](address-lookup-scope.md)
  compares provider terms, cost scenarios, Waitron field mapping and account metering.
  Choose the provider only after confirming durable address-storage rights, country
  coverage, measured address quality, licensing, caching and peak-day capacity. Keep
  manual entry and correction available when lookup is unavailable or wrong.
- **Transactional email.** Offer managed SMTP delivery for password resets and other
  account administration emails from on-prem Waitron. Scope the relay to these
  messages, authenticate requests and handle delivery failures and abuse. The existing
  Cloud email transport is a starting point. The [version 1 relay contract](transactional-email-relay-contract.md)
  now scopes installation/account grants, fixed templates, encrypted admission,
  retry versus uncertain acceptance, abuse limits, metering and customer status.
  The disabled local-proof grant and account reservation core is implemented, with
  PostgreSQL concurrency, revocation, rollover and process-restart tests. The trusted
  origin-verifier boundary has synthetic evidence tests only; implement and prove
  production domain/HTTPS verification before enablement. Signed submit/status/cancel
  and an encrypted queue now have opt-in local HTTP/PostgreSQL proof for retries,
  concurrent account reservations, key rotation/loss, cancellation and transaction
  rollback, including admission racing installation revocation/replacement. Normal
  startup keeps the routes absent. The separate local relay worker now handles
  bounded claims, expiry, keyed suppression and terminal ciphertext removal, with
  state/reason constraints. Its loopback-only SMTP proof covers temporary/permanent
  refusal, two-worker fencing, cancellation, key rotation/loss and uncertain delivery
  after disconnect or process death. Normal startup leaves it off. Retention policy,
  authenticated provider suppression events and provider spending controls remain
  open. Shared keyed recipient and stable-grant counters now enforce explicitly
  configured local budgets across independent HTTP processes. Migration 034 accounts
  for actual retained encrypted payload bytes, including sending and delayed work;
  clearing payload releases bytes without refunding message counts. Exact retries
  spend nothing extra. Local PostgreSQL proofs cover races, rollback, key rotation,
  deadline expiry during lock waits, worker cleanup and populated upgrades, including
  interrupted migration and separate pre-upgrade backup restore with external keys.
  See the [admission-bounds design](superpowers/specs/2026-10-12-relay-admission-bounds-design.md)
  and [local acceptance commands](transactional-email-relay-contract.md#exercise-shared-admission-bounds).
  Choose production budgets and recipient-key custody before enablement; normal
  startup still has no relay configuration. The immutable local policy deliberately
  refuses mismatched limits rather than resetting budgets. Policy replacement and
  the operator stop switch remain separate work. Measure admission-lock contention
  before production enablement: status, cancellation and retries share that lock.
  Separately queue Waitron's durable caller/status work before a joint
  local proof.
  Decide provider, processing location, account consent, allowance/debit policy and
  password-reset-limit behaviour before production. The source trace also found
  Waitron's profile-email catch logs raw exception text (`apps/server/src/me-api.ts`
  at `0fbcde001`); actual secret exposure is unverified. The Waitron caller item must
  use bounded diagnostics and test secret-bearing exceptions before integration.
- **Mobile notifications (candidate).** Consider a free allowance for mobile phone
  notifications. Choose the delivery channel and validate its costs before committing
  to inclusion; push notifications and SMS need separate cost estimates.
- **Per-user allowances.** Meter each service against the Cloud user account, enforce
  limits and show usage and remaining allowance. Define the allowance sizes, reset
  periods and behaviour at the limit, including password-reset delivery. Settle how
  venue-generated requests count against an account and prevent multiple installations
  from bypassing its allowance. The relay contract proposes one unit per admitted
  message. Shared account reservations now exist behind explicit local-only policy
  configuration; no production allowance is approved. Policy-version changes require
  a separately specified account upgrade path. Keep provider credentials in Cloud.

Low operating cost is an assumption to validate against provider pricing and expected
usage. Estimate costs and abuse exposure before setting allowances, and apply the
existing Spain-first residency preference when selecting providers. Next: resolve the
[address lookup scope note's](address-lookup-scope.md) storage, quality, cost and
account-allowance gates, then the authenticated email relay; evaluate mobile
notifications separately.

## Decisions in progress

| Decision | Next step |
| --- | --- |
| Customer model | Support an organisation with several legal businesses and tax identities across countries from the outset. A venue belongs to one organisation at a time. Focus signup on one owner with one venue or several venues in the same city; defer the ownership-transfer workflow. |
| Cloud staff access | The disabled-by-default [temporary support grant core](temporary-support-grants.md) now records a current owner's approval for a named, separately eligible platform account, exact configured actions, an optional venue, explicit expiry and early revocation. Transactional enforcement rechecks expiry, the original approver and platform eligibility around protected database work, while fixed audit events omit reason and request data. No route or production action is configured. Define platform roles, eligible permission and action catalogues, customer approver policy and the separately authorised emergency route. Possible on-prem SSH support still requires explicit server approval, a limited period and active-session termination on expiry or revocation. |
| Residency | Spain is the first deployment country. AWS documents the intended `eu-south-2` region, but region availability is not a residency promise. Define the policy for operational data, backups, archives, analytics, identities, logs, keys, messages and support access; map roles, providers, subprocessors, access locations, contracts and transfer safeguards before provisioning or making customer claims. See the [launch evidence boundary](launch-evidence.md). |
| Cells | Venues are independently placed, with a shared gateway per cell and stable customer-facing addresses on movement. The local two-cell workflow now stages a revision-bound destination, cancels a failed apply without replacing the source, requires a tested destination manifest sequence before commit, preserves hostnames/certificates and publishes newer source/destination manifests. Two 2026-09-26 Docker runs reconnected the fresh destination peer in 1,321 ms and 1,486 ms; the second receipt names clean head `e4f9356`, while the other venue stayed source-only. These are not production targets. Define group size, availability-zone layout and recovery-time objective; repeat movement with the selected gateway deployment, provider network, DNS/certificate reconciler and appliance automation. Keep backups and portal recovery independent of gateway machines. |
| Provider support | AWS is the first provider and `eu-south-2` is the verified regional candidate. Select the exact RDS, S3, compute, ingress, DNS, certificate, key and monitoring configuration in the real account; SES currently has no Spain endpoint, so administrative email needs a separately approved relay. Keep Google Cloud Madrid (`europe-southwest1`) as a future target that must pass the same service-by-service gate. Decide separately whether cross-provider failover is wanted. |
| Product packages | Remote access and backups are the initial paid services. Address lookup and transactional account email are planned free services for open-source Waitron with a Cloud login and per-user limits; mobile notifications remain a candidate. Define their release scope, bundles, usage limits, trial terms and cancellation behaviour after modelling operating costs. |
| Usage policy | Define lookup and other usage units, customer visibility, allowances and excess-use behaviour. Decide which measurements affect pricing and how retries, failed calls, cached results and batches count. |
| Waitron boundary | Signup inside Waitron, distinct Cloud and local staff logins, explicit identity linking and an independent Cloud portal are agreed. The signed matching-code exchange now requires live Cloud and local authority, binds one organisation per venue, handles retries and existing links, and issues renewable installation credentials. Keep the versioned contract and compatibility gates current; production configuration delivery, diagnostics and deployment remain open. |
| Server lifecycle | One guided replacement flow covers planned upgrades and server failure, preserving venue, subscription and customer-facing addresses. Use fresh installation credentials, verify restored data before trading, retire old credentials and follow Waitron's activation rules. Specify final-backup handover, concurrent requests, interrupted replacement and a returning old server. Define connection and standalone revocation, including the latter's effects on subscriptions, retained backups and reconnection. |
| Recovery promise | Specify tolerated data loss, recovery time and promotion authority for each service. Existing Waitron designs use human promotion; automation is not approved by this discussion. |
| Backup recovery | Self-service restoration is agreed; staff intervention is an exceptional fallback. Use continuous backups for the latest recoverable version and retained snapshots for archives or missing continuous data. Start with daily snapshots for 30 days, monthly snapshots for 12 months and longer paid retention for selected snapshots. Preserve the last verified snapshot against automatic expiry while subscribed, marking it out of date when backups stop. Use Cloud-managed recovery without a saved owner key; validate the inherited hourly stream snapshot/30-day retention baseline and define verification, schedule details, extended-retention terms and prices, and independent storage/deletion controls. Test recovery with continuous data absent. |

## Platform work to scope

- **Future remote DNS lost-reply browser failures.** The reproduced reconciliation
  stall is resolved by [PR #102](https://github.com/waitron-io/waitron-cloud/pull/102).
  If the saved-name assertion fails again, use the bounded request/status events,
  injection stages and setup-screen diagnostics to identify and reproduce the cause.
  Keep the four-second assertion and fault-injection ordering checks unchanged;
  passing repeats alone do not explain a failure. See [the ordering receipt](#portal-lost-reply-test-ordering).

- **CI execution budget.** You can read one summary job and the individual package
  and receipt jobs to check a candidate. CI runs type checking, each of the five
  existing receipt suites and all eight package suites in parallel, with a
  ten-minute limit per work job. Browser packages install Chromium with at most
  two attempts, each bounded to 120 seconds plus ten seconds to stop it. Main
  pushes use a unique concurrency group per run so a later merge cannot cancel
  an earlier merge's checks; superseded pull request runs still cancel.
  The workflow text guard runs in the typecheck job. Individual test deadlines
  and assertions are unchanged. The previous main
  [run 36878576466](https://github.com/waitron-io/waitron-cloud/actions/runs/36878576466)
  on `741dd7d1241d6b66d32ff711734469741e9c7cb0` spent 14m19s in its single
  job, including 13m04s in `pnpm test`. Registration, backups and account HTTP
  took about 180, 195 and 185 seconds respectively; portal took 155 seconds.
  Aim for about four minutes per job and measure real runs before deciding
  whether a package needs further splitting. This is a working target the
  owner can change. The budget remains separate from intermittent fixture
  failures; more time is not a diagnosis of a failing assertion.

- **Shared UI.** [Waitron PR #519](https://github.com/clintongormley/waitron/pull/519)
  implements `@waitron/ui-core` in Waitron with seven account controls, theme tokens
  and common helpers. Existing `@waitron/ui` imports re-export the same implementation;
  venue controls and brand delivery remain in Waitron. The runtime package depends on
  Lit rather than `@waitron/shared`. A built tarball installs outside the workspace and
  passes declaration, Chromium form, theme and accessibility checks. Both UI packages
  retain coverage and weekly mutation gates. The [approved design](superpowers/specs/2026-09-23-shared-ui-extraction-design.md)
  and [execution plan](superpowers/plans/2026-09-23-shared-ui-extraction.md) record the boundary.
  The [release workflow](shared-ui-release.md) published private `@waitron-io/ui-core@0.1.0`
  from Waitron `0a93f4d3557b669661ac8f589aad866e2cd9653f`. Cloud pins it in its
  manifest and lockfile; a Chromium fixture checks the installed controls and themes,
  and declaration checking uses `skipLibCheck: false`. Local installs use GitHub CLI
  authentication; CI uses its package-read token. The portal now uses these controls for signup, login and recovery. Read the first weekly mutation scores
  after the split in Waitron; the extraction verifies the wiring and coverage, not the
  new full mutation scores. The portal's primary-button hover override in
  `apps/portal/src/styles.css:13` keeps opacity at 1. English/Spanish light/dark
  accessibility checks pass 4/4 with
  `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 test/accessibility.test.ts`.
  A 2026-10-12 Chromium hover probe confirms axe checks the rendered primary button:
  the portal has no contrast violation in either theme, while restoring the shared
  0.85 hover opacity reproduces 3.61:1 in both light-theme languages. The workaround
  is already in Cloud; fix and release the shared hover style in Waitron before
  removing the override or claiming the private package itself is fixed.
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
  Optional passkeys now use discoverable, user-verified WebAuthn credentials. You can
  add or remove one only from a live session with your current password and CSRF proof.
  You can sign in with a passkey without entering an email address, while password login
  and email recovery remain available. Durable five-minute ceremonies are single-use,
  exact-origin and exact-RP checks are enforced, and a real Chromium virtual authenticator
  proves enrolment, sign-in, replay rejection, account isolation and removal in English
  and Spanish. The account page now lists only your live management sessions, marks the
  current one and shows creation, last-use and effective-expiry times. You can revoke any
  session with a CSRF-protected, account-scoped action; uncertain replies reconcile from
  the passive list, and revoking the current session returns you to sign-in. Passkey rows
  show their nullable last-use time. English and Spanish Chromium checks cover phone and
  desktop layouts, stale authority, concurrent logout/revocation, account isolation and
  lost replies. The [bounded history cleanup command](history-cleanup.md) now previews and
  removes ended/expired sessions and consumed/expired WebAuthn ceremonies only after an
  operator supplies exact cutoffs; no retention period or automatic deletion is enabled.
  The disabled-by-default temporary support grant core reuses these separate customer
  memberships and platform permissions. It accepts only configured eligibility permissions
  and actions, binds an optional venue, expires and revokes grants, rechecks authority around
  protected PostgreSQL work and appends redacted immutable audit events. No HTTP route or
  production action is configured. Define the platform role, eligibility and action catalogues,
  customer approver policy, emergency route and any SSH session-termination contract before use.
  The [optional authenticator-app design](superpowers/specs/2026-10-12-cloud-authenticator-factor-design.md)
  has approved email recovery and session policies: password reset keeps the factor, and
  factor changes end every session. Its [implementation plan](superpowers/plans/2026-10-12-cloud-authenticator-factor.md)
  covers storage, account controls and browser acceptance. No authenticator feature is
  implemented yet. Configure live email delivery, implement the approved second-factor design,
  and define the wider platform role catalogue before public use. Shared login/request limits, secure
  cookies and Origin/CSRF checks are implemented in the account API. A local streaming
  reverse-proxy test now exercises two real account instances with overwritten client
  addresses, shared PostgreSQL rate limits, HTTPS cookie attributes, Origin/CSRF,
  declared and streamed body bounds, and the slow-body deadline. Validate the selected
  production ingress, TLS and bot controls before deployment. Choose
  legal and operational cutoffs for sessions, signup requests and password-reset requests,
  including reset records for unknown addresses, and measure the dry-run counts against
  the expected deployment size before applying them. Signup and password-reset completion now use an optional
  screening interface with a one-second failure deadline. Packaged production-server
  startup requires an explicitly supplied local
  SHA-256 corpus; compromised passwords are rejected in English and Spanish without
  consuming the link, and unavailable screening leaves credentials and sessions unchanged.
  No password or complete digest is sent externally. Choose, verify and operate the
  production corpus update source; any external provider still requires a separate
  processing-location and residency decision.
  Rejected portal URLs now keep their exact 400, 404 or 405 status and show a bounded
  English or Spanish error page. An expired session has its own fixed API code and a
  bilingual sign-in explanation, while an admitted request during service shutdown gets
  a distinct, retryable bilingual outage page. New connections can fail at the ingress,
  so deployment-wide outage presentation remains an ingress responsibility.
  Browser coverage completes a real Spanish password reset from a legacy query-token
  link and proves the token is scrubbed before later requests. Before public use, decide
  whether to accept tracking queries and trailing-slash/case aliases. The current exact
  routes and query restrictions follow the approved portal plan.
  Set the retirement point for legacy query-token links after every deployed sender
  generates fragments and all remaining query tokens have expired; retain compatibility
  until then. Direct development-mailer rendering failures now become rejected promises,
  matching the mailer interface; a regression reproduces the former synchronous throw.
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
  Separately supplied email keys now have a read-only dependency and decryption preflight,
  plus a local restart drill and documented rotation/restore order. Choose and operate the
  production key store, and retain each database backup's matching key set. A send timeout
  or crash after provider acceptance may duplicate an email. Terminal delivery metadata
  has an explicit cutoff category in the cleanup command; choose its production cutoff.
  Immutable customer security events now cover pairing approvals, installation credential
  renewals/revocations and recovery/replacement approvals in the protected action's
  transaction. Current organisation owners can export stable cursor pages through the
  exact session/Origin/CSRF-checked API; the fixed event shape stores no request payloads.
  This operational trail is not a complete compliance archive. Audit retention and
  account-deletion handling remain separate from transient cleanup. The HTTP adapter applies
  a 300 ms response floor to login/email requests, but deployment timing and load
  measurements must still assess account/cooldown differences under contention.
  Its rate key must be shared across instances; rotation starts new allowances.
  Login now checks its IP allowance before charging the email allowance, so an
  already-blocked IP cannot spend another person's address allowance. Admitted
  attempts across IPs can still exhaust an address allowance; assess targeted
  lockout mitigation with the public ingress policy before launch. A bounded local
  two-instance contention run admitted exactly 10 of 12 same-IP logins and 30 of 31
  same-address logins; the final correct-password attempt was refused. Across two
  isolated runs, eight concurrent scrypt hashes took 23 to 52 ms each on an 18-core
  Apple M5 Pro, while known and unknown failures remained above the 300 ms response floor.
  The counters did not overshoot, and eight concurrent password-reset requests queued
  one message under the shared cooldown. Keep these as local measurements, not
  deployment promises. Targeted address-lockout mitigation still needs the ingress
  policy rather than a blind quota change.
  HTTP tests now accept a password at exactly 1024 UTF-8 bytes, reject 1025 bytes
  without consuming the signup token, and reject a declared body over 16 KiB before
  an incomplete client finishes sending it. Deleting both independent password guards
  breaks the boundary test; deleting only the HTTP guard remains masked by the store's
  defence-in-depth check. Deleting the declared-length guard breaks its early-refusal test;
  the separate streamed-body bound remains covered.
  Review the inherited password cost for deployment. The [identity source review](identity-upstream-review.md)
  classifies every mapped Waitron source and test change through `b9440c685e44`.
  Cloud already covers generic refusals, asynchronous password checks and hashed sessions;
  registration now pins the offered and accepted passkey algorithms, with real-library
  regression tests. Run `node scripts/identity-upstream.mjs ../waitron` for later changes.
  Browser credential synchronization and passkey provider-name display remain optional follow-ups.
  Further reuse should take code and
  behavioural tests from `pre-sqlite-migration`, pinned to
  `c9d80c59a30ab1ae7a4acc0a6999e6a342de924e` in the registration plan. Adapt its
  PostgreSQL schema and dependencies; add cloud memberships and permissions for
  organisations that can contain several legal businesses across countries. Include Cloud staff logins
  and explicit links between distinct Cloud and local identities; local till staff
  need no Cloud account. Support one Cloud login managing several authorised venues
  and separate platform permissions. The temporary support-grant core now implements
  customer approval, configured eligibility, expiry, early revocation and redacted
  immutable events, with every action disabled by default. Define the platform role and
  action catalogues, emergency authorisation and the audit events not covered by the
  customer security trail before enabling it. Review
  database and module dependencies. Keep the source review current and port applicable
  security fixes with failing regression tests in each affected repository.
- **Subscriptions and billing.** Service catalogue, checkout, invoicing, permitted
  services, usage accounting, trials, failed payment and cancellation.
- **Venue and node registration.** The agreed Waitron signup and connection journey is
  implemented locally. The Cloud account backend creates a new customer's organisation
  and first legal business. Signed matching-code pairing requires current Cloud approval
  to add venues and current local administrator approval, supports one person holding both
  permissions, enforces one organisation per venue, and handles existing links, renewable
  installation credentials, replacement and revocation.
  Keep venue identity stable across replacement and issue fresh installation credentials.
  Test that restoring data alone does not grant primary authority and that a returning
  old server follows Waitron's recovery rules. Cloud revocation alone does not establish
  that an offline server has stopped trading.
  The shared replacement flow for planned upgrades and failure recovery is implemented
  locally. Add the final-backup handover after stopping writes during a planned move.
  Failure recovery already shows the selected snapshot time or continuous recovery
  point and potential data loss. Approval requires confirmation that the old server
  is unavailable and acceptance of data loss; replacement separately requires explicit
  confirmation. PostgreSQL and HTTP refusal tests cover the server-side checks in
  `packages/backups/test/recovery-request.test.ts` and `replacement.test.ts`.
  These confirmations do not prove an offline server has stopped trading. Preserve
  Waitron's recovery rules; production activation and route-switch interruption
  checks remain open.
  Registration persistence now records bound approvals and results with transactional
  completion, expiry, retries, permission rechecks and separate service states. Real
  PostgreSQL tests cover concurrent workers and process restart. The Cloud pairing verifier and HTTP exchange now bind Ed25519 installation proof,
  matching code and session-backed approval, with durable guess limits and retries.
  The Waitron adapter and both browser screens now connect two real SQLite installations
  in the local integration runner. Renewable signed control leases and key proofs now
  authenticate machine operations; owner or local-manager revocation records its actor,
  reason and result. Desired revisions and stale health remain separate. Scoped storage/gateway adapters and owner-confirmed test-snapshot replacement are implemented locally; production rollout remains open. The owner approved matching-code confirmation between
  signed-in local Waitron and Cloud. The [pairing contract](superpowers/specs/2026-09-23-venue-pairing-design.md) fixes
  proof format, expiry, attempt limits and binding. Local tests refuse swapped installation
  proofs and recheck manager permission and serving-primary status after network waits. Installation history now retains superseded rows with one current installation per venue. Replacement binds the restored local venue and source node to the approved snapshot, uses fresh keys and has separate local-manager and Cloud-owner confirmation. Ordinary pairing refuses an unrelated installation, including a revoked current one. Expand diagnostics and planned-handover support before production rollout.
  Before public exposure, choose exact retention cutoffs for installation operation
  results and pairing requests, and define revocation-audit retention separately.
  The cleanup command handles completed/expired pairing and registration results in
  bounded chunks but enables no category automatically. Pairing approvals, credential
  renewals and revocations now have immutable customer audit events. Installation lease
  consumers now accept an operator-configured overlap of old and new issuer public keys,
  while new leases use only the active private key. The local control-plane outage drill
  proves overlap, cutover, expiry-before-removal and revoked-lease refusal without logging
  keys. Choose audit retention, rehearse the coordinated rotation in the selected deployment,
  and measure per-IP denial-of-service behavior
  for venues sharing NAT and known request IDs. Pairing codes now use versioned, request-bound keyed verifiers with an external
  secret and an explicit legacy upgrade; see [key configuration and rotation](pairing-code-keys.md).
  PostgreSQL/HTTP tests cover preserved approvals/history, restart, expiry, concurrent
  guesses, request binding and key overlap/refusal. Local business confirmation stays
  required. Old backups remain sensitive; no new retention policy is chosen.
  Backup-recovery request codes now have their own independently configured,
  request/machine-bound keyed verifier and explicit legacy upgrade; see
  [recovery key configuration and rotation](recovery-code-keys.md). PostgreSQL/HTTP
  tests cover storage, cross-request reuse, machine retry/status, owner approval,
  five concurrent-guess limits, expiry, process restart, rotation, absent/wrong keys
  and preserved pending/completed history. Upgrade rollback, bounded batches and
  row-lock waits and the actual CLI lock timeout are exercised; HTTP/CLI/audit
  checks disclose no code or secret. English/Spanish recovery browser tests pass.
  Before production, provision the separate keys, execute the stopped-writer upgrade
  and apply the existing retention policy to legacy backups. External proxy logging
  and production secret custody remain deployment responsibilities.
  Terminated database connections and lost replies have regression tests. The
  [local management-database recovery drill](database-recovery.md) now uses separate
  non-superuser migration and runtime logins plus a replication-only login. It takes a
  physical PostgreSQL 18 base backup, waits for a streaming standby to replay the named
  recovery point, stops the primary and promotes the standby. The clean 2026-09-27
  receipt at Cloud `072b2c0` confirmed zero lag at that point, a 158 ms local promotion
  and a 934 ms local outage on that run. It recovered the exact result and lease after a discarded
  committed reply, reclaimed an interrupted worker message once, preserved both tenants
  and rejected a crossed installation proof. These are fixture measurements, not service
  objectives. Repeat the drill with the selected provider's deployment credentials,
  backups, replication, routing, monitoring and realistic data volume before launch.
  Pairing and replacement now use venue locks compatible with monitoring's incident
  inserts. PostgreSQL race tests run the real monitor worker while a new pairing
  request waits on its installation lock: matching keys retain the existing link,
  and different keys return a registration conflict while the incident commits.
  A real PostgreSQL probe of two approved operations sharing one key and a genuinely
  new venue completed with one shared link, so the proposed race was not reproduced
  and gained no speculative regression. The adjacent existing-but-unlinked venue path
  did expose a coverage gap: a new test pauses the first installation insert, and
  deleting the venue lock reproduces a `registration_conflict` in the second operation.
  A separate bounded abuse run admitted exactly 10 of 12 concurrent new pairings behind
  one shared address across two API instances. Five guesses with unrelated UUIDs did not
  spend the target request's failure budget; five concurrent wrong codes against its
  known UUID serialized to five and closed it. That known-ID denial remains a deliberate
  guess-limit trade-off. Keep request UUIDs out of logs and choose ingress or reissue
  mitigation before changing the five-attempt rule.
- **Provisioning and placement.** Use Kubernetes for orchestration when needed;
  cluster provisioning and manifests are deferred until there is a service to deploy
  and a concrete operational need. Country/provider/cell registry, repeatable resource
  creation, recovery from partial failures, capacity and customer movement. The local
  movement state machine now reserves a destination without replacing the source, rejects
  competing/stale operations, retains durable retry results and revokes the old route only
  after the destination manifest was applied and tested. The two-cell proof preserves the
  venue's hostnames and certificate fingerprints, isolates the other venue and measures
  fresh-peer reconnections of 1,321 ms and 1,486 ms; it also proves failed-apply cancellation leaves the
  source healthy. The local DNS/certificate reconciler now preserves usable material,
  fences stale external work and republishes signed routes after restart. Repeat the full
  path with provider-native cells, live adapters and appliance configuration before
  choosing an explicit recovery-time target.
  Define how established connections and
  backups continue during a portal outage, including credential expiry and revocation.
  The [local control-plane outage drill](control-plane-outages.md) now stops the real account
  API process while a gateway HTTP route and TLS SeaweedFS transfer continue under their
  existing signed authority. It proves that cached gateway restart does not extend expiry,
  expired storage credentials are refused, recovery restores management access and a fresh
  manifest removes a revoked route. Repeat the drill with the selected deployment database,
  gateway reconciler and provider-native storage before setting an availability promise.
- **Provider integration.** Storage, compute, email, notifications, jobs, keys and
  telemetry, with AWS and Google implementations where needed. The local SeaweedFS
  storage contract now covers venue-scoped access, live key rotation, issued-credential
  expiry, versioning, interrupted uploads and concurrent conditional create/replace.
  Repeat those checks with provider-native credentials against each selected live store.
- **Operations.** The [local operations status](operations-status.md) now combines
  control API liveness/readiness, queued work, monitoring, gateway, snapshot and usage
  evidence into versioned JSON, readiness exit states and low-cardinality Prometheus
  metrics. It reveals fixed component codes without tenant, provider or raw failure
  details. The [reproducible local deployment](local-deployment.md) now packages the API,
  durable workers, PostgreSQL, Mailpit, TLS object storage and empty-route gateway in one
  loopback-only Compose stack. Its executable receipt proves clean installation, restart,
  same-schema image recreation, 26 migrations, stable generated identity, retained database
  and storage markers, and exact-project cleanup. The [database recovery drill](database-recovery.md)
  separately proves a physical standby promotion under restricted local credentials, exact
  operation replay, worker-claim recovery and tenant isolation, with zero owned resources
  left after the run. Production deployment, provider selection, public ingress, secret
  custody, provider-native database recovery, automated failover,
  realistic recovery objectives and provider-specific recovery across incompatible schemas
  remain open. The [schema upgrade rehearsal](local-deployment.md#rehearse-a-schema-changing-upgrade)
  now covers pinned revisions 9a56d012 (26 migrations) to eafd97ad (27), interrupted
  migration rollback/retry, stopped-consumer schema gates, identity/tenant checks, pending
  mail and completed-operation retries, and isolated recovery of the old version from its
  pre-upgrade logical backup with matching external keys. The original upgraded fixture is
  preserved. Historical binaries require the current deployment gate; no online upgrade,
  downgrade migration, post-backup-write recovery or production traffic switch is proved.
  The physical standby drill reads its expected migration count from
  the release manifest for both migration and runtime logins. Focused tests cover
  complete manifests of different sizes, missing migrations and extra migrations.
  The original 2026-09-27 promotion receipt above remains historical; the new drill
  receipt is recorded in [database recovery](database-recovery.md). This remains
  separate from logical-backup recovery.
  Customer and operator portals, audit, budgets,
  quotas, staged releases, maintenance and recovery controls remain broader work.
  Customer portal login and account recovery must work when the venue server is
  unavailable, so customers can manage services and recovery independently.
- **Self-service journeys.** Define completion and failure paths for setup, account
  and billing changes, diagnostics, restore and cancellation. Verify customers can
  complete routine flows without staff, including recovery from interrupted operations.
  Give exceptional failures useful diagnostics for investigation under the support policy.
  Account security is now self-service: the portal shows active management sessions and
  passkey last use, identifies the current session, and lets you revoke a session without
  staff access. It refreshes the list after every attempt so a lost successful reply does
  not encourage a second write. Owners can now download a versioned diagnostic for one
  installation. It reports redacted access, service, monitoring, remote-check and backup
  evidence without account, provider, hostname, configuration, credential or raw-error
  data. Stale health is shown as unknown and the permission is rechecked before release.
- **Service monitoring.** Check representative operations from outside the affected
  cell; track errors, response times, queued work, backup freshness and capacity.
  The [local monitor](local-monitoring.md) now records missing contact, stale snapshots
  and failed verification for configured test installations. The portal shows incident
  evidence and stale monitoring; owners can opt in to English/Spanish email alerts.
  Durable transition records prevent repeated scans from enqueueing duplicates, with
  live ownership/preference checks before delivery and recovery notices for prior
  recipients. Queued notices use the current email language. Locked installations and
  failed observations defer their next check while other venues continue. SMTP uncertain-acceptance duplicates remain possible. A separate bounded
  functional probe now derives current authorised placements, solves the real public
  challenge, verifies staff TLS/hostname trust and persists revision-bound evidence
  with certificate validity while refusing private production targets. The monitor rejects
  late results after hostname changes, replacement or revocation, treats stale evidence as
  unknown, and records deduplicated route-failure, certificate-expiry and recovery
  transitions independently from installation contact. The local two-venue gateway proof
  now persists real observations while breaking one venue route and the whole gateway,
  proves recovery, stale/invalid-certificate handling, current control contact, portal and
  Mailpit evidence, cross-venue isolation and delivery deduplication, and emits a versioned
  timing receipt. A mature unchanged local WireGuard peer recovered from gateway replacement
  after about 111 seconds at its normal rekey window; choose and prove a launch recovery target and any
  faster peer-side rekey strategy before making an availability promise. The portal now shows
  separate redacted public/staff evidence and certificate warnings in English and Spanish.
  Opted-in owners receive bilingual remote
  incident and recovery messages; delivery rechecks route authority, and opt-out or
  revocation suppresses queued mail. Current incident and observation tables are bounded
  current-state projections; terminal delivery links follow the explicit cleanup cutoff.
  The local worker-scale receipt now separates scheduling from polling, runs scheduling
  once a minute, bounds monitor/email claim batches at four and batches encrypted alert
  insertion in groups of 100. On an Apple M5 Pro with 18 logical CPUs, its 1,000-venue/200-recipient
  fixture reduced monitor processing from 7,030 ms with 1,001 sweeps to 2,335 ms with one,
  queued the bounded incident fan-out in 24 ms and reduced delivery backlog lag from
  1,558 ms to 477 ms. A 103-recipient PostgreSQL test enforces two inserts per table.
  Locked venues, restart completion and shutdown fencing remained intact. These are local
  measurements, not capacity promises. The aggregate operations command now surfaces
  the current worker queues and evidence projections through JSON, a readiness exit code
  and bounded-label Prometheus metrics. An opt-in local Compose collector now runs
  the same inspection on a bounded schedule, exports collection timestamps and failure,
  and suppresses expired or failed samples. It checks the full migration ledger
  before each inspection and uses read-only transactions. Production collection,
  retained time series and alerting remain open. The 2026-09-30 local
  [collection receipt](receipts/2026-09-30-operations-collection.json) proves healthy/degraded
  changes, migration-digest refusal, database outage/recovery, restart and read-only
  write refusal, with 26 label combinations and empty project cleanup.
  Next: choose the terminal-delivery cutoff, repeat the receipt and aggregate checks in
  the selected deployment environment, and add external representative checks,
  escalation/quiet periods and rollout pause criteria.
- **Usage metering.** Cloud now records immutable organisation-scoped events for
  snapshot storage and transfer, completed installation operations, accepted monitoring
  probes and terminal administrative alert outcomes. Bounded reconciliation repairs
  interrupted durable-source writes, stable source identities suppress duplicates and
  cleanup preserves sources until their events exist. Owner-only portal totals retain
  exact decimal precision, show measurement freshness in English and Spanish and state
  that continuous-stream bytes and account identity mail are excluded. PostgreSQL and
  browser tests prove retry rollback, tenant isolation and fresh/incomplete views. This is
  observational only. A bounded watch worker now runs in the local deployment, retries
  failed passes and exposes stalled progress through existing operations freshness.
  PostgreSQL CLI tests cover competing workers, rollback/interruption, restart catch-up,
  tenant totals and shutdown. A clean local Compose proof on 2026-09-29 recorded two
  organisations automatically, reported all four sources stale after stopping, and
  caught up a third organisation after restart; its project containers, volumes and
  network were removed. This proves local scheduling, not a production freshness
  objective. The extended Compose proof now holds the final source's PostgreSQL row
  lock and stops the service with earlier writes still uncommitted. On 2026-09-29,
  it exited normally in 9,657 ms within the 15,000 ms Compose grace period, left
  committed events and every source timestamp unchanged, then caught up two new
  organisations without duplicates. The ten-second transaction deadline remains;
  extending both database deadlines in a disposable copy made Compose kill the
  worker (exit 137), which the proof rejected. Project cleanup was empty.
  Production deployment and monitoring remain open. Next: add
  attributable lookup/API, report and compute units when those services exist, measure
  provider costs, then define allowances, excess-use and metering-outage policy before
  connecting any total to billing or enforcement.
- **Data lifecycle.** The internal managed-backup catalogue now protects the latest
  successfully verified snapshot (or newest snapshot when none has verified) and active
  recoveries, with automatic operation expiry, resumable deletion and
  30-day daily/12-month monthly expiry. PostgreSQL tests cover failures and races.
  Versioned managed keys and bound owner recovery are implemented for local test venues;
  [the real snapshot proof](local-backups.md) runs Waitron validation and restore hooks.
  The local worker now schedules real restore verification, retention and abandoned-upload
  cleanup with durable claims, lease fences and bounded retries. Captures expire after
  24 hours; cleanup waits another 16 minutes and keeps tombstones. PostgreSQL tests cover
  concurrent workers, lease takeover and restart; the two-server proof uses this queue.
  The [authenticated capture adapter](authenticated-captures.md) now uses bound installation proofs,
  scoped upload grants and authority checks after storage waits. Waitron now schedules daily
  captures, assigns monthly retention to the first successful capture of each venue-local
  month and persists one encrypted archive for exact retries across restart. The file
  uploader streams with a 14-minute/credential-expiry deadline and bounded retry backoff;
  deliberate shutdown is not an outage. The local proof crashes after upload and restores
  the resumed snapshot without recapture. Cloud now stages provider downloads to private files
  while hashing and length-checking them, reopens the immutable stage for conditional upload
  retries, and streams verification into the isolated Waitron restore process. A 32 MiB local
  SeaweedFS fixture on an Apple M5 Pro observed 5,975,936 bytes of peak ArrayBuffer growth and
  26,968,064 bytes of RSS growth. Archive assembly in Waitron still uses its existing format and
  the end-to-end 512 MiB archive limit remains unchanged. Confirmed uploads retry publication without resending; loss of an
  acknowledged storage object waits until capture expiry before recapture. A reproducible
  4 MiB controlled-HTTPS receipt now measures throttled upload/download retries, 120 ms
  deadline cancellation, partial-stage cleanup, missing objects, one-copy publication replay,
  credential renewal with one durable archive and shutdown through a controlled Waitron archive
  wait. Cloud download cancellation now releases its durable verification claim without recording
  failure or consuming a retry. These are local boundary measurements, not production timeout or
  bandwidth targets. The capacity fixture adds a disk-backed two-venue TLS profile
  at 32, 128 and 512 MiB per venue, with signed credential isolation, interrupted retries,
  digest/length checks, cancellation and exact fixture cleanup. Its version 2 receipt
  records per-size resource preflights/skips, transfer times and sampled process memory
  and scratch/disk peaks. CI exercises the boundary cases at 1 MiB; larger runs stay
  explicit. See [the capacity guide](local-backups.md#measure-local-transfer-capacity).
  The [clean-commit measurement](receipts/backup-capacity-2026-09-30.json) ran all three
  sizes; the guide records the observed times and resource peaks. Provider policies
  and real Waitron archive assembly remain outside this fixture.
  Next: measure deployment uplink bandwidth, spool volume and real database/
  encryption shutdown latency, stream Waitron archive assembly/restoration before reconsidering the current 512 MiB bound,
  production master-key custody/rewrapping and production-host verifier hardening. The
  process verifier denies network, subprocesses, native addons, host reads and outside
  writes. The container adapter adds a disposable container around the deployed
  verifier with total memory, swap disabled, aggregate scratch, no network or host mounts, and ownership cleanup.
  Real Docker fixtures exhaust native memory (192 MiB) and scratch (16 MiB); the parent
  survives and verifies later work. Two real Waitron snapshots at revision
  `00496fcd182a5c2c9189cc3faf0f8f22d3baf8ac` restore with 1024 MiB memory and 256 MiB scratch.
  See [the containment receipt and limits](backup-verifier-containment.md).
  Container-test image preparation has a separate 150-second setup budget around its
  120-second Docker command limit; individual test deadlines and containment assertions
  stay unchanged. A controlled 31-second build delay reproduces the former setup timeout.
  Production host/kernel isolation, hostile native exploits, fleet sizing and large archives remain
  unverified; the process-only development adapter still lacks these total-resource bounds.
  The verifier distinguishes bounded infrastructure failures from archive verdicts:
  failed staging, Docker start/connection, cleanup and verifier protocol errors preserve the prior snapshot
  state and retry with `verification_unavailable`. A real local PostgreSQL stop/restart,
  worker-only Docker connection outage, start refusal and two-organisation valid/invalid
  recovery tests pass. Eight-attempt exhaustion, explicit retry, cancellation, lease fencing
  and verified fallback protection remain covered. See the containment guide for the exact
  executed cases; shared-daemon loss during active cleanup, physical host crashes and
  production recovery timings remain unmeasured.
  **Open: intermittent container-worker verdict.** [CI run 36702956368, attempt 1](https://github.com/waitron-io/waitron-cloud/actions/runs/36702956368/attempts/1)
  expected a failed archive check but found it pending. Its cause remains unresolved:
  local and Ubuntu probes have not reproduced it. [PR #99](https://github.com/waitron-io/waitron-cloud/pull/99)
  adds verifier outcome, fixed Docker failure details and queued-job state to the
  unchanged test assertion; a controlled start-refusal experiment reports
  created state, attach exit 125 and `verification_unavailable`. This is diagnostic
  coverage, not a fix. The temporary stress workflow is removed. On the next natural
  failure, use those details to identify the failing boundary, reproduce it and fix
  its cause while preserving the distinction between infrastructure uncertainty
  and an invalid archive. Passing probes do not close this defect.
  **Concurrent reclamation tolerates an already removed container.**
  Deterministic Docker fixtures remove a listed container before inspection or
  removal; a missing result during active verification still raises infrastructure
  failure. Exit 1 with the exact missing-object/container diagnostic naming that
  ID is tolerated. Reclamation retries an exact removal-in-progress diagnostic
  within one ten-second removal budget, refusing a removal that never finishes.
  Daemon errors, another ID and a different exit code remain
  failures; raw daemon text is not exposed. The existing deadline and foreign-owner
  test passes unchanged. Shared-owner and isolated-owner lifecycle probes each
  complete 12 calls, with four successful restores and eight expected resource
  refusals. Three further rounds with ten expired containers and two reclaimers
  each finish without errors. This fixes the concurrent reclamation failure; it
  does not resolve the sequential worker-test failure above. Continue assigning distinct worker owners;
  these local probes do not establish production concurrency capacity.
  A read-only
  dependency inventory and local drill now prove active-key rotation, old snapshot restore,
  worker restart and wrong/missing-key refusal without exposing secrets or deleting keys.
  The history cleanup command
  now removes completed jobs and already-deleted tombstone metadata in bounded chunks
  after exact operator cutoffs; pending/running/failed jobs, current points, protected
  snapshots and recovery references remain. Choose the production cutoffs before use.
  A reproducible 1,000-venue local fixture now measures scheduling separately from job
  polling. It reduced 1,000 repeated empty backup sweeps from 3,602 ms to one 5 ms cadence
  sweep while preserving the 100-row query bound. Repeat this with the selected database
  topology and deployment-sized venue distribution before setting worker counts or
  scheduling objectives.
  The local two-venue proof now exercises Waitron's stream, sealed recovery kit and
  cold-restore contracts. Production still needs dynamic writer/reader credential
  delivery, rotation and revocation; the selected provider's prefix and conditional
  write semantics; measured continuous retention; monitoring and scheduling; and the
  planned final-write handover before activation.
  Retention, restore checks, export, deletion and access review;
  define what survives subscription termination and for how long.
  The catalogue implements daily retention for 30 days and monthly retention for 12 months.
  Longer paid retention for selected snapshots remains to be implemented. Daily timing follows the venue business-day cutover with stable jitter; the first successful
  capture per local month gets monthly retention, and missed runs make one current copy.
  Validate storage costs before pricing.
  Validate the inherited continuous-backup retention baseline. Protect the last verified snapshot from automatic
  expiry while the backup subscription is active. PostgreSQL tests already prove
  failed verification preserves the verified fallback and cleanup resumes after
  storage deletion fails, including concurrent cleanup. Run the focused cases in
  `packages/backups/test/worker.test.ts` and `catalogue.test.ts`; repeat these
  failure boundaries against the selected provider. Explicit deletion and
  cancellation policies remain open.
  Carry forward the existing topology's proposed hourly stream snapshots and 30-day
  stream retention as a baseline to validate. Productionise the implemented internal Cloud-managed recovery-key
  custody and authorised delivery, respecting the existing external vault-key design.
  The local integration now uses the contract's mapped backup contents, manifests,
  module restore hooks and per-secret handling against the landed SQLite interfaces;
  repeat those boundaries with the selected provider.
  The local key drill and two-venue recovery proof test rotation with retained snapshots
  and recovery after loss of the original server without an owner-held backup key. See the
  [existing-design reconciliation](documentation-ownership.md#backup-and-recovery-design-reconciliation).
  The version 3 recovery-boundary receipt now proves the landed consumers rather than
  the older proposed identity split: both stream and archive restore recover the source
  local node ID and run Waitron's restore hooks, while replacement registers a distinct
  Cloud installation with fresh machine authority. It restores an older key-version
  snapshot after rotation, restores the separate application vault state byte for byte,
  and inherits no backup destination, Cloud credential or staff TLS material.
  `BackupManifest` v1 needs no change for this managed path. A future hosted target with
  an external application-vault key remains blocked on the named
  `external-vault-archive-v2` compatibility contract and explicit on-premises re-encryption;
  an ordinary backup download does not satisfy either requirement.
  Owner-approved recovery and replacement now append immutable customer audit events and
  current owners can export them in stable pages. Before production, choose the
  recovery-request/result cutoff, audit retention and account-deletion handling. Closed
  expired recovery history now has a separate cleanup category that
  preserves active operations and incomplete replacements. A bounded two-instance run admitted exactly 10 of 12 concurrent fresh-key
  recovery starts behind one address. Guesses using unrelated UUIDs left the target's
  budget untouched; five concurrent wrong codes against a known UUID serialized to five,
  closed the pending request and refused its later correct code. Treat that availability
  cost as an ingress/request-reissue decision, not a reason to raise the guess allowance
  blindly. Recovery codes now use a separate external key, as described in
  [the upgrade and rotation instructions](recovery-code-keys.md).
  Keep completion reports separate from activation, and test deployment-scale transfer
  interruption, expiry and cancellation against the selected provider. Restore verification is
  separate from upload freshness; production workers still need enforceable resource and
  network isolation, without activating a primary or contacting fiscal/payment services. Define the external-key format extension
  rather than assuming it exists in the inspected manifest v1.

## Portal lost-reply test ordering

- **Resolved: reconciliation stalled after the reply was dropped.**
  [CI 36777640375](https://github.com/waitron-io/waitron-cloud/actions/runs/36777640375)
  on `ab5161d4af0fc41aad83c99ce22de80035b2e027` failed both English journeys
  at the four-second saved-name wait (portal 110/112). PR #102 subsequently reproduced
  the browser-side stall and retained the apply interceptor through reconciliation,
  as described below. [The fix's exact-merge CI](https://github.com/waitron-io/waitron-cloud/actions/runs/36851962407)
  passed on `3085054b8d82698ec3e8f420ade798957df2d9a8`.
  [PR #103](https://github.com/waitron-io/waitron-cloud/pull/103) includes the fix;
  [its rebased-head CI](https://github.com/waitron-io/waitron-cloud/actions/runs/36855902107)
  passed on `7b5cdb1f50449e4a9c2d50e59f757aa1c1cd8716`.
- The remote-DNS journey waits until its fixture has dropped a successful apply
  reply before starting the four-second saved-name assertion. Previously that UI
  wait also timed the fixture's forwarding and fault injection. A controlled
  4.5-second hold after the committed HTTP 200 reproduced the timeout while the
  browser was still waiting for the reply; the same case passes after the explicit
  injection acknowledgement. The English/Spanish journeys keep every existing
  assertion, and the delayed-injection case guards the ordering. A separate
  30-second fixture deadline fails with diagnostics if interception never completes,
  so the browser and database can close even when the route does not match.
- The failure in [CI 36738638444](https://github.com/waitron-io/waitron-cloud/actions/runs/36738638444)
  predates these diagnostics, so you cannot attribute that historical failure to
  this mechanism with certainty. The test records bounded request/status events,
  injection stages and the setup screen if it fails again. Investigate any new
  failure from that evidence; a passing repeat alone does not establish its cause.
- The bounded Ubuntu probes reproduced the newer status stall in
  [run 36846155539](https://github.com/waitron-io/waitron-cloud/actions/runs/36846155539)
  and [run 36846703454](https://github.com/waitron-io/waitron-cloud/actions/runs/36846703454).
  Both failures followed a committed apply and completed abort. The browser emitted
  the status request, the server never received it, and the database was idle.
  The second probe recorded interception being disabled after the abort. Keeping
  the apply interceptor until the saved-name assertion completes makes the status
  read pass through interception before teardown. Chromium's internal reason for
  stranding the request during teardown remains unverified. The separate delayed
  status control still fails at four seconds, so a genuinely slow read is not hidden.
  [The fixed probe](https://github.com/waitron-io/waitron-cloud/actions/runs/36847208929)
  passed all 18 English, Spanish and delayed-injection journeys; each status read
  was explicitly continued before interception was disabled. Temporary Ubuntu
  workflows, control switches and protocol tracing are removed.

## Initial services and future candidates

| Service | Design work still needed |
| --- | --- |
| Remote access (initial) | The local two-venue adapter, operator commands and durable route/certificate reconciler are implemented; see [the executable proof](local-remote-access.md). Customer setup screens expose assigned names, revision-bound custom DNS changes and readiness. The local worker has explicit per-cell/per-certificate mappings, bounded leased retries, atomic publication and stale-work fences; it reuses Waitron's CSR/install interface without taking its staff private key. The signed version 1 Cloud CSR/chain exchange and optional database staff worker now have a two-owner Pebble/HTTP/Waitron CLI proof. Live provider DNS/ACME credentials, production key storage and deployment, plus Waitron's durable exchange client, local stale-result checks and automatic install/TLS reload remain open. Public HTTPS terminates in Cloud for bot inspection; staff uses a separate hostname with TLS passthrough and network controls. Share a gateway within each cell, with separate venue tunnels and credentials. The [2026-09-30 two-venue receipt](receipts/public-gateway-limits-2026-09-30.json) records 16/16 solved calls, 31 challenge responses and 49 connection refusals in an 80-connection burst, plus four successful B calls within 14.1 ms while A timed out. The bounded public gateway profile now measures shared-source request and connection refusals, shared upstream saturation, challenge expiry and failure recovery, with two-venue credential/path isolation and a versioned cleanup receipt. The unchanged per-IP request budget and global upstream slots can refuse a legitimate other-venue caller. Choose per-venue fairness and legitimate automated-client handling; production traffic, carrier false-positive rates and multi-gateway coordination remain untested. See the public traffic profile in the remote-access guide. Implement the preferred local DNS overrides with router-specific setup and offline/recovery tests. Decide the bootstrap role of waitron.local. Temporary unavailability while the venue is offline and short interruptions during cell replacement are accepted; define and test the cell recovery-time target. |
| Backups (initial) | Guided continuous and verified-snapshot recovery are implemented for local test venues. The two-venue proof restores an exact Litestream database head after interruption and restores a verified snapshot after deleting its continuous source. Production still needs provider credential lifecycle, retention and monitoring checks, planned final-write handover and safe Waitron activation. |
| SQLite snapshots (initial backup service) | Retain daily snapshots for 30 days and monthly snapshots for 12 months, with longer paid retention for selected snapshots. Each must remain restorable if continuous backup data disappears. Protect the last verified snapshot from automatic expiry while subscribed; verify a newer copy before replacing it and show stale backup health. Define schedule details, consistency, extended-retention terms and prices, and independent storage/deletion controls. Explicit verified-snapshot selection and restoration with continuous data absent are proved locally; run the same flow against the selected production provider. |
| Failover to cloud | Allocate a replacement instance, coordinate promotion with Waitron, connect devices, stream the new primary and support return to the venue. |
| Hosted Waitron | Provision isolated operational instances, local print connectivity, upgrades, capacity and cloud-only recovery. |
| Bookings and public pages | Initial remote access may be unavailable while the venue is offline. Future independent cloud hosting needs rules for accepting reservations and synchronising them with the venue; include menus, ordering and payment-page candidates. |
| Invoice archive | Define the archived objects and access grants, including owner-approved AEAT/advisor access, retention, download and customer exit. Have hosting/archive questions reviewed for the launch country. |
| Analytics and reports | Choose ingestion, supported source versions, country and cell placement, search/aggregation engine, scheduled reports and group reporting. Elasticsearch is a candidate. |
| Multiple venues | Define group visibility, permitted changes and how central catalogue/configuration changes are delivered and acknowledged. |
| Address lookup (free) | [Scope researched on 2026-09-30](address-lookup-scope.md); provider and implementation remain open. Resolve durable storage rights, Spain-first quality test, peak-day costs, account attribution and allowance policy before implementing lookup and completion for open-source Waitron. See [free services](#free-services-for-open-source-waitron). |
| Messaging | The [version 1 on-prem relay contract](transactional-email-relay-contract.md) has a disabled local-proof grant/reservation core; opt-in signed routes, an encrypted queue and a disabled local capture worker with bounded claims and accepted/uncertain outcomes; production origin verification, Waitron durable caller, joint proof and production decisions remain open. Include free transactional account email for open-source Waitron with a Cloud login and per-user limits; evaluate free mobile notifications separately. Prefer a Spain-hosted provider for administrative email; configure the implemented TLS SMTP adapter, notification channels, sender identities, preferences, delivery failures and message location policy. |
| Automated upgrades | Treat cloud services, cloud-hosted Waitron and on-prem installations separately; choose rollout groups, compatibility, maintenance windows, pause and recovery behaviour. |
| Monitoring | External venue and remote-route health, backup staleness, customer incidents and bilingual email alerts are implemented locally. Accepted public/staff probes now emit retry-safe organisation usage events and the portal shows their measured total. Add filing/device signals, broader functional checks and performance evidence. The local deployment now schedules usage reconciliation; define production operations, cost, allowance and limit policy before using measurements for enforcement. |

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
  the hosted trial entry path. The local integration contract is mapped and proved;
  provider provisioning, the paid lifecycle and the hosted trial remain open.
- **Cloud-only redundancy.** Choose the failure and recovery model for a hosted
  primary. The old backlog's managed-Postgres framing is historical; the current
  Waitron design targets SQLite and Litestream.
- **Production object-store proof.** The executable local SeaweedFS 4.47 contract admits
  exactly one writer in eight-way create-only and compare-and-swap races, refuses stale
  replacements, retains accepted versions, isolates venue credentials, revokes a rotated
  key, refuses an expired issued credential and commits no partial interrupted upload.
  Run the same conditional-write, credential and recovery checks against the actual AWS
  and Google storage targets selected. The existing
  [prototype results](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/research/2026-09-16-sqlite-failover-prototype.md)
  concern MinIO. They do not establish either production provider's behaviour.
- **Promoted cloud generation and current pointer.** The local proof follows a signed
  `current.json` generation through Waitron's cold restore. It does not activate the
  replacement or prove that the replacement begins streaming a new generation. Add
  that promotion proof to the production handover and activation work.
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
