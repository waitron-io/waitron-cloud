# Waitron Cloud backlog

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

## Current state

Updated 2026-10-22. The repository has a pnpm workspace and internal PostgreSQL
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
D102/D104 hands-on work waits until 3 November. D68 is landed, including
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
3. **Billing.** Remote access and backups are paid services, and so is the rota solver
   below. Today billing is one bullet under _Platform work to scope_. The plan switch is a
   test-only one an operator sets by hand, and the usage ledger is "observational only"
   ([usage metering](usage-metering.md)). Missing: what is charged for, prices and free
   allowances; a payment provider and checkout; trials; Cloud's own invoices to venues under
   Spanish rules, with the customer's tax number (signup leaves "Tax details, billing and
   country-specific validation" to "the later billing journey"); failed payments;
   cancellation; and closing an account.
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

The ownership-changing hook was not observed in [cost run 40265731418,
job 121387722438](https://github.com/waitron-io/waitron-cloud/actions/runs/40265731418/job/121387722438).
Failure diagnostics now distinguish recorded worker admission from an unrun
hook and retain the last fixed preparation stage, elapsed time and cancellation
state. Private resource IDs, paths and tokens stay out of the report. A native
control preserves the original missed-ownership assertion; the genuine copy
refusal exercises the reporter in CI. Ownership assertions, deadlines and cleanup
rules remain unchanged. The historical failing operation and its repair remain
open: collect an instrumented recurrence before changing the ownership check.

## Isolated replay result-boundary refusal (D297)

An altered-stream control refused before reading its changed worker result in
[cost CI](https://github.com/waitron-io/waitron-cloud/actions/runs/40281251676/job/121434888588).
Failure-only diagnostics now retain fixed preparation, worker and host stages,
validated worker traces and result-read status without private output. The boundary
assertion, deadlines and cleanup stay unchanged. The historical cause remains open;
collect an instrumented recurrence before changing behavior.

## Isolated-replay CI work groups (D301)

Isolated replay now runs in three separate CI jobs: controller cases, host and
result-reporter cases, and the remaining command and diagnostic cases. New case
names fall into one of these groups so coverage cannot disappear. Each job keeps
the eight-minute cap, original case assertions, runtime pins and cleanup rules.
Check the complete case inventory and both head and merge runs before claiming
the jobs meet the five-minute target.

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

## Fiscal allocation registry

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
The no-request checks also rely on the controller's validation; a focused test
that isolates the screen's own refusal remains a client-validation follow-up.
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

The design and 24-task plan are owner-approved; Tasks 1–21 are implemented.
Keep translation off until the remaining Cloud, joint Waitron and release checks,
owner-only quality trials after 2026-11-02, and commercial and production decisions
are complete; preserve the approved cap, admission, consent and paging rules in the
[translation requirements and open work](backlog/translation.md).

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
  A generated SDK client-destruction throw also stops collection before its first
  bucket request on both the base and candidate. Its diagnostic is retained; a
  cleanup correction remains open. Whether the real SDK throws there is unverified.
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
  The temporary observation workflow is removed. Retain the next instrumented
  refusal before repairing browser behavior; all existing checks and deadlines remain.
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

- **CI job record publication.** GitHub can report a successful package group
  before its jobs list shows every partition as completed. The summary requires
  every planned job exactly once and every required dependency group successful.
  An `in_progress` record with no result can also prove its partition through
  completed steps: successful setup and final `Complete job`, ordered unique
  step numbers, and only successful or skipped intervening steps. This evidence
  must name the current run, attempt and source commit. Earlier attempts can
  supply completed successful records, but cannot supply unfinished step evidence.
  Final failed, cancelled, timed-out, skipped or unknown jobs still fail.

  Steps alone cannot prove success: the runner publishes its final step before
  [uploads and job-result submission](https://github.com/actions/runner/blob/4c989f2f108bb6798e07ea5935bc8bc4aab7de2f/src/Runner.Worker/JobRunner.cs#L290).
  Final successful dependency results cover failures after the steps finish.
  Missing or duplicate partitions and unexpected executed jobs still fail.
  Without sufficient evidence, the summary waits within its original 60 seconds,
  polling every two seconds. Each API read has a ten-second limit, capped by
  remaining time; timed-out reads retry inside that same allowance. Other lookup
  errors fail immediately. A timed-out API process is forcibly stopped so ignoring
  a termination request cannot extend its allowance. Each partition's step
  evidence is reported once. Exhaustion names the pending jobs and last timeout;
  the summary job retains its two-minute limit. Run
  `node --test scripts/ci-summary.test.mjs scripts/ci-cli.test.mjs` to check the
  command and refusal paths. Landing still requires every actual job record final.

  Eight runs on 2026-10-22 include five failed summaries naming 32.8–41.6 KB
  package logs; successful root jobs had roughly 371 KB logs. This does not
  support log size as the cause. Run `39828383029` still had account HTTP shard
  2/3 unfinished after its final step and a timed-out API read, despite successful
  dependency results. The exact service-side cause remains unproved; the gate
  now uses the independent final evidence rather than assuming a larger wait
  will repair that record. Earlier failed runs remain failed.

- **CI execution budget.** You can read one summary job and the individual package
  and receipt jobs to check a candidate. The summary also checks the plan's
  package allocation against the planner's registered package names and shard
  counts. Registration uses five partitions; account HTTP and portal use three
  each, and backups uses two. The summary requires every registration partition
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
  Bootstrap setup now gives npm
  registry requests 15 seconds with one retry after one second, so a stalled
  tarball fetch cannot consume minutes before tests start. A real local `npm ci`
  against a held tarball request exceeds 35 seconds under the defaults and fails
  in about 31 seconds with these settings, after two attempts. The setup action
  receives this policy in every CI job; project installation, auditing and all
  test/job deadlines stay unchanged. This is a per-request limit, not a total
  bootstrap deadline. In run 38803777952, bootstrap npm reported a five-minute
  installation and the account shard was later cancelled before completing.
  Its log does not identify the slow request, so do not attribute it to a
  particular registry endpoint or to a product test. Preserve bootstrap timing
  and npm diagnostics if setup overruns recur. A separate
  [merge run 39650584401](https://github.com/waitron-io/waitron-cloud/actions/runs/39650584401/job/119397690795)
  refused registration partition 3 before tests: the action's locked pnpm 11.19.0
  bootstrap could not verify `@pnpm/exe@9.15.0` signature metadata, reporting
  `ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE` with `terminated`. The pinned
  verifier classifies that error as unreachable metadata, rather than a completed
  invalid-signature check. A fresh disposable Linux bootstrap with the exact
  action lock later completed the switch and printed 9.15.0 with verification
  intact; it does not explain the original termination. Capture the failing
  HTTP stage and registry response if it recurs, then evaluate bounded recovery
  while preserving signature verification. A later successful run is recovery
  evidence, not a code fix. The same error class recurred in merge run
  [40022323542, backups partition 2](https://github.com/waitron-io/waitron-cloud/actions/runs/40022323542/job/120649947311):
  pnpm 11.19.0 refused the switch to 9.15.0 after signature verification of
  `@pnpm/linux-x64@9.15.0` terminated. No backup tests ran in that job. Retain
  verification and capture the missing HTTP stage before choosing a repair;
  neither the underlying cause nor a connection to portal changes is established.
  D154 adds a read-only observer to each pnpm setup in the standard and cost
  workflows. It records fixed package-metadata endpoints, HTTP status, interrupted
  metadata transfers, child exit or signal, and the final process exit. Each Node
  thread has separate limits for normal, failure and child records. It
  omits URL credentials, hosts other than the public npm label, queries, headers,
  bodies, command arguments and raw error messages. Process and worker identities
  distinguish parallel verification requests. A controlled cut-off response
  reproduces `terminated` with HTTP 200 and `UND_ERR_SOCKET`; invalid gzip can
  also produce `terminated` after a completed wire transfer, so these diagnostics
  do not by themselves expose every body-decoding failure or explain the old run.
  Tarball downloads are outside this observer's metadata allowlist.
  The exact locked 11.19.0 bootstrap completes its verified 9.15.0 switch in a
  fresh native probe. Linux qualification runs the controlled failure checks and
  observes the unchanged setup action; a later successful setup is recovery
  evidence only. Keep the current verified installer while awaiting a traced
  recurrence. Do not copy Waitron's bounded setup script unchanged: it replaces
  this self-update with `npm install`. Any later bounded recovery must retain
  signature verification, pinned versions and existing deadlines.
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
  uses five file shards, account HTTP and portal use three each, and backups uses
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
  CI now directs recognised Azure, primary and runner mirror-file archive
  references to `https://mirror.math.princeton.edu/pub/ubuntu`. This changes only the URI;
  your release, components, architectures, signing keys and other sources stay
  intact. Ubuntu's existing signed release metadata and package hash checks
  still decide which bytes you can install. No additional signing key, cache,
  unsigned source or longer deadline is introduced. See
  [Ubuntu's archive verification](https://documentation.ubuntu.com/security/software-integrity/archive-verification/)
  and the [Princeton's Ubuntu archive](https://mirror.math.princeton.edu/pub/ubuntu/).
  Run `node --test scripts/ci-browser-source.test.mjs scripts/ci-download.test.mjs`
  to check source preservation and the workflow against controlled stalled runner mirror-file
  and primary sources. Both must reach the alternative in one attempt. Real
  Actions qualification must also show two consecutive full runs of the same
  head and its independent merge run, with one install attempt and every portal
  and UI-smoke test executed. The public mirror can still fail; the existing
  supervisor must then refuse the install within its unchanged limits. The
  observed transfer bottlenecks do not establish the outside servers' cause.
  [Run 39890570457](https://github.com/waitron-io/waitron-cloud/actions/runs/39890570457/job/120209180867)
  later failed portal shard 2 before its tests: both bounded attempts could not
  connect to Princeton at `128.112.18.21:443`. The other browser jobs installed.
  The single-mirror availability risk remains open; no source, trust setting or
  download limit changes with the backup-verification correction.
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
  deliberate faults also prove each URI's leading whitespace boundary. All 17
  focused source/download checks pass. This preflight does not make subsequent
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
  or failed-setup cleanup follow-ups. Diagnostics: `~/waitron-campaign-d/receipts/d76/`.
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

  **Local registration suite lock capacity.** Running the complete registration
  suite with this Mac's default 18 test-file workers exhausted PostgreSQL's shared
  lock table (`out of shared memory`, with `max_locks_per_transaction` hints).
  That run reported 486 passes and 198 failures across 684 reported cases; two
  stalled test processes and their recorded descendant required termination.
  The wrapper then cleaned up its owned database and mail containers. Qualify
  high-core local harness defaults separately; do not raise test deadlines or
  database limits to conceal this run. A bounded four-file full-suite run uses
  the same files, assertions, database settings and individual test deadlines.

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
  business and owner membership atomically. It grants no platform access. Account
  and fiscal cooldowns use the singular word for the final second in English and
  Spanish; `apps/portal/test/cooldown-browser.test.ts` exercises real 429 replies,
  the two-to-one-second transition and expiry with a controlled browser clock.
  Sign-in, signup requests and password recovery trim surrounding email whitespace
  before validation and sending, including non-breaking spaces left by the browser.
  Stubbed Chromium checks cover all three forms in English and Spanish, both themes
  and phone/desktop widths; blank, internally spaced and overlong addresses stay
  refused, passwords retain their exact bytes and login refusals keep the generic
  credentials message. The portal email check follows the server's address grammar,
  including local-part and domain-label boundaries, consecutive dots, non-ASCII
  addresses and leading zero-width spaces. Sign-in, signup and recovery mark the
  email field before sending an address the server refuses. A sign-in HTTP 400
  shows validation feedback; wrong credentials keep their single generic answer.
  Table checks compare the browser check with the unchanged server normaliser.
  The email
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
  and Spanish. Passkey failures appear once in the relevant alert: beside your passkeys
  on Account (including `/`), or in the sign-in error summary. When you cancel a passkey
  sign-in prompt, one status message confirms that nothing changed; you can retry.
  Starting password sign-in clears that notice. Cancelling Add a passkey also shows
  one status message, including when the browser library wraps the cancellation.
  Cancelling sends no credential verification request. You can try again; other
  prompt failures keep their alert.
  Controller and stubbed Chromium checks cover these enrollment outcomes.
  Typing your current password enables Add a passkey immediately, so Tab reaches
  it without waiting for the next refresh. Clearing the password disables it again.
  Frozen-clock keyboard checks cover both languages, themes and phone/desktop widths;
  enrollment still disables Add and its password field, keeps password bytes across language
  changes and clears the password after success.
  Removing a passkey with a blank password marks the password field and shows its
  required message beside it, with one section alert and no removal request.
  Stubbed Chromium checks cover both languages, themes and phone/desktop widths;
  wrong-password alerts and server cooldowns keep their existing behavior.
  If reading your passkeys fails, Account offers Retry and does not claim you have
  none. Only a successful empty list shows that message. Retry waits for any server
  cooldown and disables itself during the read. Navigation keeps the explicit retry
  without restarting the read; account changes discard its old success and replies.
  Controller and stubbed Chromium checks cover failure, empty-list retry and account
  changes; the delayed session-activity wrong-password regression remains covered.
  A failed refresh keeps the last-read rows alongside Retry.
  Unsupported browsers keep one help message. Stubbed Chromium checks cover both
  languages, themes and widths, repeated cancellation and a later refused attempt.
  Passkey and session
  controls honour the server’s Retry-After wait, show its countdown and become available
  when it ends. Navigation retains the wait; follow-up reads still reconcile uncertain
  changes without shortening a longer wait. Stubbed Chromium checks
  cover both languages, light/dark themes and phone/desktop widths, with a Chromium
  virtual authenticator so the fixture offers passkeys on Linux too. Root-to-Account
  navigation now finishes before startup reads begin, so the redirect cannot discard
  their replies. A delayed session-activity reply no longer restarts the passkey list
  and clears a wrong-password alert. A controlled Linux reproduction captured that
  sequence across both languages, themes and widths; a separate browser regression
  retains the alert after the activity reply, with the original error checks and
  four-second waits unchanged. This addresses the repeated root-route timeout in
  CI40062082033, CI40076659731 and CI40080920398; those historical runs did not capture
  the request ordering themselves. A failed authenticator status read now keeps its
  message and explicit Retry when session activity completes, instead of silently
  restarting the read and clearing the error. Retry remains disabled during a read
  or server wait; returning to Account refreshes status.
  A failed session-list read also keeps its alert and explicit Retry when session
  activity completes. Retry cannot duplicate a pending read or bypass the server's
  wait. Returning to Account and changing accounts still start a fresh list read.
  Stubbed Chromium checks cover both languages, themes and phone/desktop widths;
  session revocation and uncertain-reply reconciliation keep their existing checks.
  If revocation and its follow-up list read both fail, activity keeps the uncertain
  message and Retry too. Retry reads the list without sending the revoke again.
  A failed alert-preferences read also keeps its message and explicit Load action
  when session activity completes, including after a server wait ends. Loading
  cannot duplicate a pending read or bypass the wait. Navigation can retry failed
  preferences while keeping a pending read and already loaded choices; changing
  accounts discards old replies. A refused Save keeps its message after navigation
  and activity; Load reads preferences without repeating the refused save.
  Uncertain-save handling keeps its existing checks.
  Stubbed Chromium checks cover both languages, themes and phone/desktop widths.
  Sign-out browser checks now wait for startup to settle before opening a passkey
  prompt and retain both enabled-button assertions. Held authenticator and
  installation replies reproduce an open prompt with Sign out correctly disabled;
  after those replies settle, the prompt alone permits sign-out. Direct handler
  calls cannot bypass pending startup, and sign-out fences the unfinished prompt.
  The real-server check records a bounded trace of fixed request paths and phases,
  without bodies or credentials, for another failure. The exact pending operation
  in CI40331684104 was not captured; its historical cause remains unconfirmed.
  Production pending guards and the original five-second browser wait are unchanged.
  A failed translation-consent read keeps its message and explicit Refresh when
  session activity completes, including after a server wait ends. Refresh cannot
  duplicate a pending read or bypass the wait, and never repeats a consent change.
  Navigation retries failed reads while keeping pending and successful reads.
  A navigation read blocked by a server wait may start on later activity after
  the wait ends. Changing accounts discards old replies. Refused consent changes
  retain their message until an explicit read. Consent authority still requires a successful
  read. Stubbed Chromium checks cover both languages, themes and phone/desktop
  widths; provider and real database behavior still require their separate checks. The authenticator-rotation lock probe now reads only this
  fixture's uniquely named database sessions. A real competing `FOR SHARE` waiter
  reproduces the old probe's false observation before rotation starts; the scoped
  probe must ignore it and then observe rotation's own `FOR UPDATE` wait. The
  account-before-child lock assertion, ciphertext reread checks and polling limits
  are retained. Production rotation is unchanged. The earlier intermittent failures
  did not capture session IDs, so their exact waiter remains unidentified. The account page
  now lists only your live management sessions, marks the
  current one and shows creation, last-use and effective-expiry times. You can revoke any
  session with a CSRF-protected, account-scoped action; uncertain replies reconcile from
  the passive list. Revoking the current session returns you to sign-in with the
  signed-out notice once the session check confirms it ended. Lost replies still
  reconcile; passive session loss stays quiet and expiry keeps its own notice.
  Database-free English and Spanish browser checks cover both themes and widths.
  While your session is checked, the home page uses the account heading in the page
  and browser tab. If the check fails, that heading stays above the retry message.
  Stubbed Chromium checks cover both languages, themes and phone/desktop widths,
  retries and the existing redirects to sign-in or Account.
  Revoking your current session starts a fresh session check even if an older
  read is pending, subject to the server's retry wait. An older snapshot cannot
  replace a newer result. The sign-out notice requires the session check to
  confirm sign-out; an unavailable check or an existing wait clears that intent,
  so a later passive check stays quiet. Ordinary passive checks share their pending
  read; expiry feedback, navigation and new-session fences stay in force.
  Stubbed Chromium checks cover current-session revocation in both languages,
  themes and phone/desktop widths. Additional light-theme phone checks in each
  language cover lost replies, response ordering, waits and passive read sharing.
  Database authority runs in CI.
  Passkey rows
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
  covers storage, account controls and browser acceptance. Storage, API and the bilingual
  portal, operational key rotation and private stack configuration are implemented locally.
  You can paste spaced authenticator or recovery codes into sign-in and factor controls.
  The portal removes whitespace, preserves recovery-code hyphens and refuses empty proof
  or activation codes before sending. Passwords and server validation stay unchanged.
  `node --test apps/portal/test/authenticator-controller.test.ts` covers each request path.
  Blank codes and missing passwords show the existing alert or sign-in summary and
  mark only the missing password, proof or confirmation field in English or Spanish
  before any request. Correcting and submitting clears the field marker; account
  changes, leaving the flow and new requests clear it too. Sign-in, setup, replacement,
  activation, removal and code regeneration
  retain the entered values for correction; pending requests and cooldowns keep their
  existing feedback. Stubbed-route Chromium checks cover correction and submission
  in both themes and phone/desktop widths without changing server authority checks.
  The populated 34-to-35 upgrade/restore rehearsal and packaged stack clean-install,
  restart, rebuild/upgrade and cleanup proofs passed with 35 migrations for the
  authenticator release. Current packaged proofs follow the selected release manifest.
  The identity primitive
  encrypts account/version/purpose-bound
  secrets and returns every matching adjacent time step; migration 035 persists factor,
  session-bound enrolment, challenge, hashed recovery and replay state. Focused PostgreSQL
  and cryptography checks cover constraints, ciphertext binding and preserved upgrade data.
  Password challenges now keep you outside a session until a valid authenticator or unused
  recovery code completes the check. Focused PostgreSQL tests cover concurrent completion,
  durable attempt limits, stale credentials, code reuse and expiry during database waits:
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test
  test/password-login.test.ts test/identity.test.ts`. Account controls now require your live
  session, current password and, for an active factor, fresh proof. Activation, replacement,
  removal and recovery-code regeneration end every session together. Email reset preserves
  the factor, unused codes and replay history but invalidates pending enrolments and login
  challenges. Session cleanup retains factor-referenced rows until a separate retention
  policy is approved. PostgreSQL checks cover concurrent changes, durable failed attempts,
  passkey access during key outages, reset during password derivation and expiry after writes:
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test
  test/authenticator-factor.test.ts test/password-recovery.test.ts test/passkeys.test.ts
  test/history-cleanup.test.ts`. The account API now returns a cookie-free second-step
  challenge after password proof, accepts a single-use factor completion, and exposes
  strict session/CSRF-protected account controls. Explicit factor policy supplies shared
  account, challenge and IP limits; IP refusals spend no account or challenge allowance.
  Separate factor keys and malformed-configuration handling preserve ordinary password
  login, passkeys and live account access during an outage. HTTP checks cover strict
  bodies, all session-backed route families, independent instances, real server restart,
  generic errors and cookie clearing after committed changes:
  `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test
  test/authenticator-factor.test.ts test/account-http.test.ts test/passkeys.test.ts
  test/account-security.test.ts test/rate-limit.test.ts test/server.test.ts`.
  The portal keeps challenges, setup secrets and recovery codes in tab memory. Its QR code
  is rendered locally. Successful changes show recovery codes once after signing you out;
  lost replies check your session without automatically resending the consumed proof.
  Browser checks cover English/Spanish, 390/1280 widths and light/dark themes: enrolment,
  replacement, single-use codes, email reset with the factor retained, independent passkeys,
  removal, cancellation, lost replies, keyboard focus, accessibility and temporary-state clearing:
  `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test
  --test-timeout=120000 test/authenticator-browser.test.ts test/authenticator-rollover.test.ts test/passkey-browser.test.ts
  test/account-security-browser.test.ts test/session.test.ts`.
  The [operator guide](authenticator-app.md) documents independent keys, explicit policy,
  account-first re-encryption and retained-backup custody. Rotation tests preserve versions,
  sessions and proof state, reject wrong/missing keys, and resume interrupted accounts:
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test
  test/authenticator-keys.test.ts`. The populated 34-to-35 receipt preserves credentials,
  sessions and synthetic passkey rows, proves migration rollback/retry and both incompatible
  consumer refusals, and restores factor state with matching/wrong/missing-key checks.
  `node scripts/schema-upgrade-receipt.mjs /tmp/cloud-factor-upgrade.json --old
  65c13f1402041931bdb244007f3cbc267ae61483 --new <full-implementation-commit>`.
  The historical upgrade defaults remain unchanged. The packaged stack proof passes
  on the complete implementation tree:
  `pnpm proof:local-stack`. Its receipt requires healthy services, retained data/identity,
  the selected release's complete migration manifest and zero leftover containers,
  volumes, networks or proof images.
  No production factor policy or key configuration is selected.
  Configure live email delivery and production factor policy,
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
  The owner selected Amazon SES in an EU region on 2026-10-21, an explicit email
  exception to Spain home storage. D102 selects Paris or Frankfurt and qualifies the
  account, entities, processing/access locations, retention and tracking controls;
  configure the sender and prove live delivery. This selection does not prove setup
  or delivery, and does not move venue databases, logs or keys out of Spain.
  Implement authenticated bounce/complaint ingestion, suppression reconciliation and delivery alerts for that
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
  breaks the database-backed boundary test. Independent HTTP checks replace the store
  boundary so its second password check cannot mask a missing HTTP guard. Signup,
  login and password reset admit 1024 UTF-8 bytes and refuse 1025 before calling
  their store, for ASCII and multibyte passwords. Deleting the HTTP guard, counting
  characters instead of bytes or rejecting the exact limit fails these checks;
  restoring the guard passes. Run `node --test
  packages/account-http/test/http-password-boundary.test.ts` without PostgreSQL.
  The original database-backed assertions and production guards are unchanged.
  Deleting the declared-length guard breaks its early-refusal test;
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
  Authenticator management checks its proof deadline after all changes, before
  committing the transaction. The duplicate earlier clock query is removed; all
  42 existing management tests pass unchanged. Two additional removal cases cover
  proof expiry while waiting for another session's lock and after management
  writes. Deleting the final check in a disposable checkout fails five late-expiry
  cases; deleting savepoint rollback also fails both new cases. They check that
  factor, recovery-code, replay, pending-operation and session changes are undone.
  You can sign in immediately after an authenticator change even
  when its ended-session read arrives late. The portal clears the old account from its
  controllers before showing the login form, so that read cannot cancel your new sign-in.
  Two controlled real PostgreSQL/Chromium cases show sign-in failing to complete
  after removal with a password and after a lost regeneration reply with a passkey.
  Removing the account reset restores both failures at the existing seven-second
  browser wait. The earlier English/light/1280 journey timeout and the two later
  CI failures were not traced to this precise reply ordering; keep that historical
  attribution open. Run `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node
  --test --test-timeout=120000 test/sign-in-session-race.test.ts`. Existing authentication
  checks, browser assertions and deadlines remain. If another timeout occurs, capture
  its request/locator stage and reproduce that cause before changing a check or deadline.
  The authenticator browser matrix retains recent response paths/statuses, headings,
  alerts, scoped IP counters and live session/factor counts when it fails, preserving
  the original exception even if collecting diagnostics fails.
- **Subscriptions and billing.** Service catalogue, checkout, invoicing, permitted
  services, usage accounting, trials, failed payment and cancellation. Item 3 of
  [launch platform work](#launch-platform-work-in-priority-order).
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
- **Service monitoring.** Check representative operations from outside the affected
  cell; track errors, response times, queued work, backup freshness and capacity.
  Production observation, phone delivery, recovery targets and C39 plan/build approval
  remain open; see [the requirements and deliberate limits](backlog/service-monitoring.md).
- **Usage metering.** Local totals cover snapshot storage and transfer, installation
  operations, monitoring probes and administrative alerts. Production deployment,
  monitoring and additional service units remain open; define costs, allowances and
  outage policy before using totals for billing. See [scope and remaining work](backlog/usage-metering.md).
- **Data lifecycle.** Local backup capture, retention, verification and recovery are
  implemented; production custody, provider qualification, isolation and lifecycle
  policies remain open. See [the complete requirements and deliberate limits](backlog/data-lifecycle.md),
  including unresolved verifier failures and capacity qualification.


## Parallel storage-cache fixture failure on main

Main [run 39943355021](https://github.com/waitron-io/waitron-cloud/actions/runs/39943355021)
rejected one of two fixtures in `deploy/test-cloud/storage-cache.test.mjs`.
The test now prints each rejected error and its socket diagnostics before stopping
the successful fixture. The read-only archive and two-success checks are unchanged.
The original rejection had no error detail, so its exact cause remains unknown.

A separate native Linux investigation reproduced a readiness failure in
[run 39945355111](https://github.com/waitron-io/waitron-cloud/actions/runs/39945355111).
With sixteen concurrent fixtures, a bucket creation can succeed after the caller
stops waiting for its reply. Every subsequent creation then returns
`BucketAlreadyOwnedByYou`, and the old readiness loop eventually refuses a working
store. Socket evidence identifies each store as the owner of all seven allocated
ports; this reproduced failure is not an observed port collision.

The fixture now checks that the owned readiness bucket is accessible before
accepting that response. Other errors still retry within the existing limits;
a failed accessibility check still blocks startup. A deterministic real-store test
discards a successful creation reply and verifies recovery, and a second test
checks refusal when access fails. Existing assertions and deadlines remain intact.
All sixteen focused native cache/startup cases pass, along with the four
adjacent storage-authority cases. Local Docker and PostgreSQL checks
stay unavailable until 3 November; qualification uses GitHub CI.

The next Linux qualification at readiness-only head `59e1749` exposed a second
failure: SeaweedFS refused its assigned filer port after Node released the
reservation. No listener was present when the later socket snapshot ran; the
competing socket's owner remains unknown. The fixture now retries that explicit
child port-allocation refusal once with a fresh directory and seven new
reservations, after cleaning up its failed child. It prints the first failure's
evidence, stops after a second collision, and never stops a competing listener.
The same handoff can fail after SeaweedFS's initial port check; Linux combined
[run 39946986371](https://github.com/waitron-io/waitron-cloud/actions/runs/39946986371)
records a volume listener's bind refusal. Both observed forms qualify only when
the reported port belongs to the fixture's seven-port allocation. An unrelated
child exit or an unallocated port does not qualify. Deterministic child tests
prove recovery, both refusal forms and the two-attempt limit. The existing first-failure diagnostic
test explicitly disables retries while retaining all its assertions.

The combined repair passes all nine independent dense Linux samples in
[run 39947812288](https://github.com/waitron-io/waitron-cloud/actions/runs/39947812288):
126 checks across three runners, including sixteen simultaneous fixtures per
sample. The temporary stress workflow and case are removed after qualification;
the deterministic regressions remain. A 479-second Claude run-it review identified
three low-severity gaps, now covered: thrown values without a message preserve
their identity, a port-shaped upstream error does not impersonate a child exit,
and a controlled cleanup barrier must finish before the retry creates its next
directory. Ten deliberate guard faults were caught
in a disposable checkout and the original files restored before the final checks.

A later rejection in [run 40106355179](https://github.com/waitron-io/waitron-cloud/actions/runs/40106355179)
identifies an unreserved S3 gRPC listener: HTTP port 35547 derives port 45547,
which is absent from the seven-port allocation. SeaweedFS 4.47 derives a separate internal service port
when no explicit S3 gRPC port is supplied. The fixture now reserves an eighth
port and supplies `-s3.port.grpc`, so its existing allocation diagnostics and
single retry also cover that listener. Deterministic child tests reproduce the
observed S3 bind-refusal message after a real occupied-socket error, then check
recovery, refusal after two failures, and disabled retries. Competing listeners
remain open. The complete-allocation and diagnostic-count checks now require
eight ports; their other assertions and all deadlines remain unchanged.

Qualification: all nine dense Linux samples in
[run 40110095865](https://github.com/waitron-io/waitron-cloud/actions/runs/40110095865)
start and stop sixteen concurrent stores, then pass the cache and S3 collision
checks. The temporary stress workflow is removed after that run. Three deliberate
allocation faults fail the new tests; restored controls pass. The collision probe
waits for its competing listener before binding, including a controlled delayed
listener. The unchanged bounded retry still refuses unknown ports and other exits.

The run-it review also observes two unreserved admin listeners per native store,
even with `-admin.ui=false`. Sixteen concurrent native stores succeed using their
fallback allocation. An admin bind refusal and its effect on startup remain
unproved. Follow-up: reproduce that failure and qualify explicit admin-port
reservations if needed; do not widen the S3 repair's retry to unknown ports.

Remaining: retain the diagnostics to attribute any recurrence of the original
read-only-cache rejection. Do not treat this demonstrated readiness repair as
proof of that historical failure's cause.

## Diagnostic permission test lock observation (D198)

The diagnostic ownership fixture must commit a revocation while its incident
read is paused, then refuse the request with HTTP 403. Its former 100 ms sleep
observed completion of a JavaScript promise, which also includes connection,
commit and callback delays. A controlled Linux run delayed update submission
by 200 ms: the old assertion failed at 100.434 ms before any membership update
was submitted, then the update completed at 203.205 ms. Eight ordinary controls
completed in 2.94–3.17 ms. The historical failure in
[run 40089088819](https://github.com/waitron-io/waitron-cloud/actions/runs/40089088819/job/120857966430)
did not record those stages, so its exact delay remains unknown.

The fixture now applies PostgreSQL's same 100 ms allowance specifically to
lock waits and awaits the successful update and commit before releasing the
incident read. It identifies that read by its actual blocker and checks that
exactly one membership changed. A five-second statement limit bounds other
database execution; the original five-second observation and 30-second test
limits remain. Ordinary and delayed submissions retain the final 403 check.
Production permission code is unchanged. Deliberately retaining the membership
lock or removing the final ownership refusal must still fail these cases.

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

The launcher also retries the exact `502 Bad Gateway` image response recorded
before any remote-conformance case in [D162's cost run
40039426881](https://github.com/waitron-io/waitron-cloud/actions/runs/40039426881/job/120707064606).
Both pinned images use the same existing three-attempt, 120-second acquisition
limits. Controlled launcher checks cover recovery, exhausted gateway responses
and immediate refusal of HTTP 401, 403, 404 and 429. Container creation, image
pins, cancellation and cleanup are unchanged. This handles the observed response;
the cause of Docker Hub's outage remains unknown. Real Docker qualification
continues in CI while local Docker is unavailable.

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

## Account HTTP reset-mail capture

[CI run 39730254198](https://github.com/waitron-io/waitron-cloud/actions/runs/39730254198)
on documentation-only `ea288eafac4bf7e8fafe5592fb3d81f0afecc7bf` passed 180 of 181
account HTTP shard-3 tests. Its signup/recovery journey could not find the reset
message in Mailpit (`packages/account-http/test/account-http.test.ts:50,90`).
The runtime, fixture and workflow paths are unchanged from main `9701cd2`.
The local unmodified shard command below passes all 181 tests, including that
journey. This does not explain the CI failure or prove a fix. Preserve the assertion and deadline.
The journey now records each worker result and SMTP handoff outcome. A missing
message or token adds queue states, attempt and failure counts, delivery codes and
Mailpit status and match counts to its assertion. Only known states and counts
leave the helper; recipients, tokens, message IDs, payloads and raw errors stay out.
`node --test packages/account-http/test/mail-capture.test.ts` forces misses and
checks the four boundaries, redaction, SMTP rejection and unavailable queue reads.
The original assertions, single lookup and deadline remain unchanged. Capture a
recurrence on Linux before deciding whether delivery or capture caused the
historical failure; these diagnostics do not explain it.

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node \
  --test --test-timeout=30000 --test-shard=3/3 'test/*.test.ts'
```

## Portal session test startup

A local full portal run during the receipt-selection work passed 195 of 196
cases, but `test/session.test.ts:59` timed out after three seconds waiting for the
initial signed-in screen. Running that file separately passed both cases. The
portal, backend and database harness sources match the preceding main revision;
that comparison does not explain the failure.
Both session cases now trace navigation and their first signed-in wait with
D134's bounded, redacted request events: endpoint, method, status, elapsed time
and browser-error occurrence. A failure adds an allowlisted heading and fake-clock
time; an unavailable page has a 250 ms diagnostic budget after the original wait.
Tokens, cookies, bodies, unexpected headings and raw errors stay out of the report.
`node --test apps/portal/test/session-startup.test.ts` forces a miss and checks
those boundaries, redaction and preservation of the original timeout. The real
portal fixture also forces a 503 startup miss in `test/session.test.ts` on CI.
Every original assertion and deadline remains unchanged. Capture a diagnostic
recurrence before attributing a cause; these diagnostics do not explain the
historical failure.

## Portal lost-reply test ordering

- **Open: new portal failures after the D132 documentation merge.**
  [CI39967649257](https://github.com/waitron-io/waitron-cloud/actions/runs/39967649257)
  at `4e07a98a9dad1073289a76b086073afc36728191`, job120461847149,
  failed the reused-reset-link message at `apps/portal/test/journey.test.ts:57`,
  the lost-reset-reply callback at line89 (`Request context disposed`), and the
  post-reload translation control at
  `apps/portal/test/translation-consent-browser.test.ts:72`. All27 jobs are final;
  the strict summary also refuses the three failed tests. The same source tree
  passed exact-head CI39966740913; matching bytes do not establish a cause.
  D134 adds bounded browser/server request traces: static endpoint, method,
  status, elapsed time and server connection-pool counts, excluding request bodies,
  cookies and reset links. All 104 real Linux test cases passed across
  [the initial trace run](https://github.com/waitron-io/waitron-cloud/actions/runs/39973004321)
  and [the browser/server trace run](https://github.com/waitron-io/waitron-cloud/actions/runs/39973503708).
  The temporary repeat workflow is removed; normal CI retains these traces.
  That does not explain the historical failures. Capture a diagnostic recurrence,
  reproduce its named stage, then fix the proved cause test-first. Every original
  session, ownership, reset, consent, cleanup and timeout assertion remains.
  No product fix or longer deadline is claimed; local real-fixture reproduction
  stays unavailable while Docker is down. Lane G owns the remaining diagnosis.

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

## Password derivation observation on Linux (D129)

**Open; the historical failure remains unattributed.** Preserve the real derivation
result barrier, password-reset refusal and existing bounds when investigating a
recurrence. Read the [observation requirements and remaining qualification](backlog/password-derivation-observation.md);
use Linux PostgreSQL CI while local Docker is unavailable.

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

PR312 run39944688693 failed the stale-process Linux fixture after both 0.3-second
installer attempts exceeded their deadlines. That run did not capture the stalled
phase. The fixture now records process IDs, elapsed times and each installer or
cleanup step before removing its temporary directory.

A controlled Linux run with eight workers sharing one CPU failed all 32 cases:
installer entry alone took 0.20–0.25 seconds, and the first attempt ended before
its detached child reached the lock checkpoint. With a one-second fixture attempt,
all 32 cases passed their original assertions. The holder became ready in
0.36–0.53 seconds, then cleanup removed it and preserved the unrelated process
and its lock. This proves the setup-budget failure under that workload; the
historical run's exact phase remains unknown.

The fixture budgets two 0.4-second Python starts and a 0.2-second holder handshake.
Its unchanged five-second outer limit covers
`2 × (0.2 + 1.0 + 0.4) + 0.01 + 1.5 = 4.71` seconds: lock wait, attempt and cleanup
for each attempt, retry, then supervisor startup, scheduling and file operations.
The unchanged 15-second Node case also covers fixture and unrelated-child setup,
verification and the final two-second cleanup. All 16 Python assertion conditions,
original Node checks and production download limits remain unchanged.

The bounded Linux diagnostic retains each case's outcome and fails if any case
fails, including when output passes through `tee`. The progress and shell-failure
checks were observed failing before their implementations. Current-head CI and
the required code review still gate landing. Docker remains unavailable locally.

One broader macOS workflow check also exhausted its separate one-second attempts;
subsequent exact-main and feature single-case checks passed. Its cause remains
unattributed. If it recurs, capture its process and step timings before changing
that separate fixture's bound; this change claims no macOS supervisor fix.

## Cost conformance image acquisition (D137)

A Docker Hub token request timed out while D135's stack group 2/3 was pulling
`node:26.11.1-slim` (cost run 39977546909, job 120496895328). Both archives
verified and the fixture image built before the refusal; 206 cost cases passed
and eight did not start. The network cause remains unknown.

The conformance preparer now checks the local image cache first and retries only
recognised transport failures, with at most three pull attempts. Authentication,
permission, missing-manifest and rate-limit refusals stop immediately, even when
the same message also contains a transport error. An unavailable Docker daemon
stops at inspection. Container creation and image builds are not retried.

Inspection, all pulls and both retry pauses share the existing 300-second image
acquisition budget: inspect time + pull times + 1 second + 2 seconds must fit
inside 300 seconds; each command receives only the remaining time. Retries are
not started when their pause cannot fit, interruption cancels a pause, and the existing
command supervisor kills a stalled child. Cached images avoid another registry
request. A BuildKit base image is not assumed to exist in Docker's runnable-image
cache; the separate Node runner still uses an explicit cache inspection.
Image pins and all conformance assertions remain unchanged.

Controlled Docker-command tests reproduce the exact recorded refusal and cover
recovery, permanent refusals, exhausted attempts, shared deadlines, cached images,
interruption and owned scratch cleanup. Local Docker qualification remains
unavailable until 3 November; Linux CI must qualify the real image path. D135
must rebase onto this repair and pass every current-head job before landing.

### Installation renewal accepted during owner revocation

PR #316 run `39953541488`, registration shard 5/5, accepted a renewal where
`installations.test.ts` expected a `revoked` refusal. The historical cause remains
unattributed. Forty instrumented Linux cases observed the correct installation wait
and passed. A forced earlier session wait exposed a test-observer defect in four
of four Linux cases: any lock wait could release the competing renewal. The test
now waits for the installation-lock statement blocked by its own held connection.
The regression rejects the earlier session wait, observes the real installation
wait and excludes an idle observer connection. Existing security, venue, service
and audit checks remain unchanged; production locking is unchanged. Linux
qualification passed 40 paired cases (80 checks), caught all three deliberate guard
removals, then passed the restored 14-test file. The temporary diagnostic workflow
is removed after retaining those receipts. A deterministic check for deleting only
the main test's call to its ordering helper remains open; the 40 cases verify the
observed wait with that call present. Local database checks remain unavailable
while Docker is down. No deployed vulnerability or fix for the historical refusal
is established by this evidence.

### Cost conformance setup timeout (D131)

PR #318 cost run `39959775169`, remote-browser job `120435513011`, stopped
before any test after a setup command reached its 300-second limit. Its log
contains no command or phase, so the historical cause remains unknown.
Setup now reports each supervised command's phase, arguments, process ID, elapsed
milliseconds and outcome to standard error. The command limit, checks, public
source revision and process-group cleanup stay unchanged; the environment is
excluded from diagnostics. Controlled timeout and nonzero-exit tests exercise the
real supervisor, retain the original five-minute deadline and verify scratch and
child cleanup. Existing SIGINT and SIGTERM cleanup checks remain intact.

Linux CI passed all seven remote-browser cases. Its trace records source fetch
in 1.8 seconds, installation in 23.6 seconds and browser-image acquisition in
32.8 seconds; no setup command timed out. Expected image-cache misses produce
a failed inspect record followed by a successful pull. Archive downloads now report their phase, public URL, HTTP status, elapsed time
and received bytes, with progress every ten seconds while waiting for headers or
body data. Completion means the file passed its pinned checksum and was written;
extraction retains its separate command trace. The 120-second download limit and
checksum, cancellation and extraction checks stay unchanged. Controlled local HTTP
checks cover success, refusal, damaged bytes, timeout, cancellation and interrupted
bodies. These diagnostics exclude the process environment. Lane D must
investigate a diagnostic recurrence at the named command before claiming a cause
or changing a deadline. This passing run does not explain or repair the historical
timeout. Local Docker-backed qualification remains unavailable while Docker is down.


### Conformance image acquisition during D135 qualification

[Cost run 39977546909, stack group 2/3](https://github.com/waitron-io/waitron-cloud/actions/runs/39977546909/job/120496895328)
on `cb333018c1dabeb3a19a1ba10e156a5423b70214` verified both pinned archives
and built its owned fixture image, then stopped before running a case.
`docker pull node:26.11.1-slim` failed after 15,139 ms while Docker Hub's token
endpoint did not return headers. Its trace names `image-acquisition`; both archive
traces end in checksum-verified completion. The image-acquisition command is
byte-identical to base `6c031499cdb19e038994c89a6725998b49ae608f`; the cause of
the registry timeout remains unknown.

The separate [image-acquisition repair](https://github.com/waitron-io/waitron-cloud/pull/328)
landed at `1174f28cd4e98aa18212d6afca89233d3f8fef43`. Its controlled command
checks cover the recorded transport refusal, bounded retries, terminal refusals
and owned cleanup within one shared budget. Both exact-head and independent
merge workflows passed all 214 conformance cases. This qualifies the handling;
the original registry timeout's network cause remains unknown. D135 retains the
archive diagnostics and requires fresh qualification on top of that repair.


### Litestream conformance transport-close refusal (D141)

[Merge cost run 39987879658, stack group 2/3](https://github.com/waitron-io/waitron-cloud/actions/runs/39987879658/job/120531832768)
failed the storage-lifetime case after 12.4 seconds with only
`Synthetic Litestream phase: transport-close`. The original error was discarded;
cleanup could replace it with another generic failure. The historical cause is
unknown. A later passing run does not explain that refusal.

Each replication, restore and cleanup transport or metering-proxy close now
reports its stage and started, fulfilled or rejected outcome. A rejected transport
also reports its first refusal category and remaining request/connection counts;
known network codes are retained. Error messages, paths, headers, object names,
credentials and unknown fields are excluded. The original rejection still fails
the close, and repeated cleanup reports the same refusal. Counters are sampled
after socket shutdown; they do not prove that a request was stuck. Controlled HTTP
tests cover invalid audit headers, malformed HTTP, refused connections, an
interrupted upstream response, an unfinished transfer and rejected lifetime or
byte accounting. The network cause is retained before a lifetime tracker refuses
the interrupted transfer. Reporting failures cannot prevent cleanup or replace
its outcome. The smoke script's main and cleanup wiring is exercised with external
workload dependencies replaced at module boundaries. All existing storage,
inventory and accounting checks and deadlines remain in place. Local Docker-backed
qualification is unavailable while Docker is down. Use GitHub CI for Linux
qualification; investigate a diagnostic recurrence before claiming or changing
the cause.

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

[Cost run 40015106057, job 120625121669](https://github.com/waitron-io/waitron-cloud/actions/runs/40015106057/job/120625121669)
refused the Litestream storage-lifetime case at replication transport close with
`transfer-interrupted`, after 21 completed attempts and no remaining requests or
connections. Later PR377 reported `response-pipeline` during a `put`. Those final
counts do not identify the earlier failed I/O event. The transport retains the
first event category, known network code and operation category through cleanup.
Paths, headers, object names and unknown diagnostic fields stay private.

The earlier smoke change waited for active transfers before stopping
Litestream. A restore can see a committed object while the writer still awaits
its PUT reply; stopping at that point cancels the pending exchange. Two controlled
[Linux observations](https://github.com/waitron-io/waitron-cloud/actions/runs/40075195985)
delayed successful replies after the real storage commit and failed with
`active-close` at transport close. Both [fixed observations](https://github.com/waitron-io/waitron-cloud/actions/runs/40075626914)
pass with the same delay and unchanged assertions and deadlines. A native real-HTTP
probe also reproduces the historical `response-pipeline` / `put` diagnostic when
the client exits before its committed reply arrives. That reproduction proves a
possible cause; the old logs cannot establish the cause of every historical event.

A Docker-free regression runs the actual smoke and transport with a real HTTP
writer child. The current checks require a validated runtime stop before signalling, then
writer exit and passive transfer settlement before final restore. Invalid replies,
early exit and silent storage refuse within the same two-second stop budget.
Cleanup sends its signal only once; the force-stop limit remains unchanged. The native harness owns a separate process
group and collects it even when its outer deadline fires.
A separate pinned-Litestream case delays committed PUT replies and checks the
original restore, integrity, fiscal, request, byte, version-history and cleanup
invariants. Every earlier test assertion and deadline remains unchanged. Existing
interrupted-I/O checks still require accounting refusal. Local Docker-backed
qualification is unavailable until Docker returns; GitHub CI supplies the genuine
Linux checks. Reproduce any new diagnostic recurrence before changing transport,
accounting or cleanup behavior.

[PR394's cost run 40099523703, job 120888687281](https://github.com/waitron-io/waitron-cloud/actions/runs/40099523703/job/120888687281)
failed `genuinePinnedLitestreamDrainsCommittedPutRepliesBeforeShutdown` with
`response-pipeline` during a `list`, after 22 completed attempts. A native real-HTTP
probe reproduces that event when the client closes before upstream response
headers arrive. Node's `ERR_STREAM_UNABLE_TO_PIPE` is now retained as a closed
error category. Transfer-failure diagnostics also record whether the client was
closed, whether response headers had arrived, and the number of idle actions
started before request admission. That count distinguishes a request before
the smoke's stop action from one admitted after it; it does not
freeze the writer or establish the historical cause. Interrupted accounting
still refuses. Controlled cancellation with no idle action and inside immediate
or queued idle actions exercises the actual transport. Each case checks the
original refusal and privacy boundary. Upstream resets before and after headers
also check that the client and response state can be false.

The four bounded Linux jobs in [run 40101340028](https://github.com/waitron-io/waitron-cloud/actions/runs/40101340028)
ran 27 genuine delayed-reply cases: 25 passed and two refused. Both refusals
record `ERR_STREAM_UNABLE_TO_PIPE`, `list`, a closed client, response headers,
and idle-action counts of one at admission and interruption. The final
diagnostic keeps the admission count; the interruption count was redundant.
This establishes late admission during the smoke's stop action for those two observations;
it does not identify which native goroutine issued the request or attribute
every historical failure. The temporary observation workflow is removed after
saving all four jobs and their exact checkouts.

A separate macOS counterexample uses the official Litestream 0.5.17 arm64
release, archive SHA-256
`e211f68ff7658d19f193f2914417afdf8f89a053ff8f263e5d6b3b1d3bbc7b08`.
A loopback relay holds the native writer's first metadata list before the
measuring transport admits it. The transport reports idle; its stop callback
releases that request and sends SIGTERM. After the native process exits with
code zero, the transport records `response-pipeline`, `list`,
`ERR_STREAM_UNABLE_TO_PIPE`, a closed client, response headers and admission
count one. The audit correctly refuses the interrupted exchange. Releasing
and completing the held request before stopping passes the paired control.
An initial upload without the relay delay also passes its stop control.

This experiment uses a generated SQLite database and a controlled storage
response. It does not run the Waitron workload, restore or Linux container,
and it does not establish the historical cause. It proves that a native
request issued before the callback can be admitted after it starts. You cannot
use the admission count to infer when the native process issued the request,
or treat an idle transport and exit code zero as a completed drain.

A separate probe uses the same native release's local control socket. With
its first metadata list held at the relay, `POST /stop` returns
HTTP 200, `status: stopped` and transaction ID zero before that reply finishes.
The request is still open when the confirmation arrives. Releasing and finishing
that reply before calling stop passes the paired ordering control. This initial
metadata probe does not run the sale/restore workload or prove what happens to
every later request. It rules out treating the runtime stop confirmation alone
as a complete request drain. Cleanup terminates the owned process after the
observation; cancellation during cleanup is not evidence of cancellation by stop.

A further native probe identifies the held initial list in the snapshot-retention
background task. After the stop reply, the private native stack contains
`Store.monitorCompactionLevel`, `Store.EnforceSnapshotRetention`,
`DB.EnforceSnapshotRetention` and AWS `ListObjectsV2`. Releasing that reply can
lead to another list while the database is stopped. This identifies the controlled
macOS task; it does not identify the historical Linux request. Waiting until just
one active stack frame disappears also fails to establish that all background
work has finished. Native stack dumps remain local diagnostic evidence.

The owner decided against a custom Litestream binary on 25 October. Keep the
official 0.5.17 release and its pins. The revised [after-stop accounting design](superpowers/specs/2026-10-24-litestream-native-drain-design.md)
and [implementation plan](superpowers/plans/2026-10-24-litestream-native-drain.md)
replace the unbuilt native extension with a small, separately counted shutdown
allowance. Its first implementation step adds the optional session ledger and
real HTTP boundary tests. The audit, first transport and independent storage
counter share attempt identities, preserve each counter's actual bytes, and
count at most three distinct affected attempts across admissions and settlements.
The exact post-acknowledgement list interruption can settle each storage reader's
pending token; its response stays incomplete and its billing unknown. The three
readers also retain one already-admitted upload completion when a real backend
success acknowledges its complete body and, for versioned storage, its exact
version. Both hops must precede acknowledgement. A lost client reply stays a
transport error in the counters; only storage history uses the commit witness.
Native HTTP tests preserve storage time bounds and refuse uncommitted, partial,
retried or second late uploads, missing versions and mismatched inventories.
An inventory mismatch invalidates the shared session. Ordinary callers stay strict.
The smoke now shares this ledger and records commit evidence from the actual
backend response. It validates the official Unix stop reply before signalling,
requires writer exit and passive idle within one two-second budget, then runs its
single final-restore loop. Restore uses a strict read-only view of the same
storage history. Failures record active counts and completed outcomes before
cleanup. Closed output preserves the two counters and labels any nonempty
allowance with the possible request-cost shortfall.

Native HTTP controls cover invalid acknowledgement, early exit, shared deadlines,
failed backend commits and post-stop missing sales. The official macOS 0.5.17
binary also restores both synthetic SQLite rows from final storage and verifies
unversioned inventories. That probe substitutes the venue and fiscal adapter;
it does not qualify the real fiscal workload. All six genuine smoke consumers now
check the separate ledger, preserve incomplete billing and display its cost caveat.
An official-binary held-list control retains a real interrupted response and the
two different byte observations. Its startup barrier requires an actual completed
upload before stop, while the controlled retention list stays held. The toy store
returns the uploads it acknowledges; the control also asserts the real upload
bytes. Deleting the startup barrier fails the native readiness assertion. The delayed-PUT probe exposed initial readiness
accepting storage visibility before the upload reply; the existing 40-poll loop
now also requires that initial transfer to settle before the second sale. Linux
qualification then exposed an idle gap during SDK retry backoff: a different
object was visible, but the injected failed upload had not retried. The same
40-poll readiness loop now also requires a successful backend acknowledgement
for that upload's first retry. The existing native retry assertion is retained;
a deterministic idle-backoff regression fails before this guard and passes with
it. The 1,500 ms delayed replies restore both synthetic rows with integrity intact.
No stop deadline, cap, official pin or pre-acknowledgement refusal is relaxed.
Native checks cover three/four-attempt boundaries with real HTTP requests; the
official held-list control observes one affected attempt and does not claim that
four official attempts occurred. Whole-branch review found no blocking defect;
the existing retry-output test also catches deletion of its guard when included
in the review matrix. A separate native child-process check now holds the stop
reply open in the parent while the writer exits. It requires the pending control
request to be cancelled before the next event-loop turn and refusal at the control
step, with the request fully received and no cleanup signal sent to the writer.
Removing the writer-exit race fails this check while the original early-exit
case still passes; restoring it passes. Native HTTP boundary checks now independently
replace the request and backend reply completeness observations with false after
full delivery. Both cases refuse certification despite matching bytes and a 200
reply. Removing either observation from the smoke's commit witness fails only its
new check; the five original commit tests still pass. These controlled observations
prove witness wiring, not actual truncated-stream handling. Separate native HTTP
controls now test the writer-running check at acknowledgement. A controlled close
notification is delivered in the complete, valid reply's end event, before the
smoke's response-end handler. The real allowance ledger must retain its pre-acknowledgement new-upload permission, and
the smoke must refuse before restore without signalling that already-closed writer.
The paired running-writer control accepts stop and completes its synthetic restore.
Removing only the response-end writer check fails the new closed-writer case while
all original shutdown checks still pass; restoring it passes both new cases.
These controls substitute the writer, venue and storage. They qualify this guard's
wiring, not operating-system exit timing or production shutdown.
A separate native HTTP case now closes the stand-in writer while one transport
reply remains pending. The smoke must wait for that reply before admitting final
restore; the completed-reply control starts restore without pending transfers.
Both cases retain all three upload attempts and exact request/response-byte
accounting. The held case observes entry into the real idle wait with one transfer
pending, so a fixed sleep cannot replace it. Each subprocess exits after fixture
cleanup with zero transport connections. Removing only the smoke's passive idle wait exposes early
restore in the new held-reply case. This qualifies forwarding order with a
controlled close notification, not actual writer-process exit or production timing.
A separate generated Node writer now owns the actual upload socket and exits after
valid stop acknowledgement. With one of four reply bytes received, the smoke refuses
at the idle step, starts no restore and publishes no measurement. Its paired
complete-reply control reconciles all three attempts and exact bytes before the
stand-in restore. Both checks collect the writer and transport connections.
Removing or not awaiting the passive idle wait exposes early restore in the held
case while the complete control passes. This qualifies generated-process exit
with real HTTP forwarding; official Litestream, production shutdown and historical
Linux timing remain unqualified.
Genuine Linux/SeaweedFS and PostgreSQL qualification run in current-head CI before
landing. Historical attribution remains open.

[PR428's cost run 40144823848, job 121023853072](https://github.com/waitron-io/waitron-cloud/actions/runs/40144823848/job/121023853072)
refuses during `stop`; cleanup records `active-close` after 21 completed attempts.
This is an unfinished-transfer refusal, not an excess-count check. Pending zero
is measured after destructive cleanup. The log does not establish which stop
outcome fired, or prove a native caller or historical cause. The earlier list
interruptions during the stop callback remain distinct evidence.

The after-stop allowance shipped in [PR #437](https://github.com/waitron-io/waitron-cloud/pull/437)
at `a6aff300882ca1d03fc2465654793025226f76af`. Its
[head CI](https://github.com/waitron-io/waitron-cloud/actions/runs/40160047703),
[head cost checks](https://github.com/waitron-io/waitron-cloud/actions/runs/40160047686),
[independent merge CI](https://github.com/waitron-io/waitron-cloud/actions/runs/40160687579)
and [merge cost checks](https://github.com/waitron-io/waitron-cloud/actions/runs/40160687574)
passed, including all six genuine smoke cases and the held-list control. Each
head/merge pair recorded 10,167 passing tests and the same 19 optional skips.
These runs qualify that delivery; they do not attribute every historical refusal.
A native HTTP control now truncates an actual successful upload reply after one
of its four declared bytes. The unchanged smoke handles the interruption at stop
and publishes no measurement. Its paired complete-reply control reports both
synthetic sales through its stand-in restore and reconciles all four response bytes at both hops. Removing
only backend-response error forwarding leaves the truncated case waiting until
its existing subprocess deadline, while the seven original commit checks and the
complete-reply control pass; restoring it passes all nine. Original assertion
bodies and runtime bytes are unchanged. The writer, venue, SDK administration and
SQLite reader remain substitutes, so official-binary and production truncated-stream
handling still need qualification.

A paired native HTTP check now sends one of four declared upload bytes, then
closes the writer's request after stop acknowledgement. The smoke records a
client-error refusal at the stop's idle step, publishes no measurement and never
invokes restore. The actual request at the writer-facing replication proxy is
incomplete; cleanup collects all transports and proxies before the subprocess
exits. The case catches broken request-error settlement and socket collection;
it does not prove that the idle wait blocks while a transfer is active. Its complete four-byte
control reconciles both counters and completes the stand-in restore. These checks
use the existing generated writer and substitute venue, SDK administration and
SQLite reader. They qualify actual HTTP truncation through the smoke; official
Litestream, production shutdown and historical attribution remain open. Every
original assertion and runtime file is unchanged.

A generic `active-close` still refuses measurement publication. Preserve the official pin,
three-attempt cap, ordinary accounting, restore and deadline checks in any repair;
local Docker qualification remains unavailable until 3 November.


### Broken-pipe shutdown investigation (D270)

The [main cost run 40216346521](https://github.com/waitron-io/waitron-cloud/actions/runs/40216346521/job/121238245625)
refused the original request-log smoke at the stop's idle step with `client-error`
and `EPIPE`, a broken pipe. All 25 attempts had left the transport, but one
accounting attempt remained unsettled. D268 changes the delayed-PUT fixture;
it does not cover this server-level socket error.

For a network error, the transport now records the failing socket's sole
forwarding operation, observed and expected body bytes, response-header state
and the idle-action count at admission. Its `forwardingTransfers` count covers
fully validated requests; `pending` also includes bodies still being checked.
Parser errors name no operation, pipelined requests remain ambiguous, and
completed requests supply no stale context. Native HTTP controls inject a
socket error while retaining real parsing, counters and refusal. A separate native
loopback probe reproduces actual `EPIPE` by closing the caller while a large list
reply starts. This demonstrates one mechanism; the historical official-binary
failure still needs a labelled recurrence before attribution. All 80 genuine
Linux request-log trials in [run 40218943112](https://github.com/waitron-io/waitron-cloud/actions/runs/40218943112) pass. All broken pipes
continue to refuse measurement. Preserve the existing after-stop signature,
three-attempt cap, official 0.5.17 pin, restore assertions and deadlines.


### Delayed PUT shutdown investigation (D268)

The delayed-PUT case failed on three of the 103 cost-workflow runs started on
25 October through the initial D268 audit. All three failures were on PRs;
40 main runs included four other failures. D266 changes tests and backlog only,
so it does not repair this runtime refusal. An [instrumented CI run](https://github.com/waitron-io/waitron-cloud/actions/runs/40210305167/job/121219914473) then reproduced
one failure in 80 trials: control acknowledged at 1,517 ms and the writer exited at
1,520 ms, but a complete PUT had started only 612 ms before the 2,001 ms cutoff.
Its injected 1,500 ms reply hold could not finish within that stop budget.

The delayed-reply fixture now waits for a successful backend PUT admitted after
the final sale completes before asking the writer to stop, while that reply
remains held. Admission is captured when the proxy receives the request, so an
earlier PUT with a later reply cannot release readiness. Every
successful PUT reply still waits 1,500 ms. The shared two-second stop budget,
accounting guards and all original assertions remain. Native checks refuse
requests admitted before sale completion, failed PUTs and unrelated operations
as readiness evidence. The bounded wait reports its own readiness phase on failure.
Stop refusals also include control/exit timings and active transfer progress,
using operation names and byte counts without paths, credentials or invocation IDs.
The two-row restore and full accounting checks still decide whether a run passes.
This fixture sequencing correction does not attribute the separate historical list
interruptions or qualify production shutdown.

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

## Recovery screen scope and supplied choices (D158)

When you return from Account, recovery now clears a backup selection that is not
one of its offered test venues. Its panel and approval controls independently
check the same offered choices. Changing organisation, losing permission or
removing the venue clears the selected source and both confirmations. Account
can still show production backup metadata.

Recovery's organisation and venue selectors, Account's organisation selector and
pairing's business selector now select their options after those options exist.
The supplied choice, displayed choice and subsequent request agree in the
browser checks. Recovery waits for an installation refresh before changing the
organisation. The pairing regression uses a supplied second business; no normal
journey that preselects that business was established.

The real-server reproduction showed a production backup panel on return. With
continuous data, Approve sent that unoffered venue ID, but the server refused it
with HTTP 403 and stored no recovery row. Snapshot approval stayed hidden because
the production environment invalidated its qualification. Direct Account API
approval was also refused for both sources. Permitted test-venue controls sent
and stored their exact snapshot or continuous source. Capture provisioning and
recovery retain the existing test-only server guard. These are synthetic retained
metadata fixtures, not evidence of production backup provisioning. PostgreSQL
checks run in GitHub CI while Docker is down locally.

## Cost-stack isolation command refusal (D152)

The earlier native-batch case refused during isolation, with command exit 1 after
1,043 milliseconds. An instrumented recurrence in [D163's exact-merge cost run
40041135283, job 120712388129](https://github.com/waitron-io/waitron-cloud/actions/runs/40041135283/job/120712388129)
refused the Litestream body-byte case before its workload: `outbound-canary`,
exit 1 after 2,924 milliseconds, stderr category `container-state`. That category
covers both a missing container and one that is not running. Neither record
identifies the affected service or explains why its state changed.

A failed outbound command now inspects its previously validated container ID
before cleanup. The report retains only the service role, a known state, running,
exit code, out-of-memory, dead and restarting flags. Missing containers and
unavailable or timed-out inspection have explicit categories. The extra read is
limited to 1.5 seconds and 8 KiB; an inspection failure preserves the original
refusal and owned cleanup. Raw errors, identifiers, paths and unknown fields
stay private. Controlled Docker-free checks exercise these boundaries. A Linux
case deliberately stops this invocation's storage service before its isolation
command and checks both refusal and cleanup. Independent Linux observations
also exercised the original eight-case group: [run 40042726726](https://github.com/waitron-io/waitron-cloud/actions/runs/40042726726)
passed the new control and all eight original cases on each of four runners,
36 checks in total, without a historical recurrence. The temporary investigation
workflow is removed; the new control remains in ordinary conformance CI. A second
Linux check exits the child abruptly after stopping its storage service. The
parent's fallback requires recorded creation IDs plus fresh owner, project and
name checks before removing a resource; matching labels alone cannot authorise
removal. Native controls cover foreign identity and ownership refusals.

A later instrumented recurrence in [PR362 cost run 40054514898, job
120754852118](https://github.com/waitron-io/waitron-cloud/actions/runs/40054514898/job/120754852118)
identifies the gateway: exited with code 1, without an out-of-memory kill, dead
state or restart. Its binary output was discarded, so this does not explain
why HAProxy stopped. The generated gateway now retains a private failure record
before exiting. Only fixed categories for name resolution, socket binding,
certificate loading, child exit, signal or process creation are retained, with
bounded exit metadata. Raw output stays private and only its first 8 KiB are
inspected. Failure output drains for at most 250 milliseconds after the master
exits; an orderly stop does not wait for descendants holding stderr open.
Synchronous and asynchronous process-creation failures retain the same fixed
categories. The parent reads at most 1,025 bytes of a private regular file before
cleanup, validates every field and rejects unknown fields or values. Missing
or invalid evidence preserves the original refusal. Real child-process checks
cover the categories, split output, large output, signal and spawn failures;
a Linux control forces a real HAProxy name-resolution failure and checks that
the parent retains its category and removes the owned resources. This
controlled failure does not establish the historical recurrence's cause.

A new instrumented recurrence in [PR369 cost run 40062864377, job
120780089952](https://github.com/waitron-io/waitron-cloud/actions/runs/40062864377/job/120780089952)
identifies a HAProxy name-resolution failure: gateway exit 1 during the outbound
check, after 1,754 milliseconds, without an out-of-memory kill or restart.
A controlled Linux regression starts the generated gateway first through its
real Compose plan. Without a backend dependency, HAProxy exits with the same
name-resolution category. The generated gateway now depends on the Waitron
service reaching its started state, so its backend joins the private network
before HAProxy resolves `waitron:8080`. The regression then requires all six
services to become ready, all isolation checks and owned cleanup. This fixes
the reproduced ordering defect; attributing the earlier intermittent event to
that order remains an inference. The separate replication interruption remains
open.

The strict 4.01-second streamed-day control covers setup as well as later
phases. A slow setup can consume that budget before idle begins, as observed
in [run 40064831558](https://github.com/waitron-io/waitron-cloud/actions/runs/40064831558).
Following the owner's 24 October decision, this control requires refusal after
the original deadline in whichever phase it reaches, unchanged source data,
removed private state and collection of every child actually started. It also
checks that each recorded child has exited. A separate native control enters
idle before firing the unchanged deadline callback; real HTTP, SQLite and
child processes must be collected before another caller operation. An opening
control fires that same deadline while storage setup is held. Removing the
deadline makes both native controls fail; restoration passes. Only the deadline
clock is controlled in these native cases; the full Linux streamed-day journey
keeps its real clock. All runtime timers, budgets and isolation checks remain.
Local Docker-backed checks are unavailable while Docker is down; GitHub CI
supplies that evidence.

## Public browser and network qualification

Qualify the public browser check against the supported browsers and production
networks before public exposure. Local HTTP, script and Chromium checks do not
discharge that deployment gate.

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

The provisioning check in [run 40120697007](https://github.com/waitron-io/waitron-cloud/actions/runs/40120697007)
aborted after 14.7 seconds without naming its operation. Its log cannot establish
whether setup, provisioning, writing or reading timed out. The unchanged native
macOS authority suite passes all four cases; the historical Linux cause remains
unknown.

The delayed-reload test now prints a fixed operation label when startup, authority
opening, bucket creation, provisioning, identity reload, writing or reading fails.
The labels contain no credentials, venue identifiers, storage locations or error
values. Reporting preserves the original rejection, including when output fails.
Four controlled SDK aborts run the real test against the native store and prove
that bucket creation, provisioning, writing and reading keep their own labels.
The original assertions, both identity checks, cleanup and every deadline remain
unchanged; the authority and storage fixture source are untouched.

Keep the label and original error at the next genuine Linux recurrence, then
reproduce and repair that operation's cause. A passing controlled abort or native
run does not close the historical timeout. Local Docker and PostgreSQL checks
remain unavailable until 3 November; full qualification uses GitHub CI. D152's
separate native-writer drain decision remains open.

## Authenticator code format feedback (D237)

Malformed authenticator codes now stay in their field with an explanation, before
any request. App codes require six digits; recovery proofs accept 32 hexadecimal
characters or four groups of eight. The portal still removes whitespace and keeps
recovery hyphens. New-app confirmation accepts only its six-digit app code.
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

## Password-change notification recovery link (D261)

Your password-changed email now links to the password-reset request page in
English or Spanish. Older queued messages without a language link to the English
page. The notification contains no reset token; you request a fresh reset there.
`node --test packages/registration/test/account-mail.test.ts` covers a public and a local
origin, both languages, legacy messages and unchanged subjects. Live provider
delivery remains part of the first working milestone's production qualification.

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
  while still holding the reply. A missing handler signal still reaches the existing
  120-second runner timeout; concurrent background list reads remain unqualified.
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
  in CI. Permission checks and transaction boundaries remain unchanged. Shared
  backup/installation reads on recovery/fiscal pages inherit the wording; their
  request-specific guidance stays in R3/R6/R7. Pairing keeps its existing guidance.
  Shared remote plan/setup refusals and revoked installations still need their own
  explanations. Membership changes need a real product path and remain open.
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
- R9 visitor guidance delivered: the public availability page uses neutral English
  and Spanish wording without promising a quick recovery. Its existing retry link
  can show another refusal or a recovered response. Native HTTPS checks cover
  persistent 403/404/503 replies and dropped connections, then recovery, while
  preserving private upstream details. Cause-specific diagnostics for owners in
  Account remain open. The [private forwarding-cause plan](superpowers/plans/2026-10-26-private-forwarding-causes.md)
  proposes bounded private recording; owner plan approval and separate build
  authority remain required. Visitor guidance does not diagnose or repair the cause.
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
  With JavaScript disabled, the original waiting line remains above the static
  guidance; simplifying that presentation stays open. Actual visitor browser
  support and production timing remain unqualified.
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

## Cost-mail reconciliation refusal observed during D262

[PR #467's cost job](https://github.com/waitron-io/waitron-cloud/actions/runs/40201247616/job/121192744128)
fails `genuineEmailQueueRetryAndBilingualMailpitDeliveryReconcileWithoutRawExport`
at the measurement close check in `scripts/cloud-cost/mail.mjs`, called from
fixture line 65. The original generic error cannot distinguish invalid state
from disagreement between the mailer and the independently observed SMTP replies.
The following signup/recovery mail case passes. The cause remains unknown;
D262's heading fix is merged in [PR #467](https://github.com/waitron-io/waitron-cloud/pull/467).

Close errors now retain the first fixed failure label, the invalid-state flag
and both count sets. You can distinguish an empty run, delivery disagreement,
malformed SMTP, timeout, cancellation and closing during delivery without
exporting message bodies, addresses, delivery IDs or raw transport errors.
Native tests reproduce these diagnostic paths with generated SMTP traffic and
prove later cleanup preserves the first failure. They do not identify the
historical refusal. Three inspected failed main runs have passing mail jobs.

Cloud follow-up: use a labelled recurrence to reproduce and fix the demonstrated
cause, test-first. Keep measurement guards, accounting and deadlines intact.
Do not rerun an unchanged red branch.
Real PostgreSQL/Mailpit reproduction waits for local Docker or a separately
qualified CI diagnostic change. This is separate from reset-mail capture and
Mailpit fixture-startup failures recorded above.

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
