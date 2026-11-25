# Waitron Cloud backlog

## Disposable test slots and repository runners (D592)

The server controller on NEW owns the only ledger; the two-host pool is NEW and BENCH
(A1479), and the Mac controller is off. OLD's CI startup is disabled; it stays available
for periodic benchmarks and practice, not as a quota fallback. The owner-approved
[design](superpowers/specs/2026-11-06-disposable-test-server-design.md) and
[plan](superpowers/plans/2026-11-06-disposable-test-server.md) govern the bridge work; the
[controller guide](../deploy/disposable-tests/README.md) owns behaviour, timing and limits.
Keep contributor approval and the accepted public-repository limits. D591's selection work
stays separate.

**Open:**

- For a replacement release, qualify a full busy hour below about 4,000 used requests in
  each returned quota series, and confirm automatic zero-capacity publication if it crosses
  that threshold. The App quota ran out again on 12 November; the later lower counts come
  from different workloads and prove no saving.
- Qualify the hosted-routing publication window on the next matched release, including
  draining existing server-labelled work, native qualification and restoring the saved mode.
- Qualify dashboard shards 5–6 (Waitron A1398-2), changed guest dependencies with the
  affected job commands before restoring their routing caps, and full browser coverage:
  the ten-slot trial exhausted guest memory. Keep the larger guest profile until smaller
  guests finish coverage without out-of-memory kills.
