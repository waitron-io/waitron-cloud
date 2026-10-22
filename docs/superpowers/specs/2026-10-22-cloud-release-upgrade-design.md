# Release Cloud and upgrade hosted venues without losing accepted work

**C41 · 2026-10-22 · PROPOSED, unapproved and unbuilt. Engineering design only.**

You need to stop a bad release before it reaches more venues, without treating an old
image or backup as permission to undo accepted work. Recommend one recorded release
identity, separate rollout boundaries for shared Cloud services and hosted Waitron,
and human approval whenever a paused release resumes. This proposal supplies the
engineering policy for a later plan. It supplies no production orchestration or proof,
and makes no availability, recovery-time or tolerated-data-loss promise.

The owner requested C41 after C39 on 2026-10-21. The full [C39 monitoring design](2026-10-22-cloud-monitoring-thresholds-design.md)
was approved on 2026-10-22 around 08:35 **for planning only**. Its exact daily backup
schedule and first monitoring cohort remain gated.
All C41 defaults below are **recommendations requiring full proposal approval**.
C60 compute and sizing remain a separate decision.

## Give the release one identity before choosing its audience

A source commit alone cannot tell you whether a deployment can read its database,
decrypt old work or communicate with the venue. Propose an immutable release record,
identified by the digest of its canonical contents. A digest is a content fingerprint;
changing any input creates a new release identity. Store actual installed versions
alongside desired versions, since a failed rollout can leave both in service.
Verify artifact digests and authenticated build provenance before installation;
record your release authorisation separately. A matching digest identifies bytes,
not who approved them.

| Bind into the proposed release record | Why you need it |
| --- | --- |
| Cloud commit, lockfile, built image digests for each architecture, base/runtime dependencies and portal assets | You deploy the tested bytes, rather than rebuild a mutable tag during rollout. Pin PostgreSQL and gateway dependencies too; an engine upgrade is its own qualified operation. |
| Complete ordered migration names and SQL digests, required conversions, supported schema and data formats | A matching migration count does not establish compatibility. Record both the starting and resulting ledger and the point beyond which the old release is refused. |
| Non-secret configuration revision, feature switches, secret references and required key IDs/versions | Code rollback must retain keys needed by current rows, queued work and backups. Record references, never secret values or guessable secret hashes. |
| Waitron release/package pins, protocol/capability versions, restore/verifier and external-vault formats, runtime and module composition | The same app version with different modules or restore hooks may not restore or run the same venue. Unsupported combinations must refuse before effects. |
| Country-pack, placement, access and security policy revisions; route/reconciler formats and trust-key versions | An old release must not restore revoked routes, broaden support or send data to an obsolete destination. Code versions do not supersede current authority. |
| Exact-candidate CI, version-pair upgrade/recovery receipts, independent restore evidence, compatibility matrix and approved exceptions | Evidence qualifies this combination and its stated scope. A local fixture or another commit's green CI is not production qualification. |

The compatibility matrix names each producer and consumer: account/worker to database,
gateway to reconciler, Cloud to Waitron machine client, backup to verifier/restore
consumer, and runtime to installed modules/configuration/keys. Mark each pair supported,
refused or unqualified, including the proposed rollback target. Test both refusal and
success; a version range without receipts is unqualified. Any changed effective input,
including a security patch or policy change, invalidates affected evidence and requires
a new release record. Keep current authority checks live even when a release is pinned.

## Stage the boundary you can actually isolate

A **cohort** is a fixed list of venues receiving the same candidate. A **cell** is a
bounded hosting/gateway group operated together. These are different from the shared
Cloud account services and management PostgreSQL. One venue cannot canary, meaning
try first for everyone else, a migration of a database everyone shares.

