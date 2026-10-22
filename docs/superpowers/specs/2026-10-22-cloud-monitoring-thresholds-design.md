# Notice failures without turning every blip into an alarm

**C39 · 2026-10-22 · Full design approved for planning only. Documentation only.**

You need a phone alert when you must act, unknown status when evidence stops, and useful incident
mail without a message for every blip. The owner approved this full policy and its starting
thresholds on 2026-10-22 around 08:35 for planning only. Implementation, the exact daily
backup schedule and first monitored group need separate authority. You are the sole
operator on call; a venue owner receiving optional mail has a separate role.

Source inspection uses base `9701cd2359d69f0a3e8960b761754cf492aac745`, file reads and `rg` searches;
guide references include this publication's backlinks. No runtime behaviour was exercised: this is policy
evidence, not proof. C41 releases, C60 compute, packages, prices and reliability promises remain later.

## What exists in the current source

| Current evidence | Consequence for your decision |
| --- | --- |
| `packages/registration/src/monitoring.ts:14–46` | Venue scheduling and active evaluation require the test environment. Contact opens at age **15 minutes**, snapshot capture age at **48 hours**, and a latest-point verification failure after **5 minutes**. These are implementation facts, not approved production promises. |
| `packages/registration/src/monitor-config.ts:7–14`; `monitoring.ts:48–57` | Remote evidence defaults to stale at **5 minutes** and certificate warning to **30 days**. Quiet and reminder defaults are both **0**, independently disabled. Route freshness and certificate handling have separate conditions; certificate handling currently uses retained dates without the route's freshness gate. |
| `packages/registration/src/monitor-cli.ts:23–26`; `monitoring.ts:59–65` | The continuous monitor schedules once a minute, with bounded concurrency and a 30-second retry after observation failure. A deadline is eligibility for observation, not a delivery guarantee. |
| `packages/remote-access/src/probe-cli.ts:15–20`; `probe-targets.ts:16–26` | The CLI selects at most 100 current authorised targets and waits 60 seconds after each batch. It does not guarantee every target a sample each minute. Production coverage needs a measured, complete target schedule. |
| `packages/remote-access/src/probe.ts:102–127`; `docs/local-monitoring.md:103–121` | Public evidence checks the challenge and availability endpoint; staff evidence checks trusted TLS, not login or trading. Results are installation/revision/hostname bound. You cannot infer full application health from either. |
| `packages/operations/src/status.ts:51–95` | Operations defaults include 5-minute email backlog/evidence bounds and 48-hour snapshot age. Storage checks the latest installation snapshot; the venue monitor instead finds the venue's newest capture marked verified. Neither query supplies current-target qualification. |
| `packages/operations/src/status.ts:100–124`; `cli.ts:16–19` | Aggregate readiness includes queues, incidents and evidence. A completed negative inspection is different from inspection failure; ordinary JSON mode can exit successfully while reporting unready. |
| `deploy/local-stack/operations-collector.mjs:9–32,37–54`; `operations-sample.mjs:11–16` | Local collection waits 60 seconds after completion, has a 30-second deadline, checks the release schema and suppresses failed/expired samples. An unreachable collector needs an outside observer. |
| `packages/registration/src/monitoring.ts:80–167`; `email-outbox.ts:181–217` | Existing episodes capture recipients/deadlines; reminder and recovery need that recipient's committed sent opening. Ownership, opt-in, verified address, service and test-environment gates remain live. Account security mail follows separate checks. |
| `docs/backlog.md:2834–2864,2876–2903,2946–2955`; `docs/operations-status.md:221–234` | Collection and notifications have local surfaces; production alerting, retained time series and deployment qualification remain open. |

Shortened filenames share the preceding full directory. Preserve the implemented [quiet/reminder
design](2026-10-13-monitoring-quiet-escalation-design.md), lines 9–13 and 44–58, and its recipient,
durable-send and authority rules. `docs/local-monitoring.md:136–190` describes its local use and limits.

## Keep five different clocks separate

All durations from here onward are **PROPOSED choices**. Inspect expected targets every **60 seconds**
from outside the affected cell. Keep **5-minute** evidence freshness. Scheduling must cover every
expected target, not repeatedly sample only the first 100. Missing expected targets are unknown,
even if `no_targets` looks ready.

A detection threshold identifies a problem. A confirmation window asks whether fresh observations
keep showing it. Mail quiet time delays an opening after detection; a reminder measures time since
each recipient's recorded sent opening. Paging acknowledgment records responsibility, not recovery.

