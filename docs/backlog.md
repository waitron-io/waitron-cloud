# Waitron Cloud backlog

## Cloud backup box identity (D451)

**Open.** Waitron's node-only identity release is merged, but the Cloud repair in
[PR #700](https://github.com/waitron-io/waitron-cloud/pull/700) remains unqualified.
The [compatibility design](superpowers/specs/2026-11-01-replay-allocation-compatibility-design.md)
and [implementation plan](superpowers/plans/2026-11-01-replay-allocation-compatibility.md)
trace the real installation-allocation and authenticated recovery callers.
A native check of the matching release's recovery guard rejects two invoice-series
purposes and accepts standard, full and rectificative purposes. The existing restore
checks require exactly two active and two retired series; the owner's current
instruction forbids changing those assertions. Resolve that exact scope conflict
before implementing the plan. Runtime qualification and historical evidence remain
separate; no replay pin, fiscal result or restore assertion changes here.

## Concurrent storage archive publication (D450)

**Open.** Real extraction, store startup and historical failure causes remain open.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#concurrent-storage-archive-publication-d450).

## Retrospective review qualification (D535)

Child exit reports retain known operating-system signals and publish the value
that was checked. Joint-fixture setup reports retain the operation that crossed
the budget before a stage change and cover initial directory refusal. Historical
Linux failure causes, mixed registry-error handling and enclosing CI job budgets
remain separate limits.
The interrupted-LIST control identifies its producer outcome; the matching
storage-observer outcome remains unqualified in that scenario.
Venue-refresh handler checks preserve the original cases, while their matrix
and outer deadline control have the limits described below.
Delayed passkey and authenticator fixtures stop adding their artificial pause
once a request has been recorded. Their sampled duplicate controls and open timing
and session-list cleanup limits are described below. The stale-draft and script
recovery notes also distinguish delayed-handler scope from outer wait bounds.
The JavaScript-disabled fixture retains ordinary and delayed screenshots separately.
Both reload fixtures also retain their reachable handler variants separately.
The live-status and landmark fixtures keep ordinary and delayed captures separately.
Their notes describe the missing-signal controls' outer refusal checks.
The recovery-width fixture also keeps each reachable handler capture separately.
The pending-session sign-out fixture retains ordinary and delayed captures separately.
The recovery-choice fixture also keeps its ordinary and delayed captures separately.
See [the diagnostic qualification and open work](backlog/retrospective-reviews.md).

## Concurrent storage extraction and failed-startup cleanup (D454)

**Open.** Real store startup and historical failure causes remain open.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#concurrent-storage-extraction-and-failed-startup-cleanup-d454).

## Separate-process storage extraction and failed-startup cleanup (D457)

**Open.** Real store startup and historical failure causes remain open.

See [the separate-process extraction limits](backlog/storage-cache-fixture.md#separate-process-storage-extraction-and-failed-startup-cleanup-d457).
The earlier conformance archive stall (run 40811399202, job 123243127986) remains
in [D311's download investigation](backlog/cost-conformance-fixtures.md#fixture-archive-download-retries-d311).
PR #788 adds an inactivity retry for that download; it does not identify the
upstream stall's cause. The separate
[header-progress test scheduling repair](backlog/cost-conformance-fixtures.md#header-progress-fixture-scheduling-d530)
retains the original assertions and controls its shortened clock independently
of connection scheduling. The [exhausted-attempt fixture](backlog/cost-conformance-fixtures.md#exhausted-archive-attempts-and-connection-scheduling-d530)
also controls its shortened clock after each stalled request reaches the server,
retaining three requests and every original check. A recurring npm abort-diagnostic refusal remains separate
in [the setup investigation](backlog/ci-pnpm-setup.md).

## Storage archive publication refusals (D449)

**Open.** Real extraction, store startup and concurrent successful publication remain open.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#storage-archive-publication-refusals-d449).

## Storage fixture filesystem refusals (D448)

**Open.** Real store startup, concurrent publication and historical failure causes remain open.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#storage-fixture-filesystem-refusals-d448).

## Worker shutdown during polling and error reporting (D459)

**Open.** Production shutdown, real database failures and cancellation remain open.
See [the boundaries and remaining work](backlog/worker-scheduling.md#worker-shutdown-during-polling-and-error-reporting-d459).

Cancelled monitoring startup scheduling and translation startup retention now require
natural command exit, as do blocked translation retention, idle monitoring shutdown,
blocked monitoring startup after lock release, and idle or blocked-claim email shutdown.
The four email cases reject a forced successful exit through a wrapper's `beforeExit`
observation. See [the email command limits](backlog/worker-scheduling.md#email-command-shutdown-with-real-database-claims-d536).
Active translation checks also require natural exit during the first provider call,
review and two concurrent jobs; explicit pool cleanup remains open. See [the additional qualification detail](backlog/worker-scheduling.md#additional-shutdown-and-timer-qualification).
Active monitoring checks retain an observation through a database lock after either
stop signal, commit it after release and leave a later due venue unchecked. See
[the observation shutdown limits](backlog/worker-scheduling.md#monitoring-command-shutdown-during-an-active-observation-d552).
Active-observation cancellation now checks unset observation state, the failed venue's retry delay,
no later claim after a stop signal and natural exit. A running control continues to
a later venue. See [the cancellation limits](backlog/worker-scheduling.md#monitoring-shutdown-after-active-observation-cancellation-d553).

Active-observation statement timeouts now qualify both stop signals and a running
control, with retained retry state, no later claim after shutdown and natural exit.
See [the statement-timeout limits](backlog/worker-scheduling.md#monitoring-shutdown-after-an-observation-reaches-its-statement-timeout-d554).

Active-observation connection-loss checks now terminate the owned blocked backend
after either stop signal, retain retry state and require natural exit without a
later claim. A running control reaches another venue through a different live
connection. See [the single-connection failure limits](backlog/worker-scheduling.md#monitoring-shutdown-after-losing-an-active-observation-connection-d555).

Email shutdown now checks connection loss after a complete local SMTP message
but before acknowledgement, including retained retry state, no later mail claim
and natural exit under both stop signals. A two-second drain check distinguishes
the fixture disconnect from the local transport’s five-second inactivity timeout.
Remote acceptance remains uncertain.
See [the SMTP connection-loss limits](backlog/worker-scheduling.md#email-command-shutdown-after-losing-an-smtp-acknowledgement-d556).

Email shutdown also checks connection loss while the server holds recipient acceptance,
before receiving a message body, under both stop signals. The command retains retry state,
leaves later mail untouched and drains naturally. See [the recipient-stage limits](backlog/worker-scheduling.md#email-command-shutdown-before-smtp-recipient-acceptance-d557).

## Worker scheduling failures and error reporting (D467)

**Open.** Production scheduling, real database failures and capacity remain separate gates.
See [the native worker boundaries](backlog/worker-scheduling.md#worker-failure-and-reporting-boundaries-d467).

See [the additional qualification detail](backlog/worker-scheduling.md#cancellation-and-empty-failure-values).

## Worker scheduling deadlines and polling failures (D468)

**Open.** Production scheduling, real database failures and recovery remain open.
See [the boundaries and remaining work](backlog/worker-scheduling.md#worker-scheduling-deadlines-and-polling-failures-d468).

See [the additional qualification detail](backlog/worker-scheduling.md#recurring-intervals-across-clock-corrections).

## Translation consent during account changes (D392)

**Open.** Qualify provider behavior and database authority; preserving an existing
warning or retry deadline still needs a separate controller check.
See [the boundaries and remaining work](backlog/translation.md#translation-consent-during-account-changes-d392).

## How to keep this file honest

- Delete finished entries after checking main, the named pull requests and the code.
  Name the delivery pull requests in your commit body; keep each remaining open point
  as a short entry.
- For an entry longer than about ten lines, keep its title, status and one to three
  sentences here. Move the full detail to an area file under `docs/backlog/` and link it.
- Remove proof-of-work such as test counts, run IDs, signed commits and measurement
  narratives. Keep what is still open and why; receipts belong with the delivery.
- Keep owner decisions you still cite under `Decisions and deliberate limits`.
  Never remove a recorded decision with finished work.

## Decisions and deliberate limits

- Email resend waits belong to each address and operation (owner, 2026-10-25).
  Correcting an address allows an immediate send; returning to it keeps its wait.
  A server Retry-After still blocks every address for that operation.


## Installation HTTP replies and stop confirmation (D416)

**Open.** Qualify server permissions, local confirmation and live delivery against the
selected deployment.
See [the boundaries and remaining work](backlog/venue-connection-http.md#installation-http-replies-and-stop-confirmation-d416).

## Installation transport refusals and retry waits (D433)

**Open.** Qualify server permissions, local confirmation and live delivery against the
selected deployment.
See [the boundaries and remaining work](backlog/venue-connection-http.md#installation-transport-refusals-and-retry-waits-d433).

## Pairing transport refusals and retry waits (D428)

**Open.** Qualify server permissions, local confirmation and live delivery against the
selected deployment. Pairing retry waits use elapsed time through clock corrections;
HTTP-date waits use the response Date or local receipt clock.
See [the boundaries and remaining work](backlog/venue-connection-http.md#pairing-transport-refusals-and-retry-waits-d428).

## Pairing HTTP replies and binding checks (D414)

**Open.** Qualify server permissions, local confirmation and live delivery against the
selected deployment.
See [the boundaries and remaining work](backlog/venue-connection-http.md#pairing-http-replies-and-binding-checks-d414).

## Initial alert reads after account changes (D408)

**Open.** Qualify server authority, browser integration and production mail delivery.
See [the boundaries and remaining work](backlog/alert-preference-http.md#initial-alert-reads-after-account-changes-d408).

## Alert-preference transport refusals and retry waits (D429)

**Open.** Qualify server authority, deployed browser integration and production mail
delivery. Alert retry waits now use elapsed time through clock corrections;
HTTP-date waits use the response Date or local receipt clock.
See [the boundaries and remaining work](backlog/alert-preference-http.md#alert-preference-transport-refusals-and-retry-waits-d429).

## Alert-preference HTTP response validation (D415)

**Open.** Qualify server authority, browser integration and production mail delivery.
See [the boundaries and remaining work](backlog/alert-preference-http.md#alert-preference-http-response-validation-d415).

## Translation-consent HTTP response validation (D417)

Malformed consent replies cannot replace your last confirmed choices. Native
HTTP/client/controller tests cover initial reads, refreshes, agreement and
withdrawal, including duplicate venues, invalid dates, unexpected statuses and
lost replies. An uncertain write keeps the last choice and offers an explicit
retry; permission loss clears it, and rate limits keep their server wait.
Server authority, browser integration and the translation release gates remain
separate qualification work; local database checks wait for Docker.


## Translation-consent HTTP retry deadlines (D430)

Translation-consent waits survive account and clock changes. See [the HTTP retry
boundaries](backlog/translation.md#translation-consent-http-retry-deadlines-d430).

Server authority, browser integration and translation release checks remain
separate qualification gates. The historical genuine-browser reconnect refusal
(run 40746396664, job 123021488076) remains under D201/D530 investigation; a
passing qualification does not establish its cause or repair it.

## Account request proof and transport boundaries (D406)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#account-request-proof-and-transport-boundaries-d406).

## Signup and password-reset HTTP acknowledgements (D423)

**Open.** Qualify production mail, browser and server authority, exact success
statuses, empty identifiers, request headers and the client deadline. See [the
client acknowledgement boundaries](backlog/account-http-boundaries.md#signup-and-password-reset-http-acknowledgements-d423).

The historical [PR #669 storage failure](https://github.com/waitron-io/waitron-cloud/actions/runs/40716310898/job/122914999702)
was a prematurely closed LIST response during Litestream shutdown. D530 owns its
cause investigation; successful delivery of these client tests does not repair it.

## Session HTTP response validation (D412)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#session-http-response-validation-d412).

## Session revocation replies after sign-out or view reset (D440)

**Open.** Qualify server authority and live ingress after the controlled client checks.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#session-revocation-replies-after-sign-out-or-view-reset-d440).

## Session management transport refusals and retry waits (D432)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#session-management-transport-refusals-and-retry-waits-d432).

## Session recheck ordering and disposal (D405)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#session-recheck-ordering-and-disposal-d405).

## Passkey HTTP replies before prompts and confirmation (D421)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#passkey-http-replies-before-prompts-and-confirmation-d421).

## Passkey transport refusals and pending actions (D435)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#passkey-transport-refusals-and-pending-actions-d435).

## Passkey management after account changes (D403)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#passkey-management-after-account-changes-d403).

## Password and second-factor sign-in HTTP replies (D424)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#password-and-second-factor-sign-in-http-replies-d424).

## Current state

Updated 2026-10-22. The repository has a pnpm workspace and internal PostgreSQL
registration state, internal password sessions, session-backed Cloud approval and an
email-verification signup backend that creates the first organisation and business.
Cloud password recovery and an encrypted PostgreSQL email queue are implemented
internally, with a retry worker, authenticated TLS SMTP delivery and Mailpit for local
email capture. SMTP capture tests select by subject and recipient because concurrent
database fixtures share the inbox. The account HTTP API now provides signup, login, session activity,
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

**D88 / published #265 access extension, reconciled 2026-10-24:** the owner requires `.local`
for venue devices and public menus, online bookings/orders and table-QR ordering
with the Cloud step soon after go-live, not go-live itself. The [hosting design](superpowers/specs/2026-10-21-cloud-hosted-venue-design.md),
[conditional outline](superpowers/plans/2026-10-21-cloud-hosted-venue-design.md) and
single [public access/A951 contract home](waitron-integration-contract.md#public-access-and-a951-proposed)
record the scope. Close D88's duplicate design-approval gate: the approved production
design settles per-venue gVisor runtimes on shared machines, country cells, cold
recovery, Spain/Paris, per-action automation, per-cell releases and quiet-hour moves.
The owner's 24 October decisions put accounts/sign-in/recovery in-country with one
owner per customer per country, no invitations or manager accounts. Global keeps
the operator console and apex routing, optionally billing. Country billing is a
recommendation for later design; global reporting needs later privacy/data scope.
Future owner transfer must be country-scoped verified transfer/recovery, without a
second owner or automatic support takeover. No D88 owner question is ready now;
P6/D115 owns runtime/build delivery with P1/P3/P4/P7, A951 and D101 dependencies.
Production local build/rehearsal authority stands; this reconciliation adds none.
Reliability promises and pricing await measurements at launch. A1018's design,
both examples and retained defaults are approved at Waitron
`060966c2b3e9203acf0849042814997307cae463`; exact formats, compatible A947
amendments, separate A1018 build authority and runtime proof remain open.
G owns P3/P4 plan revisions and priority-5 single-owner lifecycle; production
section 4 names the changed dependencies. A951 owns the lasting Waitron tunnel/certificate client; its accepted
implementation and landing pin remain required. The [D123 scoped review](waitron-integration-contract.md#a951-cut-a-contract-review-2026-10-23) records the owner-approved Waitron build and test-only staff-v1 bindings. The [D130 response](waitron-integration-contract.md#a951-helper-and-routing-response-2026-10-23-d130) accepts the exact local-helper profile for isolated T3 implementation and the 83-byte empty production manifest. Lane E recorded matching helper acceptance and the focused T3 plan amendment at Waitron `4fbb76eaf`. The [D136 response](waitron-integration-contract.md#a951-routing-revision-2-response-2026-10-23-d136) accepts full routing edition proposal-2026-10-23.2 with its suspend-aware boot-bound contexts and literal read-boundary vectors for isolated T4 work, after E records matching routing acceptance. The manifest remains the original 83 bytes; actual executable consumer pins and runtime qualification remain absent. Source pins are not running consumers. The [D132 appliance response](waitron-integration-contract.md#a951-appliance-response-2026-10-23-d132) returns concrete approval/provisioning, helper safety/custody and complete byte-corpus amendments to appliance edition proposal-2026-10-23.1. Its encoding, counters, fixed topology, replay/recovery profile and numerical limits are agreed for revision; no full appliance artifact or executable pair is accepted. Lane E returns the revised digest and focused T1/T2/T5 mappings; G records acceptance and both consumer pins before affected adapters. G1–G7 retain the remaining authority, staff policy, independent upstream, movement, diagnostics/privacy and runtime gates; real admission stays closed.

**D101 data protection, approved design and published build planning:** the owner
approved the complete D101/D88 data-protection engineering design from PR283
(`9701cd2359d69f0a3e8960b761754cf492aac745`) on 2026-10-22 around 08:30 **for build
planning only**. The [Cloud design](superpowers/specs/2026-10-22-cloud-data-protection-design.md)
and [implementation roadmap](superpowers/plans/2026-10-22-cloud-data-protection.md)
use [A980 section 2](https://github.com/clintongormley/waitron/blob/96a1129e385447e9b9a6dc545673009953a2c551/docs/superpowers/specs/2026-10-22-a980-data-protection-design.md#2-the-data-map)
as the single application map. Planning covers the service/supplier register and
annexes, country/credential/outbound controls, support/KMS, exit/purge and handoffs;
the owner approved the roadmap and authorised slice 1 on 2026-10-22. On
2026-10-23 the owner authorised local slices 2–5, with SQL-free slices 2/3 first
and slices 4/5 taking an actually available migration slot. Slices 6–12 remain
unauthorised. Slice 2 publishes the [purpose/supplier register](cloud-data-processing-register.md)
and [five draft agreement annexes](cloud-processing-annexes.md): stable IDs,
separate Cloud-own purposes, explicitly unqualified supplier evidence and all six
open lawyer questions. These are unsigned drafting records, not legal or provider
qualification. Slice 3 adds the SQL-free [country decision function](country-policy.md):
exact qualified destination matching, positive policy revisions and evidence-only results.
The production Spain default has no qualified flows. Durable placement/credential
bindings remain unbuilt. The outbound AI refusal and explicit synthetic loopback
transport are implemented locally; remaining runtime controls are **unbuilt**. One venue approval permits at most **24 hours**
of support access, shorter where practical and fresh approval to extend. **Paris
`eu-west-3`** is the approved extra encrypted backup destination, subject to service,
contract and recovery qualification; Spain data/logs/keys remain in `eu-south-2`.
The approved exit/retry/concurrency rules retain full download, fixed UTC 90-day
read-only recovery, earlier verified deletion and all-copy evidence without fiscal
row changes. O1 is answered. AI stays disabled until separately privacy-reviewed
eligibility rules, positive/refusal examples and documented limits receive owner
acceptance. All six lawyer questions, KMS deletion-waiting policy, exact provider/entity/
access-location evidence, D102 email qualification and runtime proof remain open.
The published plan records the reviewed roadmap; local build authority for slices
2–5 leaves every legal, provider, shared-contract and enablement gate in place. This does not approve broader D88 hosting/isolation/shared contracts,
spending, deployment, provider resources or contracts. D103's first C39 monitoring
design is approved for planning only; C41 release/upgrade and C60 compute decisions remain separate.
D102's [feedback and suppression design](superpowers/specs/2026-11-01-ses-feedback-design.md)
recommends Paris and authenticated private-queue intake. Full-design approval and
build-plan authority remain open; intake and shared suppression are unimplemented.
D102/D104 hands-on account setup and live tests wait until 3 November. D68 is landed, including
`b8ff5555c996c5dec1086be49f7d046018bd3187`, but does not price hosting. D79's local
backup verification includes migration 043 and the complete same-run recovery proof.
Snapshots remain unavailable in the delivered deployment and plan enforcement stays
off until release qualification. Recheck active migration reservations before new
database work; D101 slices 1–3 are SQL-free.

**D103 / C41 release and upgrade design, published proposal:** the
[engineering proposal](superpowers/specs/2026-10-22-cloud-release-upgrade-design.md)
is **unapproved and unbuilt**. It recommends immutable release identity, separate
shared Cloud maintenance and hosted-venue cohorts, bounded evidence/soak gates,
durable human-controlled pause/resume, stopped-writer migration and independent
restore proof. Compatible code rollback preserves current data; incompatible
changes repair forward, with restoration and any data-loss authority separate.
Publication is neither an implementation plan nor operational proof. One fresh
builder check and driver review are complete; the full-proposal owner decision
precedes separate planning. Build, rollout,
provider, Waitron authority and existing migration gates remain closed. C39's full
design was approved on 2026-10-22 around 08:35 for planning only, with exact daily
schedule and first monitoring cohort still gated. C60 remains separate.

## Launch platform work, in priority order

Ordered at the owner's request on 2026-10-22. The order follows what stops the first real
venue using a paid service. Each area gets its own design session with the owner, in this
order. Remote access matters most because Waitron's customer-facing features wait on it
(Waitron A951, A1013, A508, A509, A1012).

1. **Production deployment — DESIGNED AND APPROVED (2026-10-22).** The
   [design](superpowers/specs/2026-10-22-cloud-production-deployment-design.md) was approved by
   the owner for building and rehearsing locally; opening AWS accounts, spending money and
   production schema changes need a separate go-ahead (its section 12). Its section 3 replaces
   the statements in C39, C41 and the hosting proposal that put the owner's approval on every
   step. The build is [seven plans](superpowers/plans/2026-10-22-cloud-production-deployment.md),
   each written when its turn comes: P1 and P2 can start now; P3 waits for the migration slot.
   The owner approved gVisor for P6 and running Spain from Paris for P7 on
   2026-10-23. P6 still waits for P1/P4 and the accepted Waitron handover contract
   (A1018); P7 still waits for P2/P3. Neither answer grants live/provider authority.
   Cloud agrees the [revised A1018 direction](waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018)
   at Waitron `d9252ac34f2b7e946e1154dd5af1a443c2c39ad4`, including the owner’s
   15:37 correction: after controlled or emergency takeover M2 alone handles AEAT.
   Copied and later-returned originals retain their generating fiscal identities;
   M1 returns missing originals, all received outcomes and uncertainties without
   AEAT contact. The rejected emergency predecessor ownership hold is removed;
   temporary per-chain apply pauses and domain filing-case holds remain. Fresh
   target chains, fiscal-only return and the visible business gap stay. This
   supersedes #312’s M1 filing assignment and #300’s external stop proof. Waitron
   owns one short revised owner design question; formats, actor bridge, A947
   fiscal-only transfer amendments, authorised A1034 test-service receipts, build
   authority and all eight scenario/direction runtime checks remain open. Country rebuild and action status
   supply no venue declaration or activation authority.
2. **Production monitoring, alerting and the status page.** No real venue should depend on a
   Cloud nobody is watching. Built for test installations only: venue contact, snapshot age,
   backup verification and remote-route checks, plus opt-in alert emails to venue owners
   ([local monitoring](local-monitoring.md)). The
   [C39 thresholds](superpowers/specs/2026-10-22-cloud-monitoring-thresholds-design.md) are
   approved for planning only. [Incident response](incident-response.md) (D104) proposes the
   owner as the only person on call and a free hosted status page. Missing: production
   collection and retained history, checks from outside the affected cell, a chosen paging
   provider, and the status page itself.
3. **Billing — DESIGNED AND APPROVED (2026-10-29).** The
   [design](superpowers/specs/2026-10-29-cloud-billing-design.md) sets three levels
   (registered, connected, hosted), trials, SumUp cards and Stripe direct debit, failed
   payments, emergency hosting by a venue manager, and Cloud's own Veri\*Factu invoices.
   The [build plan](superpowers/plans/2026-10-29-cloud-billing.md) orders ten slices. Slice B's calendar, trial and charge rules and slice C's country-local billing store are built. The store keeps scoped event receipts, business anchors and opaque payment methods, per-venue levels and independent trials, hosted days, frozen prices and charge lines, payment observations and actual paid history. Migration 045 preserves all 44 older SQL files and existing rows. The upgrade proof interrupts and retries the real migration, checks consumer startup gates, and restores separate old and populated new backups. Restored retries, prices, payments, trials, hosted days and events retain their facts; five deliberate database guard omissions are caught, including coverage retained by a later successful payment after the first is refunded. Hosted paid-period dates are bounding summaries; future billing views must use the exact hosted-day allocations. Slice D's pure service floors, effective trial levels and continuous grant windows are built and tested. Translation requires level 2 in those rules, and a gap between trials ends the setup grant. The country authority reader and billing-event transition now qualify opt-in generations and atomic setup invalidation, including raw billing commands and elapsed trials. Registration and pairing qualify enrolled-venue lock order and legacy completion; historical clients still work without the new table, while damaged current authority refuses access. Installation consumers now read venue authority after authenticating proofs. Fresh and saved replies, explicit setup and account lists qualify current levels, complete venue locking and scope changes during waits. Snapshot admission, explicit same-location reprovisioning, retained expiry and publication after object waits qualify enrolled venue levels, generation changes, revocation and concurrent copies of one capture. Capture grants now authenticate before policy and compare permission generation and storage destination after provider waits; those checks and installation replies after expired trials, late transitions and unobserved gaps qualify in CI. Managed streams check storage destinations after provisioning and pointer reads, reject installations moved during permission waits, and accept explicit reprovisioning with the same input after an upgrade while keeping keys, reader identity and observed recovery data. Their database tests retain downgrade, trial-change and revocation checks. Stream regression checks cover explicit reprovision after expired trials, late extensions, conversion to hosted trials and unobserved gaps, while preserving recovery keys, reader identity, observed data and neighbouring venue setup. Independent omission probes exercise the expiry, setup-clearing and reprovision branches. The machine adapter authenticates before metadata or policy work; HTTP checks cover enrolled levels, signed observations and proof, lease, key and permission changes during provider waits. Recovery HTTP delivery now compares the admitted permission generation and storage destination after provider waits, including stream reader identity. Its new checks cover snapshot and continuous recovery, owner status, catalogue and close at level one, and proof, membership and operation changes during provider work, with independent guard omissions qualified in CI. Replacement regression checks cover snapshot and continuous proposals, activation and completed-result replay at enrolled venue levels, owner inspection after downgrade, and proof or session expiry during resource waits. Independent omission probes retain those authority and expiry boundaries. Replacement HTTP regression tests cover both sources: current admission and completed replay, retained owner inspection and close, proof/session/owner/binding refusals and the existing machine response fields. The direct storage adapter now binds each writer to its permission mode and per-venue generation. Explicit venue mode upgrades private state to version 2, retires legacy writers even at an equal revision, and preserves recovery readers and data. New storage checks cover mode changes, same-organisation neighbours, missed downgrade round trips, restart, provider waits and country-policy outages; independent omissions test the physical writer refusals. The storage regression checks also exercise actual writer refusal after expired trials, late extensions, conversion to hosted trials and unobserved gaps, and reject a reader grant after a permission round trip during its file-lease wait. Temporary credentials retain their 900-second requested lifetime and existing 901-second returned-expiry bound, with the native provider expiry proof kept separate. Remote route exports, scheduling and forward-status reports now share an exact venue-scoped eligible set for active and incoming placements, with forward reports enabled or disabled. Regression checks cover same-organisation siblings, level-one refusals despite stored setup, explicit reprovisioning after upgrade, original bindings and complete venue locking during waits. Gateway restart retains the signed ten-minute authority limit. Remote account status now reads venue levels, masks withdrawn access and retains explicit reprovisioning. Database checks cover DNS, signing and certificate waits, proof-first staff certificate reads, refreshed setup after installation waits, and legacy batch/report exclusion for enrolled venues. Private route job digests include configuration revisions even without a reporting gateway, so restoring the same route cannot revive an old signing job. Independent omission probes cover these admission and publication guards. First enrolment is now serialized with legacy remote batches through sorted organisation and venue parent locks. The captured venue set is reused after the wait, including reporting exports, scheduling and forward-status reads and writes. Database checks cover first enrolment, installation-lock ordering, unrelated-cell progress and captured placements; independent omissions challenge the guards. Direct remote admission now rechecks the original venue and installation key under the installation lock after policy waits, then reads setup before allowing further work. Added checks cover provisioning, DNS instructions, certificate admission, cleared setup during a move wait and unrelated-cell progress. DNS changes and certificate publication now retain the admitted installation venue and public key across external waits. Added database checks cover key and venue changes without a revision change, retain environment, revision and revocation refusals, and require unchanged identities to succeed. Independent omissions challenge each retained identity component. Additional remote-report checks cover forged signatures, mapping and route revisions, current reporter identity after waits, sibling isolation and status before cleanup. Six independent guard omissions must be caught by those checks in CI. Translation batch hooks now separate permission from spending admission, recheck permission after provider accounting and retry waits, and retain an already paid valid result without starting review. Native checks cover denial, restoration, cancellation and callback failures. Translation admission and workers now consume venue authority; new database checks cover level-one refusal, retained results, queued-job progress and downgrade round trips during provider work. Database omission checks qualify admission, provider callbacks and the admitted permission generation. The explicit test-mode worker now skips production jobs without changing their rows or bodies, so they cannot block eligible test venues. Added database checks cover queued and interrupted work, and separate omissions challenge both selection paths. The account HTTP app now passes its selected mode into translation admission. New HTTP checks cover enrolled levels, production refusal, independent consent and setup, retained paging and replay, ownership and proof refusals. Policy-wait tests cover lock order, revocation, key and venue changes, expired leases and withdrawn consent; independent omissions challenge HTTP mode propagation and post-wait authentication. Relay approval, message admission and SMTP handoff now read basic venue eligibility before installation locks, while retaining the independent owner, consent, origin, grant, allowance and operator-stop checks. New checks cover each level, policy waits through direct and HTTP entry points, fresh admission, retained account debits and rejected configuration. Same-organisation translation checks reject forged selectors and keep jobs bound to the authenticated installation. The dedicated test runtime now validates and forwards the explicit venue mode, keeps the legacy modes unchanged, drops provider inputs and selects the local storage, trust and private controller paths. Native tests cover each runtime role and invalid combinations. New database and captured-mail checks cover signup and password reset across venue transitions, unchanged queued mail and relay authority, and unavailable address and translation routes at all three levels; independent omissions challenge signup and reset admission in CI. Worker commands now pass the explicit venue-level mode to their service checks and refuse conflicting or invalid settings before database work. A separate version-2 service receipt runs nine fixture groups and retains the older free/paid proof. Each complete receipt now has its own eight-minute CI job, preserving every assertion and the 330-second child and 360-second test limits. The grouped receipt runner can overlap two independent suites, retains its serial default and still runs every selected suite after a failure; controlled scheduling tests catch extra workers, serial execution, lost failures and invalid counts. Its storage group executes the direct cases once while keeping the discovered package wrapper. A single bounded file queue covers the groups without multiplying their file concurrency. The new guard runner requires independent passing baseline and restored runs around an exact named assertion failure; its controls reject empty or omitted tests, setup failures, timeouts, ambiguous mutations and undetected changes. Version 7 has a separate strict receipt format and pinned revision parser. Actual CI qualifies all 17 guard omissions, including two pure and fifteen database cases and the exact-candidate upgrade/recovery proof, including old and populated restores and physical stale-writer refusal. Independent queued-job consent remains required in venue mode; a new regression check and deliberate omission qualify its restoration. The combined wrapper passes the preserved 255-case legacy receipt and new 360-case nine-group receipt on an equal-tree test-box snapshot. Its 355-second run leaves little room within the unchanged 360-second combined limit; fixture runtime needs measurement and reduction before adding more work. Opt-in per-file and per-case timings now identify the service group and source line without exposing paths or test names; CI also records its CPU and memory limits. The seed-batching experiment did not make the proof fit and is removed. The two independent receipts retain all cases, strict fields and head/tree bindings. The measured between-run variability remains a profiling follow-up. A qualification also reported a bound-verifier cleanup refusal followed by live-child cascades; its source and tests were unchanged at that head, and the unknown cause is reported to the watcher for D530 investigation. The watcher approved increasing this branch's new child cutoff from 170 to 330 seconds after the diagnostic took 237 seconds; the existing 360-second combined test and eight-minute CI job still decide release qualification. An earlier release qualification was blocked by a [pinned Node fixture image pull](https://github.com/waitron-io/waitron-cloud/actions/runs/41160662631/job/124417317872) returning an authentication refusal before conformance tests. The underlying registry cause remains open. A later qualification also hit an HTTP 502 while fetching the legacy Node canary image, followed by six missing-image prerequisite failures; that direct acquisition path still needs bounded recovery. On repeated CI runs, the test that removes catalogue safeguards in disposable copies exceeded its unchanged three-minute limit. Its runtime still needs investigation. Older upgrade and service assertions remain. Every selected current-head CI job remains the final release gate; production enforcement stays off. Slice J's installation-authenticated billing display now has a plan and a shared contract agreed with Waitron lane B, including state/period combinations, error mappings, five example replies and trusted account/signup destinations. Its pure display projector now uses accepted charge settlement and exact hosted-day allocations, keeps unpaid gaps visible, selects stored trial and lapse facts without inventing transitions, and derives the civil day from an explicit calendar. Its package exports and fixed signing vector are built. The authenticated country reader now derives scope through the stored installation, rechecks current authority after parent-lock waits, reads accepted attempts and exact hosted allocations in one transaction, and selects one effective published price without writing billing or installation state. The separate HTTP endpoint requires the stored installation proof and lease, applies the shared budgets and bounded body read, and keeps billing separate from service configuration. Automatic omission probes cover accepted settlement, unpaid day gaps, scope changes during a wait, revocation and trusted account destinations. The read shares its legal-business parent among display readers while retaining billing-writer exclusion. Real database, HTTP, socket and guard checks qualify the provider; joint Waitron consumer qualification remains open. Long-history read latency and batching historical charge queries still need a measured check before production enablement. Pre-connection public prices and the production billing calendar retain the owner questions raised by lane B. Billing remains internal: production prices, payment collection, invoices, allowances, enforcement and deployment need their later slices and owner gates. Slice A's SumUp and Stripe test run waits for the owner's sandbox accounts. Prices and allowance
   sizes wait for measurement (the design's §11). Billing cannot go live before the
   Waitron company exists to issue invoices, and that billing software needs its own
   declaración responsable.

   Slice E now has a [plan](superpowers/plans/2026-10-29-cloud-billing.md#slice-e-allowances-and-remote-access-traffic) for account- and venue-scoped allowances, trial tiers and measured remote traffic. Configuration, accounting, the collector and service integration remain unbuilt; production allowance sizes are unset.
4. **Terms, the data processing agreement and service promises.** These are needed before
   the first customer, paid or not, and a lawyer is needed for each, so the questions should
   go out early. The [launch evidence](launch-evidence.md) requires "lawyer-reviewed terms",
   and the D101 design lists six open lawyer questions. Missing: terms of service, the data
   processing agreement with each venue, and the promises Cloud makes about how quickly a
   venue is recovered, how much data a failure can lose, and uptime.
5. **Single-owner account lifecycle.** Each customer organisation has one Cloud account
   owner in its country, with no invitations, manager accounts or concurrent second owner
   (owner, 2026-10-24). Two countries mean two accounts. Design verified country-scoped
   handover that replaces exactly one owner and immediately revokes the former owner's
   access, plus unfinished-transfer and lost-owner recovery protections against abuse.
   Exact endpoints, evidence and recovery policy remain separately scoped here; no automatic
   support takeover or operator, fiscal or activation permission follows from ownership.
   The [revised P3 plan](superpowers/plans/2026-10-22-cloud-global-country-split.md)
   records the boundary and coordinated follow-ups; this lifecycle is not built or approved.
6. **Support and the operator console.** Time-limited support access is built but unused:
   "Nothing uses this primitive in production yet"
   ([support grants](temporary-support-grants.md)). Missing: a way for a customer to ask for
   help, a help desk or support process, an operator console for the owner, and an audit
   trail of what Cloud staff did.

Production email (D102: bounces and complaints) is already tracked and is not repeated here.

## Isolated replay ownership fixture refusal (D294)

**Open; historical cause unknown.** The Linux ownership case passes alone and
after the preceding worker-deadline test, without reproducing the historical
refusal. Collect an instrumented recurrence before changing the ownership check.
See the [reproduction commands and diagnostic boundary](backlog/isolated-replay-ownership.md).

## Isolated replay result-boundary refusal (D297)

An altered-stream control refused before reading its changed worker result in
[cost CI](https://github.com/waitron-io/waitron-cloud/actions/runs/40281251676/job/121434888588).
The counts variant failed again in [D543 merge CI](https://github.com/waitron-io/waitron-cloud/actions/runs/41202820800/job/124541925301)
before the host read the result, after a clean native replication exit. That trace
names checkpoint admission, but does not identify its refusing guard. A transport
refusal now adds its first fixed reason, request-validation boundary and pending/completed
request counts before cleanup. Controlled HTTP refusals after an idle callback and
a request admitted after that callback retain distinct evidence through worker and
host admission. The earlier preparation/worker/host stages and result-read status
remain available without private output. Existing assertions, deadlines and refusal
rules are unchanged. The unchanged counts case passed on the Linux test box; this
is not a repair of its historical failure. Collect an instrumented recurrence to
identify the cause before changing request or shutdown behavior.

## Isolated-replay CI work groups (D301)

Isolated replay now runs in three separate CI jobs: controller cases, host and
result-reporter cases, and the remaining command and diagnostic cases. New case
names fall into one of these groups so coverage cannot disappear. Each job keeps
the eight-minute cap, original case assertions, runtime pins and cleanup rules.
Check the complete case inventory and both head and merge runs before claiming
the jobs meet the five-minute target.

## Diagnostic download response validation (D410)

**Open.** Qualify server redaction, genuine browser downloads and production-network
behaviour.
See [the boundaries and remaining work](backlog/diagnostic-download-http.md#diagnostic-download-response-validation-d410).

## Diagnostic download transport failures (D425)

**Open.** Qualify server redaction, genuine browser downloads and production-network
behaviour.
See [the boundaries and remaining work](backlog/diagnostic-download-http.md#diagnostic-download-transport-failures-d425).

## Usage-read transport refusals and retry waits (D434, D436)

**Open.** Fix the separate backward-clock revival of panels other than usage, alerts, backup catalogues and pairing; server
authority and production metering remain unqualified.
See [the boundaries and remaining work](backlog/usage-metering.md#usage-read-transport-refusals-and-retry-waits-d434-d436).

## Native storage admin fallback exhaustion (D506)

Run `node --test deploy/test-cloud/storage-admin-exhaustion.test.mjs` to check
usable S3 storage when all 101 admin gRPC choices are occupied, preservation of
every competing listener, cleanup and later clean startup. The native fallback
warning does not imply S3 startup refusal. Admin-worker functionality, an actual
admin bind refusal and bind races involving other programs remain open.

[PR790 qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/41172266544/job/124452925371)
failed before these checks when SeaweedFS refused its allocated master port.
The listener snapshot names a `weed` process; its fixture owner remains
unknown. This case deliberately disables the fixture's handoff retry to prove
that admin exhaustion does not restart storage. The unchanged Linux control
passes, which does not explain or fix that historical collision.

[PR793's unrelated documentation qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/41182496471/job/124482642911)
also reaches a later handoff refusal in the existing forced-collision readiness
test. Its restarted native store cannot bind the allocated S3 gRPC port; the
listener snapshot names another `weed` PID without identifying its fixture.
The expected original SDK error is therefore replaced by the genuine startup
refusal. The unchanged forced-collision
case passes all three modes on the authorised Linux test box, including the
throwing reporter; that control does not explain or repair the CI collision.

[PR795's email shutdown qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/41187136562/job/124496295046)
repeats this failure in the same forced-collision `reporter-throws` subcase.
The restarted store cannot bind S3 gRPC port 46747; its listener snapshot names
`weed` PID 7112, with fixture ownership still unknown. The original SDK-error
assertion fails. Both storage source and test match the branch's base exactly.
Lane H's D530 investigation owns this recurrence; keep the single restart and
every assertion. A later clean qualification does not repair this collision.

A controlled current-main reproduction exposes a peer binding an already claimed
filer port before its claim attempt returns `EEXIST`. The native owner then
refuses that port. Candidates are now claimed before binding; existing claims
cause no bind, occupied unclaimed candidates retry within 256 selections, and
other bind errors retain their original object. New native handoff and occupied
socket controls cover that order and cleanup. All eight reservations, the single
native restart, readiness and authority checks, and deadlines remain. This
repairs the demonstrated reservation intrusion; it does not identify historical
Node or weed owners, prevent unrelated programs racing the later handoff, or
qualify the separate native admin fallback.

See [the cooperative port claims and cleanup limits](backlog/storage-cache-fixture.md#cooperative-native-storage-port-ownership).

## Repository licence

The root `LICENSE` is copied byte for byte from Waitron's Elastic License 2.0 text.
All eleven workspace and root manifests identify it with `SEE LICENSE IN LICENSE`.
Waitron's separate grants are not included. The owner and watcher control the repository's
visibility; this change does not switch it or alter settings and workflows.

## First working milestone

**Open; the combined milestone is local evidence only.** Repeat the venue connection,
remote access, backup, replacement and gateway checks against the selected deployment
before launch. Live providers, deployment and secret custody, database recovery,
final-write handover and automatic appliance setup remain open; see the
[milestone requirements and remaining qualification](backlog/first-milestone.md).

## Stale fiscal-draft browser handler wait (D371)

The stale-draft browser fixture bounds its installation-handler wait at the existing
30-second page budget. An absent signal fails within that budget; delayed handlers
repeat both languages, themes and phone/desktop widths. Every original pending-list,
venue permission, uncertain-write, signed receipt, reconciliation and layout check
remains. These native Chromium checks use stubbed HTTP and leave fiscal allocation
and production authority unchanged.

## Fiscal venue-refresh browser handler observation (D376)

The failed venue-list fixture observes its refresh handler's read count before
checking duplicate suppression. A delayed handler reproduces browser pending
state before the Node handler counts the read. Normal and delayed refresh
journeys cover both languages, themes and widths. The separate Retry-After and
pending/uncertain-write cases remain unchanged in both languages at width 390.

The missing-count control checks a configured two-second wait through a
three-second outer race. It detects waits that exceed that outer bound; it does
not independently enforce the exact two-second deadline. Every original assertion
and deadline remains. These stubbed Chromium checks leave fiscal allocation
behavior and expected results unchanged.

## Fiscal test-worker failure evidence (D380)

PR622's two-worker allocation check observed C000001 and a missing second receipt;
the worker refusal was absent from CI40604297872. Its reservation and retry
assertions now report up to two workers' fixed refusal codes and receipt presence
only when a check fails, then rethrow the identical assertion. Native controls
cover a real independent worker refusal, private fields, accessors, bounded output
and a broken diagnostic sink. Every original identity, allocation, retry, process
separation and deadline check remains. The historical cause is unknown; local
PostgreSQL reproduction waits for Docker to return. Use a labelled recurrence
to reproduce the cause before changing allocation behavior or expected values.

## Fiscal allocation registry

The owner requested removal of this obsolete registry on 29 October 2026
because Waitron now generates time-based codes. The
[removal design](superpowers/specs/2026-10-29-remove-fiscal-registry-design.md)
and [implementation plan](superpowers/plans/2026-10-29-remove-fiscal-registry.md)
cover its Cloud package, HTTP routes, portal and measurement consumers. This is
planning only; the registry still runs. Runtime removal must wait for Waitron
A1189 to land. The proposal retains migration 038 and stored records unchanged;
removing shipped migration history or stored fiscal data needs a separate decision.

The [shared registry plan](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/plans/2026-10-12-cloud-fiscal-allocation-registry.md)
defines the implemented Cloud service. The
[contract and storage stage](fiscal-allocation-registry.md) defines strict signed
receipts, complete series and binding snapshots, separate paper custody trust,
explicit unavailable capabilities and append-only migration 038. Local tests
exercise the actual fiscal validator, populated concurrent 37-to-38 upgrades,
interrupted migration rollback, namespace uniqueness, retained runtime history
and exact schema gates. Production authority is unavailable.

The current-history stage adds challenged signed journal reads, signed expiring
writer grants, exact full-history replay and permanent unknown outcomes. Local
PostgreSQL dump/restore and independent Node workers prove that missing C000042
cannot be reissued, the previous writer is refused, and lost replies or failed
database commits reconcile the same signed result. The external fixture survives
process restart; no production continuity provider is supplied.

The authenticated store stage adds current session, venue ownership, custody and
entitlement rechecks; terminal consumption and abandonment; signed bounded receipt
pages; and monotonic signed S/P imports with complete venue-transfer chains. Local
PostgreSQL tests cover independent authenticated workers, authority lost during a
wait, omitted full series, ended entitlement with retained reads, old uploads,
forged or consumed transfers, partial transfers and matching exact retries.
Account HTTP routes require a full session, CSRF and current venue authority;
shared PostgreSQL limits protect account and authorized namespace budgets. A
durable routing hint recovers the exact outside receipt after a first-projection
rollback. Machine reports verify the current installation key and active lease
under revocation locks, retain exact retry results and record matching or
conflicting paper evidence without activation or name issuance. Real listener
tests exercise factor challenges, shared limits, revocation and expiry waits,
discarded TCP replies, independent authority restart and failed PostgreSQL commits.
Indexed venue/operation queries avoid whole-table tenant scans. Current custody
checks protect both receipt pages and post-append consumption; fresh signed machine
authentication recovers the same immutable operation after a proof expires. Paper
import status records completion without inventing a Cloud receipt.
Registration tests run in five CI file shards. Every case and the 30-second
test deadline remain; work jobs stop after eight minutes.
The phone journey at `/fiscal-allocations` now reserves and explicitly consumes
identities, reconciles uncertain replies using the same operation, exports the
complete signed manual packet, pages retained receipts and imports existing signed
paper history. Local real-server/browser tests cover English and Spanish, light
and dark, 390 and 1280 pixels, with accessibility checks in ready, uncertain,
error and retained states. On-prem venues need no managed backup to use the journey.
Adding or removing a fiscal series clears stale series-field errors while keeping
feedback on other fields. English/Spanish browser checks retain valid series codes
and purposes and confirm that Reserve still flags empty series before sending.
Fiscal drafts name a missing Standard series and mark every repeated code.
Correcting series clears stale feedback. English/Spanish browser checks cover
both refusals together, leave unrelated codes unmarked and submit corrected drafts
with existing case-sensitive codes and normalized taxpayer/software fields.
Browser checks observe the screen-to-controller call before the controller can
reject an invalid draft. Missing Standard, duplicate and combined series errors
stay in the screen; a corrected draft reaches the controller exactly once.
Browser validation checks structure; local recovery must verify cryptographic
trust and authority before activation. Cloud now preserves the exact person or recovery-key event operator through
reserve validation, consumption approval, signed manual packets and retained
browser receipts. Tagged key operators must match the recovery event and target
node; malformed objects and person substitutions refuse. Focused contract and
real HTTP tests cover those boundaries, and eight browser cases cover retained
key-event packets in both languages, themes and widths. The actual PostgreSQL joint test now pins Waitron adapter candidate
`2293a60a311e20b227029782ba75048ee1fff241`. Its 15 cases cover real account status,
independent verification of Cloud's signed packet, source/target/event/operator and
full-purpose refusals, missing trust, reserved-state refusal, retained read access,
session/CSRF refusals, complete manual activation and a matched machine report.
A lost committed report reply retries the same operation with fresh authentication;
the independent journal returns a retained result without sending again and refuses
changed evidence. These are local synthetic fixtures, with no production policy enabled.
The test uses an explicitly pinned installed Waitron checkout, or fetches and installs
that public commit in its own temporary directory. Waitron
owns the adapter and its delivery. The joint fixture now observes actual HTTP
401/403 responses and checks that a conflicting report leaves its retained result
usable without another send. Its report cases share one activation; independently
runnable name-filter cases and removal of the temporary port's release/rebind
interval remain fixture follow-ups. The installed-checkout override verifies the
tracked tree; its dependencies and untracked files are developer supplied.
Production continuity
storage, taxpayer custody and operator attribution, subscription policy and the
signing-key custodian remain owner enablement gates. Before enabling recovery,
qualify how the service discovers custody-approved namespaces when an old database
backup lacks both allocations and routing hints, and measure full-journal replay
and indexed paging with launch-scale history. Exhausted identity space and
unverified signed evidence now direct you to your custodian in English and Spanish,
alongside the original uncertain-result warning when a write is unresolved.
The page retains status checking and exact-request resends; temporary continuity
failures still suggest a later retry. Controller checks and real-server Chromium
journeys cover both themes at 390 and 1280 pixels. The exhaustion browser response
is synthetic; the untrusted-paper response comes from the real signed-evidence check.
When you inspect a retained receipt, its disabled draft selectors now show each
signed purpose: Standard, Full and Rectificative. Selection is applied to the
rendered options so the first option cannot replace a purpose before the options
exist. Chromium checks cover English and Spanish, both themes and 390/1280 widths,
new-draft edits and the unchanged signed packet. The real-server key-event journey
also checks all three displayed purposes. Before reserving a new draft, your NIF
and software ID are trimmed and uppercased; lowercase entries reach the strict
endpoint as uppercase values. Stubbed Chromium checks cover both languages,
themes and widths, complete padded input and malformed-input refusals.
The shared input does not pass its declared length limits to the native field:
padded values arrive complete, and overlong identifiers are refused on Reserve.
Passing those limits through the shared input remains a separate follow-up.
Organisation and venue selections now
apply to their rendered options too, so your first view matches the supplied draft.
The pre-fix real-server journey showed the first organisation and an empty venue
while an untouched submission reserved the supplied second organisation's venue.
The server derives the organisation from that venue; it receives no organisation
field. Chromium checks cover the display, untouched request and stored reservation,
and native checks cover edits, organisation changes and clearing a venue. Initial
setup already displayed correctly because its mode options are static; both mode
edits and the submitted mode remain checked. Allocation and receipt fields are
unchanged. All checks cover English and Spanish, both themes and 390/1280 widths.
While your installation list refreshes, fiscal choices and submission now wait
for it to settle. A missing or no-longer-permitted venue clears an unsent draft;
a new reservation is refused when its venue is absent from the current list.
In-flight writes, unresolved replies and issued receipts keep their reconciliation
evidence. A definite refusal also clears a draft whose venue became unavailable
during the request. Pre-fix real-server journeys reserved for a different organisation from
the one shown during a refresh, and sent a hidden venue after permission removal
(the server refused it with HTTP 403). Chromium checks cover both cases, no stale
request or stored reservation, and a subsequent permitted choice whose displayed,
sent and stored venue agree, in English and Spanish, both themes and 390/1280 widths.
If your venue list cannot be read, Fiscal allocations now shows the existing
error and offers Refresh status. Refresh waits for an ongoing list read, any
pending or uncertain fiscal operation and Retry-After delays. Stubbed Chromium
checks cover failed and recovered reads in both languages, themes and widths,
plus rate-limit waits and retained write evidence. Existing draft, selection,
request and receipt rules remain covered by the fiscal browser journeys.
When several venues share a business name, the Venue choices now include the
translated fiscal environment and short venue ID, so you can tell them apart
before selecting one. Chromium checks cover both environments, two production
venues of one business, unchanged full venue IDs and the resulting draft, in
both languages, themes and phone/desktop widths. The creation date remains a
follow-up: the venue read and venue table have no creation timestamp. Add a
persisted venue creation date and its overview read before showing a localised
date here; a connection-request timestamp is not a substitute.
Stored fiscal status reads check entitlement and custody once before returning the exact
receipt. PostgreSQL checks cover that count and refusal after entitlement, custody or
venue ownership is withdrawn; history reconstruction keeps its checks around database work.
No production defaults are selected. Fiscal records, invoice hashes and Waitron's allocation code stay outside
this Cloud change.

**Fiscal session-expiry test ordering.** The store test now expires its session
on the reservation's own PostgreSQL client after the real external append commits.
Both the normal case and a 350 ms pre-reservation pause retain the strict
`session_expired` refusal, one permanent name and zero projected events. Boundary
diagnostics record database time, expiry and authorization/append stages without
credentials. Boundary assertions run after reservation settles, so append
reconciliation cannot swallow them. The earlier 300 ms setup deadline failed under the controlled pause:
it expired before authorization and the append never began. Twelve unchanged
isolated runs and a diagnostic full run did not reproduce that original failure;
its exact historical cause remains unproved. If this test fails again, use its
boundary diagnostics before changing authority checks or deadlines.

**Continuity fixture diagnostics.** A package-only CI-selection control passed
131 of 133 fiscal tests: `continuity.test.ts` reached an absent worker receipt in
the replacement-fence case, and the 150 ms witness case did not observe its
projection waiting on the held PostgreSQL lock. The same fiscal tree passed all
133 tests in the candidate gate. An isolated diagnostic run passed both cases
and observed the lock after 15 ms, then refused projection after 192 ms. These
passes do not explain the original failures. The machine also ran concurrent
review mutations; resource pressure is an assumption, not an established cause.
The fixture now emits elapsed timing stages before and after dump, restore and
worker calls, including the returned refusal code and receipt presence before
receipt access. The short-witness case records verification, client acquisition,
projection, lock observation, release and refusal, with the elapsed age since
verification and the estimated witness age. Diagnostics omit raw errors, receipt
contents and identifiers; an output failure cannot replace the original assertion.
You can run the six diagnostic checks without PostgreSQL using
`node --test packages/fiscal-allocation/test/continuity-trace.test.ts`. They also
exercise a real fenced-worker refusal and expiry before any database query.
The writer/witness policies, lock observation, identity and refusal assertions stay intact.
Do not overlap a large review mutation batch with full package qualification.
A later local full fiscal run also reached the old-backup case's 30-second
deadline and missed the same lock observation. A diagnostic-only run completed
that backup case in 5,238 ms, observed the lock after 25 ms and refused expired
history after 206 ms. These passes do not resolve the failures. Use the emitted dump,
restore and worker-result stages on recurrence; both
the 30-second deadline and the 150 ms witness policy remain unchanged.
The two cases are `a restored old PostgreSQL backup cannot reissue C000042 and
complete reconciliation permits C000043` and `a verified history that expires
during a PostgreSQL lock wait cannot project`, both in
`packages/fiscal-allocation/test/continuity.test.ts`. That run overlapped review
and other local qualification work; resource pressure remains an assumption.
The 16 October five-shard qualification also passed 132 of 133 fiscal checks:
the same 150 ms witness case did not observe its held lock. The fixture and
fiscal sources match the preceding main tree. An isolated diagnostic run observed
the lock and passed; a separate 200 ms pause before projection reproduced the
assertion after the witness had expired and projection returned `history_uncertain`.
This establishes an early-expiry mechanism, not the precise cause of the original
failure. Read the emitted verification, client-acquisition, projection and lock-observation
ages on recurrence. Evidence is under
`~/waitron-campaign-d/receipts/d69/registration-shard-budget/fiscal-*.log`.
The 150 ms policy, lock assertion and 30-second deadline remain unchanged.
The retained local evidence is under
`~/waitron-campaign-d/receipts/d69/dependency-fixtures/`: the failures are in
`gate-packages-fiscal-allocation.log`, the stage observations and diagnostic-only
patch are `fiscal-diagnostic.log` and `fiscal-diagnostic.patch`, and the later
133-case passing run is `fiscal-final.log`. Use those stages to investigate the
next failure; a passing repeat does not resolve this defect.

**Maximum-hour lease fixture timing.** Full main CI `39247738663` failed
`staff-certificates.test.ts` before its production-installation HTTP 403 check:
the issuer refused a fixture built from two clock reads. Advancing only lease
construction by one millisecond reproduces `invalid_proof` through real PostgreSQL.
The fixture now derives expiry from one issuance timestamp; its permanent advancing-clock
case verifies the signed lease lasts exactly 3,600,000 ms and retains the HTTP 403.
The outage proof's live retired-key control had the same two-clock construction.
Its complete PostgreSQL/SeaweedFS/HTTP journey also reproduces the refusal under
that clock control and passes after the same correction, retaining key-removal,
expiry and revocation checks. Both corrections leave production code, existing
assertions and individual deadlines unchanged. CI did not record its clock values,
so the exact historical timing remains unproved.
A two-millisecond advancing-clock experiment also reproduces the issuer refusal
in expired leases built from separate clock readings. The `relay-messages.test.ts`,
`relay-operator-stop.test.ts` and `captures.test.ts` fixtures now derive both times
from one reading. Each existing HTTP refusal test advances the clock during
synchronous lease construction and restores it before making requests, preserving
all expiry, permission, HTTP assertions and deadlines. A Docker-free probe executes
the four actual construction blocks with the real issuer and verifies that each
signed lease lasts 3,599,999 ms and is expired. The staff revision/revocation
fixture also uses one timestamp under the same clock control, retaining every
HTTP, revision and revocation assertion. PostgreSQL and HTTP journeys are
qualified by CI while local Docker is unavailable. The historical CI clock values
remain unknown.

**Relay worker counter fixture timing.** CI `40266435807`, registration shard
4/5, refused the initial operator-stop submission with `relay_counter_expired`:
the counter ended at `1792987200000`, and the final database check observed
`1792987200001`. Worker fixtures now start their unchanged one-hour counter
window from PostgreSQL's setup timestamp, keeping handoff and stop checks
independent of the wall-clock hour. Nine Docker-free cases execute the actual
fixture configuration and counter calculation across that boundary, including
an application clock two hours ahead or behind. Production expiry, limits and
all existing worker assertions remain unchanged. Use current-head CI for the PostgreSQL worker journeys while local Docker is down.

**Short lease fixture timing.** The capture object-write and installation-lock
fixtures, and the replacement provider-grant fixture, derive expiry from one
issuance timestamp. A Docker-free advancing-clock probe executes their actual
construction statements with the real issuer and verifies signed durations of
100, 250 and 600,000 ms. All existing refusal assertions and waits stay unchanged;
GitHub CI qualifies the PostgreSQL journeys while local Docker is unavailable.

## Translate all: approved design, implementation still open

See [the retention cadence and native transport checks](backlog/translation.md#retention-cadence-and-additional-http-boundaries)
for completed local qualification and the production limits it retains.

The design and 24-task plan are owner-approved; Tasks 1–21 are implemented.
Keep translation off until the remaining Cloud, joint Waitron and release checks,
owner-only quality trials after 2026-11-02, and commercial and production decisions
are complete; preserve the approved cap, admission, consent and paging rules in the
[translation requirements and open work](backlog/translation.md).

## Installation replies after account changes (D398)

**Open.** The earlier incomplete signature-metadata response remains unexplained; server permission and revocation checks remain in CI.
See [the boundaries and remaining work](backlog/venue-connection-http.md#installation-replies-after-account-changes-d398).

## Initial focus

**Open; local building only.** Launch first in Spain on AWS and keep routine customer
journeys self-service. Qualify remote access, replacement recovery, hostnames, cell
movement and outage behaviour against the [requirements and deliberate limits](backlog/initial-focus.md).

## Free services for open-source Waitron

**Open; production enablement is not approved.** Offer address lookup and transactional
email to open-source Waitron users with a Cloud login, without a paid subscription.
Qualify providers, storage rights, address quality, account allowances, abuse limits
and the joint Waitron integration against the [requirements and open work](backlog/free-services.md);
evaluate mobile notifications separately.

## Decisions in progress

**Open; individual decisions and qualification gates still apply.** Keep the customer,
staff-access, residency, cell, provider, package, usage, Waitron-boundary, server-lifecycle
and recovery choices together in the [decision table](backlog/decisions-in-progress.md).
The table preserves the agreed direction and identifies what still needs a decision,
implementation or production evidence.

## Platform work to scope

- **Remote fixture startup failure still needs attribution.** Merge conformance run
  `39906100584` on `a0404ad26282fadd30676266dd23c3ba439e1c4e` failed only the
  `false-availability` case in `remote-waitron-conformance.test.mjs`, after the
  unchanged 30-second readiness deadline. The same case passes locally through
  `node scripts/test-postgres.mjs exec node scripts/cloud-cost/conformance.mjs --only remote-waitron-conformance.test.mjs --pattern false-availability`.
  Both gateway and browser readiness probes now retain a fixed transport, TLS, HTTP, response-shape or
  command phase without printing response bodies, keys or raw errors. Capture that
  phase on recurrence before choosing a fix. This diagnostic change does not
  identify or fix the historical failure. The two-second request timeout,
  30-second startup deadline and all original gateway and browser journey checks remain.
  A separate browser fixture refusal in [PR594's cost run40536958436](https://github.com/waitron-io/waitron-cloud/actions/runs/40536958436/job/122305238271)
  occurred during the gateway's `docker start`, before any browser phase. The command
  wrapper now retains a fixed command category, failure reason, exit code or signal,
  and output byte counts capped at one MiB per stream. Arguments, paths and output
  contents stay private. Native child-process checks cover exit, signal, missing
  executable, output limit and the unchanged 30-second timeout. Existing browser
  refusal labels and all journey, ownership and cleanup checks remain unchanged.
  Capture the next labelled failure to identify the startup cause; these controls
  do not explain the historical Docker delay. Local Docker qualification stays
  parked until 3 November; current-head CI runs the genuine gateway journeys.

- **LAN test Cloud with free and paid organisations.** The
  [test deployment design](superpowers/specs/2026-10-17-test-cloud-free-paid-design.md)
  and [implementation plan](superpowers/plans/2026-10-17-test-cloud-free-paid.md)
  describe a separate Cloud Compose project on the owner's test box, with an
  operator-set pretend plan and service checks enabled only for this test deployment.
  The [free-service fixture proof](test-cloud.md#check-free-services-locally) now
  checks account mail under both plans, separately consented relay capture with
  test-CA origin evidence and revocation, and fake-provider translation across
  plan changes. Its bounded runner requires every selected file to execute and
  refuses missing, failed, cancelled or skipped results. The redacted receipt
  binds the Cloud commit and tree; it qualifies neither Waitron client journey.
  Waitron's inspected `e2ca1ca487412a2bb7ef1277e48c6adad6068c85` includes paging,
  but the joint translation and owner gates remain. Its email transport has no
  Cloud relay caller. Final disposable Waitron integration, image qualification
  and test-box deployment remain open; plan enforcement stays off.
  The organisation plan store and operator command now persist free/paid metadata,
  advance revisions only on changes and refuse incompatible migration ledgers.
  Real PostgreSQL checks cover concurrent updates, rollback and separate organisations;
  paid status leaves the disabled fiscal API unavailable. See the
  [operator commands](local-deployment.md#inspect-the-test-organisation-plan).
  The opt-in backup boundary now checks paid permission before provisioning,
  capture/publication, rotation, stream authority, recovery reads and replacement
  completion. Plan changes advance installation revisions atomically; downgrades
  clear paid setup and cached machine replies use current configuration. Explicit
  reprovisioning restores an existing location/stream binding without discarding
  objects or key versions. Test-mode expiry pauses while free, and admitted expiry
  holds policy through deletion. The backup worker CLI validates and forwards the
  test plan flag; ordinary completed replacement replies retain their original
  authority rules. Metadata/status/close and admitted verification
  remain available. Ordinary deployment permissions and retention stay unchanged.
  The [backup guide](local-backups.md#exercise-test-free-and-paid-plans) describes
  these checks and their lock order. Real PostgreSQL barriers cover provider waits,
  pairing, multiple installations, replacement and rollback. Keep organisation
  writes in the setter; two shared policy readers that both update their organisation
  can still deadlock while upgrading locks. No current service caller does that.
  CI also exposed an enabled Sign out button whose handler refused clicks while
  authenticator startup was pending. The three Sign out views now share the
  handler's existing pending-work gate. A held-response browser check covers both
  languages, themes and screen sizes without changing the original assertions or
  three-second waits. No fiscal policy changed.
  Opted-in remote permission now covers placements, moves, names, certificate
  submit/status, authorization and publication. Active/staged gateway routes and
  reconciler jobs share the current paid/test/provisioned eligibility set. Delayed
  signing/DNS results recheck policy; publication holds policy through the file
  replacement. Upgrading alone restores no route; explicit existing-placement
  provision restores cleared setup once. Public setup metadata remains readable.
  The account server CLI now validates and forwards the same mode; real listener
  tests cover free lifecycle masking and staff refusal, ordinary defaults and
  malformed-flag startup refusal. Fresh-health and direct-store forged-proof
  checks cover the account/status and authentication boundaries too.
  A single-cell gateway export now locks organisation policies only for that cell's
  active placements and incoming staged/ready moves, in UUID order. Real PostgreSQL
  tests prove that an unrelated cell's policy update no longer blocks the export,
  incoming policies stay locked through publication, and a newly staged organisation
  waits for the next export if its policy was absent from the locked set. The existing
  paid/test/setup/revocation checks remain. Reconciler target selection now reads
  active routes once and incoming routes once across all cells, grouping them by
  their destination cell. A real PostgreSQL check with eight cells observes two
  route reads instead of sixteen; empty-cell jobs and route/certificate contents
  remain covered, including moves, revision changes and plan restrictions.
  Reconciler eligibility now indexes the permitted installation IDs once per target
  rebuild, rather than scanning the list for each route and certificate. Real
  PostgreSQL checks with four and sixteen eligible installations observe four
  and sixteen ID reads, replacing twenty and 272. Empty test-mode eligibility
  still withdraws routes and certificate jobs; ordinary mode keeps its existing
  behavior. Single-cell gateway exports now build the same kind of index once
  for active and incoming routes. Real PostgreSQL checks through both returned
  and published manifests observe four and sixteen ID reads for four and sixteen
  routes, replacing ten and 136. Empty eligibility still excludes both kinds of
  route; ordinary mode retains them. Those exports now fetch active routes and
  incoming routes in two cell-scoped batches. Real PostgreSQL checks with four
  and sixteen mixed routes observe five database calls in ordinary mode
  (transaction, cell sequence and two route batches), plus two policy calls in
  test-plan mode, through both returned and published manifests. A missing hostname
  on an eligible route refuses the export before publication and rolls back its
  sequence. Route names, target addresses, ports and keys,
  move lifecycle, revocation and cell isolation remain covered. A controlled
  PostgreSQL move completion between the two route reads omits that route for one
  export on both the original and batched versions; the next export includes it.
  Qualify a consistent route view across those reads before promising uninterrupted
  cell movement. Eligibility still
  scans placed organisations and rebuilds target lists for current-work checks.
  Global policy locks and total target processing need production-scale measurement
  before larger capacity claims.
  A real two-peer Docker gateway proof withdrew the downgraded route/peer in
  4,053 ms while its paid neighbour still served its own body; wall-clock short-lease
  expiry and an expired-cache restart restored no access. This is local synthetic
  gateway evidence, not test-box deployment or the later client acceptance proof.
  A barrier test also excludes a new placement whose organisation was absent from
  that export's locked policy set; the next export includes it.
  The signed manifest schema and ten-minute authority maximum are unchanged.
  See the [remote test guide](local-remote-access.md#exercise-test-free-and-paid-plans).
  The isolated LAN HTTPS override, persistent private CA/leaf bootstrap, fixed
  capture mailer and dedicated test runtime are implemented. The runtime validates
  and forwards plan mode explicitly while translation stays off. Rendered Compose
  checks keep the backend unpublished, replace bindings and cap all container
  limits at 1,824 MiB. Real native-Mac Docker proofs cover trusted HTTPS signup,
  captured canonical links, independent proxy Host/Origin/header checks, restart
  identity, account replacement without restarting its proxy and owned stop with preserved volumes. They do not prove amd64 box
  deployment. The image-only driver checks platform, capacity, ports, network
  overlap, rendered bindings and recorded IDs; startup monitoring checks resource
  floors and existing Waitron health once per five seconds. Interrupted state with unrecorded IDs is refused; scoped Docker discovery and stop attempts survive a failed host inventory or state write. Cleanup that cannot reach Docker is reported as incomplete. See the [test Cloud guide](test-cloud.md).
  The owner-approved
  [backup-verification contract](superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md)
  separates data recovery checks from permission to activate a fiscal server.
  Its five worked cases and acceptance checks are a design, not runtime evidence.
  Waitron's separately owned A850 interface landed in
  [#1939](https://github.com/clintongormley/waitron/pull/1939) at
  `5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa`. The
  [Cloud implementation plan](superpowers/plans/2026-10-21-cloud-backup-verification.md)
  covers strict result admission, stored evidence, current target qualification,
  historical retention and version-bound recovery across all existing readers.
  Cloud now has dormant strict request/result readers and a complete target manifest
  exported from the compiled pinned Waitron bundle. The literal protocol vector
  matches Waitron's request digest; the manifest includes all 15 owners and binds
  package, dependency, migration and policy data to that release. These encoding
  checks do not verify an archive. The next additive migration stores immutable
  attempt bindings, keeps historical verdicts separate, and supplies a current
  qualification view. Old successful checks retain their retention protection but
  gain no current qualification. The policy starts empty with its release gate
  closed; old recovery requests gain no target identity. A dormant native runner
  now sends the request and matching key in separate bounded private frames and
  calls only the compiled verification bundle. Its result is checked after process
  exit and private scratch cleanup. A pinned-bundle probe matches all 15 owners,
  refuses synthetic invalid archive bytes and a missing migration journal, then
  repeats after restoring that journal. This is invocation evidence, not genuine
  archive success or Docker isolation. The controller's dormant bound interface
  now journals the same request token, claim and deadline, checks exact ownership
  on removal, and refuses ambiguous or unknown create outcomes. Private journals
  reject symbolic links, broad permissions, duplicate fields and oversized data.
  The dormant Docker adapter now streams those frames directly into the compiled
  verifier, checks the exact child, image, request and resource settings, and
  confirms removal before returning a result and ownership receipt. Real Docker
  checks cover private input, output forgery, resource limits, isolation, cleanup
  refusal and a watchdog that survives its host. The immutable local image builds
  from the pinned source and generated runtime stamp; all 15 owners match the
  complete target. It refuses synthetic bad bytes and a missing actual migration
  journal. These are boundary and invocation checks; genuine archive success is
  still unproved. A dormant database admission core now binds each attempt to its
  live claim, complete policy, publication metadata and terminated, removed child.
  It atomically records the outcome, point pointers and job transition. A final
  time check rolls back all changes if a blocked write outlasts the lease or
  request deadline. PostgreSQL tests cover all five outcome categories, duplicate
  results, policy changes and explicit lock waits; synthetic results prove this
  boundary, not archive recovery. The dormant catalogue claim pipeline now connects
  storage, key unsealing, independent byte measurements and encrypted-stage disposal
  to that core. It passes only the matching archive key to the verifier, records
  thrown or inconsistent results as unavailable, lets cleanup uncertainty override
  passed and invalid results, and rejects expired results without changing job
  state. PostgreSQL checks cover cancellation during cleanup, fresh retry tokens,
  storage/key errors and policy, deletion and claim changes during external work.
  These checks use synthetic child results. The worker now uses the strict claim
  pipeline and the callback-success catalogue method is removed. Both runtime
  entry points pass the persistent controller scope and pin the implementing
  Waitron revision. Jobs wait for a configured target; policy locks precede
  claims and retention venue locks. Late verification, error and cancellation
  results leave expired claims untouched. Existing tests now seed explicit
  synthetic bound evidence, while the genuine local proof requires the bound
  image as well as its original independent checks. Machine recovery now negotiates
  Waitron's exact v2 signed target binding, persists it with the fresh request key,
  and returns the selected immutable attempt's descriptor on snapshot info/read.
  Replays cannot change the target or downgrade versions. The machine-only reader
  rejects duplicate fields and malformed UTF-8, accepts bounded complete targets,
  and caps responses at 65,536 bytes without widening owner forms. Synthetic
  database and HTTP checks cover all three target actions, signature expiry after
  a confirmed lock wait, and unchanged v1 continuous recovery. Every snapshot
  approval now requires a persisted v2 request and current qualification. Metadata,
  keys, restored reports and replacement prepare, completion and completed-result
  lookup all recheck the exact approved evidence; a newer success cannot silently
  replace it. Snapshot defaults use current qualification. Policy locks precede
  venue locks, and provider grants are rechecked before credentials leave Cloud.
  PostgreSQL barriers prove refusal after policy, evidence or metadata changes and
  expiry during waits, with complete rollback of registration, key rotation and
  routes. Synthetic fixtures explicitly opt into disposable release readiness;
  their existing owner, plan, confirmation and continuous-recovery assertions stay.
  Catalogue pages, diagnostics, venue summaries, monitoring and operations status
  now use that same current evidence. A queued backup notice rechecks the actual
  point before delivery; inconclusive work cannot create a failed-copy notice.
  Historical successes still protect the fallback, bytes and key dependencies.
  History cleanup keeps attempt evidence and its job until both explicit cutoffs,
  recovery references and usage records permit removing the complete graph; a
  locked child leaves all its history intact. Focused PostgreSQL checks cover
  these decisions and acknowledged retention/admission/policy lock waits.
  These are synthetic boundary checks. A local parallel backup run reached the
  container-worker deadline and returned a wall timeout instead of the CPU-limit
  result in `verify-process.test.ts`. Both unchanged files pass isolated runs;
  `node --test --test-concurrency=1 --test-timeout=30000 'test/*.test.ts'`
  in the backups package passes all 757 tests. The original resource failures
  remain unexplained. Capture Docker stages, host deadline and CPU-limit timing
  if they recur; keep the limits and assertions intact.
  The genuine joint proof is described below. Snapshots
  stay unavailable and deployment enforcement stays off. The unavailable backup
  profile now has a private writable controller-state volume separate from its
  read-only configuration. It still receives no Docker socket.
  An unsuccessful Docker create with no discoverable exact child retains its
  private intent after expiry and blocks restart. A delayed exact child is reclaimed
  before fresh work; an outcome that never resolves can stop verification indefinitely.
  Define and qualify recovery from a definitive daemon rejection before relying on
  automatic availability. Do not clear uncertain journals merely to resume work.
  Task 9 adds portal wording that separates checked data from activation and treats
  inconclusive checks as pending. The version 5 schema proof targets migrations
  42-to-43 with synthetic legacy history, recovery holds, external backup keys,
  current evidence and v2 request bindings. The actual old-to-new/disaster proof
  passes on `ee927ed9ac4486f4d9166e0c95ac661eab674bf5`, including interrupted
  rollback, old-binary refusal and cleanup. It exposed helper lookup failure during
  `pg_restore`; unlanded migration 043 now retains its schema search path. All 42
  shipped migrations remain unchanged. The genuine joint proof is described below;
  release remains unqualified. Earlier receipt versions and fiscal authority rules remain unchanged.
  The PR5 adapters are reconciled with current main, preserving their earlier
  storage, account, remote and controller behavior and historical test evidence.
  Task 10's new version 2 receipt validator refuses missing genuine phases,
  incomplete module coverage, substituted image/request/attempt evidence,
  continuous-source presence, uncertain cleanup and publication claims for a local
  candidate. It keeps ordinary fiscal refusal distinct from a complete proof.
  The receipt producer and genuine joint orchestration record version 2 evidence
  for one complete local run, retaining the primary fiscal refusal alongside
  separately authorised ordinary recovery.
  Waitron A1004 is now pinned at `ec91a9e34d2daba146f4ee61850ea4136ad5cfb7`.
  The build compares the complete compiled target, including all 15 owners and
  the newer core/venue-service schemas. The older target is refused. Genuine
  local capture now verifies with worker threads still denied. The fixture creates
  its synthetic certificate with Waitron's existing generator and normal vault
  writer before capture; missing credentials correctly remain unavailable.
  Wrong-key and changed-byte controls refuse, and the untouched archive passes
  afterward. Signed publication through the real machine API, storage staging,
  scoped worker verification, committed current evidence and child removal pass
  together. Continuous stream objects and database pointers are checked absent
  before capture, after publication and after admission. Only the disposable proof
  database enables release readiness. The same scenario now compiles the pinned
  Waitron v2 client with its unchanged restore boundary. The owner API chooses the
  qualified default and approves the exact committed attempt. The real client
  checks target info, scoped storage delivery, digest and size before staging.
  Ordinary restore reaches the unchanged fiscal-authority refusal, reports no
  restored state and replaces no installation. Continuous objects and pointers
  are checked absent at all nine boundaries. The version 2 producer emits actual
  bound evidence only after confirmed cleanup. Both producer and strict validator
  certify the complete local scenario only with its separately authorised recovery
  and all same-run controls. The final release gate remains due. Historical two-venue resource and
  security assertions remain available without qualifying the newer contract.
  The same genuine run now refuses an alternate runtime target before any remote
  read and a damaged downloaded copy before staging, preserving recovery state.
  The same run now captures the authorised A1017 source through the normal
  backup writer, publishes it, verifies all 15 modules, admits it and delivers it
  through the pinned compiled v2 client. The private capture container receives
  those exact delivered bytes and their archive key before preparing ordinary
  recovery. Its recovered counters remain 123; fresh series begin at 1 and two
  allocations exist. Wrong node keys and missing module preparation preserve the
  destination. Changed delivery bytes, keys and digests refuse before recovery.
  The optional `authorisedRecovery` evidence binds this separate fiscal activation
  to the same run, archive, point and verification attempt. It preserves the
  unchanged no-authority refusal and records no Cloud activation or route movement.
  The same run now executes wrong-key, damaged-archive, malformed-output, timeout,
  full-scratch, cancellation, forced-crash and uncertain-cleanup controls in fresh
  exact-image children, then verifies the untouched archive again. Each outcome
  binds the admitted source request, captured bytes, unique child, claim and token;
  a refused child publishes no accepted verdict. All owned children are removed.
  Bounded compressed transport preserves the enlarged receipt through the test
  runner's output chunks. The same run now also makes the kernel kill an exact
  verifier child at its unchanged 1 GiB memory/swap limit. Its receipt requires
  Docker's OOM flag, exit 137 and confirmed removal. A format-2 request over the
  same captured bytes returns the pinned runtime's genuine unsupported-format
  outcome; the untouched archive still verifies afterward. These controls do not
  exercise a module's needs-authority outcome. Placement and recovery certification
  use the same delivered bytes' separately authorised restore, while the primary
  client remains refused with no activation or route movement. Remaining
  receipt/release checks remain due. A local image
  export also failed because Docker could not find a parent snapshot; a build
  without cached-layer reuse exported successfully. The cache failure's cause
  remains unverified.
  A source release does not establish
  a published verifier image or qualify any snapshot. Snapshots
  remain unavailable on this test deployment, and enforcement stays off until the
  implementation, evidence and release gates pass.
  The thirty-day leaf and one-year CA currently fail closed on expiry; same-CA
  in-volume renewal remains a maintenance follow-up. Continuous box supervision,
  coordinated image/schema upgrades and volume-to-volume rollback still need the
  final deployment slice; the driver refuses an image change meanwhile.
  The private storage adapter persists separate stream writers and recovery readers,
  saves withdrawal intent before provider reload, checks actual signed storage
  refusals and creates a fresh writer after explicit upgrade provisioning. Its
  plan wrapper rejects free/production venues, catches a free/paid change between
  polls and withdraws writers on a policy database failure. Reopening retries an
  interrupted withdrawal. Native SeaweedFS tests exposed static reload merging:
  deletion alone left the old writer active, so withdrawal uses an explicit
  disabled identity. Missing private state cannot silently reset an existing
  managed identity file. A private persistent issuer supplies scoped OIDC tokens
  and fifteen-minute STS configuration. The dedicated storage process and account
  runtime now share private volume state and a reload socket without Docker access.
  Storage starts without venue keys, reconciles current plans before healthy status,
  and advertises trusted `https://waitron.local:8333` through internal resolution.
  A real disposable-container proof sends signed account HTTPS requests: free
  snapshot/stream requests return 403 permission_denied, paid credentials are
  distinct and scoped, and normal/restart downgrade rejects old writers while
  preserving the neighbour, retained data, recovery key and reader. Explicit
  upgrade returns a fresh writer. Reprovisioning now compares location fields
  independently of object property order; PostgreSQL tests preserve all three
  location and installation-ownership fences. In explicit test mode, the test manifest
  worker now runs the real remote reconciler with private local certificate inputs.
  Signed staff requests receive LAN-CA chains; public keys remain volume-backed.
  The gateway accepts populated readiness and rejects stale status. Its opt-in
  certificate watch reloads the proxy after renewal; a real failing renewal proof
  preceded the fix. The delivered Docker proof covers two distinct WireGuard peers,
  staff bodies, trusted public TLS/challenge, replacement certificates, downgrade
  and pending-at-restart withdrawal while preserving the paid neighbour. Latest
  measured withdrawal was 1,162 ms, including the operator command; it is not a
  production deadline. The assigned local names use r.waitron.local; there is no
  public DNS or outside-home availability. The backup worker selects the canonical
  endpoint and LAN CA in test mode. Its dedicated controller now records a private
  child ID and token before admitting further work, checks image and ownership
  before deletion, and refuses missing or uncertain state. One database session
  admits one trusted worker; its verifier retains the 1,024 MiB memory and 256 MiB
  scratch limits, no network, no socket and no host mounts. Local Docker checks
  cover decoys, interrupted creation and resource boundaries. The verifier also
  accepts Waitron's file-backed validated database while retaining integrity,
  node, module, capture-time and restore-hook checks and the older fixture path.
  Genuine paid snapshot verification is **blocked**, not proved: the pinned
  Waitron revision `e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee` captures and publishes
  an archive, but its fiscal restore hook refuses verification with
  `restore.hook_failed` / `sif.allocation_invalid`. A separately agreed verification
  contract must resolve the required allocation authority without silently
  granting fiscal writes or skipping that hook. Keep the backup profile unavailable
  and deployment enforcement off. Final LAN/client integration also remains open.
  The first real fifteen-minute STS
  run observed InvalidAccessKeyId after its recorded expiry, but its new assertion
  wrongly expected the expired-identity error from the STS endpoint. That run is
  failed evidence, not a green test. A corrected full-duration run now passes:
  an accepted write before its 02:43:00Z expiry is refused with S3 403
  InvalidAccessKeyId at 02:43:01.013Z on 18 October 2026. The short diagnostic
  remains separate. The isolated local-stack receipt now
  supplies PostgreSQL to these policy tests. Concurrent native fixtures reuse a
  verified cached archive without rewriting it, and publish downloads by atomic
  rename; the first combined run exposed a truncated shared-archive read, and a
  read-only-cache regression test covers the corrected path.
  Deployment enforcement is still off. Three remaining implementation slices,
  real remote/verifier adapters, LAN deployment,
  two-organisation acceptance and measured headroom remain open. The existing
  Waitron venue is quarantined; use a separate disposable Waitron test venue and
  leave its running containers and data untouched. Keep address providers disabled
  and the existing translation release gates in place. A free plan permits a
  service only after that service's independent prerequisites pass.
- **Translation worker lock-probe timing is now independently exercised.** The
  existing review-totals case put a PostgreSQL lock probe inside its fake HTTP
  response while the real client allowed 100 ms. A controlled 150 ms probe on
  landed base `050084752f1c57b00183582a2d16d33b0555f5e8` produces a provider timeout
  and three requests instead of the expected two. The probe now runs at the
  worker's provider-call boundary before starting that same HTTP deadline, with a
  deliberate 150 ms database delay. The original done/review totals, NOWAIT lock
  check and exact two-request assertion remain; both provider calls are probed.
  The earlier unexplained observations remain separate unless their exact trace
  matches this reproducer. No provider retry policy, production code or deadline
  changed.
- **Password-login recovery-row expiry setup.** The recovery-row test now starts
  its unchanged 500 ms challenge expiry after acquiring the row it will hold.
  A deliberate 650 ms setup delay reproduces the earlier missing-lock assertion
  with the old ordering and passes with this precondition. The 550 ms held-row
  wait, lock observation, zero sessions, one spent attempt, unconsumed recovery
  code and 30-second test deadline remain unchanged. No authentication code or
  policy changes. [Run 39112504573](https://github.com/waitron-io/waitron-cloud/actions/runs/39112504573)
  did not capture expiry/setup stages, so its exact historical ordering remains
  unproved. Capture those stages if the same assertion fails again; do not extend
  its authority window or test deadline to hide a failure.
- **Local package validation must avoid concurrent full-package groups.** Four
  two-file-worker groups overlapped during D79 and the registration control CLI
  exceeded its unchanged five-second command bound. A landed-base phase probe
  completed every node/root/package command in under 700 ms after reducing the
  overlap; acknowledgement-to-close took at most a few tens of milliseconds.
  This does not prove the cause of the earlier nine-minute stall. Run local full
  package suites sequentially with two file workers and retain the five-second
  assertion. Capture process/phase timings if it fails under that arrangement.
- **Local registration run stalls after earlier failures.** In the test-plan
  review checkout at `cc99eef378bd9db2716a2325cd07fbe491ab06c9`,
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration test`
  emitted failures and left its sole `relay-control.test.ts` child alive for more
  than nine minutes despite the 30-second test timeout. The driver stopped that
  recorded child. An isolated run of the same command on landed base
  `f56b4c8595ed3cb81d0931352c0bac2880648e18` reproduces PostgreSQL
  `out of shared memory` within seven seconds; it was stopped after that observed
  failure. This proves a baseline resource failure, but not the cause of the
  nine-minute child stall. Neither interrupted run is a pass.
  The review's default-concurrency account suite also emitted failures. Complete
  registration/account suites passed all 679/382 tests with two file workers on
  the corrected PR2 branch. PR3 passes 679/384 and runs full packages sequentially. Capture the full output of both default-concurrency commands,
  without piping it through `head`, and diagnose failure cleanup and resource
  contention. Preserve every assertion and deadline; do not treat a rerun as a fix.
- **Operating cost.** You can compare the running platform and per-venue usage
  with the [offline calculator](cloud-cost-calculator.html) and
  [model explanation](cloud-cost-model.md). They show priced subtotals at zero,
  1, 10, 100 and 1,000 venues, with editable assumptions, English and Spanish,
  light and dark themes, and layouts for 390 and 1280 pixels. The complete bill
  remains unknown. Blank inputs and missing billing terms stay named gaps;
  neither a priced subtotal nor a successful verification command means the
  service has a complete or provider-validated operating budget.
  The [approved design](superpowers/specs/2026-10-14-cloud-cost-model-design.md)
  and [implementation plan](superpowers/plans/2026-10-14-cloud-cost-model.md)
  define this evidence boundary.

  **Public inputs and arithmetic.** The [resource inventory](cost-model/inventory.json)
  covers required capabilities, runtime roles, alternatives and excluded future
  products. The [price snapshot](cost-model/prices.json) records dated Spain,
  Stockholm and global rates, their exact sources and billing dimensions.
  Missing regional prices, minimums and rounding rules stay unknown. The
  calculator uses the same validated model in Node and the browser. It prices
  whole gateway/database capacity steps and aggregate request tiers, preserves
  startup and idle work when sales are zero, and simulates calendar archive
  growth. Month-one and later-retention storage are alternative windows, never
  added into one month. Resource size, capacity, future growth, traffic mapping
  and low/base/high sensitivity remain assumptions. Daily and monthly archives,
  continuous-stream retention and noncurrent versions remain distinct.

  **Accepted local samples.** The [joined evidence](cost-model/local-driver-evidence.json)
  preserves each experiment's source revision, clock, scope and limitations:

  - The [stream receipt](cost-model/measurements.json) replays all 207 selected
    sales through the pinned Waitron sale writer, preserving its normal fiscal
    integrity checks. It observes startup, accelerated workload, 1,200.009
    seconds of idle traffic and a successful native restore. Copied source size
    is 19,546,112 bytes; fresh-venue database growth is 700,416 bytes. All 342
    physical requests reconcile between independent counters, including setup,
    observer, restore, cleanup and eight failed attempts. Retained byte-seconds
    have explicit lower/upper bounds. This short unversioned experiment observes
    neither a full trading day nor a scheduled snapshot/compaction boundary.
    A separate three-sale original-cadence control exposes batching sensitivity;
    its different duration/background work cannot supply a daily correction.
  - The [selected-sale archive](cost-model/archive-replay.json) captures a
    3,527,677-byte archive and restores all 207 sales through the application
    with valid integrity and owned cleanup. The
    [one-sale storage sample](cost-model/archive-storage.json) separately measures
    a 2,835,270-byte generated archive, eleven storage attempts, a complete and
    range read, HEAD, listing, an abandoned multipart part and cleanup. Its
    transfer counts cannot substitute for the selected-sale archive's transfers.
  - The [generated owner browser journey](cost-model/remote-owner-browser.json)
    measures 2,836,968 encrypted response bytes through the real isolated gateway,
    including cold/cached loads, sign-in, dashboard, reconnect and sign-out.
    Interrupted stream bodies and IP/TCP/WireGuard overhead remain outside its
    body counters. The separate [owner/public API sample](cost-model/remote-owner-public-api.json)
    covers generated API actions. Choose one owner scenario; summing API and
    browser scenarios would overlap. Neither sample measures typical venue
    activity, public browser use or provider-billed transfer.
  - The [mail retry and fiscal lifecycle](cost-model/service-mail-retry-fiscal-lifecycle.json)
    and [signup, recovery and refusal](cost-model/service-signup-recovery-fiscal-refusal.json)
    samples preserve captured-mail attempts, refusals, retries and fiscal HTTP
    body counts. They issue no additional fiscal authority through replay or
    inspection. SMTP bytes, production alert eligibility and monthly service
    frequencies remain unknown.

  **Private measurement controls.** Online SQLite copies include committed
  transaction-log writes without migrating, checkpointing or reseeding the source.
  Private replay uses only owned scratch and an internal Docker network, checks
  effective isolation before opening data, excludes live credentials/senders and
  runs the genuine pinned writer/archive/restore paths. Every storage HTTP attempt
  is metered independently, including retries, failed replies, versions, deletion
  batches and unfinished multipart work. Unknown or ambiguous histories refuse
  complete evidence. Cancellation collects admitted writers before closing their
  measurement transports; replaced paths, lost ownership or unverifiable cleanup
  refuse deletion and retain the recorded resources for explicit recovery.
  The [generated conformance fixtures](../scripts/cloud-cost/fixtures/) exercise
  these boundaries. No fiscal allocation, hash-chain or golden rule is changed.
  Raw data, names, row identities, object keys, credentials and payloads stay on
  the Mac. Closed anonymous export rejects extra/hidden fields and raw canaries.

  The generated streamed-day check now prints its fixed outer stage and the last
  32 validated replay/native events when it refuses. The parent prints this
  evidence explicitly before rethrowing the child-command failure; raw exceptions
  and private fields are excluded. Run
  `node --test scripts/cloud-cost/streamed-day-diagnostics.test.mjs` for native
  child controls, the actual smoke catch, reporting failures and owned cleanup.
  This addresses the missing evidence in
  [run 41003745800, job 123893874129](https://github.com/waitron-io/waitron-cloud/actions/runs/41003745800/job/123893874129),
  which stopped at `private-replay`. Its historical Linux cause remains unknown.
  Capture a labelled recurrence and reproduce it with the pinned runtime when
  Docker returns; preserve accounting, cleanup, existing assertions and deadlines.

  **Forecast and live-check limits.** The [component projection](cost-model/usage-projection.json)
  applies explicit [assumptions](cost-model/projection-settings.json), preserving
  separate phases, failures, retry identities and source windows. Default future
  sales are an assumed 207/day after saved-clock reconciliation, rather than the
  earlier midnight-based source-selection count of 203. Owner/public/service/
  recovery frequencies start unset. This projection is not a complete daily
  object-size/lifetime, version, multipart, schedule or retry vector.
  The [trial assessment](cost-model/live-check.json) therefore stops before any
  AWS creation. Its illustrative high-cadence workload component alone projects
  130,000 requests above the 10,000 cap before cleanup. That sensitivity is
  assumed, not a proved upper bound. An under-cap base estimate cannot bound
  missing work, and no measured operation may be truncated to make the trial fit.
  No resources or synthetic payloads were created for this trial, and no billing
  read is due for it. The earlier storage rehearsal and its follow-ups stay separate.

  Local preflight helpers reserve cleanup requests/time, versions, multipart,
  active key hours and delayed/cancelled-deletion contingencies; unavailable
  applicable credits or missing price bounds refuse a plan. Consumption guards
  charge attempts before dispatch and refuse reused/altered budgets. These checks
  establish no generated-byte provenance or provisioning authority. Billing helpers
  compare gross usage and credits separately, retain prior-key/other/ambiguous
  lines, flag cost or quantity differences above 20%, and plan at most three
  physical reads including continuation/retry. They perform no provider I/O;
  independent synthetic generation, an owned-resource runner and durable billing
  execution remain future prerequisites if the stopped trial is ever revisited.

  **Rebuild and verify.** Run `node scripts/cloud-cost/cli.mjs build` and
  `node scripts/cloud-cost/cli.mjs verify`. They read only public inputs and
  compare the generated HTML, explanation and stop assessment without starting
  private replay or contacting AWS. `pnpm test:cloud-cost` runs synthetic checks
  and artifact verification; CI includes it alongside all five prior receipt suites.
  Compiler, real-browser, deliberate-fault and generated local-storage checks cover
  the model and its boundaries. Storage-only evidence validates neither fixed
  infrastructure, AWS capacity nor a full provider bill.

  Run `pnpm test:cloud-cost:conformance` for the deeper generated-data checks.
  Its setup fetches the pinned public Waitron source, compiles the required
  runtime exports and prepares local images without a venue source path. CI
  discovers all eighteen files, with the longer stack file split into three
  disjoint groups. Publication verification remains separate and offline.
  The model command verifies public inputs and artifacts. The owner-approved native deadline
  fixture holds its generated idle observation until shutdown is requested,
  preserving both original 43/44-second limits and every source, startup and
  cleanup assertion. It also requires deadline and cleanup to finish within
  56 seconds. The real generated cancellation and deadline checks both pass;
  neither check changes a production timeout.
  Linux conformance exposed a PostgreSQL initialization race: temporary database
  files now live on container-native scratch, outside the scanned ownership tree.
  The merge's unversioned ambiguous-multipart case also refused stack startup
  before its storage assertions. Generated Linux timing probes reproduce ownership
  scans racing deletion of `state/replay/venue/migrations.lock-journal`
  (`39635884776`), `state/mail.db-journal` and a storage `config.json.tmp`
  (`39636087276`, stack group 3). The generated venue, mail and storage databases
  now live on container-native scratch, outside that scan. The ownership guard
  stays unchanged. Separate real-service regressions check that sales, integrity,
  mail and storage still work without placing mutable service data on the host
  mount. Each generated service has a 64 MiB private scratch limit. Keep fixture
  data within it or make a separate bounded capacity change before larger uploads.
  The earlier stream-startup failure (`39616174409`) and merge refusal
  (`39627846860`) had no underlying trace; attributing those exact historical
  failures to these races remains an inference. Keep their logs and all ownership,
  isolation, accounting and cleanup assertions and deadlines. Temporary diagnostic
  workflows are removed.
  Another stack-start refusal occurred in
  [run 39743485615, stack group 1](https://github.com/waitron-io/waitron-cloud/actions/runs/39743485615/job/119706230844):
  `genuineArchiveAndSignedSdkTrafficReconcileThroughRealStorage` failed after
  3.6 seconds before its archive assertions; the other nine group cases passed.
  `startIsolatedStack` replaces its underlying error at `local.mjs:659`, so the
  cause is unknown. The test-image handling branch changes no cost runtime,
  fixture or workflow. The exact case passes locally through the new launcher
  with all archive, accounting and cleanup assertions intact. That passing probe
  explains neither the Linux failure nor a correction. Next: capture a bounded,
  sanitised startup stage and underlying refusal before cleanup, then reproduce
  it without relaxing ownership, isolation, accounting or cleanup checks.
  A separate paced-replay check refused after 75.8 seconds in `39637622744`.
  Its saved error is generic and exposes no underlying stage. One generated-only
  instrumented Linux run passes (`39638725311`); this does not establish a cause
  or correction. The paced-replay worker does not use the stack service runtime
  changed above. The isolated controller now preserves a bounded failure trace
  after normal cleanup and during result admission: fixed replay and stream stages,
  native exit codes and signals, stderr byte counts and fixed keyword flags. Unlisted signals
  use a fixed `other` code. The paced test prints the complete admitted trace on
  failure. If diagnostic inspection, JSON serialization or the reporter fails, you
  still receive the exact original replay refusal. The reporter reads only an own
  data property, without invoking accessors; native checks cover null and undefined
  refusals, hostile proxies, circular and non-serializable diagnostics, and failed
  output. Run `node --test scripts/cloud-cost/replay-diagnostics.test.mjs` for these
  checks. Raw output, paths and exception text stay private. Diagnostic traces
  and native keyword lists now require plain dense arrays with visible own data
  indices. Trace fields must also remain visible when copied;
  sparse arrays, accessors, proxies, custom properties and custom prototypes
  refuse before executable properties run. This prevents a keyword getter from
  changing an admitted flag into private text while the validated trace is copied.
  Native checks reproduce that substitution and preserve the existing label/count
  bounds and independent copies. Run
  `node --test scripts/cloud-cost/worker-trace-arrays.test.mjs`.
  This qualifies the in-process validator; it does not establish that an external
  caller can supply such objects through the worker's JSON files. Generated failures
  exercise the worker boundary and malformed-trace refusals. If resource cleanup
  itself refuses, its error can still be generic; preserve the private journal's
  validated trace before fixture cleanup. Both historical paced failures remain
  unexplained. Capture the trace on recurrence and fix its cause; preserve the 207-sale restore, integrity, source and
  cleanup checks and limits. An unchanged generated reproduction passed 13 times
  locally and 36 times across all 12 jobs of
  [Linux run 39857085282](https://github.com/waitron-io/waitron-cloud/actions/runs/39857085282)
  at `42f3b05d981769fb754ebcf984766a4f885f284e`. These passes do not identify or
  correct the historical failures. Local scratch samples peaked at 22,444 KiB
  within the unchanged 65,536 KiB limit; those samples do not establish the peak
  during a failure. The temporary branch-only investigation workflow is removed.
  A controlled child-process test separately reproduces premature stream readiness:
  a completed read can release workload before the first successful upload.
  Readiness now waits for a completed successful native PUT, matching the existing
  startup admission requirement. Reads, refused and unfinished writes do not
  satisfy it, and the original deadline still collects a writer that never uploads.
  This fixes the reproduced readiness gap; without a trace from the historical
  failures, it does not identify their cause. Startup observation keeps the original
  first-transfer clock and overlaps upload readiness. The first candidate instead
  waited for an upload and then began a separate observation; a real generated
  reproduction exhausted the unchanged 4.01-second deadline during startup.
  The corrected composition preserves the full two-second observation, the idle
  refusal, early-timer-wake checks and every original deadline. Diagnostic-only
  generated failures now retain their phase and elapsed-stage trace.
  A controlled hang-child reproduction now distinguishes a child that stops
  writing but ignores termination from one that keeps writing until forced
  collection. The original hang fixture kept scheduling uploads after SIGTERM;
  holding its next upload reproduces the generic cleanup refusal from
  `39953541488` receipt job `120415065191`. The hang fixture now suspends itself
  on SIGTERM until the unchanged two-second forced kill.
  Its delayed regression holds uploads only after SIGTERM and requires SIGKILL
  and exact owned-resource collection. A separate
  still-writing child must refuse interrupted accounting while reporting completed
  resource collection. Production code, original assertions and deadlines remain
  unchanged. The historical job has no transfer trace, so attribution to this
  reproduced overlap remains an inference. Earlier paced failures stay unexplained.
  The same named paced-replay test also failed after 76.1 seconds in
  [run 39829272927](https://github.com/waitron-io/waitron-cloud/actions/runs/39829272927/job/120000877058),
  while qualifying the browser-source repair after Actions recovery. Its image
  build completed, then `runIsolatedReplay` returned the same generic error.
  That diagnostic head changed no cost-model files relative to `5b709aa`.
  Its saved log has no underlying worker stage; the later bounded traces and
  separate startup correction do not establish that historical failure's cause.
  A later paced failure in
  [cost run 40489223783, job 122138753711](https://github.com/waitron-io/waitron-cloud/actions/runs/40489223783/job/122138753711)
  stops at `quiesce` after a zero native exit, before restore. That label combines
  several independent checks. You now receive separate fixed codes for waiting
  for idle transfers, waiting for child collection, validating its stop result,
  checking post-stop health and checking storage accounting. A separate code
  marks restore admission after that checkpoint completes. Cancellation can
  refuse any active operation; these codes identify its boundary, not its cause. Native child/HTTP tests
  distinguish nonzero stops, interrupted transfers, cancellation after a zero
  exit and inconsistent storage inventory after a zero exit. A held child
  reports collection in progress before the unchanged forced-kill timer fires.
  Each controlled failure refuses publication and collects owned resources. Run `node --test
  scripts/cloud-cost/replay-stream.test.mjs scripts/cloud-cost/replay-quiesce-diagnostics.test.mjs`.
  The historical cause remains unknown; capture the new boundary on recurrence
  before changing any accounting, ownership, restore or deadline guard.
  Another paced replay refused at `quiesce-checkpoint` after a successful native
  stop in [run 40954158356, job 123729967144](https://github.com/waitron-io/waitron-cloud/actions/runs/40954158356/job/123729967144).
  You now receive a fixed `measurement-refusal` code distinguishing checkpoint
  admission, independent inventory verification, rejected traffic during verification
  and accounting snapshots. A request refused while inventory is running has its
  own traffic code, even when it later poisons accounting. Cancellation is labelled
  by the operation it interrupts. The code
  survives replay and worker admission without exposing raw storage errors. Native
  HTTP controls refuse closed sessions, unobserved objects and overflowing storage
  totals; a native writer control verifies forwarding after a successful stop.
  Reporter exceptions cannot replace the refusal or prevent listener collection.
  Run `node --test scripts/cloud-cost/stream-checkpoint-diagnostics.test.mjs
  scripts/cloud-cost/replay-stream.test.mjs`. These controls reproduce diagnostic
  boundaries; the historical Linux checkpoint cause remains unknown. Capture the
  new code on recurrence before changing accounting, ownership or deadline checks.
  The D121 recurrence in [cost run 40144665901, job 121023380173](https://github.com/waitron-io/waitron-cloud/actions/runs/40144665901/job/121023380173)
  reaches `storage-cleanup` after successful native replicate and restore exits.
  Cleanup now retains its first refused operation as a fixed `storage-refusal`
  stage in the worker trace, including inventory, deletion, accounting and resource
  collection. Generated failures exercise persistence and reporting containment;
  real-backend checks cover SDK refusals and retained-inventory disagreement.
  Separate worker codes identify failure while constructing cleanup input or
  shaping its result. All eighteen storage codes have generated fault checks.
  The historical cleanup operation and cause still need an instrumented recurrence
  and reproduction. Accounting, ownership checks and deadlines remain unchanged.
  A generated setup-client shutdown exception no longer stops independent cleanup.
  The worker tries a fresh cleanup client, collects its owned bucket when that
  client opens, and closes its listener and child process. Any failed step still
  refuses measurement and retains the private directory; a failed replacement
  client never sends requests through the stale setup client or records a bucket
  cleanup intent. A client whose instrumentation fails is closed before refusal.
  The first fixed diagnostic remains available without raw SDK errors. Whether the real SDK
  naturally throws there and the historical Linux cleanup cause remain unverified.
  The successful browser journey also refused in
  [run 39890570428](https://github.com/waitron-io/waitron-cloud/actions/runs/39890570428/job/120209134728),
  while all six deliberate-fault journeys passed. Its wrapper retained only the
  generic refusal. Browser failures now retain a fixed phase through the generated
  child boundary, without printing launch errors, URLs or credentials. The complete
  seven-case journey passes locally; that pass does not identify the historical
  failure. A later merge cost run
  [40004973526](https://github.com/waitron-io/waitron-cloud/actions/runs/40004973526/job/120590562266)
  refuses the successful journey during reconnect after 16,602.897 ms; all six
  deliberate-fault journeys pass. Setup completed and the same tree passed all
  seven cases in exact-head run `40003626992`. The historical operation and cause
  remain unknown; the duration alone does not establish a timeout.
  Reconnect failures now carry one of four fixed operation labels through the
  generated child boundary: reload, takings, overdue-empty or requests. Controlled
  failures exercise each browser operation, and a real child-process check carries
  only the allowed labels into the parent refusal. Raw browser errors, URLs and
  credentials stay out of the diagnostic. Run
  `node --test scripts/cloud-cost/browser.test.mjs scripts/cloud-cost/browser-diagnostics.test.mjs`
  to check the labels, redaction and unchanged failure cleanup. Every original
  accounting, isolation, cache and cleanup check and deadline remains intact.
  A later recurrence in
  [40092022379](https://github.com/waitron-io/waitron-cloud/actions/runs/40092022379/job/120866647453)
  identifies reconnect/takings. The whole test took 16,188.328 ms; that is not
  a measurement of the takings wait. It still has no underlying error category.
  Reconnect refusals now retain three more fixed observations: whether the thrown
  error identifies itself as a timeout, the last session-check response observed
  during reconnect (accepted, refused, other or none), and whether a page error
  occurred during reconnect. A later session response replaces an earlier one;
  this label does not preserve the full response history. These observations use
  existing events and add no browser request or wait. Only the fixed labels cross
  the generated child boundary; exception text, URLs, credentials and page content
  remain private. Run `node --test scripts/cloud-cost/browser-refusal-evidence.test.mjs`
  alongside the command above to check the boundary, unusual thrown values and
  failed diagnostic output. Original tests and journey deadlines stay unchanged.
  Capture an instrumented Linux recurrence before attributing the historical
  cause. A passing unchanged repeat would not explain it. Local Docker-backed
  qualification remains unavailable until Docker returns; CI runs the real journey.
  Reconnect refusals also retain fixed request-event counts, grouped by known
  route, whether Node first observed the request before or during reconnect,
  and lifecycle event. This does not establish when Chromium issued it. Pending requests remain visible, including streams from before reload.
  Counts saturate at 999; raw paths, query strings, bodies and network errors
  are never printed. These passive observations add no request or wait and do
  not change the existing accounting refusal or deadlines. A not-modified
  response (HTTP 304) has its own label, separate from a redirect. Run
  `node --test scripts/cloud-cost/browser-traffic-evidence.test.mjs` for the
  controlled lifecycle and real child-boundary checks. The cause of the Linux
  takings timeout and outstanding-request refusals remains under investigation.
  Twelve independent Linux observations ran the complete seven-case group at
  diagnostic heads `6bdf753` and `a58e794`: all 84 cases passed. A later instrumented
  recurrence in [run 40122070386](https://github.com/waitron-io/waitron-cloud/actions/runs/40122070386/job/120955659784)
  times out at reconnect/takings with an accepted session and no page error.
  Both overview and overdue requests fail, alongside other API and live-stream
  requests. These counts do not identify the underlying connection failure.
  Reconnect refusals now retain the byte-counting relay's first refusal category
  before browser cleanup. You can distinguish a socket reset, refused connection,
  broken pipe or other socket error, timeout, incomplete close, empty exchange,
  admission or byte limit, cancellation, observation-window end, listener error
  or accounting refusal.
  `none` means the relay had not refused when the browser error was caught.
  Later cleanup cannot replace the first category. Socket sides identify the
  browser-facing client or gateway-facing upstream; raw network errors and payloads
  stay private. Run `node --test scripts/cloud-cost/remote-refusal-evidence.test.mjs scripts/cloud-cost/browser-relay-evidence.test.mjs`
  for real relay sockets with controlled resets and injected faults, preserved
  accounting refusals and the child-process diagnostic boundary. These controls do not establish the historical Linux cause.
  Browser readiness waits for stream-open callbacks and their reads, rechecks
  requests while response sizes settle, and retains the three-second deadline
  and every byte-accounting guard. Run
  `node --test scripts/cloud-cost/browser-readiness.test.mjs` for these boundaries.
  The browser source now includes Waitron's
  [document-lifecycle repair](https://github.com/clintongormley/waitron/pull/2279)
  at `99c265981ba98f1afd0e5fc822624a9a91822ad2`, alongside D499's supported
  generated authority, routes, assets and storage identity-port handoff. Replay
  measurements retain their original source. The
  [Linux investigation](backlog/browser-reconnect.md) keeps the bounded observation
  groups, six original fault controls and earlier cancellation traces. A native
  Chromium/TLS reproduction identifies an unloading page's error refresh as one
  source of late reads; historical Linux socket-reset attribution remains open.
  No cancelled bytes, failed samples, accounting checks or deadlines are excused.
  The reporter preserves the original refusal when a diagnostic property cannot
  be inspected, including throwing or revoked JavaScript proxies, objects that
  intercept property inspection. Each field is contained separately, so an
  unreadable step does not discard a valid phase. The same fixed labels and
  original checks apply. A synchronous failure while printing either label also
  preserves the exact original refusal; the reporter stops printing after that
  failure. The same focused command above checks both output failures and normal
  output. This does not identify the historical reconnect failure's cause.
  The launch, reconnect and logout failure tests also
  inspect the real traffic-meter listener and require it to be closed when the
  journey refuses. Removing the meter cleanup fails six named assertions;
  independent test teardown collects the listener and timer without waiting for
  the meter's ten-minute lifetime. Browser operations remain controlled fixtures,
  and this check does not establish the historical reconnect failure's cause.
  Ownership validation remains strict. Generated gateway fixtures explicitly
  retain the file-access capability needed for their host-owned private mounts;
  production gateways and private-data replay permissions are unchanged.

  Cancellation first drains admitted storage traffic before signalling the native
  writer, with a bounded fallback. Invalid transfer accounting still refuses
  measurement publication. Separately proved collection of native processes and
  their owned scratch lets the replay remove its own verified database copy;
  replaced roots and lost ownership continue to refuse cleanup. The generated
  native cancellation/deadline journey passes three consecutive runs, alongside
  37 stream and 33 private-replay checks. Setup interruption collects its recorded
  child process group and generated directory for both supported signals.
  The generated fast-exit cancellation checks now separate two contracts. The
  successful-close case admits only its startup upload and its held upload, so
  it retains the original successful-close and exact child-collection assertions
  without queuing later work. A second case keeps queuing, admits a later upload
  after the real idle handoff signals the writer, then exits after receiving one
  of four declared reply bytes. Close must refuse that interrupted accounting;
  cancellation separately prevents publication while independent resource
  collection reports completion. The check requires a successful native exit
  without a forced-kill signal and inspects the actual listeners, backend sockets,
  owned child identities and scratch, and never launches restore.
  Run both with `node --test --test-timeout=10000 --test-name-pattern='^cancellation'
  scripts/cloud-cost/replay-stream.test.mjs`.
  Native reproduction previously found one failure in 432 unchanged trials and
  one in 800 instrumented trials: a later PUT lost its response during session
  collection. The controlled split qualifies that local mechanism and preserves
  admitted-upload drainage, accounting, child ownership and every deadline.
  Runtime code is unchanged. The original untraced Linux event and official
  Litestream shutdown still need attribution and qualification.

  The replay writer-deadline check also refused during opening in
  [main run 40259519210, receipts job 121368783695](https://github.com/waitron-io/waitron-cloud/actions/runs/40259519210/job/121368783695),
  before its intended finish assertion. Slow fixture storage setup reproduces
  that boundary: opening correctly consumes the whole-run 0.7-second budget.
  Opening failures now report elapsed milliseconds and the existing bounded
  stage/native trace, after collection, without private paths or child output.
  The real-clock check requires its deadline callback to fire before accepting
  refusal during opening or before a complete result, then verifies source
  preservation, listener closure and final child collection. A separate check
  waits for a real writer before firing the unchanged 0.7-second callback and
  proves collection by that deadline before finish or close can hide a missed
  abort. Only that callback is controlled; HTTP, SQLite,
  native children and other timers remain real. The existing 4.01-second opening
  and idle controls, drainage assertions and all runtime timers remain unchanged.
  Run `node --test scripts/cloud-cost/replay-stream.test.mjs` for these controls
  and the bounded opening diagnostics. The historical Linux startup stage and
  underlying delay remain unknown; this repairs the reproduced test assumption.

  **Remaining work and observations.** To complete the operating total, establish
  the missing inventory quantities and regional billing terms, representative
  venue/public activity, complete retained-object forecasts, recovery/alert/email
  frequencies and provider capacity/transfer mappings. Keep external mail, fiscal
  API fees, GitHub charges, account allowances, credits and tax separate from
  gross AWS usage. Earlier untraced refusals and transient source-file fingerprint
  changes remain unattributed; later accepted samples do not explain those exact
  occurrences. A generated restore-integrity failure reproduces on the host-shared
  Docker folder and passes with active SQLite/native stream state on container-native
  storage. Its production relevance is unproved. Prepare a consistent frozen copy
  before long replay; later live-source activity does not identify a writer and
  must not be treated as proof that the isolated experiment wrote the source.

- **Future remote DNS lost-reply browser failures.** The reproduced reconciliation
  stall is resolved by [PR #102](https://github.com/waitron-io/waitron-cloud/pull/102).
  If the saved-name assertion fails again, use the bounded request/status events,
  injection stages and setup-screen diagnostics to identify and reproduce the cause.
  Keep the four-second assertion and fault-injection ordering checks unchanged;
  passing repeats alone do not explain a failure. See [the ordering receipt](#portal-lost-reply-test-ordering).

- **CI job record publication.** The historical GitHub publication delay remains
  unexplained. Deadline diagnostics identify unmet identity and completed-step checks
  from the last observed record. Preserve run identity, final dependency results and time
  limits; landing still requires every actual job record final. See the
  [investigation and qualification limits](backlog/ci-job-record-publication.md).

- **CI execution budget.** You can read one summary job and the individual package
  and receipt jobs to check a candidate. The summary also checks the plan's
  package allocation against the planner's registered package names and shard
  counts. Registration uses five partitions, account HTTP uses three, portal uses six
  and backups uses two. The summary requires every registration partition
  and rejects the former six- and seven-partition allocations. A Node subprocess
  check partitions copies of every current registration filename plus a new
  filename and requires each to execute exactly once. Its file workers run one
  at a time; overlapping fixture bodies fail on a shared scratch-directory lock.
  This checks file discovery; real package jobs must still report every test case.
  The reminder-worker cases live in `email-reminders.test.ts`, with their complete
  test bodies unchanged. The name places them before the worker-loop tests in
  Node's file allocation. Each file prepares its own disposable schema; every
  case and the 30-second deadline remain. Earlier five- and six-job layouts took
  313 and 348 seconds respectively and were not adopted. A later six-job split
  reached 259 seconds but used the same 23 rounded registration minutes as seven
  jobs, and its backup job failed the strict native-memory OOM check. The start
  ordering fix below addresses a reproduced mechanism for that failure.
  Matched case durations guide the five-job allocation; they do not prove its
  elapsed time or a saving. Require every registration job within 300 seconds
  and fewer than 23 rounded registration minutes on the exact candidate head.
  The wider target of 55 rounded minutes for a full run remains open.

  The relay-capacity test keeps its four SMTP deliveries open until all four
  competing worker attempts return without work. Its unchanged sending, queued
  and total-delivery assertions then describe one concurrent batch. A delayed-start
  control reproduces extra later deliveries when that synchronization is removed;
  the production worker limit and original deadline are unchanged. The original
  CI log did not record the worker schedule, so the exact host delay remains
  unmeasured.

  A shard is one partition of a package's tests. Removing a partition
  from both the plan and the job list cannot turn incomplete work green.
  Unknown packages, altered counts, invalid partition numbers and extra row
  fields fail; complete partitions and the existing short-package groups remain
  accepted. Each package in a short-package group must also emit a nonempty,
  consistent Node test summary and exit successfully. The runner reports its
  test, pass, skip and todo counts, keeps all output and continues with later
  packages after a failure. A zero exit without a summary, an all-skipped run,
  or a failed or cancelled test cannot pass. Plain and colored TAP and spec output are
  exercised with real Node test subprocesses; the package commands, deadlines
  and treatment of individual skipped or todo cases are unchanged. These counts
  establish executed work, not that the selected package contains every required
  test. An independent summary policy checks the execution contract; tests
  feed it every real planner package allocation and the full grouped plan, and
  compare its package names with the complete workspace inventory. Adding,
  removing or renaming a package, or changing its partition count, requires
  updating that policy. This validates allocation for selected packages;
  independently proving that every affected package was
  selected and resolving wider input selection remain open. No grouping or
  cost reduction is claimed by this guard. The reviewed
  [precise-selection design](superpowers/specs/2026-10-14-precise-ci-selection.md)
  and [implementation plan](superpowers/plans/2026-10-14-precise-ci-selection.md)
  remain the guide for the parked `feat/precise-ci-selection` branch. Rebase that
  branch over the six-partition portal allocation before resuming it. They
  define how documentation, scripts, configuration, resolved lockfile changes and
  receipt inputs can select their actual checks. The first implementation selects
  one Markdown check for a documentation-only change under `docs/` (excluding
  receipts) or at the repository root when both immutable trees match the audited
  non-document input inventory in `scripts/ci-input-audit.json`. The check reads the
  selected git blobs and requires valid UTF-8, no NUL and a final newline; deleted
  regular documents are accepted. Package Markdown, receipt data, mixed changes
  and missing or stale audit evidence retain the existing selection or full fallback.
  Adding, changing or removing an executable, configuration or other tracked input
  invalidates the exemption until you audit the readers again and renew the
  certificate. The planner now emits a prominent GitHub warning on every run when
  that audit is unavailable or stale, including non-document changes, with the
  [review and renewal procedure](ci-documentation-audit.md).
  The renewed audit covers CI reader/execution changes through #180; #144 was
  the first unrenewed input change. Fixture-only checks had missed the real-tree
  mismatch. Both immutable-tree checks and the conservative full fallback remain.
  The identity source map and gateway JSON reader remain covered by
  their existing full checks. When its input audit is current, an isolated change
  to `scripts/identity-upstream.mjs` or its behavioral test can select only syntax
  checks and that test, without
  package, receipt or compiler work. Both saved Git trees must match the complete
  other-input digest in `scripts/ci-input-audit.json`; a new reader, changed
  installation input, missing test, symbolic link or stale audit retains full work.
  The gateway-reconnection validator and its behavioral test have another
  audited exemption. Their script job checks both files and the measurement
  generator for syntax, then runs the unchanged validator tests. It does not
  launch the measurement generator. Both saved trees must match the gateway
  other-input digest, including the published receipt and generator. Changed
  readers or installation inputs retain full work. Each family pins the other
  family, so changes spanning both families also retain full work. The script
  inventories now share one strict policy, so renewing a fixed reviewed tree no
  longer makes peer certificates stale. Each mode keeps its existing content
  exemptions; damaged fields, stale base or head evidence, unknown paths and mixed
  changes retain full work. The
  [coordinated-audit design](superpowers/specs/2026-10-16-coordinated-ci-audits.md)
  and [implementation plan](superpowers/plans/2026-10-16-coordinated-ci-audits.md)
  describe explicit staged generation and committed four-mode checking.
  Historical receipt fixtures retain their independently pinned nine-manifest
  certificate and exact metadata assertions. Production validation independently
  discovers all ten current manifests, including translation and licence metadata.
  Saved dependency, execution, schema and deployment inputs are unchanged.
  Focused reader, fixture and renewal tests cover malformed policy fields, real
  file modes, symbolic links, submodules, missing manifests, staged/unstaged drift
  and committed-only checking. Complete committed-tree controls qualify all four
  inventories together, execute isolated document/script checks, and select the
  isolated lock importer with every receipt and compiler check retained. Mixed,
  unknown and changed-reader controls retain full work. The explicit generator
  never stages its output or follows a live policy link. Wider path selection,
  remaining receipt-audit renewal and job-duration work stay open. The planner
  now runs Git directly without the unused API callback or historical tree-fetch
  wrapper. Its public function signature stays compatible; existing CLI checks
  retain full main runs, exact output fields and zero PR API calls. Generation
  is a repository-root command. A real temporary Git repository reproduces a
  subfolder invocation overwriting a nested lookalike policy. Generation now
  requires a working tree and an empty current-directory prefix before reading
  staged inputs or writing output, including refusal inside Git's metadata directory.
  Regressions preserve both policies, staged inputs and the working tree on refusal;
  normal root generation still succeeds. Read-only
  checking of a committed audit remains available from subfolders.
  Generation also refuses when the live `scripts` directory is itself a symbolic
  link, before opening its output. A real temporary Git repository reproduces an outside
  policy overwrite through that directory link. The refusal preserves the outside
  files, staged inputs and working tree; ordinary root generation still succeeds.
  Committed checking reads saved Git blobs and remains read-only through the same
  linked directory. This checks the directory before writing; it does not protect
  against another process replacing the directory during generation.
  Generation also refuses a live policy with multiple hard links before writing.
  A real temporary Git repository reproduces the earlier overwrite of an outside
  alias; the regression preserves both names' contents, staged inputs and working
  tree on refusal. Ordinary generation still succeeds, and committed checking
  remains read-only with a hard-linked, dirty live policy. These checks inspect
  the output before writing; concurrent replacement remains outside this guarantee.
  An independent subprocess check corrupts only the generated audit digest after
  valid staged inputs have passed. The final validation refuses that output without
  changing the existing policy, staged inputs or working tree. Removing that final
  validation in a disposable copy makes the check fail; healthy generation passes.
  Input-schema and admission guards retain their existing coverage.
  Mixed changes also retain the existing fallback. The script job verifies the
  exact checkout and changed paths, and the summary requires its successful result.
  The identity audit covers that helper's only executable consumer, its own spawned test;
  the source-map default still takes the existing full route. Other root scripts,
  configuration and their real controls remain open. The immutable package graph
  also follows quoted references through shared JavaScript and TypeScript helpers
  outside package directories, including helper chains and cycles. It retains
  readers from both saved revisions, resolves directory index helpers and maps
  emitted JavaScript and JSX helper paths to TypeScript sources. Matching quote
  delimiters retain paths after apostrophes while the broader scan preserves
  paths embedded in generated fixture programs. Only reached helpers add package
  links. Every tracked JavaScript or TypeScript source is read as evidence, so an
  unreadable, linked or oversized source keeps all package tests even when it is
  not reached. Reading only reached sources remains an efficiency follow-up.
  This is not a complete resolver for computed inputs or root-file selection. A lockfile PR now reports
  which workspace dependency sets changed by comparing both saved revisions.
  The bounded version 9 parser follows indirect, optional and workspace-linked
  dependencies, retaining separate peer variants and their package metadata.
  Duplicate keys, missing or unused records, unsupported syntax and incomplete
  evidence cannot produce a partial comparison. YAML separation uses ordinary
  spaces; other Unicode spaces remain part of scalar values. The direct parser
  accepts at most two MiB, while production Git reads retain their one-MiB cap.
  Shared records are hashed once. The graph has a 500,000-visit limit and the
  complete comparison hashes at most 32 MiB of serialized input per lockfile.
  A lockfile PR, alone or with workspace manifest dependency edits, can select the
  affected packages and their saved source/helper
  consumers when both revisions match the complete other-input audit in
  `scripts/ci-input-audit.json`. Version 2 pins each manifest with its four dependency fields removed and every
  other tracked file, including installation policy, root readers and documentation. Any
  change to those inputs invalidates it until you review them again; follow the
  [lockfile audit procedure](ci-lockfile-audit.md). The selected packages
  include consumers from both saved revisions; all compiler and receipt checks
  still run. Root dependency changes, changed workspace membership, formatting-only
  locks, unrelated mixed paths, missing evidence and stale audits retain full work.
  Every changed manifest selects its package and its old/new consumers even if
  that edit does not change a resolved importer. Manifest scripts, package identity
  and every nondependency field stay audited. Version 1 remains supported for
  lock-only updates. This route still requires explicit reader review before
  renewing complete-input certificates. Receipt-selector test fixtures seed eleven
  saved audited dependency inputs, so an unrelated manifest or lock edit does not
  invalidate their positive test setup. Their original omission and refusal
  assertions remain; a separate real-clone regression changes every workspace
  manifest and the lockfile before running the four positive checks sequentially.
  It requires all four test names, so a passing file with no matching test cannot
  substitute for coverage. The saved manifest metadata must match its reviewed
  nondependency fields in the audit. The fixtures also seed the saved audited
  package runner and package-path resolver from
  `scripts/fixtures/ci-execution-inputs.json`. Separate real-clone checks change
  each live input and require all five original positive receipt tests to execute.
  Their assertions and the production audit pins stay unchanged; changing either
  real input still retains receipt work. Actual
  dependency changes still retain every receipt in the production planner.
  Fourteen root-test fixtures now disable automatic Git maintenance for their
  temporary repositories. Real-child checks trace each named original test,
  require that exact test and its commit to execute, and reject automatic
  maintenance or garbage-collection children. The original receipt, selection
  and reuse assertions remain unchanged. The checking process owns a separate
  process group and stops that group's remaining descendants when the check ends;
  a deliberately stalled test proves its worker is stopped after a timeout.
  In [run 38824736788](https://github.com/waitron-io/waitron-cloud/actions/runs/38824736788),
  262 of 263 root checks passed before database-input fixture cleanup failed
  with `ENOTEMPTY`. Local tracing confirms detached maintenance launches in the
  original fixtures, but does not establish that they wrote into the directory.
  Sixteen concurrent original-file review runs did not reproduce the failure.
  The change removes a confirmed detached background Git process from these
  fixtures; it does not establish the historical cleanup cause. Capture that
  directory's remaining entries and process activity if cleanup fails again.
  Four receipt-selector fixtures now use the planner's existing batch reader
  against their own temporary repositories. The local-stack and nested dependency
  checks previously launched 1,021 and 1,094 individual source-read processes.
  Tracing now requires zero individual source reads and exactly two batches per
  checked plan, while every original omission, refusal and maintenance assertion
  remains. Positive checks also reject a package-evidence fallback, so a broken
  batch cannot silently substitute a full package plan.
  Three concurrent complete root-suite runs reproduced both outer checks' former
  30-second timeouts. With batching, the local-stack check completes in 27.0 seconds
  under the same load. The nested dependency check completes in 58.2 seconds;
  its outer deadline is now 90 seconds because its four sequential workers already
  have a 60-second budget, plus repository setup and cleanup. Other outer checks
  retain 30 seconds, and the deliberately stalled worker still has five seconds.
  These are local stress measurements, not a guarantee under arbitrary host load.
  The same three-root overload still triggers the unchanged 35-second bootstrap
  observer in all three runs and the inner 60-second dependency-worker limit in
  one run. These are separate stress follow-ups, not resolved by the outer budget
  correction; retain their diagnostics and avoid overlapping full qualification.
  A later default-concurrency root run passed 322 of 324 checks and hit both
  limits again: the bootstrap observer after 35.18 seconds and the dependency
  worker after 65.34 seconds including its outer setup. Review controls and
  package qualification overlapped that run. The precise cause remains unproved;
  retain both limits and their original assertions when investigating recurrence.
  A later review of the five-shard change also missed the 60-second dependency
  worker twice with the new discovery check, while its base and skipped-check
  comparisons did not. That small sample does not establish causality. The new
  discovery fixture now permits one file worker at a time; overlapping bodies fail
  on an exclusive scratch-directory lock. Keep the 35-second and 60-second limits
  and capture stages on recurrence; bounded fixture workers do not prove that the
  historical root timeouts are resolved.
  The original historical failures did not retain these exact stages; the controlled
  reproduction establishes the timeout mechanisms rather than their precise history.
  Evidence, earlier partial fixes and complete load-run outcomes are retained under
  `~/waitron-campaign-d/receipts/d69/fixture-child-timeouts/`.
  The remote operator and reconciler test children now use one colorless
  environment, removing inherited `FORCE_COLOR` and preserving `NO_COLOR`,
  configuration and other runtime warnings. This also covers continuous
  reconciler mode. Conflicting parent settings previously added a Node warning
  to their exact error output. Run `node --test
  packages/remote-access/test/cli-color.test.ts` for real CLI refusals without a
  database, including forced color values 0, 1 and 3. Every original CLI assertion,
  command and deadline stays unchanged; production color handling is unchanged.
  Local PostgreSQL suites are unavailable while Docker is down until 3 November;
  GitHub CI qualifies the original database-backed journeys.
  The parser's current-lock inventory check still pins 215 package/snapshot
  records and the original importer counts. A new dependency record needs an
  explicitly reviewed inventory update. The disposable
  [dependency-only control #164](https://github.com/waitron-io/waitron-cloud/pull/164)
  replaces the portal's resolved axe-core version with unchanged inventory counts
  and passes a frozen install. Its
  [exact-head run 38823958615](https://github.com/waitron-io/waitron-cloud/actions/runs/38823958615)
  runs only three portal groups (196 cases), all compiler checks, 263 root checks
  and all five receipt suites (225 cases). All seven successful jobs check out the
  exact head; documentation and script jobs skip. It uses 19 rounded job-minutes,
  a 320-second job span and a 288-second longest job, compared with 69, 352 and
  322 in the [full baseline](https://github.com/waitron-io/waitron-cloud/actions/runs/38817784178).
  That baseline's complete tree equals the scratch target. Planner, workflow,
  runner, summary and audit evidence are identical between target and control.
  The scratch PR is closed without merging, and its branches and worktree are
  removed. These are timestamp-based estimates, not invoices or a completed
  full-run budget claim. Broader dependency additions, other controls and
  wider lock/root
  selection, package precision and their real scratch controls remain open. Review follow-ups:
  independent deletions of the audit-version, manifest null-byte and manifest
  dot-segment checks fail the existing policy-refusal test. The Markdown inner
  path filter also has an independent removal control: deleting it makes the
  strict-summary refusal test in `scripts/ci-docs.test.mjs` fail with
  "Missing expected exception". All 11 document tests pass before deletion and
  after restoration (`node --test scripts/ci-docs.test.mjs`). The regular-file
  defenses retain their paired removal control. Seven additional checks refuse
  a non-blob object even when its reported file mode is regular, covering the
  policy, both script pairs, the lockfile and the package manifest. Each uses
  controlled malformed inventory at the Git reader boundary and passes its valid
  input control. Deleting only the object-type guard fails all seven named checks;
  normal Git producing inconsistent metadata is not claimed. Keep the refusal
  assertions when simplifying these checks. Keep the renewal recipe's explicit manifest patterns aligned with
  discovered workspace members; a mismatch currently retains full work. The
  lock-specific explanation now lists changed package manifests separately from
  changed resolved dependency inputs, so you can see why a manifest owner runs
  even when its resolved inputs did not change. Saved-revision checks cover
  single and multiple manifests, overlap with a changed resolved importer and
  lock-only changes without edited manifests. Package selection, audits,
  fallback, compiler and receipt checks retain their existing behavior. The plan also requires measured
  grouping to reduce the full run toward 55 rounded job-minutes while keeping
  each work job near five minutes. The historical D66/D67 full-run samples used 72 and
  73 minutes; these are timestamp-based rounding estimates, not invoices.
  CI still selects changed workspace packages and every package that depends on them,
  including test dependencies and direct sibling source/fixture reads absent from
  manifests. Package-only PR selection now reads source and manifest dependency links from both
  immutable Git revisions, preserving removed links and committed readers hidden
  by local edits. The existing quoted-path discovery also retains named, root-relative
  and uncertain sibling-template readers. Missing blobs, incomplete inventories,
  changed workspace membership or test commands, checkout attributes, links and
  tracked dependency overrides keep all package suites with a reason. Initial package
  selection remains a conservative floor; an independent receipt audit may still omit
  a receipt when its own immutable evidence holds. Workspace discovery
  currently recognises only the repository's two explicit package-directory patterns;
  other policies keep full work. The planner reads the required policy, manifests and source
  blobs in one Git batch per saved revision, deduplicating identical objects. It checks
  each object's identity, byte length, separator and content hash before using the source.
  The old one-MiB per-file limit remains; each batch also has a 64-MiB output limit
  and a 30-second deadline. Missing, malformed, oversized, slow or corrupt batch
  evidence keeps all package suites with a reason. Existing callers without a
  batch reader retain individual reads.
  Named shared subdirectories now retain every saved JavaScript or TypeScript
  descendant as a possible helper input. Directory readers can therefore keep
  their package consumers through helper chains and cycles, including files
  added or deleted between the two revisions. Exact directory boundaries avoid
  pulling in similarly named siblings; equivalent dotted and repeated-slash
  directory paths resolve to the same saved inputs. A real Node directory scan reproduces
  the formerly omitted portal consumer; saved-revision and batched-read checks
  cover old and new helper files, dirty local sources and paths with spaces.
  The actual portal-only and all-nine identity selections stay covered.
  Root-relative file paths also normalize dotted segments and repeated slashes
  before looking up package owners or shared helpers. Real Node imports prove
  that equivalent package and helper spellings load the same input; selection
  checks retain their direct and transitive consumers from both saved trees,
  even when local helper files have changed. The live workspace graph applies
  the same normalization to direct package paths. When `..` leaves an earlier
  package prefix, selection follows the actual destination and drops that false
  dependency. If an unresolved root-relative package template has no constant
  package owner after normalization, every package remains a possible input.
  Real imports and selection checks cover both directions across package
  boundaries and this uncertain template case. Both graphs use slash-based
  normalization. Every earlier assertion and reader-audit certificate is unchanged.
  This is a conservative source dependency rule, not evidence that every quoted
  directory is read at runtime. A bare quoted folder name such as `scripts` can
  select extra consumers even when it names a data field. Qualify actual reader
  operations before narrowing that rule. Direct `readdirSync(new URL(relativePath,
  import.meta.url))` calls without options now retain immediate root-level source
  helpers when the URL names the repository root. A real Node scan proves the
  loaded helper keeps its package consumer; saved-tree checks retain added and
  removed helpers, transitive consumers and dirty-checkout independence. A root
  command working directory alone adds no helper inputs, and a nonrecursive root
  scan does not traverse nested directories. The same rule now follows a simple
  `const`, `let` or `var` assignment of that URL to a raw JavaScript identifier passed
  directly to `readdirSync` without options, including a `: URL` type annotation
  or a later comma-separated binding in the declaration. Raw names now include
  accented and astral letters and the two join-control characters JavaScript allows
  within identifiers. Executed Node scans cover all four directory APIs. Saved
  readers retain immediate helpers and transitive consumers when reader and helper
  coexist in either saved revision, including added or removed helpers despite
  dirty local files. Root options still
  retain every package, including for audited lock changes. Unused bindings,
  different identifiers and non-root scans keep narrow selection in the controls.
  URL-variable names also retain those consumers when declarations or uses contain
  fixed-width or braced Unicode escapes. Different spellings of the same name are
  compared after decoding the escapes. Executed scans cover all four directory
  APIs, and saved-tree checks cover removed or added helpers, former transitive
  consumers and dirty local files. Recursive root options retain full package work,
  including audited lock changes. Unused bindings, different names, local scans and
  a command working directory alone stay narrow in the controls. The `URL`
  constructor and optional type label now also accept fixed-width and braced
  Unicode escapes, including mixed spellings and leading zeroes. Executed scans
  cover all four directory APIs; saved-tree checks retain old and new helpers,
  transitive consumers and dirty-checkout independence. Recursive root options
  keep every package, including for audited lock changes. Unused bindings,
  local reads, different variable names, unrelated constructors and a command
  working directory alone remain narrow in the controls. Simple declaration
  aliases of these URL bindings now retain immediate helper consumers too.
  The scanner follows alias chains in either declaration order, decodes escaped
  names and bounds cycles with a visited set. Executed controls cover all four
  directory APIs, comma-separated declarations and the supported URL type label.
  A trailing line or block comment can carry the line break that ends the
  declaration without a semicolon; those aliases retain consumers too. Both sides
  of an alias decode identifier escapes in the controls. Comments followed by an
  expression continuation can conservatively select extra work.
  Saved-tree controls retain old and new helpers, additions, deletions and
  transitive consumers despite dirty local files. Root alias reads with options
  retain full package work, including audited lock changes. Unused aliases,
  different scanned names, local reads and working-directory values stay narrow
  in the controls. Names are combined conservatively across scopes; this does
  not resolve binding identity, destructuring or other type labels. Bare later
  assignments now preserve these URL aliases too, including separate and chained
  transfers, escaped names, comments and parentheses around a bare assignment
  such as `(directory = original)`. Executed
  controls cover all four directory APIs, old and new saved helper readers,
  transitive consumers and dirty-checkout independence. Recursive root options
  retain full package work, including audited lock changes. Unused transfers,
  different scanned names, local reads, expression prefixes and working-directory
  values remain narrow in the controls. Assignment order and reused names are
  combined conservatively, so overwritten values can select extra work. Direct
  constructor assignments such as `let directory; directory = new URL(...)`
  now retain immediate helper consumers, including assignment chains, escaped
  names and constructors, comments and parentheses around an assignment such as
  `(directory = new URL(...))`. Executed checks
  cover all four directory APIs, saved old and new transitive consumers, dirty
  local files and audited lock changes. Root options keep every package; unused
  inputs, local reads and identifier suffixes stay narrow in the controls.
  D69 closes under the owner's 2026-10-20 decision: run all when unsure.
  The historical design and measurements below do not require another syntax
  extension or a cost target before closure. More precise selection remains
  optional efficiency work; preserve the conservative fallback.
  Every direct directory read must resolve through an admitted URL constructor
  or its supported bindings and aliases. An unresolved argument, unknown value
  transfer, unrecognised reassignment or other use of a URL binding prevents
  package narrowing. A matching outer declaration cannot qualify a different
  parameter, and a URL object may change through another reference. Assignments
  inside parentheses, opaque literal programs and unknown alias sources also
  prevent proof. Executed controls cover all six same-name review probes and
  their audited-lock paths. This refuses uncertainty without resolving more forms. The planner
  then keeps every package suite and names the saved source path. Audited lock
  changes also keep full work through their existing fallback. Both saved trees
  are checked, so a removed reader and dirty local files cannot hide a consumer.
  Ordinary resolved reads keep narrow selection in the executed controls.
  In the current repository, `packages/account-http/test/fixtures/fiscal-waitron-bridge.mjs`
  computes a journal directory that this scan cannot prove. Package-only changes
  therefore retain all packages, including portal changes. Do not add another
  special case to recover that saving; the owner accepts the wider fallback.
  This deliberately trades additional work for retaining tests. Do not extend
  the syntax recogniser one written form at a time; an uncertain form takes the
  fallback. Precise binding resolution and generated-input analysis are optional
  future efficiency work, outside the closed D69 task. This source scan can also
  select extra work for inert text and reused names.
  Storing a root command working directory alone adds
  no helper inputs. An existence check alone also adds no root helpers, and a
  shared helper scanning its own directory does not scan the repository root.
  This bounded scan can keep extra consumers when identifiers are reused; it does
  not resolve directory aliases precisely, other type annotations, computed
  assignments or other directory APIs. A reachable source mentioning `glob` or
  `globSync` now keeps every package. Package-only planning names that source
  in its fallback reason; lockfile planning can report a generic full fallback.
  Glob patterns, options and the default working directory remain unresolved,
  so these calls cannot justify dropping consumers. Executed Node scans cover
  direct/stored root directories, default working directories, absolute patterns,
  optional calls, `.call` and import aliases. Saved shared-helper readers in either revision keep this fallback
  despite dirty local files. The bounded source scan can retain extra packages
  for inert text or unrelated functions with these names; indirect scans without
  a named glob reference and precise input resolution remain open. Block and line
  comments now separate tokens in the supported directory calls and URL bindings
  just as whitespace does. Executed Node scans and saved-tree checks retain the
  loaded helper, its package consumer and transitive consumers from either
  revision despite dirty local helpers. Nonrecursive scans still exclude nested
  helpers, and comments cannot hide the full fallback for explicit root options.
  Line comments end at each JavaScript line terminator. Whitespace and comments
  between the tokens of `import.meta.url` now retain immediate root-helper
  consumers for all four directory APIs, directly or through a supported URL
  declaration. Executed Node scans cover block comments and every line-comment
  terminator; saved base/head and unchanged readers retain transitive consumers
  despite dirty local files. Audited lock changes retain those consumers too.
  Recursive root options keep full package work; non-root options and root
  command directories stay narrow in the controls. This remains a bounded source
  scan; unresolved URL inputs keep full work. The immediate-entry rule also covers `readdir` from
  `node:fs/promises`, `opendir` and `opendirSync`, directly or through a supported
  URL declaration. Executed scans retain the loaded helper consumer without
  traversing nested directories; saved shared-helper readers from either revision
  retain former transitive consumers despite dirty local files. A reachable
  `readdirSync`, `readdir`, `opendir` or `opendirSync` of a literal repository-root URL,
  directly or through a supported URL declaration, now selects full package work
  whenever explicit options are supplied. The same fallback covers ancestor scans
  and URL text containing query, fragment or percent-encoded syntax that this path
  resolver does not interpret. When this prevents narrow selection, the planner
  names the source path:
  unresolved options may enable recursion and cannot justify dropping a nested
  helper's package consumer. Real recursive, directory-entry, encoding and computed
  option calls, saved readers from either revision and shared-helper directory
  depth are covered. Query, fragment, encoded-dot and ancestor runtime checks keep
  enumeration inside an owned directory. Calls without options retain their immediate-entry rule;
  options on a helper's own non-root directory do not imply a root scan. Resolving
  options precisely remains open. A reachable `readdirSync`, `readdir`,
  `opendirSync` or `opendir` renamed with `as` now keeps all package suites and
  names the source path in the planner's reason. The renamed call can load a
  helper without spelling a directory API at its call site. Executed Node scans
  prove that consumer, while saved-tree and batched-read controls cover readers
  from either revision despite dirty local helpers. Unreachable alias helpers
  retain narrow package selection. Block and line comments before `as` also keep
  the fallback. Quoted import names and escaped alias tokens also keep all package
  work; real Node checks cover both quote forms, Unicode and hexadecimal escapes
  and a quoted line continuation. The scan does not decode or execute source text.
  Escaped tokens are consumed before checking their adjacent `as` suffix, avoiding
  repeated scanning of ordinary backslash-heavy strings. The saved-source regression
  reproduces the earlier five-second timeout; a local fixed run completes in 0.48
  seconds with 100,000 backslashes. Unrelated later `as` text does not turn a token
  into an alias.
  It can select extra work for inert text, unrelated names or an escaped alias
  for a different import. Reachable directory API names followed by optional
  access, member access or computed member access now retain all package suites
  and name the saved source when the package-revision branch falls back.
  The lockfile path also retains full work, with its existing generic reader reason.
  Real Node calls cover optional
  invocation, `call`, `apply`, `bind`, computed `call` and comment-separated access
  for all four directory APIs, including TypeScript non-null assertions.
  An unchanged-reader lock control retains every package; its reader-free control
  still narrows selection. Saved-helper controls retain both revisions and
  transitive consumers despite dirty local files. An unchanged saved helper also
  triggers the package planner guard; unused helpers keep narrow work.
  This conservative rule can also select extra work for inert text or unrelated
  members. Direct TypeScript non-null calls such as `readdirSync!(directory)`
  now also retain every package suite: an assertion does not change the function
  Node invokes, but previously prevented the direct-call resolver from seeing its
  directory. Executed Node checks cover all four APIs, repeated assertions and
  block comments before and after assertions. Saved-reader checks cover either
  revision and unchanged shared helpers, transitive consumers and dirty local
  files; the lockfile control retains full work while its reader-free control
  still narrows selection. Unreachable helpers keep narrow package work.
  Precise alias resolution, assignment/destructuring aliases, escaped
  bare API identifiers and other unsupported calls remain open. Directory reader names
  wrapped directly in parentheses now retain every package suite because wrapping
  the function leaves its runtime readers unchanged. Executed Node controls cover all four APIs,
  nested parentheses, TypeScript assertions, optional invocation and comments.
  TypeScript `satisfies` and generic-type references, including unparenthesized
  generic calls, also retain full package work because Node erases their types.
  Saved-helper controls cover either revision, unchanged readers, transitive
  consumers and dirty local files; lockfile controls keep full work for the reader
  and narrow work without it. Unreachable helpers still keep narrow selection.
  The closing-parenthesis fallback is conservative: inert text and passing a
  reader as an argument can also select extra work. Directory readers stored as
  the first, final or simple middle array element now retain every package suite; indexing the
  array preserves the function that Node invokes. Real Node checks cover all four
  APIs, nested arrays, comments, trailing commas, TypeScript assertions and `at`.
  Saved-helper controls cover either revision and unchanged transitive consumers
  despite dirty local files. Audited lockfile controls retain full package work
  with these readers and narrow work without them; unused helpers stay narrow.
  These guards can also select extra work for inert text or unrelated names.
  Simple middle elements retain full work with all four APIs, comments, TypeScript
  assertions and indexed or `at` calls. Saved-helper controls cover either
  revision and unchanged transitive consumers; audited lock changes keep full
  work with a middle reader and narrow work without it. Unreachable helpers
  remain narrow. The middle-element guard requires an array opener so ordinary
  named imports preserve existing package isolation. Inert text can still select
  extra work. Logical and conditional operands adjacent to a directory reader
  now retain full package work: either branch can preserve the function for a
  later call. Executed Node scans cover all four APIs on either side of `&&`,
  `||` and `??`, both conditional branches, comments and TypeScript assertions.
  Simple namespace references such as `null || fs.readdirSync` also keep full
  work, including a comment-separated member in a conditional branch.
  Saved-helper controls retain both revisions and unchanged transitive consumers
  despite dirty local files; audited lock changes keep full work with these
  readers and narrow work without them. Unreachable helpers and ordinary named
  imports still keep narrow work. This bounded guard can select extra work for
  inert text, unrelated names and direct calls inside a branch or right operand;
  it does not evaluate branch conditions or resolve these calls precisely.
  Middle readers immediately after a nested array or object now retain full
  package work, including simple namespace references, comments, non-null
  assertions on the reader or namespace and optional namespace access. Executed
  Node controls cover all four directory APIs. Saved-reader
  controls cover either revision and unchanged transitive consumers despite dirty
  local files; audited lock changes retain full work with these readers and narrow
  work without them. Unused helpers and ordinary multi-name imports stay narrow.
  This closing-delimiter guard can also select extra work for inert text,
  unrelated names or function arguments. It does not parse arbitrary expressions:
  other nested predecessors and delimiter-bearing comments or strings remain
  unresolved. A directory reader reached through one namespace name after a
  simple array value, such as `[0, fs.readdirSync, null][1]`, now retains every
  package suite. The member may use `.`, optional `?.` access and non-null `!`
  assertions. Executed Node
  controls cover all four directory APIs, comment-separated members, non-null
  assertions and optional namespace access. Saved-helper checks cover either
  revision and unchanged transitive consumers despite dirty local files; audited
  lock changes retain full work with these readers and narrow work without them.
  Unused helpers and ordinary named imports still keep narrow work. This bounded
  guard can select extra work for inert text and unrelated names. Middle-array
  readers now also retain full package work through chains of plain member names,
  including `[0, fs.promises.readdir, null][1]` and a reader immediately after a
  nested array or object. Executed Node controls cover all four APIs through two
  and three member segments, comment-separated tokens, optional access and
  non-null assertions, plus native `fs.promises.readdir` and `opendir`. Saved
  helpers retain base, head and unchanged transitive consumers despite dirty
  local files. Audited lock changes retain full work with these readers and
  narrow work without them; unreachable helpers stay narrow. These guards do
  not resolve member identities and may select extra work for unrelated names
  or inert text, including multi-segment function arguments after a closing
  array or object delimiter. Middle-array namespace segments now also retain
  package work for Unicode, escaped and private names, such as
  `[0, ñs.readdirSync, null][1]` and `[{}, 0, this.#fs.readdirSync, null][2]`.
  Executed Node controls cover all four APIs, astral letters, join-control
  characters, fixed and braced escapes, optional access, comments and erased
  non-null assertions. Saved helper controls retain base, head and unchanged
  transitive consumers despite dirty local files. Audited lock changes retain
  full package work for simple and nested predecessors; unused helpers and
  ordinary Unicode namespace values stay narrow in the controls. These scans
  still do not resolve bindings or arbitrary expressions; inert text and
  unrelated members with directory API names can select extra work. Logical
  and conditional operands now retain full package work through Unicode,
  escaped and private namespace chains, including `null || ñs.readdirSync` and
  `false ? null : this.#fs.readdirSync`. Executed Node controls cover all four
  directory APIs, astral letters, join-control characters, fixed and braced
  escapes, comments, optional access and erased assertions. Saved readers from
  either revision and unchanged transitive helpers retain consumers despite
  dirty local files. Audited lock changes retain full work with these readers
  and narrow work without them; unused helpers and ordinary Unicode operands
  keep narrow package work in the controls. This conservative scan does not
  evaluate conditions or resolve member identities, so inert text and unrelated
  members with directory API names can select extra work. General expression
  parsing and precise directory resolution are optional efficiency work. Quoted and commented
  predecessors now retain stored readers too, including
  `[';', ñs.readdirSync, null][1]` and `[[], 'a;b', ñs.readdirSync, null][2]`.
  Executed Node controls cover all four directory APIs, single/double/template
  strings, escaped quotes, comments and regular-expression character classes.
  Saved base/head and unchanged transitive helper checks retain consumers despite
  dirty files; audited lock controls retain full package work with these readers
  and narrow work without them. Unused helpers and ordinary values stay narrow.
  The additional scan masks punctuation inside complete literal-like tokens and
  preserves the original text as a separate scan. Repeated-regex and long quoted
  array checks bound the planner child; an isolation control prevents fragments
  crossing between the two copies. The first CI run passed all 1,336 root
  checks but hit the eight-minute job limit. The new reader fixtures now use
  their explicit four-package metadata and batched saved Git reads, avoiding
  repeated pnpm discovery without dropping cases or changing deadlines.
  That fixture optimization did not leave enough margin: the independent full
  merge run [39291389992](https://github.com/waitron-io/waitron-cloud/actions/runs/39291389992)
  passed all 1,336 root checks in 445.258 seconds, then cancelled the compiler
  five seconds after it started at the unchanged eight-minute job limit.
  The preceding green head took a similar amount of time. No assertion failure
  or platform cause was established. The unchanged local baseline passed all
  1,336 checks in 392.259 seconds with two file workers.
  Root checks now run in four separate jobs, using Node's round-robin file
  partitions and two file workers per job. They retain the original selectors,
  every case and every individual deadline; the compiler runs independently.
  The existing planner decision selects both the compiler and all four root
  jobs. The summary requires each root job exactly once, completed and successful,
  plus the successful matrix result. Missing, repeated, cancelled, skipped or
  unfinished work cannot establish success. Controlled workflow execution covers
  a future matching file, both additional selectors and failing checks.
  Each work job retains its eight-minute cap. Whole-run timing and the owner's
  five-minute work-job/about-ten-minute total goal needs measured CI evidence;
  a passing local run does not establish hosted-runner duration.
  It does not resolve template substitutions, division
  versus regular expressions, array membership or receiver identities. Unrelated
  expressions and inert text can select extra work; unresolved directory-call inputs
  retain full package work. Executed base/head planner probes cover division
  between the quoted value and stored reader, but do not establish completeness.
  Logical assignments (`||=`, `??=` and `&&=`) and awaited logical or
  conditional operands now retain every package suite. These operators can
  preserve a directory function until its later call, including
  `scan ||= ñs.readdirSync` and `null || await ñs.readdirSync`. Executed Node
  controls cover all four directory APIs, bare and private readers, comments,
  optional access, escaped namespace names, repeated `await` and erased assertions.
  Saved base/head and unchanged transitive helpers retain consumers despite
  dirty local files. Audited lock changes retain full package work with these
  readers and narrow work without them; unused readers and ordinary values
  preserve narrow selection in the controls. The scan remains conservative:
  it does not evaluate assignment conditions, resolve bindings or interpret
  arbitrary expressions, so inert text and unrelated API-named members can
  select extra work. Direct async calls after a logical operator, an object
  property colon or a switch-case colon can also select full package work;
  executed base/head planner controls confirm that additional work. Other
  expression positions and arbitrary predecessor expressions remain unqualified.
  Dot-member namespace readers stored as the first array element now retain
  every package suite, including `[fs.readdirSync, null][0]` and
  `[fs.promises.readdir, null].at(0)`. Executed Node controls cover all four
  directory APIs, one to three namespace segments, comments, optional access
  and erased non-null assertions. Saved-helper checks retain base, head and
  unchanged transitive consumers despite dirty local files; audited lockfile
  changes keep full package work with these readers and narrow work without
  them. Unused helpers, ordinary namespace values and named imports stay
  narrow in the controls. The scan does not resolve member identities or
  parse arbitrary expressions; inert text and unrelated members with these
  names can select extra work, including a reader used as a computed key.
  First-element namespace segments also cover Unicode identifiers, fixed and
  braced Unicode escapes, and private members such as `this.#fs`. Executed Node
  controls load real helper consumers through all four directory APIs, including
  `[ñs.readdirSync, null][0]`, astral letters and join-control characters.
  Comment-separated members, optional access and erased assertions retain that
  fallback. Saved base/head helpers and audited lock changes retain consumers;
  unused helpers and ordinary Unicode member values stay narrow in the controls.
  This lexical scan still does not resolve identities or arbitrary expressions;
  inert text and longer lookalike names such as `readdirSyncñ` can select extra
  work because its word boundary does not follow Unicode identifier rules.
  Other expression positions remain unqualified.
  Quoted computed members such as `fs['readdirSync']` now retain full package
  work for all four directory APIs, including double-quoted and plain template
  keys, comments, optional access, assertions on the object, key or result,
  parenthesized keys and stored references. Executed
  Node controls cover loaded consumers; saved-helper checks cover either revision
  and unchanged transitive consumers despite dirty local files. Audited lock
  changes keep full work with these readers and narrow work without them;
  unreachable helpers stay narrow. This guard does not resolve member identities
  and can select extra work for unrelated keys, arrays of API names or inert text.
  Keys whose first quoted token contains an escape before the next matching
  quote now retain full package work too: Unicode, hexadecimal escapes and
  line continuations can spell a reader without its literal name.
  Executed Node controls cover all four APIs, all three quote forms, comments,
  parentheses and erased assertions. Saved-reader checks retain either revision
  and unchanged transitive consumers despite dirty local files; audited lock
  changes retain full work with a reader and narrow work without one. Unused
  helpers remain narrow. The guard does not decode keys, so unrelated escaped
  member keys and inert text can also select extra work. A receiver check keeps
  plain escaped array values narrow, including arrays after `of` and `return`.
  Receiver matching covers plain names and closing call/index delimiters, with
  comments, optional access and non-null assertions; arbitrary receiver
  expressions remain unqualified. Computed keys without a literal API-name prefix
  or an escape in that first token remain unresolved. Executed base/final probes
  still miss consumers when the escape appears in a later concatenated string,
  a comma expression or a template nested inside the key's template.
  Parenthesized dot-member receivers such as `(fs).readdirSync` now retain
  full package work when the four directory API names are written without escapes.
  Executed Node controls cover
  optional access, comments, erased assertions, deeper namespace receivers and
  stored array references. Saved-helper controls retain either revision and
  unchanged transitive consumers despite dirty local files; audited lock changes
  retain full work with these readers and narrow work without them. Unused
  helpers stay narrow. The guard does not resolve receiver identities, so unrelated
  objects with these member names and inert text can also select extra work.
  Deeper member chains such as `(fs).promises.readdir` now also retain full
  package work when intermediate names use identifier characters, Unicode escapes
  or private names (the `#` prefix used inside a class). Executed Node controls
  include accented characters, `𐐀`, an invisible character allowed inside a name,
  both Unicode escape forms (including extra leading zeros inside braces) and
  private members, across all four directory APIs.
  This includes optional access, comments, non-null assertions,
  erased receiver assertions and stored reader references. Executed Node controls
  cover all four directory APIs and actual loaded consumers. Saved-reader checks
  cover either revision and unchanged transitive consumers despite dirty local
  files; audited lock changes retain full work with these readers and narrow work
  without them. Unused helpers stay narrow. Receiver and member identities remain
  unresolved, so unrelated objects and inert text with the same member spelling
  can also select extra work. Parenthesized chains now also retain full package
  work through bracket members such as `(ns)['nested'].fs.readdirSync`,
  `(ns)[key].fs.readdirSync` and ``(ns).nested[`fs`].readdirSync``.
  Executed Node controls cover all four directory APIs, optional access,
  comments, non-null and erased assertions, concatenated keys and adjacent
  bracket members. Saved-helper controls cover base, head and unchanged
  transitive consumers despite dirty local files; audited lock changes retain
  full work with these readers and narrow work without them. Unused helpers
  stay narrow. Keys are not evaluated, so unrelated objects and inert text
  can also select extra work. Closing brackets now also retain full package
  work through member chains, including `(ns)[keys[0]].fs.readdirSync`,
  `(ns)['nest[ed]'].fs.readdirSync` and unparenthesized indexed receivers.
  Starting at the closing bracket avoids interpreting nested keys. Executed Node
  controls cover all four directory APIs, optional access, comments, erased
  assertions and stored readers. Saved-helper checks retain base, head and
  unchanged transitive consumers despite dirty files; audited lock changes
  retain full work with readers and narrow work without them. Unused helpers
  and ordinary indexed access stay narrow. Receiver identities and keys remain
  unresolved, so unrelated objects and inert text can also select extra work.
  Intermediate bracket segments still exclude embedded brackets, but a later
  closing bracket can independently retain the reader. Other expression positions
  remain unqualified; this is not a general expression parser. Closing template
  backticks now also retain full package work through member chains: a tagged
  template calls a function with a template string and can return a directory
  reader, as in ```ns[key]``.fs.readdirSync(directory)```. Executed Node controls
  cover all four directory APIs, bare and indexed tags, parenthesized tags,
  comments, optional access, non-null assertions, substitutions, escaped backticks
  and chained tags. Saved-helper checks retain base, head and unchanged transitive
  consumers despite dirty files; audited lock changes retain full work with readers
  and narrow work without them. Unused helpers and ordinary tagged values stay
  narrow. The scan also matches opening backticks and backticks in comments.
  Template contents and receiver identities remain unresolved, so inert text
  and unrelated objects can select extra work. General template parsing and
  other expression positions remain unqualified.
  Nested array or object predecessors separated from a stored reader by
  ordinary elements now retain full package work too, including
  `[[], 0, readdirSync, null][2]`. Executed Node controls cover all four
  directory APIs, multiple intervening elements, namespace access, comments
  and erased non-null assertions. Saved base, head and unchanged helper
  checks preserve transitive consumers despite dirty local files; audited
  lock changes retain full work with readers and narrow work without them.
  Unused helpers, ordinary arrays and named imports stay narrow in the
  controls. The additional literal/comment scan now crosses punctuation inside
  complete quoted strings, comments and regular-expression-like tokens. Brackets,
  braces and semicolons outside those matched tokens still bound it. A division
  pair can be mistaken for a regex token and carry the scan across actual
  statement or array boundaries. It does not resolve array
  membership, template substitutions or receiver identities. Arbitrary expression
  parsing remains open. Inert text and unrelated
  expressions can select extra work, including text after a function body
  without a semicolon. An ordinary object expression and a semicolon
  before that inert text have separate package-isolation controls. The
  nested-predecessor delimiter limit now has an independent omission control:
  a completed array statement followed by inert reader text keeps only the
  changed package selected. Removing the whole limit selects unrelated packages;
  restoring it passes. This proves the statement boundary after a closing bracket,
  not the exclusion of bracket characters alone: the earlier array guard also
  retains inert text inside arrays. General expression parsing and the wider
  reader inventory remain unqualified.
  Unicode escapes in dot-member names, such as `fs.re\u0061ddirSync`,
  now retain full package work. Node execution controls cover all four directory
  APIs, escapes at the start and end of a name, zero-padded brace escapes,
  comments, optional access and erased TypeScript assertions. Saved helper
  controls cover base, head and unchanged transitive consumers despite dirty
  local files; audited lock changes retain full work with these readers and
  narrow work without them. Unused helpers and plain escaped array strings
  stay narrow. The guard does not decode names or resolve receiver identities:
  any dot-member name with a Unicode escape, including unrelated names and
  inert text, can select extra work.
  Escaped bare names such as `re\u0061ddirSync(directory)` now retain full
  package work too. Executed Node controls cover all four directory APIs,
  fixed-width and zero-padded brace escapes at the first or last character,
  stored references, comments and erased TypeScript assertions. Saved-helper
  checks cover base, head and unchanged transitive readers despite dirty local
  files. Audited lock changes retain full work with these readers and narrow
  work without them; unused helpers and plain escaped string values stay narrow.
  The guard decodes names without resolving their bindings, so unrelated namesakes
  and inert text spelling a directory API can also select extra work. Other escaped
  identifiers and Unicode text stay narrow. It excludes an opening
  quote immediately before the name; strings with more complex contents and
  other expression forms still need separate qualification.
  Adversarial repeated delimiter/comment
  text can increase scan time; comprehensive parser performance remains unqualified.
  Semicolon-terminated stored references now retain full package work, including
  `const scan = fs.readdirSync;` followed by a later call. Executed Node controls
  cover all four directory APIs, bare and namespace references, comments, optional
  access and erased non-null assertions. Saved base, head and unchanged helpers
  retain transitive consumers despite dirty local files. Audited lock changes keep
  full work with these readers and narrow work without them. Unused helpers,
  ordinary named imports and ordinary stored values stay narrow in the controls.
  This lexical check does not resolve bindings or general assignment expressions;
  inert text spelling an API followed by a semicolon can select extra work.
  Stored assignment references now retain full work across line endings and
  comma-separated declarations, including `const scan = fs.readdirSync` followed
  by a newline and `const scan = fs.readdirSync, unused = 1;`. Executed Node
  controls cover all four APIs, bare and namespace references, comments, optional
  access and erased non-null assertions (`!`), plus CRLF, lone carriage returns
  and Unicode line endings. These controls exercise both the assignment check
  and existing reader checks. Saved base,
  head and unchanged helpers retain transitive consumers despite dirty local
  files; audited lock changes retain full work with readers and narrow work
  without them. The assignment check leaves ordinary named imports narrow.
  An exported reader also retains full work when the assignment ends at the end
  of its file, without a semicolon or final newline. Executed Node controls cover
  all four APIs, bare and namespace references, comments, optional access and
  erased non-null assertions. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes keep all
  package work with these readers and narrow work without them. Unused helpers
  and ordinary exports stay narrow.
  Inert assignment text can still select extra work; these lexical controls do
  not establish complete JavaScript or TypeScript parsing.
  Default-exported reader references, including awaited values, now retain full
  package work at the end of a file or across a line ending. Awaited assignments
  that export the stored reader later also retain full work in the controls.
  Executed Node controls cover all four directory APIs, bare and namespace references, comments, optional access and
  erased non-null assertions. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes keep full
  work with these readers and narrow work without them. Unused helpers, ordinary
  default exports and resolved directory calls keep narrow selection in the
  controls. These lexical checks do not resolve bindings; an unrelated namesake
  or inert text can select extra work. Precise resolution, general assignment
  and destructuring aliases, and other unresolved reader forms remain open.
  Class fields ending before `}` and arrow functions with a single expression
  now retain full package work when they store a reader. Executed Node controls
  cover all four directory APIs, bare and namespace references, static fields,
  comments, optional access
  and erased non-null assertions. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes retain
  full work with readers and narrow work without them. Unused helpers, ordinary
  fields and arrow values, and resolved directory calls keep narrow selection in
  the controls. The scan does not resolve bindings or parse arbitrary expressions;
  inert text and unrelated namesakes can select extra work.
  Block returns also retain full package work when a function or method returns
  the reader before its closing brace, including `return ns.readdirSync }`.
  Executed Node controls cover all four directory APIs, block-body arrows,
  ordinary functions, instance and static methods, awaited values, bare and
  namespace references, comments, optional access and erased non-null assertions.
  Saved base, head and unchanged helpers retain transitive consumers despite dirty
  local files; audited lock changes retain full work with these readers. Unused
  helpers, ordinary return values and resolved directory calls keep narrow selection
  in the controls. These lexical checks do not resolve bindings or parse general
  expressions; inert text, unrelated namesakes or a call continued on the next
  line can select extra work. General assignment, destructuring aliases and other
  unresolved reader forms remain open. Generator yields now retain full package
  work when they yield the reader directly, including `yield ns.readdirSync }`.
  Executed Node controls cover all four APIs, bare and namespace references,
  comments, optional access, erased non-null assertions, generator methods and
  awaited async-generator values. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes keep full
  work with readers and narrow work without them. Unused helpers, ordinary yielded
  values and resolved directory calls stay narrow in these controls. The scan does
  not resolve bindings or parse general expressions; inert text and unrelated
  namesakes can still select extra work. Object shorthand now retains full
  package work when it stores a directory reader, including
  `yield {readdirSync}`, `yield {readdirSync, n: 1}` and `return {readdirSync}`.
  Executed Node controls cover all four APIs, first/middle/final properties,
  nested preceding values and comments. Saved base, head and unchanged helpers
  retain transitive consumers despite dirty local files; audited lock changes
  keep full work with readers and narrow work without them. Static named imports
  are excluded from this shorthand check, including default-plus-named and
  type-only imports, comment-separated forms and the executed quoted-program
  controls. Generated objects still retain consumers in those controls. Unused helpers, ordinary objects
  and resolved directory calls stay narrow in these controls. This lexical scan
  does not resolve bindings or parse general expressions; inert text and unrelated
  namesakes can still select extra work. General aliases, destructuring and precise
  object/binding resolution remain open. Destructured reader bindings, named
  reader exports, quoted text such as `'{readdirSync}'` and generated import text
  with escaped quotes can still select extra work. Executed base/final probes
  record these conservative cases; precise binding and generated-code resolution
  are optional efficiency follow-ups outside D69. Call arguments ending in a comma now retain full package
  work when they transfer a directory reader. Executed Node controls cover all
  four APIs, first/middle/trailing-comma arguments, nested preceding values,
  namespace members, comments, optional access, erased non-null assertions and
  awaited values. Saved base, head and unchanged helpers retain transitive
  consumers despite dirty local files; audited lock changes retain full work
  with these readers. Generated programs, a transfer inside division tokens
  and division in neighboring arguments retain their executed consumers.
  The same context rule retains object shorthand between division-valued
  properties. Executed controls cover all four APIs there and a division followed
  by a path-string argument. Unused helpers, ordinary arguments, static
  named imports and resolved directory calls keep narrow work in the controls;
  separate inert quoted fragments cannot combine into a transfer. This lexical
  scan does not resolve bindings or distinguish parameter declarations and
  inert program text from executed calls, so those can select extra work.
  General alias, binding and generated-input resolution remain open; these
  controls do not establish complete JavaScript reader discovery.
  A broad review run reported one child-status assertion with `null` instead
  of zero, but its output filter lost the test name and child diagnostics.
  A later 1,600-check run passed; that does not establish the first failure's
  cause. Preserve complete TAP, the named test, child error/signal and output
  before changing any assertion or deadline on recurrence. The complete
  reader/object controls pass separately; no broad-load reliability claim is made.
  The object check requires a brace
  context, so array readers keep their existing diagnostics and comma-only text
  stays narrow. Each quoted program has its own delimiter context; separate inert
  fragments cannot combine into a reader. A division-like token can contain live
  code, so its body is also checked for a stored object reader. A valid
  12,000-import control executes in Node and keeps five repeated saved-revision
  plans, using the production batched Git reader, within one five-second child budget. The initial source-masking scan
  reproduced a timeout; ordered import ranges, token contexts and skipping
  ordinary quoted values without reader names pass that same bound. This does
  not qualify arbitrary parser inputs, nested generated programs or host load.
  A final element's trailing comma also keeps full work, including multiline and
  comment-separated forms. Saved-helper and lockfile controls independently exercise
  final elements, so the first-element guard cannot mask a missing final-element guard.
  TypeScript `as` wrappers already retain full work; the diagnostic can name an
  import alias or an indirect call, depending on the surrounding expression.
  Precise resolution and clearer reasons remain open.
  Existing assertions and reader-audit
  certificates are unchanged. Repository-root working directories, computed
  inputs, non-source directory contents and broader root-path selection remain
  conservative. The owner closed D69 with the run-all fallback; more precise dynamic-input selection is optional future work. Identity still selects all nine packages in the current graph;
  portal-only changes now retain full package work when any saved reader is unresolved. Unaudited root, unknown and empty changes run everything.
  Type checking stays whole-workspace. The root command compiles the shared
  backend configuration once, then runs the portal and UI-smoke configurations.
  The seven backend package commands use the same root configuration, so repeating
  them does not check additional sources. The package-revision checks run in separate
  files discovered by the existing CI command, preserving every test
  body, assertion and fixture while allowing Node to run the files in parallel.
  This follows an eight-minute job cancellation after all 671 root checks and
  compiler checks completed; the test step alone took 457.9 seconds. The roughly
  five-minute job target still needs qualification. Real-compiler controls retain errors in
  every backend package, a newly added package, portal source/tests and UI
  declarations. A workspace inventory check refuses an unaccounted compiler
  command or configuration. Individual package commands remain available. Measure
  the full CI job before attributing any billed saving; the new behavioral checks
  also take time. The automated controls now inject a real type error into every backend test
  directory and a newly added backend package. They require a compiler diagnostic
  for each file, then pass after correcting all injected errors. Excluding those
  test directories in a disposable copy makes the new check fail. Missing
  package compiler scripts now fail with the affected package name, including
  absent scripts objects and non-string commands. Isolated workspace checks
  remove each package command in turn, require the named inventory failure and
  pass after restoration. Every compiler assertion and command remains unchanged.
  Both `-p` and the equivalent `--project` spelling identify the same three
  configurations in the inventory and real compiler trace. Isolated controls
  switch every package to the long spelling and still refuse unknown commands
  or configurations. All earlier compiler assertions remain in place.
  **pnpm setup:** capture a labelled recurrence to explain the historical network
  failures, and qualify cleanup when the supervisor itself is forcibly stopped.
  Native cancellation now remains visible when no request error follows an
  `.abort()` event, including before socket assignment or exit from an abort
  handler. Cleanup after a complete wire transfer stays successful. The historical missing npm timeout diagnostic
  remains unattributed; no existing assertion or deadline changed.
  Keep signature verification, version pins and deadlines; see the
  [setup boundaries and remaining work](backlog/ci-pnpm-setup.md).
  Package-only changes omit the two-venue milestone receipt when both immutable
  revisions retain its audited regular-file inputs, test command and CI wiring.
  These tests exercise validators and receipt composition; their guarded CLI
  blocks do not launch backend proofs when imported. Changed, missing or linked
  readers and unsupported evidence keep that receipt. Package-only changes also
  omit the backup-capacity receipt when both revisions retain its audited TLS
  fixture, two backup source files, validators, installation inputs and CI wiring.
  Root installation files and all tracked package manifests must match the complete
  audited inventory, so nested manifests, new install hooks or packages keep the
  receipt. Tracked dependency overrides under `node_modules` also keep it. Changed storage
  or transfer code still runs the real TLS checks. Package-only changes also omit
  the database-recovery receipt when both revisions retain its audited syntax-check
  targets, validator, migration-count helper, migration module, transaction helper,
  installation inputs and CI wiring. The suite checks syntax and validators; it
  does not execute the physical recovery drill. Changed imports or missing evidence
  keep the receipt. Any tracked `.gitattributes` file also keeps capacity and
  database-recovery checks: checkout encoding can change a reader without changing
  its stored Git hash. A fresh-clone control proves the UTF-16 import failure.
  The shared installation check preserves the earlier capacity guards.
  Package-only changes also omit the public-gateway receipt when both revisions
  retain its audited seven-module test closure, installation inputs and CI wiring.
  The tests exercise the real TLS gate, its fallback page and strict receipt
  validator. Changed gate/page code, helpers, test roots, commands, manifests,
  checkout attributes, install hooks or dependency overrides retain the checks.
  Package-only changes also omit the local-stack receipt when both revisions
  retain its audited deployment helpers, package readers, root script/test files,
  installation inputs and CI wiring. Whole deployment and migration directory
  hashes preserve wildcard test discovery and new directory entries. The tests
  exercise configuration, manifests, migration compatibility, operations metrics
  and validators; their child probes use controlled failures or supplied fixtures.
  They do not launch the deployed service stack. Changed or missing readers,
  new directory entries, installation hooks, attributes or overrides keep the checks.
  Unknown/full changes retain all five;
  portal source changes also omit local-stack when its audit holds, otherwise they
  retain it. Isolated ui-smoke needs no receipt. Registration
  uses five file shards, account HTTP uses three, portal uses six and backups uses
  two. Selected identity, operations and remote-access suites share one job when at
  least two are needed. Each keeps its full package command and deadline, runs
  once in sequence, and reports its own result. One PostgreSQL/Mailpit setup
  serves the group; a failure fails the job while later suites still run. The
  summary refuses malformed groups and overlapping package execution. Other
  packages keep one job each. Selected receipt suites share one
  setup and run in one job. The runner validates every selected suite before
  execution, runs each once and continues after a failure so later results remain
  visible. Any failed suite fails the job; the summary requires that job to
  complete successfully. The existing receipt-input audits also pin the grouped
  runner and its suite registry, because they now control execution. Changed or
  missing execution inputs retain the affected receipt. The five receipt commands
  and all their assertions stay intact. Compare actual rounded minutes with the
  preceding five-job sample before claiming a saving; the full-run budget and other grouping work remain
  open. Each file runs once, with its original
  assertions and test deadline. The authenticator clock-rollover case has its own
  portal file so sharding can separate its two real clock waits from the main
  authenticator journey. All work jobs have an eight-minute limit; the target is
  at most five minutes per job and about ten minutes for the whole run, including
  setup and queueing. Measure both the candidate and its merge before claiming the
  target is met.
  Browser packages install Chromium with at most two attempts, each bounded to
  120 seconds plus a shared ten-second cleanup allowance. On Linux, the privileged
  supervisor adopts its own orphaned descendants, including dpkg processes that
  start a separate session. It checks current parentage before signalling through
  stable process handles, and reaps adopted children after success, failure,
  timeout or cancellation. A second cancellation signal cannot interrupt that
  cleanup. Kernel handle and signal support are probed before installation;
  pre-existing children cause refusal instead of being assigned to the attempt.
  Each process receives at most one signal per cleanup phase. Unconfirmed
  cleanup refuses another attempt. The explicit browser cache path keeps the
  installed browser available to the runner. Before each
  attempt it waits at most 30 seconds for the existing apt/dpkg locks, without
  deleting lock files or stopping another process. The retry delay stays five
  seconds and all browser assertions and test deadlines stay intact. These
  configured allowances total at most `2 × (30 + 120 + 10) + 5 = 325` seconds,
  excluding job setup; the job still has its eight-minute limit. The lock waits
  are additional time introduced by the earlier supervisor change.
  D109's retrospective review found that apt could move dpkg outside the earlier
  process group and that a second cancellation could skip the forced stop.
  Real Linux session/lock checks now cover escaped children, stale ownership
  data, unavailable kernel support, inherited children, repeated termination
  and refused cleanup while preserving an
  unrelated holder. Host checks cover repeated cancellation and background
  children after successful and failed parent exits. A real disposable local
  package install leaves no apt/dpkg/install-script processes behind after its
  timeout. The interrupted package configuration still refuses the next install:
  cleanup releases process ownership and locks, not dpkg's unfinished records.
  Use a fresh CI runner; this helper does not run automatic package repair.
  [Run 39744422290](https://github.com/waitron-io/waitron-cloud/actions/runs/39744422290/job/119709401502)
  failed before UI-smoke tests: a timed-out dependency install left apt holding
  its lock. A controlled reproduction runs the workflow shell with a real
  lock-holding child that ignores termination: the old retry fails, while the
  supervised retry kills that child and succeeds. Run
  `node --test scripts/ci-download.test.mjs scripts/ci-download-linux.test.mjs scripts/ci-workflow.test.mjs` to check
  retry exhaustion, cancellation, lock release and refusal to touch an unrelated
  lock holder. On macOS, set `CI_DOWNLOAD_LINUX_IMAGE` to a cached Linux image
  with Python 3 (for example `node:26`) to execute the Linux checks in an owned
  container. Actual CI separately qualifies the root boundary and browser
  cache access. This handling does not establish why the outside download stalled.
  Ubuntu's Azure mirror and primary archive have both exhausted these limits.
  In [run 39804073424](https://github.com/waitron-io/waitron-cloud/actions/runs/39804073424/attempts/2),
  portal shard 1 timed out twice fetching the 15 MB `noble/universe` package index
  from the primary archive. Earlier
  [run 39787485838](https://github.com/waitron-io/waitron-cloud/actions/runs/39787485838)
  reached package downloads but timed out fetching fonts and NSS libraries.
  An initial alternative, kernel.org, was refused by a GitHub runner at its
  IPv4 address in [run 39810150851](https://github.com/waitron-io/waitron-cloud/actions/runs/39810150851/job/119934129050).
  Its local signed-download probe passed, so local reachability alone cannot
  qualify the source for Actions.
  CI directs recognised Azure, primary and runner mirror-file archive
  references to a local APT mirror list. APT tries Princeton first, then
  `https://archive.ubuntu.com/ubuntu` when a file cannot be fetched. Your release,
  components, architectures, signing keys and unrelated source files retain their
  values. A generated APT configuration limits HTTPS connection and idle waits
  to 10 seconds, including other HTTPS sources on that disposable CI runner, so
  an unavailable host leaves time for the alternative. The two outer 120-second
  attempts, cleanup grace, package-lock waits and retry delay stay unchanged.
  Ubuntu's signed release metadata and package hashes still decide which bytes
  you can install; no additional signing key or unsigned source is introduced.
  See [Ubuntu's archive verification](https://documentation.ubuntu.com/security/software-integrity/archive-verification/)
  and [APT's mirror fallback and priority rules](https://manpages.ubuntu.com/manpages/noble/man1/apt-transport-mirror.1.html).
  Run `node --test scripts/ci-browser-source.test.mjs scripts/ci-download.test.mjs scripts/ci-browser-apt.test.mjs`
  to check preserved source fields, the unchanged workflow, controlled unavailable
  mirrors and exhausted attempts. On Linux, the final check runs real APT against
  a temporary signed archive: it checks the effective timeout after runner defaults,
  downloads through the alternative when the first connection cannot complete,
  refuses two unavailable mirrors, rejects altered signatures and
  rejects changed package bytes. It installs no package and uses no system APT
  state. On macOS that Linux check is skipped; GitHub CI must execute it.
  Browser CI now requests stable index filenames, keeping the mirror that
  supplied each signed release. APT's by-hash URLs otherwise select a mirror
  again for every index, including one that just failed. Signed release metadata
  still supplies the required index digests, and package hashes still apply.
  Stable-path selection is now limited to each rewritten Ubuntu source entry,
  using APT's [source-local By-Hash option](https://manpages.ubuntu.com/manpages/noble/man5/sources.list.5.html).
  Vendor sources keep their own bytes and hash-addressed downloads, which can
  avoid stale filename copies during index publication. A mixed Ubuntu/vendor
  Deb822 stanza refuses before any source is changed because one stanza shares
  its index policy. Signing keys, digest checks and retry deadlines stay intact.
  Run `node --test scripts/ci-browser-vendor.test.mjs` on Linux to reproduce a
  signed stale-filename mismatch, successful vendor hash-addressed acquisition,
  and refusals of altered immutable-index bytes and signatures. The historical
  Microsoft publication mismatch in [run40482034486](https://github.com/waitron-io/waitron-cloud/actions/runs/40482034486)
  remains unattributed; a controlled reproduction does not explain its CDN state.
  If an index changes during publication and its required bytes cannot be fetched,
  a digest mismatch still refuses the update; no package state is repaired.
  A separate [extra relay admission](backlog/relay-contention-extra-admission.md)
  needs PostgreSQL reproduction; this source repair does not explain it.
  The controlled regression includes four suites with sixteen package indexes
  and forty-eight compressed package, translation and command indexes, with a
  separate altered-index refusal. Both journeys require the actual stable
  index request paths, with no missing or extra requests. The compressed Ubuntu by-hash case reproduced the
  release-success/index-timeout sequence before stable filenames were introduced; the one-index and
  uncompressed sixteen-index cases did not. Run
  `node --test scripts/ci-browser-apt-components.test.mjs` on Linux as well as
  the original trust and refusal journeys. If the isolated fixture's update or
  package download fails, its bounded stderr record names the stage and scenario,
  retains the output tail and lists the latest requests received by its local
  archive. Run `node --test scripts/ci-browser-apt-diagnostics.test.mjs` on any
  platform to check timeout evidence, nonzero exits, output bounds and silent
  success. The original exception, result, checks and deadlines are preserved.
  On the Ubuntu 26 test box, the archive fixture reproduced three unexpected
  TLS closes before signed-index validation. Its HTTP handler now sends the
  TLS shutdown notification, with a one-second limit for the peer to reply.
  Run `node --test scripts/ci-browser-apt-tls.test.mjs` for strict clients that
  reply, stay silent or disconnect. All three original component journeys and
  the original signature/package-hash refusal journey pass on that box with
  their assertions and deadlines unchanged. This repairs the local fixture
  transport. The handler also disables TCP coalescing, which can hold small TLS
  writes while earlier bytes await acknowledgement. The same three transport
  checks now inspect both accepted sockets as well as response bytes and bounded
  shutdown. All original APT assertions, signature and hash checks, retry limits
  and deadlines remain unchanged.
  The compressed-index update timeout in
  [run40536424286](https://github.com/waitron-io/waitron-cloud/actions/runs/40536424286/job/122302974742)
  remains unexplained; the missing temporary configuration warning's relation to
  that timeout is unknown. A later
  [index-hash recurrence](https://github.com/waitron-io/waitron-cloud/actions/runs/41276827214/job/124760631141)
  recorded the expected hash mismatch and 47 local requests before the eight-second
  supervisor expired. Neither historical run captured packet timing, so the exact
  historical cause remains unknown. Run the Linux component journeys and
  retain their labelled failure evidence on another recurrence; a passing retry
  alone does not repair a timeout.
  The public mirror's underlying
  network failure remains unexplained; this change addresses index selection.
  Real Actions qualification must show two consecutive full runs of the same
  head and its independent merge run, with one install attempt and every portal
  and UI-smoke test executed. Keep this gate when changing sources; controlled
  checks alone do not qualify public mirror availability.
  [Run 39890570457](https://github.com/waitron-io/waitron-cloud/actions/runs/39890570457/job/120209180867)
  and [run 40094682408](https://github.com/waitron-io/waitron-cloud/actions/runs/40094682408/job/120874425012)
  could not connect to Princeton at `128.112.18.21:443`. The fallback addresses
  the repeated single-host dependency. Either public archive can still fail,
  and the existing supervisor must refuse within its limits if neither works.
  [Run 40423880234](https://github.com/waitron-io/waitron-cloud/actions/runs/40423880234)
  later refused Princeton's expired certificate chain before browser tests.
  The alternative retains TLS verification; an expired certificate is never trusted.
  The outside network cause and the separate browser reconnect cause remain
  unknown; those original red runs remain evidence.
  The rewrite recognises the runner's current lowercase, whitespace-delimited
  URIs. Qualify compact Deb822 URI fields or capitalised hostnames before
  widening that support when a runner changes its source format.
  When the source helper rewrites no archive URI, it now warns on stderr and
  continues: your sources may already be prepared or the runner layout may have
  changed. A warning keeps an unfamiliar but usable runner eligible; the existing
  signed-package checks and bounded install still decide whether CI can proceed.
  Empty, unfamiliar and already prepared source inventories retain their bytes
  and successful exit status; a real rewrite reports its mirror without the warning.
  Source preparation now reads every selected file as UTF-8 before writing any
  source, so an unreadable vendor file refuses without rewriting earlier files.
  A real-command invalid-byte regression preserves both files byte for byte;
  deliberate faults also prove each URI's leading whitespace boundary. This preflight does not make subsequent
  write failures atomic or qualify new source formats. ARM
  runner sources remain unqualified; check their archive location before adding
  that architecture. The current workflow uses x64 runners. D117 preserves line
  endings, closing the review's separate newline-format note.
  D107's corrected-head
  [run 39776383906](https://github.com/waitron-io/waitron-cloud/actions/runs/39776383906/job/119816424815)
  could not build the verification fixture because Docker Hub returned
  `502 Bad Gateway` for the `node:26` manifest. The two infrastructure tests
  in `packages/backups/test/verification-infrastructure.test.ts` did not run;
  cleanup also refused to remove the image that was never built. The outage
  fixture now acquires a missing base before creating its PostgreSQL container,
  makes at most three pull attempts for transient registry failures, and shares its existing
  120-second image-preparation budget across acquisition and one build. Cached
  bases need no pull; authentication refusals stop immediately. Cleanup removes
  the uniquely requested image tag when present and the uniquely named attempted
  PostgreSQL container, including failed builds and starts. Docker's forced
  container removal accepts an absent container; other cleanup errors remain
  visible and image cleanup still runs after container-removal failure.
  The readiness probe
  checks TCP because PostgreSQL's temporary initialization server already accepts
  local sockets. Fourteen controlled acquisition/failure checks and the two
  real outage/malformed-archive tests pass with the existing limits and original
  behavioral checks. The target-bound worker uses the same acquisition helper
  with its own Dockerfile, building exactly once before PostgreSQL starts. This handles
  the local fixture failure; it does not fix Docker Hub's response or guarantee
  registry availability. Other backup fixtures still acquire their base inside
  their own build; extend this preparation helper there if acquisition fails.
  The later [D108 qualification run 39786287483](https://github.com/waitron-io/waitron-cloud/actions/runs/39786287483/job/119850413048)
  exhausted both browser-install attempts before any portal test ran. D117's
  signed alternative source above now has two consecutive full exact-head runs
  and an independent merge qualification, each installing in one attempt and
  executing every browser test. The historical primary-archive slowness remains
  unexplained. Every fixture head requires its own CI qualification.
  **Local storage fixture port allocation repaired; original holder unknown.** In
  [run 39929839494](https://github.com/waitron-io/waitron-cloud/actions/runs/39929839494/job/120335229364),
  SeaweedFS's filer failed before the separate-authority concurrency case because
  its loopback address was already in use. The fixture now holds all seven child
  port reservations together until just before spawning SeaweedFS, preventing the
  allocator from choosing one port for two services. Reservations drop incoming
  connections so a peer cannot hold their release open. Partial allocation failure
  closes every earlier reservation. A child startup failure records the named
  port allocation and a bounded `lsof` listener snapshot, or an explicit reason
  that collection was unavailable, before stopping only its own child.
  Native tests reproduce the earlier release pattern, allocation interruption and
  an owned competing listener. Authority/concurrency checks and service deadlines
  are unchanged. Another process can still claim a port during the handoff to the
  separate child. The [parallel fixture repair](#parallel-storage-cache-fixture-failure-on-main)
  now retries an explicit refusal of an allocated port once, preserving its
  diagnostics and leaving the competing owner alone. The historical CI socket
  owner remains unknown. D101 slice 3 landed in PR311 after fresh head and merge
  CI; every later fixture change still requires its own qualification. A
  successful unchanged rerun is not a cause diagnosis.
  A separate test-harness route failure remains unattributed. In
  [run 39813909743](https://github.com/waitron-io/waitron-cloud/actions/runs/39813909743/job/119947375548),
  registration shard 2 never ran its tests: pulling `axllent/mailpit:v1.31.1`
  from Docker Hub failed with an IPv6 `connect: network is unreachable` error.
  The launcher now retries that connection response within its existing
  three-attempt, 120-second per-image acquisition limits. Docker-free checks run
  the real launcher against a controlled Docker executable, proving recovery
  for both pinned images before either container starts, and refusal after three
  unreachable responses without running package tests. Original assertions,
  deadlines, cancellation and container cleanup remain unchanged. Run
  `node --test scripts/ci-test-postgres.test.mjs` for those checks. Real Docker
  qualification runs in CI while local Docker is unavailable. The outside
  route's cause and recovery remain unproved; a later successful pull does not
  establish a route fix. The historical job's stale `in_progress` record hid its
  failed step, so read the actual job log and final status before counting tests.
  Main pushes use a unique concurrency
  group per run so a later merge cannot cancel an earlier merge's checks;
  superseded pull request runs still cancel. The workflow text guard checks shard
  completeness and deadlines. The summary checks actual job records against the
  plan, refusing missing, duplicated, cancelled, unfinished or failed required
  jobs, and any unexpected executed job. Unused job families must finish skipped.
  Every PR job checks out its exact
  head SHA. Every push to main runs the complete package, receipt and compiler
  suites, even when the merge tree equals a green pull-request head. This follows
  the owner's 2026-10-18 decision; daily-only main testing is withdrawn. Local
  regressions exercise the real planner and summary commands and both equal-tree
  and advanced-main squash merges without depending on the pull-request API.
  The reuse helper and its evidence checks remain historical controls.
  The planner explicitly disables setup-node's automatic package cache because
  it does not install dependencies. The lockfile control selected all 20 package
  jobs, then reproduced a missing-store failure in the cache-saving cleanup step
  ([run 38546606743](https://github.com/waitron-io/waitron-cloud/actions/runs/38546606743)).
  setup-node describes its input as “Set to false to disable automatic caching”
  ([action definition](https://github.com/actions/setup-node/blob/v5/action.yml), read 2026-10-14).
  Historical Actions controls proved portal-only selection (three nonempty shards,
  180 tests), identity's complete consumer set (all nine packages), and lockfile
  fallback (then all 20 package jobs and five receipts). The corrected cold-lockfile
  [run 38548997181](https://github.com/waitron-io/waitron-cloud/actions/runs/38548997181)
  passes all 28 jobs and all 1,477 package tests, including the added usage case.
  The [current scratch merge](https://github.com/waitron-io/waitron-cloud/actions/runs/38547672978)
  reuses its green head with only planner and summary work; the
  [behind scratch merge](https://github.com/waitron-io/waitron-cloud/actions/runs/38547920473)
  refuses reuse and passes the full suite. The portal head and its merge use
  18 + 2 = 20 rounded job-minutes, compared with the previous full-run pair's
  70 + 70 = 140. These are timestamp-based rounding estimates, not invoices.
  That historical backlog-bearing PR took the full route because mixed docs and
  code changes remain outside the narrow selectors. Its observed full head uses 72 minutes; adding the measured
  two-minute reuse gives a 74-minute pair estimate. The final production pair is
  recorded in the [PR evidence](https://github.com/waitron-io/waitron-cloud/pull/124).
  The simultaneous proof runs queued behind each other: identity took 13m54s
  overall, while every executed job stayed within 4m14s. Treat queue time separately
  from test duration and keep measuring normal runs.
  [Run 38500339948](https://github.com/waitron-io/waitron-cloud/actions/runs/38500339948)
  on `9bb8e8644d5ce9993fffa3f7ec13170d81de5ae4` took 9m45s in portal and
  9m02s in account HTTP before this split. The package logs counted 1,476 tests;
  compare the sum of every shard's count with each package's original count.
  Whole-package coverage must remain whole-package if a package later enables it.
  Run focused local checks while implementing; CI owns mandatory package suites
  under the owner's 2026-10-18 decision. Check every job on the exact PR head
  and the independent main run.
  On an 18-core local runner, the unsplit registration suite exhausts PostgreSQL's
  shared lock table while resetting disposable schemas (`53200: out of shared
  memory`). For a full local package run, put `--test-concurrency=2` before the
  file list, for example
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-concurrency=2 --test-timeout=30000 'test/*.test.ts'`.
  The full unsplit account HTTP suite also reports PostgreSQL `53200` during
  disposable migration setup on this Mac: the D72 run completed 292 cases with
  82 failures, including the unchanged signup, origin, session and rate-limit
  fixtures. Use the same two-file limit for full local database package runs;
  retain every file, original deadline and portal build. A later parallel local Task 21 run
  also killed the unchanged npm-bootstrap probe at its 35-second deadline without
  retaining npm output. An isolated run passed in 31.36 seconds; that does not
  explain the earlier deadline. Capture process startup and request timestamps on
  recurrence, and preserve the original budget. A later D69 focused CI-script
  run passed 970 of 971 checks and reached that same unchanged 35-second
  bootstrap limit with no child output. The test and workflow match its base.
  An isolated instrumented copy passes in 31.4 seconds, with tarball requests at
  0.4 and 16.4 seconds. A controlled five-second npm startup delay reproduces
  the unchanged timeout assertion. This demonstrates that startup time can
  consume the remaining budget; the original run recorded no request stages,
  so its precise cause remains unproved. No bootstrap assertion or limit changes.
  Retain startup and request timestamps on recurrence. Local receipts are under
  `~/waitron-campaign-d/receipts/d69/nested-predecessor-readers/`.
  Fiscal store and HTTP fixture construction now close acquired resources when
  a later setup step fails. Docker-free checks force authority startup, table,
  venue, listener and machine setup failures, using real authority children,
  HTTP listeners and pool objects with database operations replaced. Normal
  teardown also closes multiple HTTP listeners. The PostgreSQL package suites
  verify the unchanged fiscal behaviour in CI; local database checks remain
  unavailable while Docker is down. The authority helper now stops its child
  and removes its temporary directory before rejecting failed startup or restart.
  Docker-free checks force a synchronous spawn refusal, a missing executable,
  early child exit and malformed ready output, preserving the startup error.
  Keep the package's original test deadline and any build step. Appending the
  concurrency option to the package script leaves it after the files and does
  not limit this runner. The fixture's default lock capacity for a full local
  parallel run remains open; preserve every assertion when addressing it.
  A later bare `node scripts/test-postgres.mjs` run repeated `53200` in registration
  schema reset/migration, including authenticator setup; it reported 576 passes and
  72 failures among 648 result entries. The last relay-worker test process remained
  open with no remaining test-database sessions. Stopping its recorded process ID
  allowed the failure report and wrapper cleanup to finish. Qualify that fixture's
  failed-setup/resource cleanup separately; the exact remaining handle was not
  identified. The documented two-file command keeps every original assertion and
  deadline; the bare run's failure remains recorded.
  The residential-comparison bare run repeated `53200` in authenticator schema
  reset and reported 377 passes and 273 failures among 650 registration result entries.
  Its remaining `test/relay-operator-stop.test.ts` worker also needed an owned-PID
  stop before failure reporting and wrapper cleanup completed. The exact open
  handle remains unproved. The complete documented two-file suite then passes
  all 646 registration cases; that qualification does not close the unsplit-resource
  or historical open-handle investigation. The shared relay-worker fixture now closes
  both pools when schema creation, migration or its clock read fails, and drops only
  a schema whose creation succeeded. Cleanup attempts later resources even if an
  earlier step fails; a setup failure remains the cause when cleanup also rejects.
  Docker-free checks exercise real pool closure with database operations replaced.
  They do not reproduce the historical PostgreSQL hang; genuine database cleanup
  remains for CI. The relay operator-stop SMTP fixture now rejects listener startup
  errors with their original cause instead of waiting for a successful listen
  callback. A Docker-free occupied-port check reproduces the earlier pending setup
  and keeps the competing listener open; real mail capture and test teardown are
  also checked. This does not identify the historical PostgreSQL hang's cause.
  Diagnostics: `~/waitron-campaign-d/receipts/d76/`.
  The migration batch-size fixture now confines its database-wide DDL trigger
  to its own schema. A second populated fixture proves that other tests can
  migrate while it is active; the original 103-recipient and 100-row batch
  assertions remain.
  The usage privacy fixture now uses an owned organisation identifier distinct
  from the foreign-count marker `999`. A valid identifier containing those digits
  reproduces the old false privacy alarm; an added HTTP case proves that such an
  owned identifier remains allowed while foreign totals and credentials stay out.
  Every original privacy and ownership assertion remains unchanged. The natural
  local failure did not record the matching value, so its exact cause stays unproved.
  The pairing lock/expiry fixture prepares five seconds of valid authority, then
  waits on the database clock until that deadline passes before releasing its
  observed membership lock. A controlled 200 ms call delay reproduces the old
  100 ms fixture failure and passes with this setup. Every original refusal,
  observed-lock and rollback assertion and the 30-second deadline remain.
  Removing both mutually masking post-wait expiry checks fails the owning test;
  restoring them passes. The natural CI failure did not record entry timing, so
  its exact cause remains unproved. Production expiry rules are unchanged.
  The Cloud-approval session-expiry fixture also starts its five-second deadline
  after setup. It identifies the approval waiting behind its membership blocker,
  checks that the session is still valid, then waits on the database clock before
  releasing the lock. An outside expiry update would wait on the session row
  already held by approval. A controlled 200 ms setup delay reproduces the old
  observed-lock assertion failure; the corrected fixture retains that slow setup
  and passes. All
  original session-refusal, observed-lock and absent-approval assertions and the
  30-second execution deadline remain. Main run `39209023087` did not capture
  these timing boundaries, so its exact scheduling remains unproved.
  Other pairing expiry fixtures still observe any lock wait in their schema;
  identify their actual blockers before claiming that observation proves a
  membership-lock wait.
  This budget is separate from intermittent fixture failures; more time is not
  a diagnosis of a failing assertion.
  **Two fixture failures reproduced after the authenticator merge.**
  [Run 38373683976](https://github.com/waitron-io/waitron-cloud/actions/runs/38373683976)
  on docs-only `7860981` failed registration and portal. Advancing each clock read
  by one millisecond makes the relay worker fixture reject its lease: its separate
  `issuedAt` and `expiresAt` clock reads can exceed the one-hour limit. The worker
  fixture now reads the clock once. Its advancing-clock regression passes and
  restoring the separate reads fails; the production maximum and every existing
  worker assertion remain. The Spanish/dark/390 authenticator journey also failed
  at its first factor sign-in. A controlled rollover after enrolment reproduces the
  same timeout with a real 401: the journey's previous-step code then names the
  already-consumed enrolment step. The first sign-in fixture now uses a valid
  code for the next 30-second period, which the existing verification window
  accepts. A real browser/PostgreSQL regression observes the clock advance
  after enrolment, signs in with that fresh code, refuses the consumed enrolment
  code, then accepts an unused code from the previous period after the next clock
  advance.
  It fails with 401 before the fixture correction and passes afterward. All original
  journey assertions and the seven-second waits remain. The failed CI did not record
  its factor response or steps, so the reproduced mechanism does not establish that
  historical run's exact cause; collect the failing response on any future failure.
  **Server-startup fixture grouping.** The plan merge's
  [run 38375993173](https://github.com/waitron-io/waitron-cloud/actions/runs/38375993173)
  timed out in the single server CLI settings/missing-migration test after 30 seconds.
  Its unchanged local run takes 14.9 seconds; adding one second to each real child
  startup reproduces that timeout. Each missing migration now has its own named test,
  keeping all original refusal/ledger assertions and the existing 20-second child
  and 30-second test deadlines. The controlled slow-start run passes all 31 cases. Individual startup timings were absent from CI,
  so its exact failure cause remains unproved; use the named case on a future failure.


  **HTTP authenticator replay fixture.** The management journey retains the exact
  activation code for its replay refusal, instead of computing a potentially fresh
  code after the 30-second period changes. A previous-step enrolment variant
  reproduces the old `200 != 401` failure and passes with that correction. All
  existing replay, session, recovery-code and cookie assertions and the 30-second
  test deadline remain. The complete HTTP authenticator file passes 16 checks;
  bypassing replay refusal in a disposable checkout fails both management variants
  at their unchanged 401 assertions. Run
  `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec
  node --test --test-timeout=30000 test/authenticator-factor.test.ts`.
  [Run 38419110801](https://github.com/waitron-io/waitron-cloud/actions/runs/38419110801)
  failed that assertion. CI did not record the two code periods, so its exact cause
  remains unproved. Production authentication code and accepted code periods stay
  unchanged.

  **Registration authenticator replay fixture.** The registration-store enrolment
  test now retains its exact accepted activation code for the replay refusal,
  matching the HTTP fixture and the approved authenticator spec. A previous-step
  enrolment variant reproduces `Missing expected rejection` with the old fresh-code
  expression. The refusal code, every original assertion and the 30-second test
  deadline remain. No production authentication or accepted-window rule changes.
  PR run `39237311621` failed at `authenticator-factor.test.ts:86`; it did not
  record both code periods, so this reproduces a mechanism rather than proving
  that historical run's precise cause. Keep the explicit replay variant and
  investigate any recurrence with the consumed time-step evidence.

  **Stable registration enrolment clock (D530).** A previous-step code can expire
  after the fixture checks the time but before password verification and database
  work finish. A Linux probe holding the generated code across its period boundary
  reproduces activation's `permission_denied`, with the original assertions and
  30-second deadline. The successful enrolment and replay variants now use one
  schema-local PostgreSQL timestamp for verification and code generation. The
  clock sits 90 seconds ahead of real time, inside the five-minute enrolment
  lifetime, so an ordinary-clock pool or missing clock function fails reliably.
  Two additional host-clock-shift controls fail before the setup change. Every
  original assertion, accepted code offset and deadline remains; the independent
  lock-wait expiry cases still advance their verifier clock and require refusal.
  Run the registration `test/authenticator-factor.test.ts` file through the
  PostgreSQL wrapper. This repairs the fixture's timing dependency; the exact
  cause of [the historical registration activation refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/41167290103/job/124437552213)
  remains unproved because that run did not capture both code periods.

  **Local registration suite lock capacity.** Running the complete registration
  suite with this Mac's default 18 test-file workers exhausted PostgreSQL's shared
  lock table (`out of shared memory`, with `max_locks_per_transaction` hints).
  That run reported 486 passes and 198 failures across 684 reported cases; two
  stalled test processes and their recorded descendant required termination.
  The wrapper then cleaned up its owned database and mail containers.
  Full local registration and account HTTP package commands now run at most two
  test files at once, keeping every discovered file and its existing deadline.
  Docker-free command probes check the bound, new-file discovery and failure
  reporting with real Node workers. A complete unsharded PostgreSQL run still
  needs qualification when local Docker returns; CI's existing database shards
  keep their own commands. Receipt fixtures compare seeded historical manifests
  with their saved test commands; existing assertions and production selection
  guards stay unchanged. The historical lock exhaustion and unidentified
  failed-setup handles remain recorded; database limits are unchanged.

  **One-second relay budget fixture.** The key-retirement and rollover tests now
  retry setup admissions at most ten times when the budget window ends before
  admission commits. They keep the one-second window and every existing assertion.
  A permanent PostgreSQL 1.1-second first-insert delay proves setup recovers only
  after the expired attempt rolls back; the complete relay-bounds file passes 34
  checks. Removing the production expiry guard in a disposable checkout fails both
  the slow-insert rollback assertion and the original rollover-refusal assertion.
  Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
  node --test test/relay-bounds.test.ts` for these checks.
  The design-only [merge run 38415818412](https://github.com/waitron-io/waitron-cloud/actions/runs/38415818412)
  failed at that expiry guard during first admission. A controlled delay reproduces
  the failure, but CI did not record window timestamps, so its exact cause remains
  unproved. Production guards and timing policies are unchanged.

- **Shared UI.** The portal uses the released shared account controls. Release the
  shared hover fix in Waitron before removing Cloud's override, and read the first
  post-split weekly mutation results; see [scope and remaining work](backlog/shared-ui.md).
- **Identity and organisations.** Local signup, recovery, passkeys, authenticator
  controls, account sessions, pairing approval and encrypted transactional mail are
  implemented. Production ingress, email and key qualification, password screening
  operations, retention, platform/support permissions and legacy-account recovery
  remain open. See [requirements, remaining work and deliberate limits](backlog/identity-and-organisations.md),
  including the email-region decision and the boundaries of local browser evidence.
- **Subscriptions and billing.** Service catalogue, checkout, invoicing, permitted
  services, usage accounting, trials, failed payment and cancellation. Item 3 of
  [launch platform work](#launch-platform-work-in-priority-order); designed in
  [the billing design](superpowers/specs/2026-10-29-cloud-billing-design.md).
- **Venue and node registration.** The agreed Waitron signup and connection journey is
  implemented locally. Planned handover, diagnostics, retention, key provisioning
  and rotation, deployment qualification and production activation remain open;
  see [the requirements and deliberate limits](backlog/venue-registration.md).
- **Provisioning and placement.** The owner approved the
  [production deployment design](superpowers/specs/2026-10-22-cloud-production-deployment-design.md)
  for local building and rehearsal. D110's
  [P1 country-cell plan](superpowers/plans/2026-10-22-cloud-country-cell.md)
  specifies images, repository-driven Kubernetes deployment and genuine three-node
  availability checks for sign-in, remote access and backups. The plan is a documentation
  milestone; implementation and those runtime checks remain unfinished. AWS accounts,
  spending, live infrastructure and production schema changes need separate authority.
  Global account separation and the action controller have planning entries below;
  release waves, hosted venues and regional failover remain later plans.
  Country/provider/cell registry, repeatable resource
  creation, recovery from partial failures, capacity and customer movement remain open. The local
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
- **Global and country separation (P3).** The
  [revised implementation plan](superpowers/plans/2026-10-22-cloud-global-country-split.md)
  follows the owner's 24 October decisions: customer accounts, credentials, factors,
  sessions, profiles, plans, alerts, quotas and account/box recovery stay in-country,
  with one owner per customer organisation per country and no invitations or managers.
  Fresh sign-in, account recovery, new box recovery and venue services must work with
  global absent. Global keeps the separate worldwide operator console and apex routing,
  with no customer or venue copies. Country billing is recommended, not implemented or
  approved; global reporting needs a later privacy decision. This is planning only,
  pending owner PLAN re-approval after landing, then separate P3 build
  authority. Isolation, cutover and real outage acceptance remain unbuilt and unproved.
  Every migration task must reconcile reservations, including 043, and the actual
  manifest before reallocating provisional later names. P1's shared database remains
  transitional; P1 owns isolated deployment and P4 country action/approval adapters.
  Priority 5 separately designs verified owner handover and lost-owner recovery.
  Production schema, provider resources, deployment, spending and live mail retain
  their separate authority gates.
- **Repair actions and Cloud controller (P4).** The approved production design's
  action-by-action automation is described in the
  [implementation plan](superpowers/plans/2026-10-22-cloud-action-controller.md).
  This is planning only. The catalogue, durable requests, operator approvals,
  console, notifications and controller are not built. Plan approval and P1's
  country-cell build remain required before implementation; any new database
  migration must recheck active reservations and the inventory after migration 043.
  C39 supplies observations without
  granting action or activation authority. P5 release waves, P6 hosted placement
  and revised A1018 handover, P7 regional failover and all production enablement
  gates remain separate. P4's historical external-proof writer-admission tasks
  require amendment against the revised shared contract before build. No provider
  operation, spending or live mail is authorised.
- **Provider integration.** Storage, compute, email, notifications, jobs, keys and
  telemetry, with AWS and Google implementations where needed. The local SeaweedFS
  storage contract now covers venue-scoped access, live key rotation, issued-credential
  expiry, versioning, interrupted uploads and concurrent conditional create/replace.
  The [Stockholm AWS sandbox rehearsal](aws-storage-rehearsal.md) now exercises those
  storage boundaries with real assumed-role credentials, PostgreSQL-backed archive
  publication/key rotation and real Waitron/Litestream restores. New S3 buckets need
  explicit SSE-C enablement for the existing stream format. Cloud must extend its
  managed-stream credential contract to carry and renew session tokens, coordinated
  with Waitron, before using assumed roles through that adapter. Repeat the deployment
  qualification in Spain and separately for Google; production custody, credential
  delivery, web identity, retention, monitoring and activation remain open.
- **Operations.** Local status, deployment, database recovery and schema-upgrade
  rehearsals are implemented. Production deployment, provider-native recovery,
  recovery objectives, portal resilience and operator controls remain open;
  see [the requirements and deliberate limits](backlog/operations.md).
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
  If a diagnostic download fails, you see its error beside the venue you chose. Starting
  another download clears that warning; changing accounts clears its venue association.
- **Service monitoring.** Check representative operations from outside the affected
  cell; track errors, response times, queued work, backup freshness and capacity.
  Production observation, phone delivery, recovery targets and C39 plan/build approval
  remain open; see [the requirements and deliberate limits](backlog/service-monitoring.md).
- **Usage metering.** Local totals cover snapshot storage and transfer, installation
  operations, monitoring probes and administrative alerts. Native controller tests
  hold old totals, permission refusals and rate limits across account or organisation
  changes, including switching away and back and signing out. They check that old
  replies cannot replace current totals, end a pending read, publish an error or
  impose a cooldown; selecting the same account and organisation keeps its read.
  Production deployment,
  monitoring and additional service units remain open; define costs, allowances and
  outage policy before using totals for billing. See [scope and remaining work](backlog/usage-metering.md).
- **Data lifecycle.** Local backup capture, retention, verification and recovery are
  implemented; paused-parent verifier checks retain diagnostic-input ordering. Production
  custody, provider qualification, isolation and lifecycle
  policies remain open. See [the complete requirements and deliberate limits](backlog/data-lifecycle.md),
  including unresolved verifier failures and capacity qualification.


## Diagnostic download replies after account changes (D400)

See [the client account-change boundaries](backlog/diagnostic-download-http.md#diagnostic-download-replies-after-account-changes-d400).
The earlier PR #644 qualification timed out during source installation before
private-replay checks began (run 40646201742, job 122675571593). D530 retains
the unresolved cause; a passing retest does not repair it. Production permission
checks and provider qualification remain separate.

## Backup catalogue replies after account and venue changes (D396)

Native controller checks hold refresh and older-page replies while you change
account or venue, reopen the catalogue, switch accounts away and back, or sign out.
Late successes and refusals leave the current rows, recovery choices, pending read,
feedback and cooldown unchanged. Current reads still complete and paginate; selecting
the same account preserves its pending read. These checks use controlled HTTP
replies and preserve the existing recovery permissions and cooldown policy.
Server authority and genuine restore qualification remain separate CI and launch gates.


## Backup catalogue HTTP response validation (D411)

**Open.** Qualify server permissions and genuine restore or recovery; these client
checks grant no activation or stop-proof authority.
See [the boundaries and remaining work](backlog/backup-recovery-http.md#backup-catalogue-http-response-validation-d411).

## Backup catalogue transport refusals and retry waits (D426)

**Open.** Qualify server permissions and genuine restore or recovery. Catalogue retry
waits now use elapsed time through clock corrections, including HTTP-date and
body-reading time; these client checks grant no activation or stop-proof authority.
See [the boundaries and remaining work](backlog/backup-recovery-http.md#backup-catalogue-transport-refusals-and-retry-waits-d426).

## Storage archive extraction command refusals (D453)

**Open.** Real store startup and historical failure causes remain open.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#storage-archive-extraction-command-refusals-d453).

## Container verifier memory-refusal observation (D335)

**Open.** Qualify the native Docker-positive, non-73 refusal control; Docker event-reporting differences remain unexplained.
See [the boundaries and remaining work](backlog/verifier-build.md#container-verifier-memory-refusal-observation-d335).

## Verifier source isolation from local edits (D445)

**Open.** Run real image qualification in CI and reproduce the historical build timeout
when local Docker returns.
See [the boundaries and remaining work](backlog/verifier-build.md#verifier-source-isolation-from-local-edits-d445).

## Verifier build refusal and cleanup controls (D443)

**Open.** Run real image qualification in CI and reproduce the historical build timeout
when local Docker returns.
See [the boundaries and remaining work](backlog/verifier-build.md#verifier-build-refusal-and-cleanup-controls-d443).

## Bound verifier fixture build timeout (D312)

Find why the bound verifier fixture image exceeded its two-minute build limit in CI.
The cancelled run retained no build progress, so registry, image-pull and cache causes
remain unproved. Build failures now print their command, elapsed time, failure reason
and output tail before the test summary. Failed-build cleanup still attempts its
unique image tag, with a one-second limit, and always removes temporary files.
Reproduce the image build when local Docker is available; passing CI does not explain
the earlier timeout. Keep every verifier assertion and the existing build and job limits.

## Storage partial port-reservation refusals (D464)

**Open.** Real store startup and historical failure causes remain open.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#storage-partial-port-reservation-refusals-d464).

## Storage extraction and certificate setup refusals (D452)

**Open.** Store startup, concurrent extraction and historical failure causes remain open.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#storage-extraction-and-certificate-setup-refusals-d452).

## Storage startup configuration refusals (D446)

Malformed token-duration strings are now checked before the fixture allocates a
private directory or requests an archive. Run
`node --test scripts/ci-backup-storage-options.test.mjs` for native controls of
missing units, partial matches, whitespace, negative and fractional durations,
and an empty value that must not select the default. Accepted second, minute and
hour formats and omitted options reach a deliberately refused download; that
failure retains its cause and removes its private directory without retrying.
These checks exercise the existing format rule. Real token issuance and expiry,
store startup and concurrent valid-cache publication keep their separate gates.

## Existing storage-cache refusal qualification (D442)

**Open.** Capture an instrumented recurrence before attributing the historical startup
or download failure; real storage qualification remains separate.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#existing-storage-cache-refusal-qualification-d442).

## Storage identity-server bind refusals (D456)

The identity server binds directly to an OS-assigned port and keeps that socket
until cleanup. Its discovery response, provider configuration and tokens use the
bound port, removing the probe-and-rebind race reproduced under D499.
Run `node --test scripts/ci-backup-storage-issuer-bind.test.mjs` to check real
bind refusals, later setup failure and preservation of another listener. Failed
identity and numbered reservation binds print only their name and bind attempt number while
preserving their original error and cleanup, even when diagnostic output fails.
Skipped port claims count toward that number; four regression cases cover the
D548 diagnostic mismatch without changing existing assertions or deadlines.
Identity-server errors after startup and historical failure causes remain open;
see [the storage investigation](backlog/storage-cache-fixture.md#identity-port-allocation-race-d499).

## Storage TLS material refusals (D455)

**Open.** Real store startup and historical failure causes remain open.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#storage-tls-material-refusals-d455).

## Storage archive download failure reporting (D441)

**Open; historical cause unknown.** The Linux test box passes five download
controls and all four unchanged service-runtime checks from a private empty
archive cache. A controlled local HTTP/2 truncation confirms archive-body
reporting but has a different protocol error number from the historical refusal.
Capture an instrumented recurrence before attributing that old failure or changing
the single download attempt; full CI qualification remains separate.
See [the boundaries and remaining work](backlog/storage-cache-fixture.md#storage-archive-download-failure-reporting-d441).

[PR794's root shard](https://github.com/waitron-io/waitron-cloud/actions/runs/41182674171/job/124483174725)
fails the three storage TLS cases in their shared setup: fetching the pinned
SeaweedFS 4.47 archive raises `fetch failed` before their assertions. The transport
cause is absent from the test output. The unchanged TLS tests pass three cases
locally, and a later archive GET on the authorised Linux test box returns HTTP
200; neither control explains or repairs the CI failure. D530's investigation
must capture the cold-download cause while preserving the original TLS checks,
checksums and cleanup assertions.

## Parallel storage-cache fixture failure on main

Native admin-port fallback and explicit HTTP refusal now have controlled checks;
see [the remaining collision boundaries](backlog/storage-cache-fixture.md).

Retain diagnostics to explain the original read-only-cache rejection; the readiness
and S3 port repairs do not establish its cause. Reproduce an admin-listener bind
failure and reserve those ports if needed, without retrying unknown ports or other
child exits. See [the investigation and remaining work](backlog/storage-cache-fixture.md).

The qualified current browser fixture and identity-port repair retain separate
historical bind and reconnect investigations. See [the D499 boundaries](backlog/storage-cache-fixture.md#current-browser-and-identity-port-qualification-d499).

## Diagnostic permission test lock observation (D198)

Capture a recurrence to explain the historical membership-update delay. Keep the
100 ms database lock-wait limit, successful revocation before releasing the
incident read, and final HTTP 403 refusal. See [the investigation and guard
requirements](backlog/diagnostic-permission-lock.md).

## Dependency-cache save stalls (D507)

**Open.** Attribute the historical upload stall and qualify the five remaining
setup-node cache consumers before changing them. Portal work now uses six
file partitions to leave room for setup and cleanup within its eight-minute
job limit; every case keeps its original assertions and deadline.
See [the boundaries and remaining work](backlog/ci-cache-saving.md#dependency-cache-save-stalls-d507).

## CI PostgreSQL image pull

D104's documentation-only [run 39733028534](https://github.com/waitron-io/waitron-cloud/actions/runs/39733028534/job/119672295764)
failed before account HTTP shard 3 started its tests: Docker's request to
`auth.docker.io` timed out while pulling `postgres:18-alpine`. The recorded failure
is in the container-start path of `scripts/test-postgres.mjs`, before the owned
container is marked running.
This is separate from the reset-mail capture failure below. No runtime, test,
fixture, workflow or dependency change accompanied the incident, and the external
registry failure's cause remains unproved.

The test launcher now acquires both images before creating either container. It
uses cached images without registry access. For a missing image, it retries a
recognised connection failure with at most three attempts within each image's
120-second acquisition budget, including inspection and retry waits. A pull
killed at that deadline has no time left for another attempt. Access refusals and
other terminal errors stop immediately; a failed daemon inspection does not
become an image pull. Container starts disable implicit pulling and are never
retried. Package commands, assertions, readiness deadlines and owned cleanup retain
their existing behaviour. Run `node --test scripts/ci-test-postgres.test.mjs` for
the controlled launcher checks, including timeout termination, retry exhaustion,
Mailpit acquisition, command exit status and cleanup. These checks qualify local
failure handling; they do not prove Docker Hub availability or explain its outage.

The launcher also retries registry HTTP 5xx responses, including the HTTP 500
failures before package tests in [this merge run](https://github.com/waitron-io/waitron-cloud/actions/runs/40856632619).
Each failed HTTP attempt logs its status and attempt number. Both pinned images
keep the same three-attempt, 120-second acquisition limits. Controlled launcher
checks cover recovery, exhausted server responses, both retry-wait deadline
boundaries and immediate refusal of HTTP 401, 403, 404 and 429. Container creation,
image pins, cancellation and cleanup retain their existing behaviour. These
bounded retries handle registry server failures; the cause of Docker Hub's outage
remains unknown. Real Docker qualification continues in CI while local Docker is
unavailable.

The controlled checks also cover both deadline boundaries around retry waits,
a pull client that ignores graceful termination, and every recognised connection
response. Deliberate faults must make the matching checks fail. An early injected
`ETIMEDOUT` separately qualifies retry classification; a real launcher timeout
still exhausts the unchanged per-image budget. Cancellation checks cover SIGINT
and SIGTERM during successful and hanging synchronous pulls and at a retry wait.
They check the exit status, prevent the package command from starting and require
cleanup of every created container. Cancellation during a synchronous pull is deferred
until that call returns, so containers can still be created before cleanup.
A pull killed at its deadline exits with the acquisition error, rather than the
cancellation status, before creating any container.
These fake-client checks leave one question open: whether stopping the client
also stops Docker's own registry transfer. Qualify that with a real daemon and a
controlled registry when local Docker is available; do not infer it from client
termination.

## Backup recovery wait observation (D164)

A controlled Linux PostgreSQL reproduction in [PR #355](https://github.com/waitron-io/waitron-cloud/pull/355)
pauses the activity snapshot before its live blocker check. It reproduces the
expiry-query/qualification-lock mismatch from #352's independent merge. The test
observer now acknowledges a blocked backend first, then reads its query in a new
statement while the caller still holds the blocker. The original operation and
proof-expiry cases record backend IDs, query times, wait events and stages. All
original expiry guards, refusal assertions and deadlines remain unchanged;
production recovery code is unchanged. This establishes an observer defect that
can explain the historical failure, without proving that run's exact timing.

## Portal reset-mail boundary reporting

**Open; the missing reset email remains unexplained.** Capture a diagnostic
recurrence before changing delivery or inbox capture, preserving the original
assertions, single lookup and deadlines. Read the [reporting boundaries and
redaction limits](backlog/mail-capture.md#portal-reset-mail-boundary-reporting);
local PostgreSQL and SMTP reproduction waits for Docker to return.

## Account HTTP reset-mail capture

**Open; the historical reset-mail capture failure remains unexplained.** Capture
a Linux recurrence before choosing a delivery or capture fix, preserving the
original assertions, single lookup and deadline. Read the [investigation and
bounded diagnostics](backlog/mail-capture.md#account-http-reset-mail-capture).

## Passkey Enter browser handler observation (D374)

The passkey Enter fixture now waits for its options handler to record the request
before checking the exact password and pending enrollment. A browser request event
can arrive before that record. The observation uses the existing four-second page
budget; delayed-handler journeys and an absent-record control retain all original
keyboard, enrollment, unsupported-browser, cooldown, clock and deadline checks.
Only the first options request is delayed. An injected second request reaches
the existing count assertions in the English, light, 390-pixel ordinary and
delayed controls. All 39 cases pass after restoring the controller. Historical
browser failures remain
unattributed; these stubbed HTTP checks do not qualify real server authority.

## Portal session test startup

**Open; historical cause unknown.** Capture a diagnostic recurrence before
attributing the initial signed-in timeout. See the [investigation and diagnostic boundaries](backlog/portal-session-startup.md).

## Portal lost-reply test ordering

D530 records the unresolved consent-uncertainty and usage rate-limit waits from
[PR #598's CI run](https://github.com/waitron-io/waitron-cloud/actions/runs/41183089824/job/124484426019).
The usage journey now reports its named stage, static request lifecycle events
and a bounded controller snapshot when a page wait or setup step fails. Read
[the diagnostic limits and next reproduction](backlog/portal-lost-reply-ordering.md#usage-rate-limit-wait-d530)
before attributing either failure. Consent failures also report a separately bounded,
redacted [database wait snapshot](backlog/portal-lost-reply-ordering.md#consent-database-waits-d530).
All existing usage and consent assertions and deadlines remain.

**Open:** the historical reset-link, lost-reply and translation-control failures
remain unexplained. Capture a diagnostic recurrence, reproduce its named stage
and fix the proved cause while preserving every existing assertion and deadline.
See [the investigation and retained ordering controls](backlog/portal-lost-reply-ordering.md).

## Password derivation observation on Linux (D129)

**Open; the historical failure remains unattributed.** Preserve the real derivation
result barrier, password-reset refusal and existing bounds when investigating a
recurrence. Read the [observation requirements and remaining qualification](backlog/password-derivation-observation.md);
use Linux PostgreSQL CI while local Docker is unavailable.

## Usage HTTP response boundaries (D409)

**Open.** Production deployment, monitoring and billing policy remain unqualified.
See [the boundaries and remaining work](backlog/usage-metering.md#usage-http-response-boundaries-d409).

## Initial services and future candidates

**Open; local implementations do not approve production enablement.** Remote access
and backups are the initial paid services; other services retain their individual
design, integration and launch gates. Read the [service requirements and future
candidates](backlog/service-candidates.md) for the full table, including the owner’s
rota, comparison and supplier-service decisions.

## Items transferred from Waitron

The source is [Waitron's backlog at `830cf71fe854`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/backlog.md).
Its section titled "The cloud primary" mixed cloud services with core SQLite work.
The [ownership map](documentation-ownership.md) records what remains in Waitron.

- **Cloud provisioning and trial onboarding.** Own the service that creates a
  customer's resources and supplies configuration and credentials to Waitron, plus
  the hosted trial entry path. The local integration contract is mapped and proved;
  provider provisioning, the paid lifecycle and the hosted trial remain open.
- **Cloud-only redundancy.** Implement and qualify the approved failure and recovery
  direction through P6/D115 and P7. The [reconciled Cloud hosting design](superpowers/specs/2026-10-21-cloud-hosted-venue-design.md)
  uses the owner-selected cold recovery shape and the revised A1018 controlled or
  explicit emergency handover where selected. After either takeover M2 alone handles
  AEAT, including copied and returned old originals in their generating identities;
  returning M1 transfers missing originals and all received outcomes without AEAT
  contact. The external stop-proof requirement
  is superseded; human shutdown declarations do not prove an isolated M1 stopped.
  A running follower needs separate future approval. D88's duplicate design gate
  is closed; no owner question is ready now. A1018's examples and retained defaults
  are approved at Waitron `060966c2b3e9203acf0849042814997307cae463`.
  Exact formats, compatible A947 amendments, separate A1018 build authority,
  implementation and runtime/provider qualification remain open, with P1/P3/P4,
  A951 and D101 dependencies. Reliability promises and pricing follow measurements.
  The old managed-Postgres framing
  is historical; Waitron targets SQLite and Litestream.
- **Production object-store proof.** The executable local SeaweedFS 4.47 contract admits
  exactly one writer in eight-way create-only and compare-and-swap races, refuses stale
  replacements, retains accepted versions, isolates venue credentials, revokes a rotated
  key, refuses an expired issued credential and commits no partial interrupted upload.
  A [one-day AWS Stockholm sandbox rehearsal](aws-storage-rehearsal.md) now proves
  real S3 conditional-write races, stale-write refusal, version retention, two-prefix
  isolation, role-session revocation/expiry and interrupted multipart cleanup. It
  restores an older-key retained archive through PostgreSQL-backed Cloud verification
  and Waitron, and a continuous Waitron database through Litestream. Its receipt
  records the conservative US$1.37 pretax estimate, cleanup and scheduled KMS deletion;
  charges were not read. This is no Spain-location or production-deployment claim.
  Qualify the selected Spain deployment, managed credential delivery/renewal,
  web identity and recovery journey; run a separate Google proof. The existing
  [prototype results](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/research/2026-09-16-sqlite-failover-prototype.md)
  concern MinIO and remain historical evidence.
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

## Linux download-supervision fixture timing (D126)

The historical Linux failure phase and a separate macOS timing failure remain
unattributed. Capture process and step timing if either recurs, preserving the
existing outer limits and assertions. See the [fixture timing detail](backlog/linux-download-supervision.md).

## Cost conformance image acquisition (D137)

The historical Docker Hub token-request timeout remains unattributed. Keep the
bounded, cache-first image acquisition and permanent-refusal checks. The D530
inventory separates launcher HTTP 500, build-metadata HTTP 502 and later Node-pull
authentication refusals; the first two already have bounded recovery on main.
The authentication cause remains open and must retain immediate refusal. Use
the authorised Linux test box for reproduction and current-head CI for landing.
The separate isolation-test Node acquisition now retries temporary HTTP 5xx and
transport failures before creating resources, within a shared 120-second
preparation budget; it retains every isolation assertion and immediate permanent
refusal. The historical provider outage remains unexplained.
See the
[image acquisition detail](backlog/cost-image-acquisition.md).

A later [Linux CI pull](https://github.com/waitron-io/waitron-cloud/actions/runs/40984997048/job/123833975271)
of `node:26.11.1-slim` refused authentication before any browser case started.
The registry or runner-credential cause is unknown. Capture the registry challenge
and credential selection during a controlled reproduction, preserving the rule
that authentication refusals stop immediately.

### Installation renewal accepted during owner revocation

A controlled Linux scheduler pause reproduces the accepted renewal after an
observed revocation wait. The test now queues renewal behind revocation before
releasing the held installation. Existing security checks and deadlines remain;
production locking is unchanged. The historical scheduling was not captured.
See [the reproduction and qualification](backlog/installation-renewal-revocation.md).

### Cost conformance setup timeout (D131)

The historical setup timeout remains unexplained. Bounded installation summaries
identify unfinished package downloads, imports and install scripts, alongside the
existing command and archive diagnostics. Real pnpm controls prove that the outer
setup limit stops stalled and slowly progressing response bodies and removes their
process and scratch directory. The labelled Linux canvas slowdown remains unexplained;
deadlines and integrity checks stay unchanged.
See the [investigation and remaining qualification](backlog/cost-setup-timeout.md).
Pinned source fetches now use Git's low-speed limit and one bounded transport
retry from a fresh owned checkout; bad references still stop immediately.

D212 qualification in PR #744, head
`8cf732967538f0dc3e14111383f5c93e8b69c8e5`, reports a distinct source-install
timeout in cost run 40941888772, job 123687227986. All 670 packages are available
and imported; `cpu-features@0.0.10` remains in its install stage when the existing
300-second limit expires. No package download or import is pending. Native-build
progress now retains fixed node-gyp milestones and header/checksum HTTP status,
without raw output or URLs. A controlled native header-body stall and a successful
fresh build qualify this distinction; the historical Linux cause remains unknown.
Keep the source pin, integrity checks, deadlines and original assertions.

### Interrupted source-fetch fixture state (D530)

**Interrupted writes reproduced and handled; historical timing remains unknown.**
[D349's CI run](https://github.com/waitron-io/waitron-cloud/actions/runs/41169033630/job/124443297790)
failed to read an empty generated JSON state file while checking the historical browser
revision. A controlled interruption reproduces that read failure by stopping the
fixture's Git helper between truncation and writing. The helper now writes a
temporary file and renames it into place, so you retain the last complete state
when the supervisor kills a fetch. The new case still requires revision refusal,
one bounded retry and collection of both fetch children. All original assertions,
source pins, deadlines and cleanup checks remain unchanged. The historical run
did not capture the write boundary or explain the helper's delay; those details
remain unknown. A separate control kills the supervisor while its helper is
paused; fixture cleanup records that helper's PID independently and waits for
it to exit, so a failing supervisor cannot leave the test process behind.

### Fixture archive download retries (D311)

**Open; the upstream 504 and later HTTP 500 causes remain unknown.** D457's
stalled successful response now gets another attempt after 30 seconds without
headers or body progress, within the existing three attempts and shared
120-second budget. Local HTTP controls prove recovery from stalled headers and
partial bodies, ongoing progress, cancellation and exhausted attempts. Archive
diagnostics retain known public response-service labels and validated request IDs
so you can correlate a refusal without exposing signed redirect URLs or arbitrary
headers. Keep the bounded retries, shared download budget, cancellation and
checksum requirements; see the
[download handling and qualification limits](backlog/cost-conformance-fixtures.md#fixture-archive-download-retries-d311).

### Storage startup retry notice can replace the original refusal (D530)

**Fixed by D526; the throwing notice preserves the permitted retry.**
[PR788 root shard 2](https://github.com/waitron-io/waitron-cloud/actions/runs/41164895176/job/124430391561)
reached the port-handoff retry notice in `startBackupStorage`, where a throwing
reporter replaced the expected readiness error. A controlled wrapper probe
isolated that defect; D526's native S3 port collision reproduces it and verifies
the fix. The fixture contains the reporting failure, completes the one permitted
restart and preserves the final readiness error. Original-error identity,
bounded reporting, request budgets and every child's cleanup remain checked.
The separate historical provisioning timeout and Linux internal error remain
open under the [readiness investigation](backlog/storage-authority-timeout.md).

### Conformance image acquisition during D135 qualification

**Open; the registry timeout and metadata HTTP 502 remain unexplained.** Fixture
builds now handle Docker Hub metadata HTTP 5xx within the original build budget,
with native controls for bounded retries, permanent refusals and cleanup. D135
still needs fresh qualification on the acquisition repair; see the
[image acquisition investigation](backlog/cost-conformance-fixtures.md#conformance-image-acquisition-during-d135-qualification).

### Litestream conformance transport-close refusal (D141)

**Open; the historical close refusal and later result-assembly failures remain
unexplained.** Meter snapshot refusals now identify the failed check and first
invalidation boundary without exposing request details. D513's historical failure
is the body-byte comparison, not the storage-lifetime comparison named in the
initial inventory. The unchanged body-byte case passes on the Linux test box;
this does not identify or repair the old refusal. D513 and G474 still need causal
attribution, preserving redaction, cleanup, accounting and deadlines; see the
[transport and result diagnostics](backlog/cost-conformance-fixtures.md#litestream-conformance-transport-close-refusal-d141).

## Cloud cost Mailpit fixture startup

[Merge CI run 40000552513](https://github.com/waitron-io/waitron-cloud/actions/runs/40000552513)
on `57bc23ad6f61d67c66ae43ec123d5232a4c05f28`, stack-conformance shard 3,
job 120575313226, fails
`generatedServiceKeepsItsMutableFilesOffTheScannedHostTree_mailpit` after 4.17 s.
It stops at fixture startup (`stack-conformance.test.mjs:762`), before the mail,
storage and host-file assertions. `scripts/cloud-cost/local.mjs` at that revision replaced the
underlying startup error with `Invalid cloud cost local run`; the historical cause
remains unknown.
Both files have the same Git blobs as the preceding main `917e586`, and the
identical candidate tree passed exact-head cost run 39999259906. That comparison
does not explain the failure or prove a fix. This is a different case from D141's
storage-lifetime close refusal. Startup now emits `stack_startup=` before cleanup and attaches the same bounded
record to its rejection. It names ownership, plan, configuration, runtime files,
certificate, resource discovery, Compose, container policy, isolation, readiness
or cancellation handoff. Only fixed error categories, exit codes, signals and
elapsed time are retained; paths, credentials and raw subprocess output are
excluded. Cancelled requests and expired deadlines have separate categories.
Opaque thrown values also fall back to a fixed category so inspecting them cannot
prevent cleanup. A cleanup failure gets a separate record and cannot replace the original
startup refusal. Reporting failure cannot prevent cleanup.

Docker-free tests run the actual orchestration, ownership checks, files and
OpenSSL with a controlled Docker-command boundary. They inject a fault at each
stage, command timeouts and missing executables, unknown private errors, cleanup
failure and reporting failure, with a successful start/cleanup control. These
prove diagnostic handling, not the historical Linux cause. Qualify the genuine
Mailpit journey on the changed Linux CI head; a passing run alone does not explain
the earlier refusal. On a diagnostic recurrence, reproduce the named cause and
fix it test-first.
Preserve every isolation, storage, accounting and cleanup assertion and deadline.
Use GitHub CI while local Docker is down; do not rerun the unchanged merge for a
passing result. The exact job log and source-identity receipt are retained in lane
G's `receipts/d142/`.

## Relay migration setup across a counter rollover (D155)

The release-35 populated-upgrade test assumed every setup admission would finish
inside its counter window. A deterministic PostgreSQL check holds the first
message insert past that window and reproduces the final counter-expiry refusal
with the database clock, counter end, message expiry and row counts recorded.
The relay still rolls back that admission. Its internal error now carries only
the counter end and observed clock, with a fixed cause name; the public response
remains `503 relay_unavailable` with `Retry-After: 1`.

Migration setup retries only this proved counter rollback, at most ten times.
Unexplained unavailability, rate limits and other failures still fail immediately.
The new check verifies one retained message, reservation and pair of counters,
no additional debit on replay, and the existing ciphertext-byte invariant. A
separate Linux check deletes the expiry guard, its clock evidence and the pool
notice observer, then injects an extra replay counter increment in disposable
checkouts. It requires all four faults to fail before checking the restored code.
Original migration assertions, counter policy, authority windows and deadlines
stay unchanged. The old failure log did not record its exact clock values; this
reproduction does not invent those missing historical values. Local database
checks are unavailable while Docker is down; GitHub CI supplies that evidence.

## Cost-stack replication interruption (D152)

**Open; historical interruption causes and production shutdown qualification
remain unresolved.** Read the [replication and shutdown investigations](backlog/cost-stack-replication.md)
for retained limits, diagnostic findings and remaining reproduction work. Local
Docker proof waits for Docker to return; reproduce each new diagnostic recurrence
before changing transport, accounting or cleanup.
The D325 stop diagnostic now distinguishes child exit code and signal from an
invalid request audit, retains the first failed audit stage and identifies an
interrupted producer attempt. The historical stop/exit cause still needs a
labelled recurrence; see the linked investigation before changing the stop rule.
The delayed-PUT fixture also records up to sixteen uploads on a stop refusal,
including which upload released readiness and their arrival, backend-response and
reply-forwarding times relative to stop. Its readiness gate now requires a
transaction newer than every known pre-sale upload, including pending ones,
refuses multipart parts, and waits for older post-sale replies already admitted
when the new response arrives, while the new reply remains held. Native HTTP controls
catch the earlier admission-only gate and the missing settlement order. Use the
records to investigate the remaining historical idle timeout; this fixture change
does not qualify production shutdown.


## Initial upload admitted after stop (D393)

[PR635's merge cost run](https://github.com/waitron-io/waitron-cloud/actions/runs/40634308325/job/122638015466)
refused an initial PUT after a validated stop reply, with writer exit zero.
A controlled macOS reproduction uses the checksum-verified official 0.5.17
binary and a toy SQLite database with two rows. A loopback relay holds a snapshot
upload before the measuring transport receives it. The runtime confirms stop
while that upload remains held; forwarding it then reproduces the same
`after-stop-admission / post-stop-operation / put / initial` refusal.
A private native stack identifies the controlled upload as `DB.Snapshot` under
`Store.monitorCompactionLevel`. Completing it before stop passes the paired case.

You cannot infer first HTTP admission from the earlier SDK request log, an idle
transfer count or a zero writer exit. Run `node --test
scripts/cloud-cost/litestream-pre-admission-put.test.mjs` for the two real HTTP
ordering controls. Removing the admission guard makes the late upload return
200 instead of the required 400. Existing runtime code, assertions, accounting,
pins, allowances and deadlines remain unchanged. This establishes a possible
cause, not the historical Linux cause or real fiscal-workload qualification.
Keep that attribution and any repair open; genuine local container reproduction
waits until Docker returns. Do not delay stop or admit late uploads as a workaround.

The native admin-port qualification also encounters an
[initial PUT after stop](https://github.com/waitron-io/waitron-cloud/actions/runs/41037164023/job/124000805980).
Its admin checks pass on Linux; the upload's underlying cause remains unproved.

## Held-list control failure ordering (D391)

The official held-metadata control failed in [PR633's merge cost run](https://github.com/waitron-io/waitron-cloud/actions/runs/40631222000/job/122627856885)
on its first LIST attempt. The transport reported an interrupted response while
the storage observer reported success. Matching byte totals and a zero writer exit
do not explain or permit that refusal.

Failure-only fixture records now distinguish the initial, held retention and other
LISTs. You can compare arrival, forwarding, response and per-counter settlement
order with the stop request, reply, validated acknowledgement, release and signal.
The record holds at most sixteen LISTs, marks truncation, omits private request
identities and freezes before cleanup. Native HTTP/process controls cover ordering,
invalid replies, truncation and an actual pre-acknowledgement interruption. That
controlled partial response remains refused at a different boundary from the
historical Linux event. It records the producer's interrupted response while the
storage observer is still pending, so it does not qualify the historical pair of
producer interruption and observer success or identify that event's cause. The official
0.5.17 binary, allowance, both counters, assertions and deadlines remain unchanged.
Genuine local Docker reproduction waits until Docker returns. Use a labelled
recurrence to establish the cause before changing any shutdown rule.

## Registration SQL setup failure diagnostics (D385)

A registration setup failure now reports its fixed boundary and, for migration
work, its ordinal in the shipped migration list. You can distinguish the advisory
lock, ledger creation and compatibility check, migration loading, lookup,
application and ledger recording, and transaction start or finish. Relay fixtures
identify schema creation, migration setup, issuer creation, the bounds clock, relay
configuration, venue preparation, each initial insert, session creation, grant
approval and lease construction. These failure-only records omit SQL,
parameters, schema and account names, credentials and caught error values.
Original errors, query text and arguments, rollback, cleanup and the five-second
statement limit stay in force. Successful setup remains silent.

[PR627 qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/40617804734/job/122584381707)
refused two migration applications and one relay account insert with PostgreSQL
statement timeouts. The historical cause remains unknown. Native controls cover
labelled refusals and reporter failures; genuine local PostgreSQL reproduction
waits for Docker to return. Use a labelled recurrence to reproduce the cause
before changing queries, transaction rules, concurrency or timeouts. D383 remains
parked with its completed review; this diagnostic delivery does not qualify that
branch or establish a runtime repair.

## Litestream request-validation diagnostics (D378)

The transport records the first refused request-validation boundary using fixed
stage names, including request identity, operation, retry sequence, after-stop
admission, content length, mutation body and lifetime bookkeeping. Stop checkpoints
and sanitized close records carry the stage without request paths, headers or
SDK invocation identifiers. Later requests cannot replace the first refusal.
Native HTTP checks still require refused requests to return 400 without forwarding
or publishing accounting, and include a successful forwarding control.

The [PR620 cost refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40600605206/job/122527571695)
reported request-validation at stop's idle step without identifying its check.
Its cause remains unknown. Reproduce the next labelled recurrence before changing
transport, stop, accounting or cleanup rules. Genuine local Docker qualification
remains unavailable until Docker returns; current-head Linux CI checks the delivery.

The first D378 qualification also found an absent fiscal worker identity in
[CI40604297872, job122540422831](https://github.com/waitron-io/waitron-cloud/actions/runs/40604297872/job/122540422831).
The test expected `C000001` and `C000002`; its output did not identify why one
worker returned no allocation. D380 now adds bounded worker-refusal reporting
without exposing the response. The historical cause remains unknown. Preserve
both exact identities and every authority, retry and concurrency check. Use the
new reporting on a recurrence, or reproduce with PostgreSQL when Docker returns,
before changing the fixture or allocator.

## Litestream after-stop admission diagnostics (D381)

You can now identify the exact refused admission guard in the stop checkpoint,
independent request audit and sanitized close record. Fixed categories distinguish
poisoned state, input shape, hop and phase, row metadata and identity, row capacity
and operation, duplicate admission, retry sequence, observer pairing, post-stop
operation and ordinal, clock order and the three-attempt bound. Later refused
calls retain the first admission cause. Producer and observer share the tracker,
so a later poisoned hop reports the earlier hop's cause. No request paths, headers, invocation
identifiers or accessor values are published; every existing refusal and accounting
rule remains in force.

The [PR622 merge refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40611462709/job/122563803926)
named after-stop admission without its inner guard. Its underlying cause remains
unknown. Reproduce a labelled recurrence before changing admission, stop, retry,
accounting or cleanup. Native controls exercise each category and real HTTP
refusal; genuine local Docker reproduction waits for Docker to return. Current-head
Linux CI supplies the genuine backend qualification.

## Litestream refused operation and attempt diagnostics (D383)

The [PR625 merge refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40615344423/job/122576493560)
identified a non-list operation after stop, but omitted the operation and whether
it was an initial attempt or a retry. You can now read both fixed categories from
the validated internal row in admission errors, independent audit checkpoints,
transport checkpoints and sanitized close reports. Later poisoned calls retain the
first shared producer or observer cause, without adding their own request details.
Earlier refusals keep their existing context-free shape, including after stop.
Later clock and affected-attempt refusals retain the validated list and initial
attempt categories. Request identifiers,
paths, headers, arbitrary caller values and accessor output stay private.

Native controls exercise initial attempts and retries, shared first-cause retention,
real HTTP refusal and the privacy filters. Every original admission, stop, retry,
accounting and cleanup rule, assertion and deadline remains unchanged. The cause
of the historical refusal is still unknown. Reproduce the labelled operation
before changing runtime rules; genuine local reproduction waits for Docker to
return, while current-head Linux CI qualifies the real backend.

[PR627's first qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/40617804734/job/122584381707)
reported three PostgreSQL statement timeouts in registration shard 5: two during
migration setup and one while creating an account fixture. Their cause is unknown.
D385 now labels those setup boundaries, so a changed qualification can retain more
evidence if they recur. Preserve the failing assertions and five-second database
limit, then reproduce a labelled failure before changing runtime rules.

## Recovery refusal messages and pasted codes (D192)

Recovery now keeps the server's definite refusal message for approval, close and
replacement, including rate limits, expired requests and lost permission. It
reconciles only uncertain replies, so a refused action does not erase its error
or lock approval as an unknown outcome. Outer code whitespace is trimmed before
validation and sending; leading zeroes remain. Existing request binding,
confirmations and permission guards stay in place.

Native controller and stubbed-browser checks cover definite refusals, cooldowns,
uncertain writes and padded codes. Real PostgreSQL recovery suites remain CI's
gate while Docker is down locally. This does not qualify production recovery,
prove an old server has stopped, or change the existing recovery source limits.

## Public browser-check status handler wait (D366)

The live-status browser fixture configures a four-second challenge-handler wait.
Its missing-signal control checks a five-second outer race, so it does not prove
the exact configured value or that every ordinary observation is necessary.
Delayed handlers repeat every language, theme, width and failure journey. All
33 browser checks pass, and ordinary and delayed challenge-failure captures now
retain 16 separate files with all eight historical names. Every original
live-region, accessibility-tree, reload, focus, cookie, forwarding assertion and
deadline remains. Native Chromium and local HTTP checks leave other browser
engines, worker-failure images and production-network qualification open.

## Recovery-choice browser handler wait (D362)

Set `RECOVERY_PORTAL_RECEIPT_DIR` to a fresh directory when checking the recovery
choice fixture. It retains sixteen recovery captures: eight ordinary and eight
delayed, keeping all eight original names. Separate names prevent a later handler
variant from overwriting earlier evidence. The missing-signal control runs only
the first four subtests, then returns before the disabled-choice assertions,
source clearing, recovery submission, pairing and screenshots. Its title names
the submission boundary.
Every original organisation and venue selection, recovery permission, source
clearing, approval payload, pairing, layout, observation and deadline check remains.

The missing-signal control wraps a configured four-second observation in a
five-second race. It does not independently establish the exact four-second
boundary. Native Chromium with stubbed HTTP leaves real recovery authority,
other browser engines, production networks and the historical Linux cause
unqualified. Delayed handlers still repeat all eight language, theme and width
journeys.

## Recovery organisation-width browser handler wait (D364)

Set `RECOVERY_WIDTH_RECEIPT_DIR` to a fresh directory when checking the recovery
organisation-width fixture. It retains seventeen captures: eight ordinary,
eight delayed and one English/light/390 absent-signal capture. The eight
original names stay unchanged. All captures precede the gated refresh, so they
show the initial choice and width, not its later pending state. Every original
choice, width, pending-state, selected-value and deadline assertion remains.

The missing-signal control wraps a configured four-second observation in a
five-second race. It does not independently establish the exact four-second
value. Delayed handlers repeat all eight language, theme and width journeys.
See [the review boundaries](backlog/retrospective-reviews.md#recovery-organisation-width-captures).
Real recovery authority and the historical Linux cause remain unqualified.


## Recovery HTTP replies before confirming an outcome (D419)

**Open.** Qualify server permissions and genuine restore or recovery; these client
checks grant no activation or stop-proof authority.
See [the boundaries and remaining work](backlog/backup-recovery-http.md#recovery-http-replies-before-confirming-an-outcome-d419).

## Recovery transport waits and pending actions (D437)

**Open.** Qualify server permissions and genuine restore or recovery; these client
checks grant no activation or stop-proof authority.
See [the boundaries and remaining work](backlog/backup-recovery-http.md#recovery-transport-waits-and-pending-actions-d437).

## Recovery screen scope and supplied choices (D158)

Read the [recovery-screen scope detail](backlog/recovery-screen-scope.md) for the
supplied-choice checks and retained server refusals. Production backup provisioning
remains unqualified; PostgreSQL checks run in CI while local Docker is down.

## Delayed recovery replies across account and request changes (D401)

**Open.** Qualify recovery authority and genuine browser and restore behavior
separately from controlled replies.
See [the boundaries and remaining work](backlog/backup-recovery-http.md#delayed-recovery-replies-across-account-and-request-changes-d401).

## Cost-stack isolation command refusal (D152)

**Open.** Both unchanged signal checks pass on the shared Linux test box, without
reproducing the historical missed admission. Attribute a new failure from the
retained child evidence before changing signal handling. See [the diagnostic boundary and reproduction results](backlog/cost-stack-isolation.md#local-signal-check-stopped-before-worker-admission-d502).

Read the [isolation and deadline investigation](backlog/cost-stack-isolation.md)
before changing the fixture guards. Historical attribution and Linux qualification
remain limited as described there; the separate replication interruption remains open.

## Public browser and network qualification

Qualify the public browser check against the supported browsers and production
networks before public exposure. Local HTTP, script and Chromium checks do not
discharge that deployment gate.

## JavaScript-disabled browser-check fixture handler wait (D369)

The JavaScript-disabled browser fixture bounds its enabled-script challenge-handler
wait at the existing four-second page budget. An absent signal fails promptly;
delayed handlers repeat enabled-script journeys in both languages, themes and
phone/desktop widths. Original script-disabled guidance, content-security policy,
bilingual visibility, cookie, forwarding and failure assertions remain. These
native Chromium and local HTTP checks leave production-network qualification open.
Ordinary captures keep their original names; delayed captures add a suffix so all
24 screenshots survive. The missing-signal control checks the five-second outer
bound rather than independently proving an exact four-second wait.

## Public browser-check landmark handler wait (D365)

The landmark browser fixture uses a four-second observation for an absent
challenge-handler signal. Its missing-signal control checks a five-second outer
bound; it does not independently pin the exact four-second value or prove that
ordinary handler observation is necessary. Delayed handlers repeat running-check
journeys in both languages, themes and phone/desktop widths. All original main
region, bilingual guidance, reload link, cookie, forwarding and layout checks
remain, including disabled JavaScript and unavailable-script journeys.
Ordinary captures keep all 24 historical names; eight delayed running captures
add a suffix, retaining 32 screenshots. Set `PUBLIC_CHALLENGE_RECEIPT_DIR` to a
fresh directory for this file, separate from other browser fixtures. These checks
use native Chromium and local HTTP; other browser engines and production networks
remain unqualified. Production behaviour is unchanged.

## Public browser-check reload handler wait (D367)

The reload browser fixture refuses an absent challenge-handler signal within
its existing four-second page budget. Delayed handlers repeat both script-failure
journeys in both languages, themes and phone/desktop widths. All original reload,
keyboard, request-count, cookie, forwarding and disabled-JavaScript checks remain.
The fixture keeps its 24 historical screenshot names and retains 16 delayed
captures plus the reachable missing-signal capture separately, for 41 images.
The missing-signal control wraps its configured four-second observation in a
five-second race; it does not independently prove the exact four-second value.
These checks use native Chromium and local HTTP; production behaviour is unchanged.

## Running browser-check failure reload handler waits (D368)

The running-check failure reload fixture refuses either missing first or restarted
challenge-handler signal within its existing four-second page budget. Delayed
handlers repeat all four failure journeys across both languages, themes and
phone/desktop widths. Original messages, reload, keyboard, request-count, cookie,
forwarding and deadline checks remain. Native Chromium and local HTTP qualify
this fixture; supported-browser and production-network checks remain open.
Its eight historical screenshot names stay unchanged; delayed captures and the
reachable missing-next control have separate paths, retaining 17 images. Missing
signals are checked against a five-second outer race around the configured
four-second observation; the exact four-second value is not independently proved.

## Script-fallback browser handler wait (D370)

The script-fallback fixture refuses an absent challenge-handler signal within
its existing four-second page budget after script recovery. Delayed handlers
repeat all three script-recovery journeys in both languages, themes and
phone/desktop widths. Original guidance, security policy, cookie, forwarding
and rollout checks remain, including the exact earlier shipped-page hash.
These are native Chromium and local HTTP checks; production network and browser
qualification remains open.

## Session activity replies across reads and sign-out (D439)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#session-activity-replies-across-reads-and-sign-out-d439).

## Session HTTP replies and sign-out acknowledgements (D422)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#session-http-replies-and-sign-out-acknowledgements-d422).

## Initial session lists after account changes (D407)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#initial-session-lists-after-account-changes-d407).

## Public gateway source limits (D191)

The public gate now counts an IPv6 /64 network as one source, while IPv4-mapped
IPv6 addresses share their corresponding IPv4 allowance. Rotating 4,096 addresses
inside one /64 no longer fills the table or refuses a different network. Native
HTTP/HTTPS regressions cover the 120-request allowance, equivalent spellings,
separate networks, full-address challenge/access binding, the 4,096-source cap
and expiry. The [limits guide](local-remote-access.md#measure-shared-public-traffic-limits)
keeps the 2026-09-30 receipt as a historical measurement.

Before public deployment, qualify fairness for customers sharing IPv4 addresses
or IPv6 networks, including IPv4-to-IPv6 translation. Many distinct networks can
still exhaust all 4,096 source buckets and refuse new callers until expiry; the next gateway hardening task must
choose and test admission under that pressure. Per-venue fairness, coordinated
limits across gateways and HAProxy connection-table pressure remain open. Verify
IPv6 connection accounting with HAProxy's configured `stick-table type ip`; native
gate checks do not qualify that separate layer.


## Storage-authority request timeout evidence (D212)

**Historical cause unknown.** A later Linux run of the same case reports a
startup `InternalError` before authority opening. The fixture now retains the last
readiness request, attempt and request counts, and prints them when attempts run
out, without changing its retry budget. D526 reproduces a separate test-count
failure after a port collision: five abandoned-client requests plus 120 final-client
requests fail the test's aggregate 120 assertion. The final diagnostic correctly
reports 120. The owner-approved correction checks each client separately,
requires all 120 requests on the final client and verifies every child stops.
A permanent native collision control also reproduces a throwing retry logger
replacing the readiness error. Logging now preserves the permitted retry and
the final SDK error; request budgets and retry limits are unchanged.
Use that evidence to reproduce the refusal before a fix; preserve the existing
assertions and deadlines. The labelled failure does not establish the historical
timeout's cause. See the [investigation and qualification
limits](backlog/storage-authority-timeout.md).

## Authenticator management transport and session rechecks (D431)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#authenticator-management-transport-and-session-rechecks-d431).

## Authenticator HTTP response boundaries (D418)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#authenticator-http-response-boundaries-d418).

## Authenticator replies after account changes (D399)

**Open.** Qualify server authority, browser integration and live ingress; physical
passkeys and the separate retry-clock repair retain their own gates.
See [the boundaries and remaining work](backlog/account-http-boundaries.md#authenticator-replies-after-account-changes-d399).

## Authenticator code format feedback (D237)

Malformed authenticator codes now stay in their field with an explanation, before
any request. App codes require six digits; recovery proofs accept 32 hexadecimal
characters or four groups of eight. The portal still removes whitespace and keeps
recovery hyphens. New-app confirmation accepts only its six-digit app code.
Editing a malformed sign-in, management or new-app code clears its previous local
format message and field marker. Submit checks the edited value again; editing
neither sends a request nor changes the code rules. Other-field edits leave that
code error alone. Required-code feedback still waits for non-whitespace input,
and server refusals, uncertain changes and retry waits remain visible.
Blank-code, incorrect-code and outage feedback remain distinct. Server refusals
keep their general feedback without marking a code field: an invalid-input reply
can also mean the setup or account state changed. The server remains the authority
for accepting a proof. Controller and English/Spanish browser checks cover sign-in,
management and new-app confirmation without changing server rules.

### Distinguish server refusals during authenticator changes

An expired, consumed or superseded setup, a removed factor, and an over-long
password can all produce the same invalid-input reply. Give these causes distinct
server codes, then map them to guidance that explains what you can do next, such
as starting setup again. Cloud owns this follow-up across the registration,
account HTTP and portal packages. Keep proof acceptance and account authority
checks intact; cover each refusal with a server test and matching portal feedback.

## Clear stale connection and recovery code feedback (D249)

When you edit the code on Connect a venue or Recover, the old malformed-code
message and field marker clear. Submit checks the edited code again before any
request. Server refusals and uncertain outcomes stay visible while you type;
choosing a business still leaves code errors alone. Browser checks cover English
and Spanish, both themes and phone/desktop widths, including pasted code trimming
and values retained across a language change.

Lane D's Litestream investigation has another observation from
[cost run 40181699752, job 121133970845](https://github.com/waitron-io/waitron-cloud/actions/runs/40181699752/job/121133970845).
The committed-PUT-reply shutdown check refuses at `idle` with one pending exchange
and 20 completed exchanges; transport cleanup then reports `active-close`.
Reproduce this refusal before attributing its cause. Keep the existing limits
and assertions; the code-feedback fix does not resolve this investigation.

## Remote hostname keyboard review (D250)

Press Enter in the remote-access Hostname field to review the DNS settings.
Enter keeps you at the review step; applying the change requires clicking Confirm.
Malformed names still show their field message before any DNS request, and pending
operations and server retry waits keep review disabled. English/Spanish browser
checks cover both themes and phone/desktop widths.

Press Enter in the passkey password field to choose Add a passkey, using the
same password and disabled states as its button. Browser confirmation still
completes enrollment; Enter never chooses a passkey to remove. Stubbed API and
virtual-authenticator browser checks cover English/Spanish, both themes and
phone/desktop widths, blank passwords, modified or composing Enter, pending
requests, rate limits and unsupported browsers. These are portal checks, not
provider or production qualification. Each supported-browser fixture supplies
its own virtual passkey device instead of relying on the host.

When your authenticator is off, Enter in its password field starts first setup
through the existing Enable action. Empty passwords show the existing field
message; pending requests and retry waits keep setup blocked. Enter does not
choose replacement, regeneration, removal, activation or cancellation. Stubbed
API browser checks cover English/Spanish, both themes and phone/desktop widths;
these do not qualify the backend or production.

## Home redirect browser readiness (D314)

The home-page browser checks wait for the existing `/account` or `/login`
destination before checking the confirmed session's heading, title and notice.
The Account heading also appears during session checking, so it cannot confirm
that the redirect has finished. A delayed session reply reproduces the earlier
URL refusal and catches omission of the destination wait. All original
assertions and four-second page/120-second runner deadlines stay unchanged;
this corrects test readiness without changing product authentication or routing.

## Pending-session sign-out browser handler wait (D363)

The pending-session sign-out browser fixture configures a four-second old-read
handler observation. Its missing-signal control requires a timeout within a
five-second outer race and returns before revocation and screenshot checks;
that control does not establish the exact observation deadline. Delayed handlers
repeat the original revocation and stale-session journeys across both languages,
themes and widths. The eight ordinary screenshot names remain; delayed current-session
captures use separate names, retaining sixteen files so neither handler's capture
overwrites the other's.
Every original assertion, observation and deadline remains. Native Chromium with
stubbed HTTP does not qualify real session authority, other engines or networks,
or explain the historical Linux failure.
Sampled omission of the handler observation still passes twelve head cases and
six parent cases. A single reply-filter omission passes four cases on each;
a separate omission of both check-reply filters also leaves the focused current
case passing on head and parent. Guard necessity remains unqualified. Preserve
the checks and reproduce an actual ordering failure before changing them.
One native full-file sample takes 325 seconds for 53 cases versus the parent's
157 seconds for 26. Collect captures into a fresh `PENDING_SIGNOUT_RECEIPT_DIR`
and check all sixteen names; browser assertions alone do not check filenames.

## Sign-out failure browser handler wait (D361)

The sign-out failure fixture refuses within its existing four-second page budget
when the first logout route handler never signals entry. A missing-signal control
reproduces the unbounded wait; delayed handlers repeat all eight original journeys
across both languages, themes and phone/desktop widths. Pending-state, focus,
scroll, failure-message, retry, request-count, layout and runner deadline checks
remain. These native Chromium checks use stubbed HTTP and do not qualify backend
or production sign-out.

## Session-check retry browser handler wait (D359)

The session-check retry fixture refuses within its existing three-second page
budget when the first session route handler never signals entry. Missing-signal
controls cover both connect and recovery; delayed handlers repeat every original
language, theme, width and failure journey. All protected-action, retry, cooldown,
request-count, clock and runner deadline assertions remain. These native Chromium
checks use stubbed HTTP and do not qualify backend or production authentication.

## Translation-refresh browser handler wait (D358)

The translation-refresh fixture now refuses within its existing four-second page
budget when the installation route handler never signals entry. A missing-signal
control reproduces the earlier unbounded wait; delayed handlers repeat every
original journey across both languages, themes and phone/desktop widths. All
translation retry, consent, pending-state, layout and runner deadline assertions
remain. These native Chromium checks use stubbed HTTP and do not qualify the
backend or production.

## Session-list retry browser handler observation (D375)

The session-list activity fixture waits for its retry handler to count the read
before checking that a second load cannot duplicate it. The browser request event
can arrive before that count. The wait uses the existing four-second page budget;
a missing count fails within that budget. Delayed handlers repeat both languages,
themes, widths and clock setups while retaining every original session, retry,
uncertain-revoke, account, write and deadline assertion. These native Chromium
checks use stubbed HTTP; database and permission qualification remain in CI.

Earlier qualification encountered a [Litestream storage refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40600605206/job/122527571695).
The historical cause remains unknown. The shared transport now reports which
request-validation check refused; keep its accounting checks and deadlines.
Local Docker reproduction waits until 3 November.

## Browser-test clock setup (D313)

The monitoring-status fixture also reproduces the refusal when setup pauses
longer than its one-second clock window. It now freezes from the earlier start;
original and delayed journeys retain every latest-status, freshness, missing-data,
certificate, read-only, layout and deadline check.

The passkey Add keyboard fixture reproduces the refusal with a 100 ms setup
delay and now freezes from an earlier start. Original and delayed journeys retain
every caret, focus, exact-password, Tab/Enter, pending-request and enrollment check
across both languages, themes and viewport widths, with unchanged deadlines.

The alert-preferences activity fixture now installs its running clock a day before
its intended pause, then freezes at the original instant before loading the app.
A 100 ms setup delay reproduced CI's “Cannot fast-forward to the past” refusal;
the corrected delayed case and all 15 original journeys pass without changing
assertions, deadlines or application time. The session-list activity fixture also
reproduces the refusal with a 100 ms setup delay and now freezes from the earlier
start before loading the app. Its original journeys and delayed variants retain
all session, retry, uncertain-revoke and account assertions and deadlines.
The authenticator-status activity fixture reproduces the same refusal under a
100 ms setup delay and now uses the earlier start too. Its original journeys and
delayed variants preserve every status, retry, account, write and deadline check.
The translation-consent activity fixture also reproduces the refusal under a
100 ms setup delay. Its four clock setups now start earlier and freeze at the
original instant before loading the app. Original journeys and delayed variants
retain every consent, retry, navigation, account, write and deadline check.
The account-security cooldown fixture also reproduces the refusal with a 100 ms
setup delay and now freezes from the earlier start. Original and delayed journeys
retain all six passkey/session actions, request counts, disabled-control, countdown,
retry and deadline checks across both languages, themes and viewport widths.
The authenticator keyboard fixture reproduces the refusal with the same setup
delay and now freezes from the earlier start. Original and delayed journeys retain
every Enter-key, activation, unavailable-status, cooldown, request and deadline
check. Both clock setup sites are qualified.
The passkey Enter fixture reproduces the refusal with the same setup delay at
all three clock setup sites and now freezes from the earlier start. Original and
delayed journeys retain every password, enrollment, unsupported-browser, cooldown,
request-count, duplicate-submit and deadline check.
The monitoring-action guidance fixture reproduces the refusal with a 1100 ms
setup pause and now freezes from an earlier start at the original instant. Its
original and delayed journeys retain all failed/stale/certificate explanations,
read-only actions, hostnames, dates, requests, healthy states and deadlines.
The session-check retry fixture reproduces the refusal after a 1100 ms setup
pause, beyond its old one-second window. It now starts earlier and freezes at
the original instant before loading the app. Both connect and recovery journeys
retain every protected-action, request, retry, cooldown and deadline assertion;
the original language, theme and viewport matrix and four delayed variants run.
The change-email cooldown fixture reproduces the refusal after a 1100 ms setup
pause and now freezes from an earlier start at the original instant. Its original
journeys and delayed signup/recovery variants retain every corrected-address,
per-address wait, server retry, navigation, operation separation and deadline check.
The cooldown wording fixture reproduces the refusal after a 1100 ms setup pause
and now starts earlier before freezing at the original instant. Its account and
fiscal views retain all singular, plural, expiry, layout and deadline checks;
the original language, theme and viewport matrix and delayed variants run.
No historical CI failure in these fixtures is attributed here.

## Paced replay deletion recurrence (D351 qualification)

[Cost run 40541558126, job 122321994540](https://github.com/waitron-io/waitron-cloud/actions/runs/40541558126/job/122321994540)
records another `storage-cleanup` / `delete-object` refusal, after 75.35 seconds,
following native restore and validation. Retain it with the D344 qualification
trace below and lane D's D121 investigation. The deletion cause remains unknown;
source equality with the parent does not establish independence. Keep ownership,
accounting, cleanup and deadlines unchanged; genuine reproduction needs Docker.

## Paced replay object deletion refusal (D344 qualification)

The passkey keyboard qualification run also captured a paced-replay refusal at
`storage-cleanup` / `delete-object`, after native restore, file, integrity, sales
and accounting stages. The failure is in
[run 40516366868, job 122231317704](https://github.com/waitron-io/waitron-cloud/actions/runs/40516366868/job/122231317704)
at `c1c2ea77e2005e2e88c6a8da9a5b989782d55d82`; the case refused after 75.33 seconds.
The branch changes no cost-runner code. This labels the refused operation but
does not identify its cause. Resume D121 with this trace and reproduce the
deletion refusal without changing ownership, accounting, cleanup or deadlines.
Genuine local reproduction waits for Docker to return; a later passing run does
not establish a repair.

## Password-change notification recovery link (D261)

Your password-changed email now links to the password-reset request page in
English or Spanish. Older queued messages without a language link to the English
page. The notification contains no reset token; you request a fresh reset there.
`node --test packages/registration/test/account-mail.test.ts` covers a public and a local
origin, both languages, legacy messages and unchanged subjects. Live provider
delivery remains part of the first working milestone's production qualification.

## Passkey keyboard browser handler observation (D373)

The keyboard fixture waits for its options handler before checking the exact
password and pending controls. The waiter has its own four-second limit, matching
the page timeout. Original journeys remain alongside delayed-handler and
missing-record controls.

Historical qualification recorded a [gateway reconnect refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40597914600/job/122518692085):
the session was accepted but the request check failed. Its cause remains unknown;
lane D's D201 owns the investigation. Keep the accounting checks and deadlines.
The owner's test box now provides focused Docker reproduction. Fresh qualification
does not identify the historical cause.

## A way forward after every refusal (D254)

The [self-service refusal audit](refusal-self-service-audit.md) traces current
English/Spanish portal messages, public pages and account emails to their server
causes. Native probes confirm 50 client refusal mappings and 34 rendered emails
and HTTP pages. Database causes are source evidence, not local runtime proof.
No current customer message asks you to contact Cloud support, and no shared
refusal code is classified as possible only through a product bug.

Cloud follow-ups, each a separate small change with tests before implementation:

- R1 delivered: refused authenticator management requests offer Check authenticator
  settings in English and Spanish. The read-only refresh discards the old local
  setup and inputs, reads current status and requires fresh password/codes before
  another change. General 400 responses retain general feedback, without blaming
  a code field or claiming a specific cause. Server responses, proof checks and
  uncertain-write reconciliation remain unchanged. Native and stubbed-browser
  checks cover stale setup, changed status and restart; database qualification
  runs in CI. The audit records each server cause and the remaining shared-code limit.
- R2 delivered: refused passkey registration and removal requests offer Check
  passkeys in English and Spanish. The read-only action clears the old password
  and refreshes your account's list before you start a fresh prompt or removal.
  The shared 400 response gives general guidance, including choosing another
  passkey if already registered; it does not identify expiry, duplication or a
  verification failure. Password sign-in, credential feedback, rate waits and
  uncertain-write reconciliation remain available. Native and stubbed-browser
  checks cover the path; database and HTTP qualification runs in CI. The browser
  checks wait until the list handler counts the refresh before asserting its count,
  while still holding the reply. A missing handler count now refuses within the
  existing four-second page wait budget, with a controlled bypass case that proves
  the bound. All original journeys and assertions remain; concurrent background
  list reads remain unqualified.
  Request-body
  limits/formats/interruption and other browser failures keep their previous
  feedback and remain follow-ups.
- R3 delivered: recovery approval and replacement refusals now distinguish missing
  confirmations, unverified or incompatible sources, reused replacement keys,
  another open recovery, changed request bindings and missing approval in English
  and Spanish. Check request status reads the existing request without repeating
  a write; refreshing snapshots and choosing a different source still requires
  both confirmations. Replacement conflicts first ask you to check for completed
  replacement; source refusals point to setup requirements without assuming the
  snapshot is at fault or that verification guarantees compatibility. An unapproved
  request can be left to expire. Another open
  recovery must be closed through its original link if it is no longer needed;
  this page does not list or close another request. Unknown replies and transport
  failures retain read-after-uncertain-write reconciliation. Native API/controller
  and stubbed-browser checks cover these paths; real database authority, locking
  and compatibility checks run in CI. Finding another request without its original
  link, displaying source compatibility before approval, and fresh replacement
  setup remain follow-ups in their owning Cloud/Waitron surfaces. No recovery,
  permission, proof or single-writer rule changes.
- R4: recovery now explains a refused test-only action in English and Spanish.
  Open a new recovery link from the replacement server’s setup, then choose a test venue;
  production recovery remains unavailable. Native API/controller and browser
  checks cover the 403 restriction, cleared authority, retained permission errors
  and uncertain-write reconciliation. Server scope and proof requirements stay
  unchanged; PostgreSQL scope checks run in CI.
- R5 venue panels now distinguish denied permission from request verification.
  Installations, snapshots, diagnostics, usage, remote setup and translation consent
  ask you to check your account, organisation and venue. Both languages offer Account
  overview without reloading and Sign out beside the refusal, with retry if sign-out
  fails. Native HTTP/controller and two-venue browser checks cover six reachable
  panels, heading focus and cleared private state; real database/locking checks run
  in CI. Existing permission conditions remain; specific remote refusals get a
  fresh session and ownership check before their cause is returned. Shared
  backup/installation reads on recovery/fiscal pages inherit the wording; their
  request-specific guidance stays in R3/R6/R7. Pairing keeps its existing guidance.
  Remote setup now explains a missing paid trial plan, missing gateway setup,
  a production venue outside the test-only trial and stopped installation access
  in English and Spanish. Account overview and a read-only installation refresh
  give you current context; plan changes, gateway provisioning and restoring stopped
  access are unavailable here. Shared callers keep `permission_denied`; Account
  exposes only a known refusal cause after its ownership check. Native SQL-boundary,
  API/controller and browser checks cover the mapping; real database and late-DNS
  rechecks run in CI. Customer plan/setup/restart controls and membership changes
  still need real product paths and remain open.
- R6: make outside fiscal-custodian, entitlement and identity-space guidance usable;
  record missing provisioning paths without changing fiscal authority or history.
- R7: distinguish temporary fiscal continuity access from missing configuration,
  uncertain history and allocation contention; retain original-request inspection.
- R8 delivered: the no-eligible-business message explains the existing sign-out
  and owning-account sign-in path in English and Spanish. Stubbed-browser checks
  cover the same-page account switch, retained connection request and recoverable
  sign-out failure. Reloading loses the in-memory request; reopen the connection
  link from Waitron. Preserving it across reloads and same-account membership/business
  creation remain separate missing capabilities.
- R9 private forwarding diagnostics now appear in Account for the current owner.
  The [approved plan](superpowers/plans/2026-10-26-private-forwarding-causes.md)
  keeps five fixed failure categories, separate success and unknown states,
  five-minute visibility and 30-second batching. Visitors retain neutral bilingual
  guidance with no upstream details. Refresh reads stored evidence without probing
  or repairing; Account clears it on expiry and navigation. Gateway/collector
  container mounts, primary-only reads and P1/P3 backup integration still need
  deployment qualification. Reporting stays disabled in deployments. See the
  [collection and Account guide](local-monitoring.md#private-gateway-forwarding-collection).
  The invalid equal-timestamp fixture uses one captured observation; its owning
  refusal test advances the clock on every read so a tick cannot make it valid.
  Client validation and the guard-deletion checks retain their assertions.
- R10 delivered: direct navigation to rejected public requests receives bilingual
  guidance for 421/429/413/404/405/400 and failed-proof 403. Background refusals stay
  empty; host, proof, quota, size and forwarding checks retain their status codes.
  Unmatched hosts receive no retry link. The worker reports exhaustion after its
  20-second search budget; the page stops stalled challenge, worker or proof
  requests after 30 seconds, terminates the worker and ignores late results.
  Unsupported/blocked workers offer another-browser and JavaScript guidance;
  disabled JavaScript gets a static explanation. Native HTTP, executed scripts
  and browser checks cover these outcomes. A failed page attempt ignores late
  replies and does not redirect; proof and access remain server decisions.
  If the browser-check script cannot load or JavaScript is disabled, bilingual
  guidance stays visible below the heading. It disappears when the script starts
  and reveals the waiting line, so a failed download does not leave you without
  a next step. Native Chromium checks cover failed, disconnected and delayed
  script downloads, recovery on reload, disabled JavaScript and later retry
  feedback in both languages, themes and phone/desktop widths. Other browser
  engines, screen readers and production timing remain unqualified. A new script
  can still start on the previous page markup during a rollout. The fallback
  offers Reload page / Volver a cargar as an ordinary link to the same public page.
  Pointer and keyboard checks cover restarting after a failed script download;
  without JavaScript, the link returns to the static guidance. Reloading repeats
  the browser check and does not grant access. A script from before fallback hiding was introduced may
  leave the guidance visible during a mixed rollout. If a running check fails,
  the Reload page link reappears beside the existing failure-specific message.
  With matching page and script versions, static download/disabled-JavaScript
  advice stays hidden after startup, so a failed request offers reload guidance
  while blocked/unfinished checks keep their browser guidance. Mixed versions can
  keep the previous advice until reload. Chromium checks cover both languages,
  themes and widths; this wording does not diagnose why a request or check failed.
  Pointer and keyboard
  checks cover restarting after challenge, worker, proof and timeout failures,
  with no automatic retry or granted access; the new attempt hides the fallback
  while it runs. The older-page
  browser fixture now serves the exact shipped HTML from before the static
  fallback, with a pinned digest independent of current page generation. Its
  existing waiting, bilingual failure, no-forwarding and no-cookie checks run
  against the current script. Native Chromium also completes the real worker and
  proof exchange on that historical page, then opens the local HTTPS venue response.
  Both languages, themes and widths retain zero cookies and upstream requests before
  proof, followed by the scoped access cookie and one forwarded request. Other
  historical versions, browser engines and production networks remain unqualified.
  In the reverse rollout pairing, the shipped older script also runs on the
  current page: after a failed challenge, Reload page restarts the real worker
  and proof exchange before opening the local HTTPS venue response. Chromium
  checks cover both languages, themes and widths, with no cookie or forwarding
  before proof. The older script leaves the current static advice and reload
  link visible while checking; these tests preserve that known mixed-version limit.
  The browser-check page groups its heading, waiting or failure message and
  reload guidance in one main content region. Native Chromium checks cover
  disabled JavaScript, a failed script download and a running check that fails,
  in both languages, themes and widths. Automated landmark checks run with
  JavaScript enabled. The waiting message and later failure share a status
  region so assistive software can observe the change without moving your focus.
  Chromium exposes a polite, whole-message region while waiting; the failure
  message replaces its contents in place. Checks cover challenge and worker
  failures in both languages, themes and widths. The reload link returns after
  failure and access still requires proof. Actual screen-reader announcements,
  other engines and production networks remain unqualified.
- R11 delivered: public/staff alerts in Account and email name the existing remote
  setup and refresh controls in English and Spanish. Failed checks ask you to
  check venue internet, the selected hostname and setup status. Unknown monitoring
  asks you to look for new observations without declaring an outage; certificate
  warnings retain their separate dates and can accompany a passing route check.
  Native mail and stubbed-browser checks cover the guidance, read-only setup/status
  requests and later healthy evidence. The local monitoring guide explains the
  checks and their limits; refreshing neither starts a probe nor repairs a route.
  Gateway assignment, renewal configuration and certificate installation remain
  operator tooling. Owner-facing repair controls, appliance certificate delivery
  and live provider activation remain unfinished. No monitoring, certificate,
  gateway, permission or delivery rule changes. Real database/gateway qualification
  remains in CI and the Docker-based local proof.

Authentication, recovery, tenant permissions and fiscal changes keep their full
review and owner gates. This audit does not enable services or change policy.

## D413 — Locate a failed joint fiscal fixture setup

**Open.** Initial directory refusals and completed blocking setup overruns now
produce bounded reports. Capture the operation behind the historical setup
timeout; keep the pinned source, fiscal assertions and deadlines unchanged.
See [the boundaries and remaining work](backlog/joint-fiscal-fixture-setup.md#d413--locate-a-failed-joint-fiscal-fixture-setup).

## Cost-mail reconciliation refusal observed during D262

The historical mail measurement-close refusal remains unexplained. Both unchanged
PostgreSQL/Mailpit cases pass on the Linux test box, alongside all 20 mail controls
on Linux and macOS. These results do not identify or repair the old failure.
Use the next labelled close-error diagnostic to reproduce its cause while preserving
measurement guards, accounting and deadlines. See [the investigation and qualification limits](backlog/cost-mail-reconciliation.md).

## Remote hostname browser-test request observation (D315)

The Enter-key browser test waits for its DNS route handler to record the first
request before checking its payload and pending-review behaviour. The browser's
request event can arrive before that record is filled. A controlled handler delay
reproduces the empty-array refusal; waiting for the handler preserves the existing
request, confirmation, apply, invalid-input and rate-limit assertions and deadlines.
A missing handler now refuses within the existing three-second page budget,
rather than waiting for the outer runner deadline. Native browser checks cover
an absent handler and a delayed handler while retaining every original assertion.
No remote setup or permission behaviour changes.

## Authenticator keyboard browser handler observation (D372)

The authenticator setup keyboard fixture waits for its route handler to record
its request before checking the payload. The browser request event can arrive
first; a delayed handler reproduces that empty-record refusal. Setup handlers
pause only while no request has been recorded. Ordinary and delayed English/light/390
controls submit a real extra request during pending setup and reject it at the
later existing count assertion. Arbitrarily late duplicates and other fault
combinations remain unqualified. All 39 native Chromium checks retain every original password,
Enter-key, pending-state, activation, cooldown, clock and deadline assertion.
These checks use stubbed HTTP; real account authority and the historical Linux
failure cause remain unqualified.

## Recovery-session browser handler wait (D360)

The recovery-session browser fixture refuses an absent handler signal within its
existing three-second page budget. Delayed handlers still run the full bilingual,
theme, viewport and server/network failure matrix. Original session-status,
recovery-input, request-count, retry navigation, layout and deadline checks remain.

## Installation-refresh browser handler wait (D357)

The installation-refresh browser fixture refuses an absent route-handler signal
within its existing four-second page budget. A delayed handler still runs all
removed, retained and failed-refresh journeys. Original recovery, permission,
selection, request, layout and deadline assertions remain unchanged across both
languages, themes and viewport widths. No product authority changes.

## Remote hostname save transport and read-back (D427)

**Open.** Qualify live DNS/ACME, browser integration and deployment; retain the existing
permission and retry rules.
See [the boundaries and remaining work](backlog/remote-access-http.md#remote-hostname-save-transport-and-read-back-d427).

## Remote status and DNS-preview transport failures (D438)

**Open.** Qualify live DNS/ACME, browser integration and deployment; retain the existing
permission and retry rules.
See [the boundaries and remaining work](backlog/remote-access-http.md#remote-status-and-dns-preview-transport-failures-d438).

## Remote-access HTTP response boundaries (D420)

**Open.** Qualify live DNS/ACME, browser integration and deployment; retain the existing
permission and retry rules.
See [the boundaries and remaining work](backlog/remote-access-http.md#remote-access-http-response-boundaries-d420).

## Remote hostname replies after account and venue changes (D402)

**Open.** Qualify live DNS/ACME, browser integration and deployment; retain the existing
permission and retry rules.
See [the boundaries and remaining work](backlog/remote-access-http.md#remote-hostname-replies-after-account-and-venue-changes-d402).

## Unchanged remote hostname review (D259)

On Account, Review DNS settings is available only when the entered name differs
from the selected saved name after trimming spaces, lowercasing and removing one
trailing dot. The controller also refuses an unchanged review, so clicking or
pressing Enter cannot create a confirmation or send a redundant save that puts
remote access back into setup. Changed names still need review and confirmation;
Use assigned name still lets you switch back from a custom name.

Stubbed portal and controller checks cover assigned and custom names, staff and
public access, equivalent input, saving a different name and switching back. The
existing Enter, installation-refresh and uncertain-save checks retain their
assertions and deadlines with the three owner-approved setup changes. Server
behaviour and the outstanding live DNS/ACME and deployment qualification are
unchanged.

## Isolated replay ownership-loss fixture

An earlier remote-guidance qualification failed in
`isolatedControllerNeverClaimsCleanupAfterLosingItsOwnership`: the fixture did not
observe the replay worker's started journal state (conformance run 40265731418,
job 121387722438). The cause remains unknown and belongs to D530's investigation.
Keep the ownership assertion, deadlines, resource collection and refusal to claim
cleanup after ownership loss. Qualify any repair with the genuine runtime fixture;
a passing remote-guidance qualification does not establish a repair.