| Change boundary | Proposed release treatment |
| --- | --- |
| Shared Cloud control plane, account API, database and database workers | Rehearse on an isolated synthetic stack, then use one approved shared maintenance operation. Stop every affected database consumer before migration. Current packaging requires the complete release ledger, so assume no mixed-version database fleet. All dependent venues can be affected at shared cutover; venue cohort success cannot prove otherwise. |
| Gateway and route/reconciler changes | Rehearse the pair together. Stage a cell only if its serving, publication and failure boundaries are demonstrated independent. A shared signer, reconciler or route-format change is a shared operation even when one cell is selected first. |
| Separately hosted Waitron instances | Upgrade fixed venue cohorts under the joint Waitron lifecycle contract, with per-venue stop, capture, compatibility and activation evidence. A venue's own SQLite migration can be staged here; the shared Cloud migration cannot. |
| On-premises Waitron | Keep its update consent, installer and writer authority in Waitron. C41 defines Cloud compatibility and evidence prerequisites, not a remote-update permission. |

For a coordinated release, qualify and install the shared compatibility prerequisite
first, complete its hold below, then begin hosted cohorts. Older venue clients must
continue working through that hold and the entire rollout. If the new Cloud side cannot
support them, propose a separately approved coordinated outage with its full scope;
do not disguise it as a small venue trial. No migration number is allocated here.

## Recommend bounded stages with enough evidence

Before any production stage, require the launch gates, deployed C39/D104 observation
and phone qualification, an approved maintenance window and venue consent where needed.
C39's seven-day observation rehearsal and seven-day paging rehearsal remain separate
prerequisites; C41's shorter soaks do not replace them. Name all expected targets and
record **30 continuous healthy minutes** immediately before starting. An absent target
or unqualified backup blocks admission. Recommend one named release owner, initially
you, actively available through disruptive work and the first **60 minutes** afterward.
Longer soaks need your recorded phone coverage, not continuous screen watching.

Freeze the eligible population, ordered cohort IDs, installation/placement revisions,
consent and maintenance windows when authorising the release. Recheck authority before
every effect. Revocation or replacement removes eligibility and pauses that member;
never silently substitute another venue to keep the denominator green. A changed list
requires a recorded revision and new admission checks. Do not overlap a venue with
restore, move, cancellation, key retirement or another upgrade.

These exact starting defaults are proposals, not observed safe durations:

| Stage | Minimum observation and evidence | Maximum unattended wait before an owner decision |
| --- | --- | --- |
| Internal synthetic | **60 continuous healthy minutes**, at least **60 complete synthetic journeys** through the affected functions, plus one interrupted/retried upgrade and an independent restore with matching keys | **4 hours** |
| Shared production change, when applicable | One maintenance cutover, then **24 continuous healthy hours** on the shared deployment, at least **100 successful representative synthetic journeys**, including a relevant scheduled job cycle | **48 hours**; no hosted rollout before acceptance |
| One opted-in hosted venue | **24 continuous healthy hours**, at least **100 successful read journeys and 20 ordinary accepted mutations**, plus one scheduled backup qualified for the current target | **48 hours** |
| Small hosted cohort | **min(5, remaining eligible venues)**, each meeting **48 continuous healthy hours**, the same **100 reads / 20 mutations** and a qualified scheduled backup | **96 hours** |
| General hosted rollout | Fixed ordered waves of **min(20, max(1, ceil(10% of the frozen eligible population)), remaining venues)**; each wave meets **24 continuous healthy hours** and the same per-venue evidence before you authorise the next | **48 hours per wave** |

If no venues remain, skip the empty stage explicitly. The shared row applies to a
shared change, not every venue-only release. Synthetic journeys must exercise actual
affected boundaries: authorised account/configuration reads, route challenge and staff
TLS, stable-operation retry, tenant refusal, queue settlement and backup/restore where
changed. Run mutations only in an isolated test venue, or use ordinary authorised live
work as evidence. Never fabricate sales, payments or fiscal submissions to fill counts.
A TLS handshake is not a trading journey; a hosted release additionally needs the
Waitron-approved functional checks for its modules and device path.

Low traffic does not pass by waiting out the timer. At the maximum, remain paused until
you extend the window or approve a documented alternative evidence requirement. Keep
the original shortfall visible. A soak measures continuous healthy evidence after the
last disruptive action; failure, unknown evidence or a disruptive correction resets it.
Keep earlier counts as history, but count qualifying traffic again in the new window.
Your explicit acceptance advances each stage. The final wave's gate closes the release;
no percentage or timer authorises expansion by itself.