Show venue detections immediately. Propose **5 minutes** of mail quiet time and **one reminder
60 minutes after each recipient's committed opening send**, only while still open and eligible.
These are global monitoring-mail choices supported by the existing mechanism, not per-severity
settings. Recovery still requires a recorded sent opening and current authority. A sent receipt
proves the queue committed its result, not inbox arrival.
Password resets, verification and password-change/security mail inherit neither monitoring
quiet/reminder timing nor monitoring opt-in (`packages/registration/src/email-outbox.ts:181–217`).

If evidence becomes unknown, defer unsent opening and reminder mail without moving their
deadlines or creating another notification identity. Resume only when fresh adverse evidence
confirms the same open episode and all delivery checks still pass. Fresh recovery cancels unsent
notices; suppression keeps its existing cancellation rules. Send no invented unknown or recovery
email. The independent observation-gap page remains actionable. Preserving an episode through
unknown evidence needs approved implementation work beyond the existing quiet-time configuration.

## Initial severity and threshold proposal

Use **P1** for a phone page requiring prompt action and **P2** for an operator work item reviewed
within **24 hours**. These are operational choices, not customer guarantees. Evaluate age thresholds
at equality or later. Each row includes confirmation; do not add mail quiet time to phone thresholds.

| Signal | PROPOSED detection and phone rule | Why this starting point |
| --- | --- | --- |
| Public or staff route | Detect the first fresh failed sample. P1 after failures spanning **3 minutes**, with a new failed sample at least every **90 seconds** and at the deadline. | Allows a short reconnection while detecting persistent loss independently of contact. |
| Account API live or ready probe | P1 after the same **3-minute / 90-second** failure confirmation. Retain the current **2-second** probe timeout. | You need access to accounts and recovery even when a venue is down. |
| Missing installation contact | Detect at **15 minutes** since last contact; P1 at **20 minutes** of contact age if still absent and collection is current. Never-contacted grace starts at approved monitoring enablement. | Gives five more minutes to investigate without presenting contact as route health. |
| Late retained snapshot | Detect and P1 at approved capture due time **plus 2 hours**, when no qualifying capture for that scheduled slot exists. No additional confirmation delay. | Bounds a missed scheduled copy without changing capture frequency. |
| Failed snapshot verification | Detect and P1 after the same latest artifact has failed continuously for **5 minutes**. | Retries may clear a transient failure; preserve the older protected copy. |
| Certificate | P2 at **30 days** remaining; P1 at **7 days** remaining, on fresh successful trusted certificate evidence, without another wait. | Renewal gets a work window before an urgent deadline. TLS expiry failures also follow the route rule. |
| Collector, scraper or alert evaluator | Mark unknown immediately on failed/missing collection. P1 when last successful collection is **5 minutes** old, or failures/unreachability persist **5 minutes**, whichever comes first. Use startup time if no success exists. | A dead observer must alert through an independent path, not masquerade as a venue outage. |
| Venue monitor or remote probe evidence | Unknown at **5 minutes** old or absent for **5 minutes** after enablement; P1 then, without another wait. | You must investigate the observation gap without declaring the route or venue failed. |
| Administrative email | P2 when pending age reaches **5 minutes** or a processing lease expires. P1 at **10 minutes** pending age or **5 minutes** unresolved expired lease. A new failed/expired required message is P1 immediately. | Email cannot be its own failure alarm. Historical terminal counts alone do not page again. |
| Backup/configuration jobs; usage evidence | P2 when due work remains due for **5 minutes**, a job parks, or usage evidence reaches **5 minutes** of age/absence after enablement. P1 **15 minutes after P2** if unresolved. | Queue counts need age and outcome context; already-due work is not automatically an outage. |

Route confirmation needs new evidence, not repeated reads of one failed result. A gap over
90 seconds breaks confirmation and creates observation uncertainty; it never closes the
underlying incident. Reconfirm with new failures when sampling resumes. Correlate a shared
cell failure into one operator page while retaining each affected route and venue in your view.
Do not suppress an independently failing collection or mail path as a side effect of grouping.
Required mail means delivery still needed for a current action/incident, excluding obsolete tokens
and deliberate cancellation. Latency is diagnostic; qualified latency percentile, capacity and spend
alerts remain measurement gaps to close before expansion, without inventing thresholds here.