- Record the first server assignment for each enabled job family, then hourly
  server-versus-hosted jobs, server-caused failures and host memory and load for
  [automatic pickup](../deploy/disposable-tests/README.md#pick-up-ordinary-pr-jobs-automatically).
  Cancelled jobs without assignment and hosted retries must not establish server health,
  and an API-monitor failure is not a measure of a guest's speed.
- Natural pickup after A1472's rereads and A1440's smaller pages, and sustained operation,
  remain to be measured. The old fallback's exact failed status field is unproved.
- A run omitted from GitHub's status lists and older than the newest 100 can still be
  missed, so the campaign's SERVER STUCK alarm stays. The watcher owns connecting A1456's
  status command to it.
- Physical Mac sleep is watcher-deferred to a coordinated window. Guest-tools adoption, the
  coordinated Waitron workflow, first-day queue measurements, the first ordinary Cloud
  typecheck with hosted fallback, frozen transitive guest packages and permanent-host
  reproduction remain open.

### CI self-recovery (A1473)

The controller is installed, with quota holds, one delayed registration-5xx retry,
obsolete-PR cancellation and forward overflow; the
[forward-overflow plan](superpowers/plans/2026-11-10-a1473-forward-overflow.md) records
the rules and their measurement prerequisite. One owned overflow drill ran on 13 November;
it qualifies no product test or speed.

**Open:** natural outcomes for registration failure, a live rate limit (the six recorded
403s have no headers), the busy-runner retry, obsolete-PR cancellation, marker retirement
and stale queued runs, and an owned stuck cancel. The watcher held new code for the
five-minute untaken-job rule (13 November 07:02) until a real case is measured; reverse
movement waits for one too. Main pushes, schedules and manual runs still need hand moves.

## Keep the private shared UI release current (D579)

For future UI releases, verify the published source, review actual Cloud consumers,
approve the immutable archive and publish matching test-host support before adoption.
Both consumers must install the same release and pass authenticated CI. Follow the
[release guide](shared-ui-release.md); source/archive review and host publication
remain human work.

## Shared storage-test seed downloads (D585)

Native startup, test seed hooks, conformance and the image build share bounded
acquisition. **Open:** qualify full application image preparation.
See [the acquisition and cancellation record](backlog/storage-cache-fixture.md#every-seaweedfs-archive-fetch-and-a-controlled-copy-proposal-d530-4).

## Admin listener shutdown and paced replay (D581)

**Open; the historical causes are unknown.** The exhaustion fixture's listener shutdown is
repaired ([limits](backlog/storage-cache-fixture.md#admin-owner-probe-draining-d581)).
Replay shutdown now half-closes used storage sockets and waits for their peers inside the
existing two-second budget, which repairs one measured ordering and explains none of the
older CI traces. A request reusing a half-closed socket, the native LIST investigation and
requests starting after the final drain remain open.

Controlled official Litestream runs (0.5.17, and 0.5.18 in one comparison) show a
snapshot-retention task still listing storage after a confirmed database stop, so a
passive idle wait is not completion and a later LIST can be cancelled. Completing that
retention sequence before stop passes as an ordering control only; waiting for the whole
turn after stop reaches the three-request guard. Next: reproduce this boundary in the real
smoke without treating a briefly idle transport as finished maintenance. The smoke's final
sale and concurrent maintenance still need qualification. Do not copy replay's socket
retirement into the smoke: all three native trials refuse at retry-sequence validation.

Keep every acceptance guard, the two-second stop budget and the pins (cost experiments stay
on 0.5.17). Real bucket-control billing stays unknown and cannot qualify because two
transfer counters agree; generated archive and stream runs finish without a new measured
receipt for that reason. Keep the assertion on PR1050's byte discrepancy of 742 instead of
-1 until the synthetic proof captures its exact cause. Controls:
`node --test scripts/cloud-cost/litestream-idle-retirement.test.mjs
scripts/cloud-cost/replay-stream.test.mjs scripts/cloud-cost/checkpoint-socket-diagnostics.test.mjs`.

## Cloud backup box identity (D451)

Current-Waitron runtime compatibility, production time sources, published-image
qualification and deployment remain unqualified. The [existing joint and paired proofs](test-cloud.md#backup-verifier-boundary)
record historical local verification and separately authorised recovery; they do not
exercise a module's `needs_authority` outcome. The [legacy local runner](local-backups.md#run-the-proof)
still reaches ordinary fiscal restore's deliberate refusal without allocation authority.
That refusal is not missing D79 verification work. Keep snapshots unavailable and
deployment enforcement off until the remaining integration and release gates pass.

## Retrospective review qualification (D535)

On 7 November 2026, reviews reached #417 and stopped after ten consecutive reviews
found no real product defect, leaving twenty source pull requests and 147 test or
maintenance pull requests unreviewed; receipts are in
`~/waitron-campaign-j/receipts/d535/`, and
[the qualification limits remain recorded](backlog/retrospective-reviews.md).

## Worker shutdown during polling and error reporting (D459)

**Open.** Qualify the deployed account mail worker's stop allowance during a
database claim and a silent handoff. In one loopback run, the command in
production SMTP mode exited 14.9 seconds after SIGTERM during a handoff.
The 10- and 15-second local allowances apply to different mail paths.
Database failures, cancellation, real relay behavior and explicit pool cleanup
remain open. Real-command checks and the allowance comparison are in
[the worker shutdown detail and remaining limits](backlog/worker-scheduling.md#worker-shutdown-during-polling-and-error-reporting-d459).

## Historical CI observations without a recorded recurrence

Keep D126, D129, D131, D198, D262, D311, D335, D349, D457, D574 and D583,
D152's isolation-command refusal and D507's old cache-upload stall together.
The 31 October to 6 November retained failure-history review found no matching
recurrence; that explains no cause. A new matching failure joins its existing
investigation, with the original assertions, limits and cleanup checks preserved.
Lane J's `receipts/d593/` inventory is no longer on disk, so this table is the record.

| Entry | What was seen | Start from |
| --- | --- | --- |
| D126 | Linux download supervision | [detail](backlog/linux-download-supervision.md) |
| D129 | Password reset during derivation failed before its final checks. A late observer reproduces it and the test now holds the result. | [run 39953541488](https://github.com/waitron-io/waitron-cloud/actions/runs/39953541488) |
| D131, D583 | Conformance setup timeouts; a healthy source fetch retried. #957 repaired the fixture clock; the isolated replay early wake is open. | [detail](backlog/cost-setup-timeout.md) |
| D152 | Isolation canary exit 1 in category `container-state`, and the gateway later exited 1. A name-lookup ordering defect is fixed; linking it to these is an inference. | [run 40041135283](https://github.com/waitron-io/waitron-cloud/actions/runs/40041135283/job/120712388129), [run 40054514898](https://github.com/waitron-io/waitron-cloud/actions/runs/40054514898/job/120754852118), [run 40062864377](https://github.com/waitron-io/waitron-cloud/actions/runs/40062864377/job/120780089952) |
| D198 | Diagnostic revocation slower than 100 ms. Record connection, update, commit and read-release times; keep the lock-wait limit and the final 403. | [run 40089088819](https://github.com/waitron-io/waitron-cloud/actions/runs/40089088819/job/120857966430) |
| D262 | Mail measurement refused at close | [rehearsal refusals](#platform-work-to-scope) |
| D311 | Fixture archive downloads | [detail](backlog/cost-conformance-fixtures.md#fixture-archive-download-retries-d311) |
| D335 | Verifier build | [detail](backlog/verifier-build.md) |
| D349 | Empty generated JSON state. An interrupted write reproduces it and is fixed. | [run 41169033630](https://github.com/waitron-io/waitron-cloud/actions/runs/41169033630/job/124443297790) |
| D457 | Storage extraction across processes; prompt refusal is unproved. | `scripts/ci-backup-storage-process-extraction.test.mjs` |
| D507 | Cache-upload stall | [detail](backlog/ci-cache-saving.md#historical-upload-transport-cause-d507) |
| D574 | Translation startup | [detail](backlog/translation-startup.md) |
| Installation renewal | Renewal accepted during owner revocation. A paused backend reproduces it; the test now queues renewal behind revocation. The historical scheduling is unknown and production locking is unchanged. | runs 39953541488, 40990452819, 41266766013 |

The translation launcher's 20-second startup limit (PR #1173, then an `ETIMEDOUT` in
PR #1282) has no proved cause and no established link to D574;
[the retained evidence](backlog/translation-startup.md) keeps every deadline.

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

- The owner changed the cost rehearsal's acceptance rule on 6 November 2026: functional
  checks still fail, while cost-accounting problems are reported with named gaps in every
  mode. This replaces the proposed retry, uncertain-read cap and maintenance-completion
  gate. Sales, uploads, stop, restore, SQLite and fiscal integrity, cleanup, request caps
  and deadlines remain required. An unknown figure stays unknown, and a run with gaps
  cannot replace a published cost figure.
- The owner rejected a custom Litestream binary on 25 October 2026. Keep the official
  release and its pins ([detail](backlog/cost-stack-replication.md)).
- Every message Cloud sends for a venue uses a fixed Cloud template (owner, 2026-11-08),
  for email and SMS. Callers supply a template name and values; refuse free text and values
  outside the template's allowed type and length. A code is digits; a time is a time.
- A venue's own mail server always sends its email (owner, 2026-11-21). Without one,
  the free scope covers account emails and the five staff notices the owner chose
  on 22 November. The paid scope covers every venue email, from its own domain or
  a Waitron address. The venue decides what to do about bounces. [Detail](backlog/venue-email.md).
- Email resend waits belong to each address and operation (owner, 2026-10-25).
  Correcting an address allows an immediate send; returning to it keeps its wait.
  A server Retry-After still blocks every address for that operation.
  This also means a refusal in another operation cannot transfer or clear that wait.
- Cloud backups are streamed as whole files (owner, 17 November 2026 at 23:16). The trial
  bounds lanes G and J agreed within it are 2 GiB of ciphertext and 4 GiB expanded; linear
  growth reaches the expanded limit at about 15–16 months. The shipped ceiling stays 512 MiB.
- Guests open a venue's shared menu only while it has an active Connected or Hosted trial
  or paid level: “Only with the trial” (owner, 20 November 2026 at 14:13). The menu page
  follows the phone's languages: “we should fix the cloud's menu page to follow the phone
  langs” (owner, 17 November 2026).
- The box registers quietly when you sign in at the start of setup, with no account-only key:
  “I'd like the quiet at the end option, but i think it needs to be earlier, at the start of
  setup, because we need access to address completion and emails during setup” (owner,
  20 November 2026 at 13:11). Remote access still needs a trial or paid level.
- You may remove a venue while its trial or paid period runs. The confirmation says the venue
  is hidden and its connection stopped, but charges continue and Billing still lists it (owner,
  19 November 2026 at 19:23, choosing this over refusing removal).
- Live Google address completion serves “Yes, every registered box”, inside each box's existing
  limit (owner, 21 November 2026 at 10:34). The private launcher still serves one approved box;
  [what is left](backlog/free-services.md).

### CI policy

- The owner closed D69 on 20 October 2026 with "run all when unsure" and accepted
  the wider unresolved-reader fallback. Do not extend the syntax recogniser one
  written form at a time. Precise bindings, generated inputs, directory options,
  parser performance and reading only reached helpers remain optional efficiency
  work; keep the [reader limits](ci-package-readers.md) and conservative fallback.
- The parked `feat/precise-ci-selection` branch remains reference material.
  Rebase it over the six-partition portal allocation before any authorised resumption;
  retain its [design](superpowers/specs/2026-10-14-precise-ci-selection.md) and [plan](superpowers/plans/2026-10-14-precise-ci-selection.md).
- CI owns mandatory package suites (owner, 18 October 2026); run focused checks
  locally and read every exact-head and independent merge job.
- The [nightly full backstop](ci-nightly.md) follows the owner's 4 November decision.
- The owner's target remains at most five minutes per work job and about ten
  minutes per complete run, including setup and queueing; keep the eight-minute
  work-job cap. Passing local checks do not establish hosted duration or savings.
- Pull requests test only the packages they change: “yes, same rule”; “if code in package
  X changes then run the tests for package X ... and then catch anything else in the
  nightlies.” (owner, recorded 9 November 2026). Omitting the audited root suites was
  approved with “9% is significant, I'd build it as long as it doesn't add fragility.”
  (owner, 9 November 2026 at 22:22): uncertainty runs everything, and an advice failure
  runs the original command.

### Service monitoring

Owner decision, 8 November 2026:

No cost alert until a real cost figure exists: the calculator over committed inputs
cannot see a cost change (about 90% of its USD 18.44/month is one fixed server
charge; 100 times the orders moves it 5.7%). Reopen with measured storage and
request counts priced nightly. If it reopens, the owner's earlier rule (8 November 15:03,
as the watcher relayed it) was an alert and email at 10% or more above the last alert,
including slow creep, with the first measurement saved silently.

## Installation deployment qualification

**Open.** Qualify server permissions, local confirmation and live delivery against the
selected deployment.
See [the native installation boundaries](backlog/venue-connection-http.md#installation-deployment-qualification).

## Pairing deployment qualification

**Open.** Qualify the combined continuous-recovery journey through its final source
restart and refresh; preserve its existing checks and keep that service unavailable.
The next slice starts with an isolated restart/refresh diagnostic. Also qualify server
permissions, local confirmation and live delivery against the selected deployment.
See [the native pairing boundaries](backlog/venue-connection-http.md#pairing-deployment-qualification).

## Alert-preference deployment qualification

**Open.** Qualify server authority, deployed browser integration and production mail
delivery.
See [the native alert boundaries](backlog/alert-preference-http.md#alert-preference-deployment-qualification).

## Translation-consent deployment qualification

**Open.** Qualify server authority, deployed browser integration and translation
release checks. See [the remaining consent qualifications](backlog/translation.md#translation-consent-deployment-qualification).

## Current state

Accounts, sign-in and recovery, pairing, remote access, backups with verified restores,
monitoring, email, guest menus, translation, handover and the test-only billing pages are
built and exercised by local or test-Cloud checks only. The portal has Account, Venues, Remote
access and, for eligible accounts, Billing. **No public Cloud service is deployed;** live
providers, senders and public deployment remain open. This file owns Cloud product and
platform work; Waitron's backlog owns the on-prem application and its side of the
integration. Start with the [product discussion](product-and-platform.md); the
[launch evidence boundary](launch-evidence.md) separates local proof from what public
exposure still needs.

**D88 hosting.** The owner requires `.local` for venue devices and public menus, online
bookings and orders, and table-QR ordering with the Cloud step soon after go-live, not
go-live itself. The [hosting design](superpowers/specs/2026-10-21-cloud-hosted-venue-design.md),
[conditional outline](superpowers/plans/2026-10-21-cloud-hosted-venue-design.md) and the
[public access/A951 contract](waitron-integration-contract.md#public-access-and-a951-proposed)
record the scope. D88's duplicate design-approval gate is closed: the approved production
design settles per-venue gVisor runtimes on shared machines, country cells, cold recovery,
Spain/Paris, per-action automation, per-cell releases and quiet-hour moves. The owner's
24 October decisions put accounts, sign-in and recovery in-country with one owner per
customer per country, no invitations or manager accounts. D112-S's 16 November direction
keeps countries independent, including billing and customer email; worldwide is limited to
a small admin passkey console for health and deploy starts plus the apex/Spain redirect,
with no country customer data or operator authority. A future owner transfer must be
country-scoped verified transfer or recovery, without a second owner or automatic support
takeover. P6/D115 owns delivery with P1/P4/P7, D608's owner checks, A951 and D101.
Reliability promises and pricing await measurements at launch. A1018's design, examples
and defaults are approved at Waitron `060966c2b3e9203acf0849042814997307cae463`; exact
formats, compatible A947 amendments, separate A1018 build authority and runtime proof
remain open.

**A951 tunnel.** Waitron owns the lasting tunnel and certificate client; its accepted
implementation and landing pin remain required. The owner parked the earlier D582 protocol
work on 6 November; its [Cloud build plan](superpowers/plans/2026-11-05-a951-cloud-tunnel.md)
and the contract's D123, D130, D132, D136 and D560 responses keep their scopes and
acceptance limits (complete appliance acceptance and both executable consumers: none).
D582-S ran the two-venue proof and connects a real browser through the existing gateway;
that path now works in test, including certificate status by lost request ID. Joint reboot,
renewal, revocation, offline sales, signed tunnel provisioning, connected-machine isolation
and deployment of the lasting gateway remain open. Waitron (E) owns local permission
decisions, provisioning, private keys, client and native confinement. The missing approval
channel, revised full appliance and complete signed corpus must precede affected adapters.
The first target is one fixed box with opt-in test staff access on Debian 13; gates G2–G7
keep their scopes, and G4/G5 are outside the first target. Admission stays CLOSED and
`.local` independent.

**D101 data protection can proceed in cleared slices.** The owner lifted the
9 November pause on 2026-11-24 at 17:46 (lane G questions): “Yes, and let's not be blocked
by the privacy specialist. search the gdpr rules to find answers. let's go with our
best guess and ask for confirmation from the specialist later”. The
[provisional privacy answers](superpowers/specs/2026-11-24-d101-privacy-answers.md)
record the research for the specialist to confirm. The
[test-Cloud owner download](test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online)
covers a verified backup and key for a synthetic venue. Real use still needs
a download audit event and the [remaining exit work](superpowers/plans/2026-11-24-cloud-exit.md#later-retention-and-deletion).
Bring the slice 5 plan to the watcher next, followed by slices 6 onward one plan
at a time for clearance.

- The owner approved the D101/D88 [design](superpowers/specs/2026-10-22-cloud-data-protection-design.md)
  on 2026-10-22 around 08:30 **for build planning only**, then the
  [roadmap](superpowers/plans/2026-10-22-cloud-data-protection.md) and slice 1 that day, and
  local slices 2–5 on 2026-10-23. Slices 6–12 remain unauthorised until each plan is cleared. It uses
  [A980 section 2](https://github.com/clintongormley/waitron/blob/96a1129e385447e9b9a6dc545673009953a2c551/docs/superpowers/specs/2026-10-22-a980-data-protection-design.md#2-the-data-map)
  as the single application map.
- Built, disabled: slices 1–4 (outbound AI refusal, the
  [register](cloud-data-processing-register.md) and [draft annexes](cloud-processing-annexes.md),
  the [country decision](country-policy.md), the [venue lifecycle journal](data-lifecycle-journal.md))
  and slice 5's first task, internal stored-policy admission that no product adapter calls
  yet. The production Spain default has no qualified flows. No customer route or effects
  worker is enabled.
- Open in slice 5 ([plan](superpowers/plans/2026-11-04-cloud-country-flow-enforcement.md)):
  placement and credential enforcement, production assignment, provider retirement,
  destructive-retention coordination and mail retry semantics. The retention and mail worker
  integrations stop until their existing guarantees have a compatible design. Resubscription
  needs a retained-data check and an activation adapter. The later exit adapter must keep
  priority for an earlier verified delete, do an independent status lookup and qualify finer
  deadline comparisons if another producer writes timestamps beyond milliseconds.
- One venue approval permits at most **24 hours** of support access, shorter where practical
  and fresh approval to extend. **Paris `eu-west-3`** is the approved extra encrypted backup
  destination, subject to service, contract and recovery qualification; Spain data, logs and
  keys remain in `eu-south-2`.
- The 21 October exit decision includes a full download and fixed UTC 90-day
  read-only recovery. On 2026-11-24 at 17:58 the owner said “yes to all” to the
  three changes (lane G questions). Require proof of return before destruction, and
  seal data if it has not been returned. Close venue access on day 90 and destroy
  all copies eligible for deletion by day 120. Keep billing records and one sealed
  file of Cloud’s own account and security evidence for three years per event or
  five years for contract evidence, with no venue content. The owner also said
  “invoices may be kept in europe”. P6/P7 own the future hosted signup and failover
  checks, including evidence that a hosted venue notified Spain’s tax agency before
  keeping invoices abroad. Earlier verified deletion, copy evidence and unchanged
  fiscal rows remain requirements. O1 is answered.
- AI stays disabled until separately privacy-reviewed eligibility rules, positive/refusal
  examples and documented limits receive owner acceptance. All six lawyer questions (reusing
  [adviser confirmation P8](https://github.com/clintongormley/waitron/blob/2a4443a2ba01676e51fdb119a82d224f9d1cece7/docs/compliance/2026-11-06-adviser-questions.md#for-the-privacy-specialist),
  still awaiting legal confirmation), KMS deletion-waiting policy, exact
  provider/entity/access-location evidence, D102 email qualification and runtime proof
  remain open. The final production destruction step, AWS key deletion and AI sending stay
  disabled. Product repair uses records stripped of personal data.
- Broader D88 hosting, isolation and shared contracts, spending, deployment and provider
  resources still require their own approvals. The C39 monitoring design remains approved
  for planning only, subject to the production deployment and monitoring designs'
  corrections. The [alerts plan](superpowers/plans/2026-10-22-cloud-monitoring-thresholds.md#global-constraints)
  keeps the exact daily UTC backup schedule, first due slot and first monitored
  group subject to owner approval before enablement.

**D102 email feedback and suppression.** The
[design](superpowers/specs/2026-11-01-ses-feedback-design.md) was approved for authenticated
private-queue intake on 2026-11-01. The owner then authorised the local code and tests
(D565), accepting Stockholm `eu-north-1` and Paris `eu-west-3`, with Stockholm as the
configured default. Tasks 1–8 of the
[plan](superpowers/plans/2026-11-02-ses-feedback-implementation.md) are built locally and
off; the [qualification guide](ses-feedback-qualification.md) has the live profile and
handoff. The owner approved the late-feedback rule (Task 3 retains the original recipient
across later policy or configuration revisions when country, provider account, region,
purpose and configuration set still match) on 5 November, and accepted for that task that
any revoked retained key closes feedback and admission across its entire scope, with no
supported recovery path yet. Open:

- A separately approved key-retirement and recovery design, including whether an unrelated
  revoked key should exceed the design's required-key refusal. Production is blocked on it.
- Before production wiring, qualify retained-key failures that leave relay work queued until
  its original expiry and occupy capacity until the claim lease ends.
- Collecting authenticated provider samples, queue encryption, IAM and real dead-letter
  transfer, operator permission provisioning, provider-only removal, production provider
  acquisition and enablement. `Rendering Failure` and other extra event types still refuse.
  Spain's trusted policy has no qualified email flows.
- AWS resources, spending, credentials, production access and live mail remain unauthorised
  for production; these rules supersede the historical Paris-only and date-based enablement
  wording. The separately approved
  [Stockholm sandbox switch](test-cloud.md#send-account-mail-to-the-approved-test-mailbox)
  admits one verified Cloud account mailbox. Qualify real receipt and sender authentication
  on the test host, then authenticated queue intake, bounce and complaint application and
  suppression.
- D101's legal, retention and supplier gates, C39's alert thresholds and D104's independent
  alert route remain open; a second country needs its own approved provider-account policy.

Snapshots remain unavailable in the delivered deployment and plan enforcement stays off
until release qualification. Recheck active migration reservations before new database work.

## Hosted guest menu (A670-CLOUD)

Qualify Waitron's signed sender and its published menu from a phone on mobile
data using the [Amazon test Cloud guest address](test-cloud.md#open-the-synthetic-venues-guest-menu).
The Amazon test proxy returns a retry response when the browser reuses the account
connection for the guest menu, or the reverse. The proxy fixture checks both
directions over HTTP/2. After rollout, recheck the two pages and a fresh phone
visit to the menu immediately after sharing starts.
Qualify the Connected or Hosted trial and paid-plan gate with the box preview on the
Amazon test Cloud. Production DNS, certificates and rollout remain open. The
[remaining work](backlog/guest-menu.md) covers variant publication. Live forwarding
belongs to Waitron A509 online ordering.

## Custom domains with one record, and names that follow the venue

All eight slices of the [Cloud plan](superpowers/plans/2026-11-17-custom-domain-one-record.md)
for the [approved design](superpowers/specs/2026-11-17-custom-domain-one-record-design.md)
are built; the [local two-cell proof](local-remote-access.md#run-the-proof) covers them.
**Open:** the [Amazon test Cloud](test-cloud.md#configure-a-separate-https-test-name)'s
real-domain trial still needs a certificate readback and a page load on mobile data;
automatic staff certificate installation on the appliance needs qualification; Waitron’s
part, taking its staff name from Cloud, is a separate plan in Waitron. Live Let’s Encrypt,
Route53, production keys and multi-gateway coordination remain production gates.

## Venue email from Cloud, sent as the venue's own domain

**Open.** The owner approved the
[paid venue email design](superpowers/specs/2026-11-23-venue-email-paid-design.md)
on 23 November 2026. Build after D621, for release soon after go-live. A venue's
own mail server always wins. Without one, the free relay pilot covers staff
account emails and five staff notices. The paid design covers every email the
box sends, from the venue's own domain or a Waitron address. Start by checking
whether Amazon SES accepts the one-record domain setup.
[Decisions and open work](backlog/venue-email.md).

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
   each written when its turn comes; D112-S replaces the old P3 migration programme.
   P2's [AWS layer](aws-infrastructure.md) is built as mocked plans and offline checks, not a
   deployment. Open: account and state custody, populated secrets, actual service and
   collector permissions, recovery and provider availability under separate authorisation;
   state qualification (first initialization at an absent key, separate bootstrap-key
   creation, later deployment-role refresh); database recovery grants (P7); removing the
   global email/sign-in secret metadata, which has no reader, under its own plan; and the
   cause of the provider startup failure in nightly 43495535547.
   The owner approved gVisor for P6 and running Spain from Paris for P7 on
   2026-10-23. P6 still waits for P1/P4, the accepted Waitron handover contract
   (A1018) and D608's owner checks. P7 recovers a self-contained
   country without P3 permits; P2 and legal/provider gates remain. Neither answer
   grants live/provider authority.
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
   authority and all eight scenario/direction runtime checks remain open. Country
   rebuild and action status supply no venue declaration or activation authority.
2. **Production monitoring, alerting and the status page — DESIGNED AND APPROVED (2026-10-24).**
   The [design](superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md) was
   approved by the owner for building and rehearsing locally; the paging, outside-machine and
   Anthropic accounts, and any spending, need a separate go-ahead (its section 16). It changes
   C39 and D104 where its section 3 says: the owner is paged after an AI investigation or at
   15 minutes, by a text then a phone call; the status page updates itself; an on-prem box
   going quiet never pages. Built locally: [report receivers and private reader](box-error-reports.md),
   the [status-page generator and first-update rehearsal](incident-setup.md), phone adapters
   and signed callbacks against fake providers, and
   [collector measurements](operations-status.md#collect-status-in-the-local-deployment) with
   explicit settings. It pages nobody and opens no work items. Open: Waitron's opt-in, staff
   form, sender, "can trade" check and updater holding a version; the triage agent and D101's
   AI gate for its inputs; trial-derived targets and hosted measurements (here `rule="slow"`
   names the design's long-window rule); matched-window error shares once real reports exist;
   Verified-health wording, live status publication and later updates, account setup,
   supplier review, spending approval and outage/delivery/coverage drills. The
   [owner setup checklist](incident-setup.md) creates no account or service.
3. **Billing — DESIGNED AND APPROVED (2026-10-29).** The
   [design](superpowers/specs/2026-10-29-cloud-billing-design.md) sets three levels
   (registered, connected, hosted), trials, SumUp cards and Stripe direct debit, failed
   payments, emergency hosting by a venue manager, and Cloud's own Veri\*Factu invoices; the
   [build plan](superpowers/plans/2026-10-29-cloud-billing.md) orders ten slices. Slices B
   (rules), C (country-local store), D (per-venue levels), E (allowances and signed traffic,
   test/UTC use only) and J (the box's billing view) are built, and slice A's
   [sandbox receipt](billing-provider-test.md) exists. Enforcement, production allowance sizes
   and provider credentials stay off. Open:
   - Prices and allowance sizes wait for measurement (the design's §11), except the separately
     decided [SMS figures](superpowers/specs/2026-11-07-cloud-venue-sms-gateway-design.md). The
     owner approved its per-venue design on 9 November 2026; sender/privacy/delivery
     qualification and implementation remain open, and booking messages are outside it.
   - Billing cannot go live before the Waitron company exists to issue invoices, and that
     billing software needs its own declaración responsable.
   - Joint Waitron qualification of the billing view; pre-connection public prices and the
     production billing calendar keep the owner questions raised by lane B.
   - Live-account enablement, production settlement timing and the live saved-card rate. The
     reported SumUp sandbox fee was €0.25 on €10.
   - Provider accounts, clock-drift and calendar qualification, live recovery, slice G onward
     and production collection, invoices and deployment. An unconfirmed spent call keeps later
     trial evidence incomplete; it is never replayed to manufacture confirmation. A production
     gateway's traffic is unqualified, and stored hosted paid-period dates are bounding
     summaries: later billing views must use the exact hosted-day allocations.
   - A1188's agreed values ([part 1](waitron-integration-contract.md#emergency-hosting-display-and-code-proposed-d568),
     [part 3](waitron-integration-contract.md#agreed-part-3-values-15-november-2026),
     [part 4](waitron-integration-contract.md#agreed-part-4-confirmation-18-november-2026) and
     the [TOTP purpose keys](waitron-integration-contract.md#totp-purpose-key-input-amendment-17-november-2026))
     are contracts for a future build, not owner design approval or permission to build hosted
     runtime. The endpoints wait for P6's locked placement, stored copy operation, restricted
     copy authority, capped lease, D568 eligibility and shared signing actions. Hosted
     enrolment must name the node-record writer; environment-backed settings with null file
     digests need a compatibility design.
   - The venue service proof still reaches its 330-second limit at 1.5 CPUs, and a bound
     verifier cleanup refusal and registry failures remain unexplained: see their entries below.
4. **Terms, the data processing agreement and service promises.** These are needed before
   the first customer, paid or not, and a lawyer is needed for each, so the questions should
   go out early. The [launch evidence](launch-evidence.md) requires "lawyer-reviewed terms",
   and the D101 design lists six open lawyer questions. Missing: terms of service, the data
   processing agreement with each venue, and the promises Cloud makes about how quickly a
   venue is recovered, how much data a failure can lose, and uptime.
6. **Support and the operator console.** The [D609 approved design](superpowers/specs/2026-11-07-cloud-operator-console-support-design.md)
   covers paired-box reports, automatic sending, country feature lists and standard 24-hour
   support access. The owner approved the design on 8 November 2026, including omitting
   author names and letting staff hide text that contains personal data. The [synthetic
   browser check](../apps/portal/test/sent-reports-browser.test.ts) covers exact Sent
   reports for the current owner.
   Waitron's A1047 owns the staff form, checked sending and offline retries.
   Cloud still needs automatic-report opt-in and Sent reports for automatic sends, private
   bugs and status, country features with votes and comments, GitHub links, the operator
   console and common country routes, grant integration and customer-visible staff history. Joining country lists waits for a second country and an
   owner decision. Privacy, retention and qualified country support authority remain open.

Production email (D102: bounces and complaints) is already tracked and is not repeated here.

## Isolated replay ownership fixture refusal (D294)

**Open; historical cause unknown.** Recorded Linux CI passes all twelve controller
cases, including ownership loss after the worker-deadline case. Current native
diagnostic checks also pass. Neither result explains the historical refusal;
collect an instrumented recurrence before changing the ownership check.
See the [reproduction commands and diagnostic boundary](backlog/isolated-replay-ownership.md).

## Isolated replay result-boundary refusal (D297)

The altered-worker result controls have refused before reaching the result they
were meant to check. The historical cause remains open. Current diagnostics retain
the first transport refusal through the actual worker and host, and the current
Linux host group passes all thirteen cases. Use the
[reproduction commands and next-failure evidence](backlog/isolated-replay-result-boundary.md)
to identify a recurrence before changing request or shutdown behavior.

## Diagnostic download qualification

**Open.** Qualify server redaction, genuine browser downloads and production-network
behaviour. Native refusal and retry checks already pass.
See [the remaining checks](backlog/diagnostic-download-http.md#diagnostic-download-qualification).

## Usage deployment qualification

**Open.** Qualify server authority and production metering before you use totals
for billing or enforcement. See [the remaining usage qualifications](backlog/usage-metering.md#usage-deployment-qualification).

## Native storage admin fallback exhaustion (D506)

**Open; the automatic-listener conflict has a targeted repair.** Native service
ports use Linux 61000–65535 or Mac 32768–49151. The ownership regression reads the
running kernel’s automatic range and checks all eight native ports before a real
bucket operation. Final allocated-port collisions print the existing listener
snapshot; the single restart, claims and assertions remain. The Linux focused run
passed 59 cases, but does not identify every historical owner or measure recurrence.
The progress-control timeout, default native admin behaviour, admin-worker
functionality and other programs’ explicit bind races remain separate qualifications. See
[the commands and limits](backlog/storage-cache-fixture.md#native-storage-admin-fallback-exhaustion-d506).

## Repository licence

The root `LICENSE` is Waitron's Elastic License 2.0 text, without Waitron's separate grants.
The owner and watcher control the repository's visibility.

## First working milestone

**Open; the combined milestone is local evidence only.** Repeat the venue connection,
remote access, backup, replacement and gateway checks against the selected deployment
before launch. Live providers, deployment and secret custody, database recovery,
final-write handover and automatic appliance setup remain open; see the
[milestone requirements and remaining qualification](backlog/first-milestone.md).

## Fiscal allocation registry

Retired: Waitron generates time-based codes, and the
[removal design](superpowers/specs/2026-10-29-remove-fiscal-registry-design.md) records the
boundary. Migration 038, its dormant tables and stored rows stay unchanged; the
[registry reference](fiscal-allocation-registry.md) keeps the withdrawn contract. Destructive
retirement of stored records or shipped migration history needs a separate owner decision.

## Translate all: approved design, implementation still open

Keep translation off until the remaining Cloud, joint Waitron and release checks,
owner-only quality trials after 2026-11-02, and commercial and production decisions
are complete; preserve the approved cap, admission, consent and paging rules in the
[translation requirements and open work](backlog/translation.md).
The separately scoped [owner's demo-menu trial](../packages/translation/README.md#try-the-owners-demo-menu)
still needs the server-only key, its live provider result and the joint Waitron handoff;
ordinary-client refusal and public privacy, supplier and release work remain open. Waitron still needs to
send the signed abandon action and verify recovery after a lost submit reply against Cloud.

## Initial focus

**Open; local building only.** Launch first in Spain on AWS and keep routine customer
journeys self-service. Qualify remote access, replacement recovery, hostnames, cell
movement and outage behaviour against the [requirements and deliberate limits](backlog/initial-focus.md).

## Cloud signup and business moves

Send the daily high sign-up volume warning to the configured operator over SMTP and
SES. The warning goes to the account log and can reach the operator in the local
capture stacks.

The [Stockholm rehearsal](superpowers/plans/2026-11-21-cloud-setup-qualification.md#stockholm-result-21-november-2026)
covered sign-in after Admin and return to the original tab on a synthetic box.
Qualify the same setup on the released Waitron box, including the setup services.
Confirm the rule for tax numbers when a venue reconnects under a new owner. Moving
one business by itself and filing a new tax number when you own several organisations
remain open.

## Free services for open-source Waitron

**Open; production enablement is not approved.** Offer address lookup and transactional
email to open-source Waitron users with a Cloud login, without a paid subscription.
The [local address trial](address-lookup-trial.md) accepts registered test boxes
with a single verified owner when a fake provider is injected. The
[test setup contract](waitron-integration-contract.md#test-box-sign-in-before-the-venue-form)
lets a configured box register during sign-in for a new account or an account with one empty business.
Cloud browser checks cover verified signup and a return to the same tab after enrolment
and fresh sign-in. The [test relay contract](transactional-email-relay-contract.md#choose-staff-email-in-test-setup)
covers Cloud's signed staff-email choice. The Mailpit rehearsal in
`deploy/test-cloud/free-services-relay.test.mjs` covers delivery after sign-out.
The [joint Stockholm rehearsal](superpowers/plans/2026-11-21-cloud-setup-qualification.md#stockholm-result-21-november-2026)
covered the Waitron setup screen and one staff password reset delivered to private
Mailpit with the local mail server blank. The [Mac address trial](address-lookup-trial.md#what-the-mac-trial-measured)
measured first-choice drafts for 40 public addresses. Billing and the connected-box
check remain open.
Qualify providers, storage rights, account allowances and abuse limits against
the [requirements and open work](backlog/free-services.md).
Evaluate mobile notifications separately.

## Decisions in progress

**Open; individual decisions and qualification gates still apply.** Keep the customer,
staff-access, residency, cell, provider, package, usage, Waitron-boundary, server-lifecycle
and recovery choices together in the [decision table](backlog/decisions-in-progress.md).
The table preserves the agreed direction and identifies what still needs a decision,
implementation or production evidence.

## Platform work to scope

- **Remote fixture startup failure still needs attribution.** Merge conformance run
  `39906100584` failed only `false-availability` in `remote-waitron-conformance.test.mjs`
  after the 30-second readiness deadline, and [PR594's cost run](https://github.com/waitron-io/waitron-cloud/actions/runs/40536958436/job/122305238271)
  was refused during the gateway's `docker start`. Probes and commands now report a fixed
  phase or category. Capture that on a recurrence before choosing a fix; keep every timeout
  and journey check.

- **LAN test Cloud with free and paid organisations.** The fixed project is
  `waitron-cloud-test`; protected Waitron containers are never adopted, and the existing
  Waitron venue is quarantined: use disposable venues and leave its containers and data alone.
  The dormant proof runner and [evidence assembler](test-cloud.md#assemble-the-local-evidence-before-release-qualification)
  are built; their Linux receipts keep their original source and do not qualify the current
  release image. Publication remains `unqualified`, the complete-integration and shipping
  flags stay false, snapshots stay unavailable, plan enforcement and deployed translation stay
  off and address providers stay disabled. No image publication, account, provider resource
  or spending is authorised here. The [test Cloud guide](test-cloud.md) keeps historical
  failure diagnostics.

  Open on the [Amazon test Cloud](superpowers/plans/2026-11-16-test-cloud-aws.md):

  - Public test-venue HTTPS needs staging/production issuance and renewal qualification,
    account renewal, pairing and the owner's mobile-data check
    ([short plan](superpowers/plans/2026-11-17-test-cloud-public-remote.md)).
  - Sustained OS, disk and CPU headroom, SES feedback composition, real email delivery and
    joint box handoff. Stockholm's original restart cause and the joint box email trial.
  - After Stockholm, [upgrade the Amazon test Cloud](backup-verifier-containment.md#build-the-verifier-for-the-amazon-test-box).
    The owner resets the test box to the pinned Waitron release before the fresh
    [guided pairing and capture](test-cloud.md#rehearse-backup-on-the-amazon-test-cloud).
    Recovery approval remains off.
  - Automatic remote access needs the same fresh pairing, the assigned Staff page on mobile
    data, and confirmation that the box switch stops access.
  - A phone check of how long a synthetic menu takes to reappear after sharing is enabled
    (Juniper portal trial).

  **Open:** the owner-authorised **Cloud/Waitron release driver**, after this dormant proof
  branch finishes, owns published-image upgrade and rollback qualification. It must bind
  immutable published Cloud and Waitron digests to their exact source, compiled verifier
  target/module manifest and generated assets, name a supported old/new release pair, prove
  its real schema upgrade and old-consumer refusal, then restore the matching database,
  configuration, storage and gateway state and prove both original pairings still exchange.
  The existing rehearsal refuses a target containing migration 064 because its seeds use the
  retired local-id layout, so the driver needs a v2 seed. See the
  [release-driver handoff](test-cloud.md#release-driver-handoff).

  Other open maintenance: keep organisation writes in the plan setter, since shared policy
  readers that update their organisation can deadlock while upgrading locks. Qualify a
  consistent route view across the two export reads and production-scale processing before
  promising uninterrupted movement or larger capacity. Qualify recovery from definitive
  daemon rejection without clearing uncertain verifier journals. Same-CA in-volume renewal,
  continuous box supervision and the coordinated image/schema and volume-to-volume rollback
  path remain open.

- **Local package validation must avoid concurrent full-package groups.** Overlapping groups
  once pushed the registration control CLI past its five-second bound; the cause of the
  earlier nine-minute stall is unproved. Run local full package suites sequentially with two
  file workers, keep the five-second assertion, and capture process timings if it still fails.
- **Password-login recovery-row expiry.** [Run 39112504573](https://github.com/waitron-io/waitron-cloud/actions/runs/39112504573)'s
  ordering is unproved. If the assertion fails again, capture expiry and setup stages; do not
  extend its authority window or test deadline.
- **Operating cost.** The [offline calculator](cloud-cost-calculator.html) and
  [model](cloud-cost-model.md) compare the running platform and per-venue usage; the
  [approved design](superpowers/specs/2026-10-14-cloud-cost-model-design.md) defines the
  evidence boundary. The complete bill remains unknown: missing prices, minimums and blank
  inputs stay named gaps, and neither a priced subtotal nor a passing command means a
  complete or provider-validated budget. The accepted local samples
  ([joined evidence](cost-model/local-driver-evidence.json)) keep their own source, clock and
  limits; never add overlapping samples or substitute one's transfers for another's. Private
  replay uses owned scratch and an internal network, and raw data stays on the Mac. No fiscal
  allocation, hash-chain or golden rule is changed.

  The [trial assessment](cost-model/live-check.json) stops before any AWS creation: its
  illustrative high-cadence component alone projects 130,000 requests above the 10,000 cap,
  an assumed sensitivity rather than a proved bound. No resources were created and no billing
  read is due. Independent synthetic generation, an owned-resource runner and durable billing
  execution are prerequisites if it is revisited.

  Rebuild and verify with `node scripts/cloud-cost/cli.mjs build` and `… verify`;
  `pnpm test:cloud-cost` runs the synthetic checks and `pnpm test:cloud-cost:conformance` the
  generated-data checks.

  **To complete the total:** missing inventory quantities and regional billing terms,
  representative venue and public activity, complete retained-object forecasts,
  recovery/alert/email frequencies and provider capacity/transfer mappings. Keep external
  mail, fiscal API fees, GitHub charges, allowances, credits and tax separate from gross AWS
  usage. Keep generated fixture data within each service's 64 MiB scratch limit, or make a
  separate bounded capacity change. A generated restore-integrity failure reproduces on the
  host-shared Docker folder and passes on container-native storage; its production relevance
  is unproved, so prepare a consistent frozen copy before long replay. Earlier untraced refusals
  and transient source-file changes are unattributed; later activity in a live source is not
  proof that the isolated experiment wrote it.

  **Unexplained rehearsal refusals.** Each now reports a fixed stage or category; capture that
  on a recurrence, reproduce it with the pinned runtime and fix the cause. Passing repeats
  explain nothing. Keep every accounting, ownership, isolation, restore, cleanup check and
  deadline.

  | Refusal | Evidence to start from |
  | --- | --- |
  | Streamed-day check at `private-replay` | [run 41003745800](https://github.com/waitron-io/waitron-cloud/actions/runs/41003745800/job/123893874129) |
  | Stack start before archive assertions | [run 39743485615](https://github.com/waitron-io/waitron-cloud/actions/runs/39743485615/job/119706230844), and the older 39616174409 and 39627846860 |
  | Paced replay, generic error | 39637622744, [39829272927](https://github.com/waitron-io/waitron-cloud/actions/runs/39829272927/job/120000877058) |
  | Paced replay at `quiesce` | [40489223783](https://github.com/waitron-io/waitron-cloud/actions/runs/40489223783/job/122138753711) |
  | Paced replay at `quiesce-checkpoint` | [40954158356](https://github.com/waitron-io/waitron-cloud/actions/runs/40954158356/job/123729967144), [41449381877](https://github.com/waitron-io/waitron-cloud/actions/runs/41449381877/job/125290693382) (`transfer-interrupted`) |
  | Paced replay at `quiesce-idle` (D581) | [nightly 43207714335](https://github.com/waitron-io/waitron-cloud/actions/runs/43207714335) |
  | Paced replay at `storage-cleanup` (D121) | [40144665901](https://github.com/waitron-io/waitron-cloud/actions/runs/40144665901/job/121023380173) |
  | Writer-deadline check during opening | [40259519210](https://github.com/waitron-io/waitron-cloud/actions/runs/40259519210/job/121368783695), [43971423269](https://github.com/waitron-io/waitron-cloud/actions/runs/43971423269) |
  | Remote browser journey, mostly reconnect/takings | [39890570428](https://github.com/waitron-io/waitron-cloud/actions/runs/39890570428/job/120209134728), [40004973526](https://github.com/waitron-io/waitron-cloud/actions/runs/40004973526/job/120590562266), [40092022379](https://github.com/waitron-io/waitron-cloud/actions/runs/40092022379/job/120866647453), [40122070386](https://github.com/waitron-io/waitron-cloud/actions/runs/40122070386/job/120955659784); [investigation](backlog/browser-reconnect.md) |
  | Mail measurement close (D262, PR #467) | [job 121192744128](https://github.com/waitron-io/waitron-cloud/actions/runs/40201247616/job/121192744128). Read the close error's first reason and both counts: a timeout, a protocol failure and a disagreement after an accepted reply need different reproductions. |
  | SIGINT cleanup before a worker was admitted (D502) | [run 41003177471](https://github.com/waitron-io/waitron-cloud/actions/runs/41003177471/job/123892097439). Read `local-command-refusal` first; controls in `scripts/cloud-cost/local-command-diagnostics.test.mjs`. |

  The strict 4.01-second streamed-day control must refuse after its original deadline in
  whichever phase it reaches, with the source unchanged, private state removed and every
  started child collected and exited (owner, 24 October 2026).

  The official Litestream shutdown also still needs qualification
  ([scheduling investigation](backlog/cost-conformance-fixtures.md#replay-close-scheduling-d530)).

- **Future remote DNS lost-reply browser failures.** If the saved-name assertion fails again,
  use the bounded request/status events, injection stages and setup-screen diagnostics to
  reproduce the cause. Keep the four-second assertion and fault-injection ordering checks.
  See [the ordering receipt](#portal-lost-reply-test-ordering).

- **CI job record publication.** The historical GitHub publication delay remains unexplained.
  Preserve run identity, final dependency results and time limits; landing still requires
  every actual job record final. See the
  [investigation and qualification limits](backlog/ci-job-record-publication.md).
  The evidence tool also refuses CI 44104446979 attempt 2 (44 latest final jobs against 45
  attempt-specific records); the watcher closed that merge on the native view on 17 November
  at 16:10, leaving this readback gap open.

- **CI execution budget.** Hosted browser qualification still owns removal of the retained
  apt-only setup. Record D614's first natural proof-only PR hosted selection.

  **Closed failure sweep (D530).** Handle a matching recurrence from that run's log under the
  existing CI-failure rules; preserve the original assertions, deadlines and cleanup checks.

  | Boundary | Retained cause or uncertainty | Disposition |
  | --- | --- | --- |
  | Translation disconnect (D201) | Natural cause unknown. | Retain the existing disconnect evidence; no guessed worker change. |
  | Registration migrations and usage-worker termination | Natural causes unknown. | Keep existing diagnostics; investigate a matching recurrence. |
  | Storage LIST during stop | Interrupted replies observed; natural cause unknown. | Keep strict accounting refusals and the existing 0.5.17/0.5.18 comparison. |
  | First storage PUT after stop | A held initial upload can arrive after stop. | Retain the boundary work in [#1016](https://github.com/waitron-io/waitron-cloud/pull/1016). |
  | Archive-header cancellation timer | Two timers share one event loop. | Controlled ordering is delivered in [#1072](https://github.com/waitron-io/waitron-cloud/pull/1072). |
  | Native storage listener/admin | Address-in-use observed; competing socket owner unknown. | Preserve ownership and cleanup assertions. |
  | Missing reset/close email | Natural cause unknown. | [#1024](https://github.com/waitron-io/waitron-cloud/pull/1024) bounds diagnostic acquisition, not the email cause. |
  | Browser reconnect and panels | Natural causes unknown. | Preserve the original waits. |
  | Paced replay cleanup and early wake | Natural causes unknown. | Preserve existing completion checks. |
  | Ownership and result boundaries | Natural causes unknown. | Preserve ownership assertions. |
  | Authority/startup, HTTP/2 and body metering | Separate boundaries; natural causes unknown. | Do not assume a common repair. |
  | Offline packages and package authentication | Missing prerequisite and placeholder-token boundaries were addressed. | Retain #892/#880/#931; historical refetch cause remains unknown. |
  | Source/install/termination and APT | Historical causes unknown. | Retain bounded acquisition, cancellation and source-state work. |
  | Registry/image and archive acquisition | Upstream refusals observed; service causes unknown. | Retain existing acquisition bounds and recovery. |
  | Missing logs, fiscal before-hooks and SIGINT | Natural causes unknown. | Preserve existing checks; no fiscal change is authorised. |
  | Source JSON/gateway, cleanup and cache publication | Separate fixture fixes; historical scheduling causes unknown. | Keep delivered fixes and the existing non-recurrence history. |
  | Session clocks, foreign-container inventory, venue cutoff, child output and UI fixture | Reproduced fixture causes. | Retain #1002/#890/#1034/#1055/#1040; do not repeat those repairs. |
  | Concurrent documentation suites | Shared commit-hash output path; exact deleting process untraced. | Use separate temporary directories; passing isolation is not a test-source repair. |

  Reproduced fixture mechanisms do not establish the historical causes.
  Qualify package and whole-run duration against the retained targets; keep the
  [registration slowdown](backlog/package-ci-runtime.md#what-remains-unexplained),
  [backup slowdown](backlog/backup-ci-budget.md) and [remote runtime limits](backlog/remote-ci-budget.md) distinct.
  Qualify [cache-miss job budgets and the unexplained upload stall](backlog/ci-cache-saving.md).
  Capture labelled [pnpm transport/cancellation and nested-install recurrences](backlog/ci-pnpm-setup.md), including forced-supervisor cleanup.
  Investigate root-fixture `ENOTEMPTY` with remaining directory entries and child activity; its exact deleting process is unknown.
  Preserve the [35-second bootstrap and 60-second dependency-worker limits](backlog/ci-pnpm-setup.md#root-fixture-stress-boundaries) on recurrence; avoid overlapping full qualification.
  Retain complete TAP, test name, child error/signal and output if the unnamed null child-status assertion recurs; its cause is unknown.
  Keep D586's [job-page race and historical readback timeout](backlog/ci-job-record-publication.md) unproved; do not retry contradictory job evidence.
  Capture [local database handles, capacity and fixture timing evidence](backlog/package-ci-runtime.md#other-fixture-causes-still-unknown); more time is not a diagnosis.
  Keep the schema-upgrade lifecycle checkout cause unattributed; retain its fixed release/operation labels and bounded exit facts.
  Investigate [storage acquisition and competing socket owners](backlog/storage-cache-fixture.md); a passing retry does not identify either cause.
  Extend the existing backup-image acquisition helper only if another fixture fails acquisition; its [historical slowdown](backlog/backup-ci-budget.md) remains separate.
  Qualify changed [browser sources and Linux supervision](backlog/linux-download-supervision.md#browser-source-qualification-still-open), preserving signature checks, waits and cleanup.
  Measure healthy full-run savings before claiming them; use the current [proof selection](ci-proof-selection.md), [package selection](ci-package-selection.md), [reader review](ci-documentation-audit.md), [lockfile audit](ci-lockfile-audit.md) and [merge evidence](ci-merge-evidence.md) guides.

- **Shared UI.** Read the first post-split weekly mutation results;
  see [scope and remaining work](backlog/shared-ui.md).
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
  The Connected trial chooser, its price, tax details and test-only saved methods work for
  configured synthetic accounts ([sandbox receipt](billing-provider-test.md#local-sumup-save-card-switch-20-november-2026)).
  The [supplier inventory](cloud-data-processing-register.md#trace-the-current-payment-test-paths)
  records SumUp card and Stripe SEPA test paths; both suppliers and their live country
  flows remain unqualified. Paid-plan tax collection and Spanish tax-number
  validation, paid-plan choices, cancellation, account closure, hosting enrolment,
  supplier qualification and production billing remain open. When Billing can cancel, the
  **Remove venue** confirmation gains the instruction to cancel there to stop charges.
- **Venue and node registration.** Qualify the installed-box sign-in with the released
  Waitron client. Initial setup still needs sign-in, signup and access to basic services.
  Planned handover, diagnostics, retention, key provisioning
  and rotation, deployment qualification and production activation remain open.
  Qualify continuous writer withdrawal/rebinding together with the pairing continuous
  restart journey; production replacement setup, box self-service and the A1018
  retirement adapter remain separate. See [the requirements and deliberate limits](backlog/venue-registration.md).
- **Provisioning and placement.** The owner approved the
  [production deployment design](superpowers/specs/2026-10-22-cloud-production-deployment-design.md)
  for local building and rehearsal. D110's
  [P1 country-cell plan](superpowers/plans/2026-10-22-cloud-country-cell.md) is rehearsed in
  private Kind ([guide and commands](aws-infrastructure.md)); full service and fault proof, the
  strict common verifier and P1's production-mode acceptance remain open. The owner moved the
  remaining checks to the owner-started Amazon session on 14 November, and dropped D570's
  first-machine proposal on 9 November.

  **D621, Stockholm qualification, is open.** The
  [remaining-checks plan](superpowers/plans/2026-11-10-d621-remaining-p1-checks.md),
  [run 9 decision](superpowers/plans/2026-11-18-d621-run9-qualification.md),
  [storage limits](superpowers/plans/2026-11-18-d621-stockholm-storage.md#limits-found-in-the-linux-rehearsal)
  and [bounded three-machine plan with its run results](superpowers/plans/2026-11-09-d618-bounded-amazon-run.md#amazon-runs)
  hold the detail. The full saved-image Linux rehearsal passed all three stops, the repairs and
  a restore after the all-machine restart; paid Stockholm qualification remains open:

  - [Signed uploads](authenticated-captures.md#wire-contract) use the Waitron release in the
    [Amazon verifier pin](backup-verifier-containment.md#build-the-verifier-for-the-amazon-test-box).
    After stopping the database primary, the first fresh reserve must return a
    signed URL with zero storage session calls and zero reserve HTTP 503s; require independent
    backup verification within five minutes and signup email within 90 seconds. Repeat the
    outside rehearsal on the exact Cloud commit and Waitron image proposed for any separately
    approved paid run.
  - The two Stockholm sign-in timeouts are unexplained. In the free comparison both surviving
    email workers were down for 26.621 of the 31.234 seconds that fresh mail stayed queued;
    the worker now [reconnects](superpowers/plans/2026-11-24-d621-email-worker-reconnect.md).
    If a challenge is stranded, the measured observer restarts 60 seconds after the password
    reply, which can miss the 90-second target.
  - Unexplained: the returning-store timeout, the venue's HTTP 503 and the manifest restarts of
    the paid attempt, run 11's relay exit, the first run's target read, the earlier stop delays
    and two temporary-grant renewals that reached the ten-second deadline.
  - To reproduce the older pairing failure, start with the first in-cluster journey on
    disposable Debian 13 x86-64 using paid revision `f19c12c7` and its pinned Waitron image;
    if it passes on one node, match the three-node placement, shared configuration and limits.
    Capture previous manifest and account container exits, and trace the venue's
    `/api/pairing/start` through the host's port 3000.
  - Multipart when a DNS host stops, repair and multipart through consecutive outages, real
    gateway loss and address changes, replicated publication and shared ingress, the
    [Amazon-only repository repair](superpowers/plans/2026-11-16-d621-flux-repair.md) (Git
    application, drift repair, refetch, last-good retention), Flux-hosting-node loss, the
    original A and all-node loss, and billing reconciliation.

  The [practice-account setup](d618-account-setup.md) covers roles, budget, keys and owner-run
  checks. The owner chose Stockholm (`eu-north-1`): render the region explicitly, update the
  existing roles, compare the saved image policy with the run config and check the account's
  Paid Plan before running there; the owner completes these before each new run, and the
  one-run access-key route requires manual key deletion. Live permission enforcement,
  production provider identity, capacity, fixed quantity/cost assumptions, the independent
  expiry drill, offline ARM inputs and measured build/steady/fault/verifier/healing peaks
  remain open. The 6.10 GiB owned-memory sample is only a lower bound. Weekly automation needs
  scoped access and the [weekly plan](superpowers/plans/2026-11-04-kubernetes-weekly-proof.md).
  **Spending on these runs:** “we need to get it working. if that requires paid runs the sobeit”
  (owner, 23 November 2026 at 19:46). One run at a time, after looking for the last failure's
  cause for free. The limits recorded with it: ask the owner again before a run above about $10,
  after three failures for the same cause, or past $250 in total. Another fresh sign-in failure
  counts as the third (watcher, 24 November 2026 at 19:47).
  No general AWS, production or schema authority follows from any of this.
  [Release waves](superpowers/plans/2026-11-17-d114-release-waves.md) wait for full P1
  qualification; hosted venues and regional failover remain open.

  Also open: the country/provider/cell registry, repeatable resource creation, recovery from
  partial failures, capacity and customer movement. Repeat the local two-cell movement proof
  with provider-native cells, live adapters and appliance configuration before choosing a
  recovery-time target, and the [control-plane outage drill](control-plane-outages.md) with the
  selected deployment database, gateway reconciler and provider-native storage before setting
  an availability promise. Define how established connections and backups continue during a
  portal outage, including credential expiry and revocation.
- **Independent countries and the worldwide admin console (P3 / D112-S).** The
  [replacement P3](superpowers/plans/2026-10-22-cloud-global-country-split.md) leaves
  deploy-start control open. The [release-waves plan](superpowers/plans/2026-11-17-d114-release-waves.md#2-start-that-release-from-the-worldwide-console)
  names the GitHub workflow and inputs for that button.
  Public hosting, DNS/certificate delivery and provider qualification remain open.
  No country customer/venue copies or country operator authority belong worldwide.
  D608 owns the one-owner rule and swap-owner function; P7 owns the outside checker.
  Provider operations, deployment, spending and live email retain separate authority gates.
- **Repair actions and Cloud controller (P4).** The [country-local plan](superpowers/plans/2026-10-22-cloud-action-controller.md)
  leaves C39's future fact feed, real executors, P1's remaining qualification,
  release waves, hosted handover and regional failover open. Allocate migrations against the
  live manifest/reservations. Production operator selection and provider
  delivery remain operating decisions; local synthetic/Mailpit rehearsal
  authorises no provider operation, spending, deployment or live mail.
- **Provider integration.** Storage, compute, email, notifications, jobs, keys and
  telemetry, with AWS and Google implementations where needed. The local SeaweedFS contract
  and the [Stockholm AWS sandbox rehearsal](aws-storage-rehearsal.md) pass. New S3 buckets need
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
  Account sessions, passkeys and a redacted installation diagnostic are self-service already.
- **Service monitoring.** Check representative operations from outside the affected
  cell; track errors, response times, queued work, backup freshness and capacity.
  Production observation, phone delivery, recovery targets and C39 plan/build approval
  remain open; see [the requirements and deliberate limits](backlog/service-monitoring.md).
  See [the cost-alert decision](#service-monitoring).
- **Usage metering.** Local totals cover snapshot storage and transfer, installation
  operations, monitoring probes and administrative alerts. Production deployment,
  monitoring and additional service units remain open; define costs, allowances and
  outage policy before using totals for billing. See [scope and remaining work](backlog/usage-metering.md).
- **Data lifecycle.** Local backup capture, retention, verification and recovery are
  implemented. Production custody, release
  qualification, provider isolation, capacity and lifecycle policies remain open.
  The venue-level test worker can use bounded disk scratch. Raising the 512 MiB
  ceiling still needs year-sized recovery, and fiscal verification still needs
  VERIFIER-CERT-OPEN. See [the requirements and deliberate limits](backlog/data-lifecycle.md).

## Backup catalogue qualification

**Open.** Qualify server permissions, deployed browser integration, computer sleep
and genuine restore or recovery. Native transport and elapsed retry checks pass;
they grant no activation or stop-proof authority.
See [the remaining checks](backlog/backup-recovery-http.md#backup-catalogue-qualification).

D640's portal step waits for Waitron A1323 PR 6e. Once the box can choose a
checked snapshot, switch the Cloud approval page to venue-only approval and
keep the loss confirmation in both languages.

## Operations scale-test timeout

**Open.** Find and fix what the scale case waited on in
[run 43811109636, attempt 1](https://github.com/waitron-io/waitron-cloud/actions/runs/43811109636/attempts/1).
Its 30-second cancellation and three subsequent status setup failures remain
unexplained. Read the next natural failure's `cloud-test-setup-waits` report
before choosing a repair; passing probes have not reproduced the cause.
The [diagnostic scope and limits](superpowers/plans/2026-11-16-operations-timeout-diagnostics.md)
identify the observed stages and gaps. Preserve all assertions and deadlines.

## Monitoring shutdown fixture migration timeout (D530)

**Open; causes unproved.** Registration shard 1 failed in migration 013 under its 3,000 ms
statement cap, and PR #1042's merge saw migration 024/035 setup timeouts and a usage-worker
SIGKILL on shard 3. Passing reruns reproduce none of it. Preserve the caps and assertions;
read the retained `cloud-test-setup-waits` output on recurrence before choosing a fix.
See [the failure and qualification limits](backlog/worker-scheduling.md#migration-setup-timeout-remains-unexplained-d530).

## Service-proof failure diagnostics (D530)

**Open.** A 16 November Linux run of `deploy/test-cloud/https-proof.test.mjs` returned 503 at
its final restart-readiness assertion, and the
[first venue-proof attempt for PR381](https://github.com/waitron-io/waitron-cloud/actions/runs/41805521835/attempts/1)
failed with only `Free-service proof failed`; neither has a known cause. Proof runs now emit
bounded `SERVICE_PROOF_FAILURE` records; match a file number against its group's list in
`scripts/test-cloud-free-services.mjs`. Earlier output can hide a later error, and the cap can
omit a parent hook failure. The translation disconnect case is in
[translation work](backlog/translation.md). At 1.5 CPUs the venue proof still reaches its
330-second child limit (326 cases); that constraint, the hosted slowdown and signal delivery
through that cutoff are unqualified. Keep every assertion and time limit.

## Bound verifier test failure cleanup (D530)

**Open; the original Docker refusal is unexplained.** [The D462 backup job](https://github.com/waitron-io/waitron-cloud/actions/runs/41311315472/job/124862280459)
refused an invalid-archive verdict because child cleanup failed (20.197 seconds), and the
leftover child then failed later cases. The fixture now rescues only its own recorded children.
Use the controller's fixed diagnostics on the next occurrence (discovery, ownership,
removal, absence) before changing cleanup; do not repeat the passing concurrency probe without
a new failure or hypothesis. A lost create response before an ID, and a child created by a
separate host, stay outside the rescue. Keep every verifier assertion, authority check and
deadline.

## Bound verifier fixture build timeout (D312)

**Open.** The historical CI build timeout, three PostgreSQL image-inspection timeouts and two
Worker fixture builds at the same limit have no proved cause, shared or not. They now retain
bounded Docker and host diagnostics; capture a recurrence before choosing a repair.
See [the evidence and remaining investigation](backlog/verifier-build.md#bound-verifier-fixture-build-timeout-d312).
Keep every verifier assertion and the existing build and job limits. PR #994's
[oversized-daemon inspection case](https://github.com/waitron-io/waitron-cloud/actions/runs/42161904817/job/127709403709)
read an incomplete state file at `ci-test-postgres.test.mjs:146`; on a recurrence, investigate
the fixture writer and its termination boundary.

## Relay reservation admission timestamp (D530)

A reservation now records the database time used for its admission checks. **Open:** a
controlled probe still admits when a grant expires during the counter query, after its
admission check; measuring time again at a later write needs its own authority and period
design. Production-role behaviour, mixed-version deployment and the original CI interleaving
(registration job [127430816673](https://github.com/waitron-io/waitron-cloud/actions/runs/42079861800/job/127430816673))
are unqualified.

## Storage test socket attribution and live progress (D575)

Reservation-control binds now report their phase, port and owner before cleanup.
Historical owners and a shared cause with default admin listeners remain unknown; hard-kill
survival of the live log is unqualified.
See [the checks and investigation limits](backlog/storage-cache-fixture.md#storage-test-socket-attribution-and-live-progress-d575).

## Storage archive download failure reporting (D441)

**Open; historical cause unknown.** Capture the named
request and phase at a new failure before changing the single archive-download
attempt.
See [the evidence and remaining work](backlog/storage-cache-fixture.md#storage-archive-download-failure-reporting-d441).

## Storage extraction seed acquisition (D530-4)

Bounded acquisition is shared by the suites, conformance and the image build. The historical
timeout has no recorded HTTP stage: capture a labelled failure before attributing it to the
registry. Full application image preparation remains open. The owner has deferred
the costed controlled-copy proposal; no mirror is built. See [the seed controls and limits](backlog/storage-cache-fixture.md#extraction-refusal-seed-acquisition-d530-4)
and [the complete inventory and proposal](backlog/storage-cache-fixture.md#every-seaweedfs-archive-fetch-and-a-controlled-copy-proposal-d530-4).

## Parallel storage-cache fixture failure on main

The original read-only-cache rejection is unexplained; the readiness
and port repairs do not establish its cause. Reproduce an admin-listener bind
failure and reserve those ports if needed, without retrying unknown ports or other
child exits. See [the investigation and remaining work](backlog/storage-cache-fixture.md)
and [the D499 boundaries](backlog/storage-cache-fixture.md#current-browser-and-identity-port-qualification-d499).

## Reduce unnecessary CI work (D613)

The [9 November report](ci-proof-selection.md#remaining-ci-work-measured-on-9-november-2026-d613)
closes the accepted three-category measurement. Ordinary code PRs still ran about
25 job-minutes of root tests and every receipt suite in that sample. The first
root cut omits nine audited synthetic suites on selected package-only PRs.
**Open:** measure its hosted job-minute saving on a healthy natural eligible PR. Then model
registration test times by area over recent merged PRs before proposing a package
split and agree the pairing boundary before moving code. Review the retained
receipt fallback and weekly cost-check policy separately. Sample infrastructure
and cost-input PRs as they arrive naturally; no measurement-only reruns.

## Dependency-cache miss job budgets (D507)

The 6 November sample covered 67 cache-consuming jobs across ten definitions.
Each fit its cap, but registration partition 1/6 took 445 of 480 seconds with
saving skipped, leaving less than a full save allowance. **Open.** Qualify healthy
miss paths for the retained definitions sampled only on hits; preserve limits,
matrices and checks pending a separate decision.
See [the phase timings and remaining qualification](backlog/ci-cache-saving.md#healthy-run-timing-sample-6-november-2026).

## Audit fixture dependency preparation (D530)

The audit and guard fixtures copy installed dependencies and pass with an empty cache. See the
[nested-install investigation](backlog/ci-pnpm-setup.md#nested-package-installs-d530)
for the remaining cache questions.

## CI PostgreSQL image pull

The launcher acquires both images first, with bounded retries for connection failures and
registry HTTP 5xx (`node --test scripts/ci-test-postgres.test.mjs`); the Docker Hub outage's
cause is unknown. **Open:** whether stopping the pull client also stops Docker's own registry
transfer. Qualify that with a real daemon and a controlled registry; do not infer it from
client termination.

## Portal reset-mail boundary reporting

**Open; the missing reset email remains unexplained.** Capture a diagnostic
recurrence before changing delivery or inbox capture, preserving the original
assertions, single lookup and deadlines. Every mail lookup now reports its queue, worker and
SMTP evidence. Read the [reporting boundaries and
redaction limits](backlog/mail-capture.md#portal-reset-mail-boundary-reporting) and the
[separate five-second Mailpit send failures](backlog/mail-capture.md#package-test-mailpit-send-timeout).

## Account HTTP reset-mail capture

**Open; the historical reset-mail capture failure remains unexplained.** Capture
a Linux recurrence before choosing a delivery or capture fix, preserving the
original assertions, single lookup and deadline. Read the [investigation and
bounded diagnostics](backlog/mail-capture.md#account-http-reset-mail-capture).

## Portal session test startup

**Open; historical cause unknown.** Capture a diagnostic recurrence before
attributing the initial signed-in timeout. See the [investigation and diagnostic boundaries](backlog/portal-session-startup.md).

## Recovery and remote browser waits (D530)

**Open; the historical causes are unknown.** Delayed proof-status and passkey-list replies, the
changed-email click lost when the session list started, and an authenticator code rollover
are covered; sign-out and revoke still have the changed-email window. Capture the activation
response if the owner-handover wait returns. Read the
[evidence and next reproduction](backlog/portal-panel-waits.md) before attributing either
timeout or repeating the passing baseline.

[Run 43694844056](https://github.com/waitron-io/waitron-cloud/actions/runs/43694844056/job/132753088334)
timed out at sign-out waiting four seconds for the sign-in heading
(`fiscal-registry-removed-browser.test.ts:63`); a recurrence needs priority root-cause work.

## Portal lost-reply test ordering

**Open:** the historical reset-link, lost-reply and translation-control failures, and the
consent-uncertainty and usage rate-limit waits from
[PR #598](https://github.com/waitron-io/waitron-cloud/actions/runs/41183089824/job/124484426019),
remain unexplained. Capture a diagnostic recurrence, reproduce its named stage
and fix the proved cause while preserving every existing assertion and deadline.
See [the investigation and retained ordering controls](backlog/portal-lost-reply-ordering.md).

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

- **Historical cost fixtures.** Their `venue.location` and
  `provisioned.locationId` inputs match the pinned Waitron releases.
- **Cloud provisioning and trial onboarding.** Own the service that creates a
  customer's resources and supplies configuration and credentials to Waitron, plus
  the hosted trial entry path. The local integration contract is mapped and proved;
  provider provisioning, the paid lifecycle and the hosted trial remain open.
- **Cloud-only redundancy.** Implement and qualify the approved failure and recovery
  direction through P6/D115 and P7. The [reconciled Cloud hosting design](superpowers/specs/2026-10-21-cloud-hosted-venue-design.md)
  uses the owner-selected cold recovery shape and the revised A1018 controlled or
  explicit emergency handover where selected (its terms are in Current state and Launch
  platform work). Human shutdown declarations do not prove an isolated M1 stopped.
  A running follower needs separate future approval. The old managed-Postgres framing
  is historical; Waitron targets SQLite and Litestream.
- **Production object-store proof.** The local SeaweedFS contract and a
  [one-day AWS Stockholm sandbox rehearsal](aws-storage-rehearsal.md) pass (conservative
  US$1.37 pretax estimate; charges were not read). This is no Spain-location or
  production-deployment claim.
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

## Cost conformance image acquisition (D137)

The historical Docker Hub token-request timeout and the
[authentication refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40984997048/job/123833975271)
of `node:26.11.1-slim` are unattributed. Recovery for HTTP 5xx and transport failures is bounded
and on main; authentication refusals must still stop immediately. Capture the registry
challenge and credential selection during a controlled reproduction on the Linux test box. An
empty image cache is unqualified. See the
[image acquisition detail](backlog/cost-image-acquisition.md).

### Litestream LIST-response interruption (D352 qualification)

[Cost run 40546771851](https://github.com/waitron-io/waitron-cloud/actions/runs/40546771851/job/122339634344)
refused the transport body-accounting case: at stop/idle a LIST response closed after headers,
and the native process exited 0 with the audit unfinished. The cause is unknown; keep all
accounting guards and deadlines. See the
[Litestream shutdown investigation](backlog/cost-stack-replication.md).

### Storage startup readiness

The historical provisioning timeout and Linux internal error remain
open under the [readiness investigation](backlog/storage-authority-timeout.md).

### Conformance image acquisition during D135 qualification

**Open; the registry timeout and metadata HTTP 502 remain unexplained.** D135
still needs fresh Docker-backed qualification on the acquisition repair. Keep the separate
generated HTTP 408 and native fixture timings under
[their scheduling investigation](backlog/cost-conformance-fixtures.md#cost-fixture-timing-under-ordinary-ci-load-d530).
See the [image acquisition investigation](backlog/cost-conformance-fixtures.md#conformance-image-acquisition-during-d135-qualification).

### Litestream conformance transport-close refusal (D141)

**Open; the historical close refusal and later result-assembly failures remain
unexplained.** D513's failure is the body-byte comparison. D513 and G474 still need causal
attribution, preserving redaction, cleanup, accounting and deadlines; see the
[transport and result diagnostics](backlog/cost-conformance-fixtures.md#litestream-conformance-transport-close-refusal-d141).

## Cloud cost Mailpit fixture startup

**Open; the historical cause is unknown.** [Merge CI run 40000552513](https://github.com/waitron-io/waitron-cloud/actions/runs/40000552513)
failed `generatedServiceKeepsItsMutableFilesOffTheScannedHostTree_mailpit` at fixture startup.
Startup now emits `stack_startup=` with a fixed stage before cleanup. Reproduce the stage a
recurrence names and fix it test-first, preserving every isolation, storage, accounting and
cleanup assertion and deadline.

## Cost-stack replication interruption (D152)

**Open; historical interruption causes and production shutdown qualification
remain unresolved.** Stop refusals now retain exit code, signal, the first failed audit stage,
interrupted attempts, body counts and up to sixteen active transfers. A valid database stop and
one completed LIST do not stop later retention LISTs; waiting through the observed last level
works only in a toy setup. Read the [replication and shutdown investigations](backlog/cost-stack-replication.md)
and reproduce each new diagnostic recurrence before changing transport, accounting, cleanup or
the stop rule.

## Initial upload admitted after stop (D393)

**Open.** [PR635's merge cost run](https://github.com/waitron-io/waitron-cloud/actions/runs/40634308325/job/122638015466)
refused an initial PUT after a validated stop reply, with writer exit zero, and the
[native admin-port qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/41037164023/job/124000805980)
met another. Controlled macOS and Linux runs of the official 0.5.17 binary reproduce the
admission refusal with a held snapshot upload (`DB.Snapshot` under
`Store.monitorCompactionLevel` on macOS); they do not identify the historical upload. You cannot infer first
HTTP admission from the SDK request log, an idle transfer count or a zero writer exit. Do not
delay production stop or admit late uploads on the strength of these probes; a pre-signal idle
wait passes one controlled ordering only. Controls:
`node --test scripts/cloud-cost/litestream-pre-admission-put.test.mjs`.

## Held-list control failure ordering (D391)

**Open.** In [PR633's merge cost run](https://github.com/waitron-io/waitron-cloud/actions/runs/40631222000/job/122627856885)
the first LIST was interrupted at the transport while the storage observer reported success.
Failure-only records now order up to sixteen LISTs against stop and acknowledgement. The genuine
case passes on Linux with one permitted late LIST interrupted, which does not reproduce the
historical event. Use a labelled recurrence to establish the cause before changing any shutdown
rule.

## Recovery deployment qualification

**Open.** Qualify server permissions and genuine restore or recovery; these client
checks grant no activation authority or proof that the old server has stopped.
See [the native recovery boundaries](backlog/backup-recovery-http.md#recovery-deployment-qualification).

## Public browser and network qualification

Qualify the browser check on public venue pages and the sign-up and password-reset
email forms across supported browsers and production networks. Verify those paths
before public exposure, including on slower phones.

## Public gateway deployment qualification (D191)

The [limits guide](local-remote-access.md#measure-shared-public-traffic-limits)
documents the implemented source policy and its native checks. Its 2026-09-30
receipt remains a historical measurement, not deployment qualification.

Before public deployment, qualify fairness for customers sharing IPv4 addresses
or IPv6 networks, including IPv4-to-IPv6 translation. Many distinct networks can
still exhaust all 4,096 source buckets and refuse new callers until expiry. Choose
and test admission under that pressure. Per-venue fairness, coordinated
limits across gateways and HAProxy connection-table pressure remain open. Verify
IPv6 connection accounting with HAProxy's configured `stick-table type ip`; native
gate checks do not qualify that separate layer.

## Storage-authority request timeout evidence (D212)

**Historical cause unknown.** A port collision and a throwing retry logger were found and
fixed separately (D526); neither explains the old timeout or the later startup
`InternalError`. Use the next labelled recurrence to find the cause, preserving the existing
assertions and deadlines. See the
[investigation and qualification limits](backlog/storage-authority-timeout.md).

## Paced replay deletion refusals (D344, D351)

Cost runs [40541558126](https://github.com/waitron-io/waitron-cloud/actions/runs/40541558126/job/122321994540)
and [40516366868](https://github.com/waitron-io/waitron-cloud/actions/runs/40516366868/job/122231317704)
refused at `storage-cleanup` / `delete-object` after about 75 seconds, following native restore
and validation. Resume D121 with these traces and reproduce the deletion refusal without
changing ownership, accounting, cleanup or deadlines.

## Passkey keyboard browser handler observation (D373)

The fixture now waits for its options handler. A
[gateway reconnect refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40597914600/job/122518692085)
with an accepted session remains unexplained and belongs to D201's investigation; keep the
accounting checks and deadlines.

## A way forward after every refusal (D254)

The [self-service refusal audit](refusal-self-service-audit.md) traces current
English/Spanish portal messages, public pages and account emails to their server
causes; most rows are delivered and it records their limits. Authentication, recovery, tenant
permissions and fiscal changes keep their full review and owner gates. Still open, each a
separate small change with tests first:

- R2: malformed JSON (400) and billing request-body refusals. Concurrent background passkey
  list reads are unqualified. An earlier [reconnect check](https://github.com/waitron-io/waitron-cloud/actions/runs/40246747289/job/121329853937)
  refusal belongs to the shared CI-failure investigation.
- R3: finding another recovery request without its original link, showing source compatibility
  before approval, and the box button to set aside an unreadable reconnection request.
- R5: customer plan, setup and restart controls and membership changes need real product
  paths.
- R8: same-account membership and business creation during connection.
- R9: private forwarding evidence ([approved plan](superpowers/plans/2026-10-26-private-forwarding-causes.md),
  [guide](local-monitoring.md#private-gateway-forwarding-collection)) needs container mounts,
  primary-only reads and P1 country backup integration qualified; reporting stays disabled in
  deployments.
- R10: other browser engines, screen readers, production timing and other historical
  page/script versions are unqualified. An older script can leave static advice visible while
  checking, and a mixed rollout can keep previous advice until reload.
- R11: owner-facing repair controls, appliance certificate delivery, production certificate
  delivery and live provider activation.

## Remote hostname save qualification

**Open.** Qualify live DNS and certificate issuance, browser integration and deployment.
Production installation refusal remains in place. The single-suffix trial completed
staging and real issuance, trusted browser sign-in from outside the home network, and automatic
app and tunnel restart. Reboot, renewal, revocation, offline sales and connected-machine
isolation still need joint qualification. Cross-suffix moves also need it: the retained staff
hostname and the destination-derived challenge name currently differ, so keep that production
renewal and routing gate open. Permission and retry rules remain in force.
See [the remaining checks](backlog/remote-access-http.md#remote-hostname-save-qualification).

## Remote status and DNS-preview deployment qualification

**Open.** Qualify live DNS, certificate issuance, browser integration and deployment;
retain the existing permission and retry rules.
See [the native read boundaries](backlog/remote-access-http.md#remote-status-and-dns-preview-deployment-qualification).

## Isolated replay ownership-loss fixture

An earlier remote-guidance qualification failed in
`isolatedControllerNeverClaimsCleanupAfterLosingItsOwnership`: the fixture did not
observe the replay worker's started journal state (conformance run 40265731418,
job 121387722438). The cause remains unknown in the retained D530 history.
Keep the ownership assertion, deadlines, resource collection and refusal to claim
cleanup after ownership loss. Qualify any repair with the genuine runtime fixture;
a passing remote-guidance qualification does not establish a repair.