## Pause early; page using C39

Use **healthy** only when every expected target has fresh, revision-bound positive
evidence, no overdue, failed or uncertain required job or compatibility failure, and the stage's tests
pass. **Unknown** means missing, stale, wrong-revision or failed observation. **Error**
means a completed adverse observation. Keep those outcomes separate from a process's
exit status. C39's five-minute freshness is an outer limit; its 90-second confirmation
gap still breaks route/API/observer recovery and release soak continuity.

Required checks follow the operation's phase. During an authorised stopped-writer
window, require affirmative stop, backup, migration and independent-observer evidence
instead of a successful request to the deliberately stopped API. Record expected
impact and the window before stopping; unplanned scope or exceeding the proposed
**60-minute maintenance bound** pauses new effects for your decision. Planned downtime
never counts as healthy soak time or suppresses C39 phone rules. An observation or
authority gap cannot be relabelled planned maintenance after it happens.

Recommend pausing further admission immediately on the first failed phase-required check,
any unknown required evidence, open P1/P2 affecting the release, parked/uncertain job,
coverage gap, missed page, false recovery, or authority/privacy/integrity breach.
Recommend immediate P1 for a confirmed release-caused authority, privacy or integrity
breach; that C41 addition uses C39's existing phone/acknowledgment process.
Block on known degradation in a shared dependency even if it predates the candidate;
record attribution separately. A pause stops expansion and new disruptive steps, not
healthy trading or essential recovery/credential renewal. Settle an already accepted
operation at its safe boundary; do not kill it merely to enforce a pause.

Phone severity and incident closure retain C39's planning-approved rules:

| Signal | C39 rule you carry into release decisions |
| --- | --- |
| Route or control API failure | P1 after fresh failures span **3 minutes**, new failures at most **90 seconds** apart and one at the deadline. Two fresh successes at least **60 seconds** apart, with no failure or gap over 90 seconds, close the incident. |
| Observation gap | Unknown immediately on failed/missing collection; observer P1 at **5 minutes** since last success or persistent failure, whichever first. Venue-monitor/probe absence or age reaches P1 at **5 minutes**. A collector's recovery does not clear an unready service. |
| Contact, snapshots and certificates | Contact detects at **15 minutes**, P1 at **20** with current collection; scheduled qualifying capture missing at due time **plus 2 hours** pages then; latest-artifact verification failure sustained **5 minutes** pages. Certificate P2 at **30 days**, P1 at **7 days**, on fresh trusted evidence. |
| Email, backup/configuration jobs and usage | Email P2 at **5 minutes** pending or expired processing lease, P1 at **10 minutes** pending or **5 minutes** unresolved expired lease; newly failed/expired required mail is immediately P1. Other job/usage P2 at **5 minutes** overdue/stale or a parked job, P1 **15 minutes after P2** if unresolved. |

Use C39's full signal-specific recovery conditions, slot qualification and unknown
handling. Schedule-relative backup gates cannot operate until the exact schedule,
first slot and D79 qualification are accepted. A legacy verified flag does not pass.
Five-minute mail quiet time and one reminder 60 minutes after each committed opening
send apply to opted-in monitoring mail, not the phone or release-pause clock.

You are the concrete stop/resume decision owner. Record the release, scope, reason,
actor and UTC time for every manual or automatic pause. A P1 hands off to the
[D104 runbook](../../incident-response.md): acknowledge the episode within the proposed
**10 minutes**, one repeat then if unacknowledged, unattended marker at **20 minutes**,
and review an acknowledged open P1 every **30 minutes**. Keep the episode/deadlines and
an independent release-pause record accessible outside the affected deployment.
Publish confirmed impact, or unknown observation, through the independent bilingual
status path; give private notices through authorised contacts. Neither email nor Cloud
login can be its only failure route. No second responder or continuous response is assumed.

Resume only when you record the correction, reconciled effects, current authority,
restored coverage, C39 recovery evidence and new soak start. A green sample or alert
acknowledgment cannot resume a release. If you are unavailable, pause expansion; an
urgent security problem stays an incident until you can authorise the next action.
D102/D104 hands-on provider, page and phone qualification waits until **3 November**.