Propose two fresh successful samples **at least 60 seconds apart**, with no intervening
failure or gap over 90 seconds, to close route, control API or observer incidents. A collector
success clears only collection failure; a current unready snapshot keeps its own problem open.
Contact needs new accepted contact. Snapshot lateness needs a qualifying capture for the due
slot; verification needs a qualifying result, not merely a new pending artifact. Certificate
recovery needs fresh trusted evidence beyond 30 days. Queue recovery needs fresh evidence
that the overdue work settled or was explicitly reconciled, not an empty/stale scrape.
Never close an incident from absent or stale evidence. Removal/revocation is suppression,
not recovery, and sends no recovery message (`docs/local-monitoring.md:44–46,163–176`).

## A late backup is relative to its schedule

Daily snapshots are the adopted starting frequency; scheduling detail remains open
(`docs/superpowers/specs/2026-10-21-cloud-hosted-venue-design.md:144–148`). Propose a per-installation
**UTC due time**, approved before enablement, including its first due slot.
The two-hour tolerance covers capture, publication and qualifying verification for that slot.
A missing schedule is a configuration work item and blocks enabling this rule; it is not healthy.
Never turn “two hours late” into “capture every two hours” or use verification time to rejuvenate
old data. Preserve monthly retention and last-verified-copy protection independently.

Each daily slot starts at its due time and ends just before the next due time. A capture belongs
to exactly the slot containing its capture timestamp; publication or verification may finish later.
It cannot fill an earlier missed slot. A qualifying capture in the current slot restores current
coverage even after several missed days, but those older slots remain recorded as missed, never
rewritten as successful. Keep one lateness episode open until current coverage is restored; do
not create a page for every missed day. If yesterday's artifact qualifies today, today's due slot
still needs its own capture. Version schedules and their effective first due time: changes apply
only to future slots and cannot move an already due deadline or erase missed history. A separate
configuration work item records any requested change that cannot satisfy that rule.

Qualification must bind the artifact, source identity/generation, formats, verifier and current
restore target. D79 remains blocked: its unpublished migration **043** is untouched and supplies
no evidence on this base (`docs/launch-evidence.md:31–33`; `docs/backlog.md:1047–1062`). Legacy
`verification='verified'` flags cannot promise a valid current-target backup. Until the D79
release/evidence gates pass, report qualification unavailable, create operator work immediately
and block backup-service activation; do not emit a reassuring backup recovery or customer claim.

Continuous stream recovery has **no qualified production lag metric** here. Contact/probe freshness
cannot supply a five-minute recovery target. A later joint contract must bind source/uploaded/applied
progress, generation and observation age, then measure isolated recovery
(`docs/superpowers/specs/2026-10-21-cloud-hosted-venue-design.md:129–134,146–150`).

## Worked timelines under the proposal

- **Short route blip:** fresh failure at 10:00 appears immediately; successes at 10:01 and
  10:02 confirm recovery. The three-minute phone rule never qualifies; recovery before the
  10:05 mail deadline cancels opening, reminder and recovery mail. You still retain the incident evidence.
- **Persistent route outage:** fresh failures at 10:00, 10:01, 10:02 and 10:03 produce one
  phone page at the first evaluation at/after 10:03. Mail becomes eligible at 10:05. If its
  sent result commits at 10:06, its only reminder becomes eligible at 11:06, provided it stays
  open. Successes at 11:10 and 11:11 confirm recovery; eligible prior recipients can receive recovery mail.
- **Late daily snapshot:** assuming you approved 02:00 UTC daily, Monday's qualified 02:00
  copy does not satisfy Tuesday's slot. Tuesday 04:00 detects/pages lateness; mail is eligible
  at 04:05. A Tuesday capture at 04:12 qualified at 04:18 clears it then. Rechecking Monday's
  archive at 04:10 does not clear it. This example is conditional on D79 qualification, not today's capability.
- **Stopped collector and failed email:** last successful collection is 12:00; the collector
  stops immediately afterward. Its cached sample expires at 12:01:30 with current defaults;
  an outside observer pages at 12:05 from last-success age. Venue incidents stay open/unknown.
  Separately, a required mail queued at 12:00 warns at 12:05 and pages at 12:10 if pending;
  a terminal failure at 12:03 pages immediately. Neither phone path depends on that email queue.

These times assume punctual evaluation; they do not guarantee delivery.

## Responsibility, readiness and missing capabilities