## Persist intent and recover uncertainty before continuing

Propose durable release states: **prepared**, **authorised**, **running**, **paused**,
**reconciling**, **completed**, **aborted**. Persist the immutable candidate, rollout
revision/membership, stage deadlines/counts, installed inventory, decisions and every
per-target operation. Within an operation record stop, backup, migration, conversion,
verification, activation and route publication as separate effects with intended,
uncertain, confirmed or refused outcomes. Record intent before an outside call.

Use one active release across shared Cloud dependencies and, initially, **one disruptive
venue operation globally**. This deliberately conservative concurrency is a C60
measurement question later. Serialize per-venue lifecycle work too. Before every effect
and completion, compare the recorded release, venue lifecycle, placement and worker
claim revisions. A claim is temporary permission for one runner; replacing it must
exclude the old runner's later completion. A lost reply requires status reconciliation,
not another migration, credential issue or activation. No database transaction can make
a PostgreSQL update, provider call and Waitron activation atomic together.

After a runner crash or loss of its journal/independent observer, default to paused.
A restarted runner may inspect and record outstanding outcomes, but starts no new
disruptive effect until you explicitly resume. If an issued operation may have activated
or written, retain its disks, ledger, generation and credentials needed for investigation;
reconcile its actual authority before cleanup. A lease expiry is not writer-stop proof.
A late completion cannot change stage membership, erase a pause or publish a stale route.

For simultaneous releases, queue the later one against the actual installed baseline.
An emergency patch can supersede a paused release only after you freeze it, reconcile
its effects and authorise a new candidate from that baseline. Already upgraded venues
keep their recorded versions and necessary compatible service while other venues remain
old. Partial success never becomes general success or a reason to erase new writes.

## Migrate with stopped writers and prove the recovery point

Recommend the following admission contract for each schema-changing operation, rather
than an online-migration promise:

1. Inventory and stop admissions and every database writer, scheduler, operator script
   and consumer in scope. Drain accepted requests and jobs, preserving operation IDs,
   queue claims and external outcomes. Prove stopped processes and blocked re-entry;
   route withdrawal or a heartbeat gap alone is insufficient. A bounded drain of
   **5 minutes** is proposed; an unresolved outcome pauses for reconciliation, never
   becomes permission to force a migration or replay a payment/message.
2. Capture a consistent pre-upgrade backup **after** quiescence, meaning stopped writes
   and settled or explicitly recorded in-flight work. Bind its recovery point, digest,
   source identity, schema, release and required external keys. For hosted Waitron,
   include module-owned state and the accepted final-write/stream handover. Preserve
   the current ledger and protected older copy if capture fails.
3. Restore that exact backup independently into a fresh isolated target with matching
   external keys and the named consumer. Verify tenant isolation, required decryptions,
   retries and module integrity with business/fiscal/payment/message workers disabled.
   This must work without the original workload. Hosted current-target qualification
   additionally waits for D79 and its released Waitron dependency. Successful upload,
   provider snapshot creation or verification of a different artifact does not pass.
4. Apply only the candidate's forward migrations and explicit data/key conversions,
   with one migration owner. Check the complete resulting ledger before starting
   consumers, then verify the new data formats and keys before reopening admission.
   Qualify interrupted migration and retry for this exact version pair. A migration
   runner's advisory lock serializes runners; it does not stop application writers.

The independent restore prolongs the stopped-writer window. Accept and measure that
cost before enabling the operation. A future faster approach needs evidence for its
actual recovery point; a previously restored unrelated backup cannot substitute.
An additive SQL change is not automatically rollback-compatible: today's packaged
consumers demand an exact manifest. An older binary must refuse an extra migration.
Never bypass the gate or delete migration ledger rows to make it start. A compatible
forward fix is a **new** candidate carrying the actual schema, keys and current policy,
even if it reuses earlier application logic.

Waitron owns planned stop, all-peer fencing, restore hooks, membership, writer generation
and activation. Fencing proves the previous writer cannot write or file even when
isolated. Cloud cannot infer it from a pod deletion, route change or revoked Cloud lease.
Require an accepted version of the proposed
[hosted lifecycle contract](../../waitron-integration-contract.md#hosted-lifecycle-and-promotion-proposed)
and the D88 gates; no new Cloud fiscal permission, series allocation or activation bypass
is proposed. A merely restored/verified server remains non-writing and unrouted.

## Choose rollback, forward repair or restoration explicitly

**Code rollback** reuses a proven compatible artifact against the **current** database
and current authority. It preserves all accepted writes and operation receipts. Require
positive compatibility for schema, new values, protocols, configuration, keys, jobs and
security policy; then treat rollback as another recorded disruptive operation with
verification and a fresh soak. Hosted Waitron keeps D88's stricter boundary: after new
writes or a new generation, do not resume the previous image/identity as a shortcut.

**Forward repair** keeps the current data and introduces a newly qualified compatible
release. Recommend it after an incompatible schema change, new writes/generation,
revoked credentials, an irreversible conversion or a security patch whose predecessor
is vulnerable. Do not silently reactivate a vulnerable image or disabled permission to
restore service. If no safe repair is ready, keep affected admissions stopped and use
the incident path; no response-time promise forces an unsafe downgrade.

**Restoration** creates an isolated recovery target from a named point. It is not release
rollback. You may inspect it without routing traffic, while preserving the upgraded
source. Making a recovery target authoritative needs a separate recorded decision by
you as incident/recovery owner: stop scope and proof, exact available/missing tail,
affected services/venues, accepted-data reconciliation, external continuity checks,
authority and consequences. Never rewind reachable accepted tenant or fiscal writes
for rollback. If the source is actually lost, record any irrecoverable interval as
data loss requiring explicit recovery authority and affected-venue instruction where
applicable; no C41 blanket loss allowance is granted. Waitron's fiscal, all-peer fence
and fresh activation gates still apply and cannot be waived by that instruction.

Do not cut over a pre-upgrade copy that omits accepted later work as a routine fix.
Reconcile or repair from the preserved current ledger under the owning contract; no
generic SQL merge or blind external retry is proposed. Cloud's fiscal registry also
needs independently current outside history before issuing anything after a restore.
Your release approval, a healthy probe and possession of a backup key supply none of
that restore, data-loss or writer authority.

## Keep keys, routes and jobs compatible through the transition

Treat credential/key rotation as a release change with its own affected consumers.
Distribute a new read/trust version before switching writers/signers, verify old and
new retained data, then retire a version only after dependency and revocation checks.
Preserve matching email, factor, pairing, recovery, backup and application-vault keys
outside database backups. Follow the existing [pairing](../../pairing-code-keys.md#rotate-without-interrupting-pending-requests),
[recovery](../../recovery-code-keys.md#rotate-with-overlap) and
[factor](../../authenticator-app.md#rotate-and-recover-encryption-keys) procedures;
verifier secrets that cannot be rekeyed keep their original dependencies. Restore tests
must include missing/wrong keys. A compromised credential is revoked, not kept usable
for convenient rollback; reconcile its issued sessions and uncertain effects.

A rolling trust-key change needs explicit dual-trust support and tests on both sides;
current gateway manifests name no key ID and use a configured trust key. Do not assume
that overlap exists. Preserve cell sequence monotonicity and expiry across restarts and
code rollback. Reissue authorised current routes at a higher sequence instead of
replaying an old manifest. Check installation/hostname/configuration/claim revision
before publishing and accepting certificates/routes, and verify installed acknowledgments
and fresh target probes. Preserve staff private-key ownership, public allowlists and
current revocations. Unsupported route/protocol revisions pause, not fall back broadly.

For jobs, record queued, claimed, externally accepted, uncertain and settled work before
stopping workers. Test the candidate and rollback consumer on each retained job format,
lease, retry identity and encrypted payload. Stop claims, allow bounded completion,
and reconcile expired claims without duplicating already accepted external effects.
A database restore can lose a later operator stop: explicitly impose the current
release/delivery pause before starting restored consumers. Never send old mail, print,
pay or file merely because restoring a backup made a job pending again.

## Work through three failures

**Cloud-only code rollback.** Assume candidate `cloud-B` changes account rendering and
API logic, with exactly `cloud-A`'s database ledger, job formats and key dependencies.
After shared cutover, a required synthetic account journey fails. Expansion pauses on
the first failure; C39 pages only if its own rule qualifies. You confirm `cloud-A` is
still security-supported and the matrix permits it to read all values accepted by B.
You drain account requests, deploy A's retained image digest with current configuration
and keys, reconcile lost replies by their original operation IDs and verify current
rows and journeys. No database restore occurs, so account changes accepted by B remain.
Record A as installed and begin a new soak; you decide whether to abort B or propose C.
If that compatibility assertion fails, this example takes the forward-repair path.

**Incompatible schema failure after writes.** Assume B migrates the shared management
database and then accepts installation renewals and owner changes before a worker
fails on a converted row. One opted-in venue cannot contain this shared change.
Pause expansion and affected admissions, settle known jobs and preserve the entire
upgraded database. A's old manifest refuses startup. Restoring A's pre-upgrade dump
into an isolated target proves that old point is readable, but omits the accepted
renewals and changes, so you do not route production to it. Build a new compatible C
with B's complete schema and current keys/policy, repair forward, and prove operation
replay and tenant isolation before resuming. If the upgraded source is destroyed,
open a separately authorised disaster recovery with the actual missing interval;
that is not rollback and does not grant permission to rewind a hosted fiscal ledger.

**Hosted Waitron upgrade with cross-repository gates.** Assume Cloud `cloud-C` must
support Waitron `venue-B`, new module composition and an externally keyed vault archive.
Pin both repositories' released artifacts and the joint accepted protocol, stop,
restore, activation and A951 route/certificate contracts. Require the independently
released strict-sandbox-compatible A1004 dependency and D79 current-target restore
qualification; the parked D79 tree is insufficient. Keep this case blocked until
those and broader D88 hosting/isolation approval, device checks and provider gates pass.

Once authorised, upgrade the internal synthetic venue, then the one opted-in venue.
At that venue, settle in-flight bills/device/fiscal outcomes through Waitron, prove
all-peer stop, capture and independently restore its exact backup, then migrate and
validate without business workers. Only Waitron's accepted activation result permits
routing to the target. If the activation reply is lost after a new sale, record
uncertainty, query the same operation and retain the new ledger/generation. Do not
restart venue-A on the old disk or repeat activation. Repair forward or use the
separately authorised recovery path, then restart the soak. Other venues remain on
the recorded compatible old release until you accept the cohort gates.

## Retain the ability to explain and recover a release

Recommend retaining immutable application artifacts and sanitised release manifests,
compatibility/CI receipts and pause/decision history for the **current and two preceding
qualified releases, for at least 90 days after supersession**, whichever keeps them
longer. This is an artifact recommendation, not a new customer-data retention policy.
A retained vulnerable artifact is quarantined from deployment. Keep referenced artifacts
longer when a live supported composition still requires them.

Store no tenant payloads, raw logs, database dumps, decrypted exports or keys in that
artifact record. Private target mapping, incident evidence and operational backups follow
their separately approved D101 purpose/location/access/deletion policy, not this 90-day
artifact rule. Backup/key dependencies require an explicit retention authority; they
cannot silently prolong exit retention or override earlier verified deletion. Keep Spain
data/logs/keys at home and the conditional Paris backup decision, without assuming
regional key independence or an additional provider capability.

## Read existing commands as local receipts, not a production controller

Source inspection uses Cloud **`0f5d7be04baaf072234e3fb19a554ba524ce7f1f`**.
The following are existing entry points and source receipts; none was executed for
this authoring milestone. Run version-pair proofs later only for a supported mode
and its exact pinned releases, not arbitrary migration counts.

| Existing source or command | Demonstrated/documented scope and limit |
| --- | --- |
| `scripts/local-stack-lifecycle.mjs:13`; `deploy/local-stack/runtime.mjs:11,55`; `packages/registration/src/migrate.ts:9` | Local upgrade builds, stops, recreates; packaged database consumers compare full SQL digests; migration runners serialize and reject unknown/changed entries. Source inspection, not new runtime evidence. The current manifest ends at 042. |
| `pnpm local-stack:upgrade`; `pnpm proof:local-stack /tmp/cloud-local-stack.json`; `pnpm verify:local-stack /tmp/cloud-local-stack.json` | [Local lifecycle receipts](../../local-deployment.md#rehearse-the-complete-lifecycle) cover packaging and same-schema recreation. Compose rebuild and tags are not an immutable production artifact registry or rollout journal. |
| `pnpm proof:schema-upgrade /tmp/cloud-schema-upgrade.json`; `pnpm verify:schema-upgrade /tmp/cloud-schema-upgrade.json` | [Pinned 26-to-27 rehearsal](../../local-deployment.md#rehearse-a-schema-changing-upgrade); `scripts/schema-upgrade-receipt.mjs:129,224,230,280` captures `pg_dump -Fc`, separate `pg_restore --exit-on-error`, external-key checks and versioned limits. Later explicit factor/relay/monitoring modes cover only their named pairs. |
| `pnpm proof:database-recovery`; `pnpm verify:database-recovery /tmp/waitron-cloud-database-recovery-receipt.json` | [Physical local recovery](../../database-recovery.md#read-the-evidence) proves a named replay point, retry and worker recovery in recorded synthetic fixtures, not provider failover or fiscal continuity. |
| `scripts/test-cloud-deploy.mjs:9,24`; `deploy/local-stack/Dockerfile:2,23` | LAN deployment checks an image ID and rendered restrictions; local image build uses locked packages and a build secret. Neither supplies release provenance/signing, production upgrades or cohort control. |
| `packages/remote-access/src/manifest.ts:7,17,34`; `reconciler.ts:144,180` in that directory | Existing signed v1 cell sequences, bounded expiry and current job/authority checks ground the route requirements. They do not prove the future appliance acknowledgments or a dual-key rollout. |
| `.github/workflows/ci.yml:32,175`; `scripts/ci-plan.mjs:11`; `scripts/ci-docs.mjs:31`; `scripts/ci-scope.mjs:63` | CI selects audited prose-only PR checks or affected package/receipt work with conservative fallback; main pushes use full work. It checks code, not deployed rollout health or provider recovery. A future release requires the exact candidate's complete required results. |

The [launch evidence gate](../../launch-evidence.md#pass-the-production-evidence-gate)
still owns production qualification. Future orchestration must demonstrate crash/pause
persistence, stale-runner refusal, membership stability, cross-release compatibility,
partial failure and all three worked outcomes before enablement. Prove the refusals
as well as success under TDD in separately authorised implementation; this document is
neither that plan nor operational evidence. Provider selection, artifact custody,
maintenance execution, capacity, concurrency increases, drain/soak timings and recovery
costs need deployed measurement, including C60. No new provider facts are asserted here.

## What approval would decide, and what remains gated

Full C41 proposal approval would select this release identity, shared-versus-venue split,
stage/count/timeout defaults, stop/resume owner and rules, compatibility and recovery
boundaries, and sanitised artifact-retention recommendation **for separate planning**.
The driver should put one concrete full-proposal approval question to the owner after
fresh review. Publication here records **unapproved/unbuilt**, not consent.

Implementation, production rollout and maintenance windows, first venue/cohort consent,
C39's exact daily schedule/first cohort, tolerated loss/recovery objectives, broader D88
hosting/isolation and bilateral Waitron contracts, and C60 sizing remain gated. D101's
full engineering design is approved for planning only, including the 24-hour support
maximum and conditional Paris copy; its build authority, legal/provider/AI and runtime
gates stay open. D79 remains clean and parked at `fab41b1`, awaiting a released
strict-sandbox-compatible A1004 Waitron dependency; migration 043 is not on this base.
**No new migration may start.** D102/D104 hands-on work waits until 3 November.
No deployment, spending, provider access, fiscal permission or build authority follows
from this proposal.