Persist a phone episode's identity, first P1 eligibility time, delivery attempts and acknowledgment
outside evaluator memory. Bind it to the signal, affected resource/revision and uninterrupted
problem episode. First committed P1 eligibility starts the acknowledgment clock, even when
delivery fails; restarts, repeated samples, correlation and provider retries never reset it.
D104 must retain observation-gap episode state outside the affected Cloud deployment so a
database or regional outage cannot disable its own alarm.
Acknowledgment must name that episode and come from the authenticated operator. Keep one initial
page identity and one repeat identity, with retry/deduplication behavior qualified under D104;
lost provider replies may duplicate delivery and are never evidence of acknowledgment.

Propose phone acknowledgment within **10 minutes**, one repeat to you if unacknowledged at
10 minutes, and an unattended marker plus monitoring-cohort expansion pause at **20 minutes**.
Delivery failure also needs the independent D104 path; do not rely on this same failed provider.
The pause stops adding monitoring cohorts only. C41 will separately propose application-release
pause rules; this policy neither stops trading nor changes service activation permissions.
There is no assumed second responder. Review an acknowledged open P1 every **30 minutes**;
acknowledgment never closes it. D104 owns the actual paging provider, the outside check that detects
a stopped observer, acknowledgment delivery, public status and runbook. None is activated here.
Monitoring mail remains owner-opt-in EN/ES incident/recovery mail; this draft sends no customer notice.

Keep traffic admission on the API's own readiness and process replacement on liveness
(`docs/operations-status.md:187–200`). Aggregate readiness includes delayed mail, backups and usage;
do not drain traffic or restart healthy workers merely because it is degraded
(`packages/operations/src/status.ts:102–124`). Liveness is not a working customer journey;
a green probe is neither recoverability nor permission to activate.

Current config cannot express schedule-relative lateness, phone routing, severity, sustained confirmation,
new-terminal-mail tracking or complete target coverage. These need later approved work, not invented options.
Keep test-environment, schema, service, installation, route, recipient and live delivery gates intact.
No automatic failover, repair, permission, key, security or activation change follows an alert.

## Minimise data and qualify before rollout

Keep metrics to fixed labels (`packages/operations/src/metrics.ts:13–25`); phone payloads contain only severity, bounded issue, time and an authenticated incident link.
Exclude venue names/content, email addresses, hostnames, certificates, raw errors, secrets and
backup paths; restrict detailed incident lookup to authorised access. Keep email payloads encrypted
and existing sent-receipt/cleanup dependencies (`docs/local-monitoring.md:171–190`); choose no new
automatic retention period. Qualify paging metadata's supplier, location and deletion before export.

Preserve D101 country-pack regions: Spain data/logs/keys in `eu-south-2`, one qualified extra EU
backup, and the separately qualified D102 EU SES exception. Preserve per-session support approval,
narrow emergency access, cold recovery and exit/deletion gates; monitoring grants no new access
(`docs/superpowers/specs/2026-10-22-cloud-data-protection-design.md:19–29,98–108`). Waitron keeps
capture/restore/activation ownership (`docs/documentation-ownership.md:28–47`); preserve D88's
bilateral, fencing, target and release gates (`docs/superpowers/specs/2026-10-21-cloud-hosted-venue-design.md:124–150,275–285`).
D101/D88 full approval and `docs/launch-evidence.md:170–197` remain prerequisites.

After full design approval, a separate plan must define failing behavioural tests first for boundaries,
these timelines, unknown/recovery, schedule slots, coverage and independent collector/mail failure.
Preserve existing recipient, restart, sent-receipt and revocation assertions.
Omit each critical freshness, identity, qualification, authority and sent-opening guard individually in
a disposable candidate and require its test to fail. Retain receipts; qualify deployed observation and paging.

Propose a **7-day** observation-only rehearsal followed by **7 days** paging one approved cohort.
Pause expansion immediately on a missed P1, false recovery, undeliverable page, coverage gap,
privacy/gate breach or two false P1 pages in 24 hours. Keep observation running where authorised.
Re-evaluate after each stage, every **30 days**, and after schedule/topology/verifier/provider changes,
using detection, false-page, unknown-time and acknowledgment evidence. Resume only after you accept corrections.

The full design, including its thresholds, five-minute mail quiet time, one 60-minute reminder
and sole-owner paging rules, is approved for separate planning. Build and enablement remain
gated; decide the exact daily schedule and first monitored group before enablement.
The [C41 release/upgrade proposal](2026-10-22-cloud-release-upgrade-design.md) remains a
separate, unapproved decision.
