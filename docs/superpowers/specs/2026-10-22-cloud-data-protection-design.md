# Protect venue data when Cloud handles it

**D101 · 2026-10-22, authority updated 2026-10-23 · Owner-approved engineering design; roadmap approved and local slices 1–5 authorised. Other runtime controls remain unbuilt.**

You need to know who can see your venue's data, where copies go and what happens when
membership ends before you entrust Cloud with it. This proposal supplies Cloud's half
of that agreement. It does not approve a contract, establish legal compliance or enable
hosting. The first outbound AI refusal is implemented locally after separate slice 1 authority
on 2026-10-22. Other runtime controls proposed below remain **unbuilt**. Source inspection is not executed runtime verification.

Cloud source references use base **`60c0fbf25618a30977657fe74cce90fc5dbb915b`**.
The [ownership boundary](../../documentation-ownership.md) keeps application behaviour
in Waitron and managed services in Cloud. D88's [hosting design](2026-10-21-cloud-hosted-venue-design.md)
and [conditional outline](../plans/2026-10-21-cloud-hosted-venue-design.md) remain proposed.
The owner approved the complete D101/D88 data-protection engineering design from
PR283 (`9701cd2359d69f0a3e8960b761754cf492aac745`) on 2026-10-22 around 08:30
for build planning only. The [implementation roadmap](../plans/2026-10-22-cloud-data-protection.md)
records the reviewed roadmap. The owner subsequently approved it and authorised slice 1
initially. On 2026-10-23 around 08:15 the owner authorised local slices 2–5,
SQL-free slices 2/3 first and then 4/5 using the next actually available migration
slot after reconciliation with Lane G. Slices 6–12 remain unauthorised. Slice 2
publishes the [register](../../cloud-data-processing-register.md) and
[draft annexes](../../cloud-processing-annexes.md), with all supplier evidence
unqualified and all six lawyer questions open.
Broader D88 hosting/isolation and shared contracts remain unapproved; no deployment,
spending, provider resources or contract execution is authorised.

## 1. Keep the decisions separate from the recommendations

These are the owner's Cloud decisions of 2026-10-21, with the 2026-10-22
planning approval recorded below, carried into D101 and D88:

| Decision | Meaning for this proposal |
| --- | --- |
| Country packs choose locations | Each pack names a home region and permitted backup regions. Same-country hosting is not always possible. Spain uses AWS `eu-south-2` for venue data, logs and keys, with one extra backup copy in another EU region. |
| Translation sends menu text only | Never send personal data. Arbitrary text entered in a menu can contain it; section 4 proposes the missing outbound boundary. SES email in an EU region is a separate approved exception, owned by D102. |
| Cancellation provides an exit | Full standard-format download of database, latest backup and its key; plain fiscal-retention warning; backups read-only for 90 days, recoverable on resubscription; then delete everything except Cloud's own billing records. Section 6 records the approved engineering clocks and earlier-deletion handling. |
| Support needs approval each time | Time-limited session, every action logged and visible to you. **24 hours is the approved maximum** for one venue approval, shorter where practical; extension requires fresh approval. |
| Emergency has two conditions | Your venue cannot trade **and** cannot be reached. Access only keeps it running, with a log and a report straight afterward. Keys use AWS's key service; machines have scoped restore/verification access, Cloud personnel only these two support routes. |
| Standby starts cold | Start and restore only when needed. A continuously running Cloud follower is a future, unapproved option. Reliability and prices wait for measurement and D68. |
| Suppliers need exact qualification | AWS infrastructure, owner-selected Amazon SES in the EU; OpenAI is the actual translation adapter, Anthropic and Google remain candidates. No supplier chain is certified Spain-only by these decisions. |

The engineering design below is approved for planning, with the legal, provider and
separate AI-eligibility gates still open. D103's first C39 monitoring design was approved
for planning only on 2026-10-22 around 08:35; release and compute decisions remain separate.
D104 owns the incident runbook and an external public status page. Neither is built here.

## 2. Use one application map and purpose-specific roles

[A980 section 2](https://github.com/clintongormley/waitron/blob/96a1129e385447e9b9a6dc545673009953a2c551/docs/superpowers/specs/2026-10-22-a980-data-protection-design.md#2-the-data-map)
is the **one application data map**. Its document landed at `96a1129e3`; the inspected
Waitron main is `2e63a28a87f3f43e2f665f6fb8649fe2766aee84`. Its own code audit uses
`e032e2dd0`. This supplement maps Cloud flows to its category IDs, without re-auditing
or duplicating application columns. A980's r9 description of intended menu-only data
is not evidence that every free-text value is nonpersonal, nor a Cloud account inventory.

| Cloud flow and purpose | A980 categories and boundary |
| --- | --- |
| Hosted venue, stream, snapshots, restore and exit download | All applicable s1–s13, c1–c8 and d1–d9, carried through r1–r3; r4 configuration export is a separate, narrower application function. Hosting does not remove health data from c6 or s10. |
| Remote transport and public access | r10, with relevant s/c content and d1/d4–d8; future public booking/order traffic follows D88's exact-route contract. Cloud transport/security metadata must be inventoried separately from A980 d3's claim about application storage. |
| Human support and diagnostics | Only the s/c/d categories needed for the approved action. Existing customer diagnostics are narrower than a database or raw-log export; see [operations status](../../operations-status.md#download-a-customer-diagnostic). |
| Venue email through Cloud | r7, including s2/s13 and c1/c2 when the agreed message needs them. Cloud account verification/reset/alerts have Cloud's own account-service purpose, separate from venue mail. D102 qualifies the service. |
| Translation and problem reports | r9 menu text, subject to section 4; d9 reports link to d4–d8 and accidental s/c content. No automatic raw free text or database attachments. |
| Other routes | r5/r6/r8 and r11/r12 remain A980's fiscal, payment, identity, device and paper boundaries. Cloud hosting adds no fiscal authority or permission to change them. |

The venue decides the purposes of its staff/customer processing. Proposed role:
Cloud processes hosted data, managed backups and approved support on its instructions.
Cloud separately proposes controller responsibility for its own account administration,
subscriptions, billing and necessary service-security records. Keep those purposes,
notices, access rules and retention schedules separate. Role follows the activity,
not its label; see the [Commission's definitions](https://commission.europa.eu/law/law-topic/data-protection/data-protection-explained_en)
and the [DPC contract guidance](https://www.dataprotection.ie/en/organisations/know-your-obligations/controller-and-processor-relationships).

Before launch, Cloud's own register must name account/contact and membership records,
authentication material, email queues/delivery metadata, support/audit records, usage,
billing, gateway security metadata, incidents and exports. For each, record purpose,
role, data subjects, access, location, recipients and approved cutoff. This is a Cloud
service inventory, not a replacement field map. Minimal security retention remains a
lawyer question in section 10; a useful log is not automatically a billing record.

[A980 Q57](https://github.com/clintongormley/waitron/blob/96a1129e385447e9b9a6dc545673009953a2c551/docs/superpowers/specs/2026-10-22-a980-data-protection-design.md#9-questions-for-the-privacy-specialist)
already asks the role for encrypted relay traffic and bug reports used to fix the
software. Use that question and its answer for both halves; encryption alone does not
settle the role. Do not open a duplicate question or promise those flows are exempt.

## 3. Complete the processing agreement before offering it

Article 28(3)(a) requires processing “únicamente siguiendo instrucciones documentadas”
(only on documented instructions). The proposed starting point is the Commission's
[EU/EEA Article 28 model clauses](https://commission.europa.eu/publications/standard-contractual-clauses-controllers-and-processors-eueea_en),
with the following completed service outline for a lawyer to turn into an agreement.
These are not international-transfer clauses or a signed contract.
[GDPR Article 28](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807&lang=es).

| Proposed annex | Concrete contents to complete for each venue/service |
| --- | --- |
| Parties and instructions | Venue legal entity/controller, Cloud legal entity/processor, contacts and authorised approvers; service order, country-pack revision, permitted operations and change history. Reject unlawful instructions and notify the venue for legal resolution. |
| Subject, duration and people | Hosting, transport, backup/recovery, approved support and selected messaging; service term and instructed exit period; staff, diners, invoice recipients and identifiable device users from A980 section 2, including its health-data categories. No advertising, model training or unrelated reuse of venue content. |
| Security and assistance | Confidentiality duties and trained authorised staff; sections 4–8 controls; assistance with rights, breaches, security assessments and impact assessments; evidence access, audits/inspections and remediation. Record dependencies and unbuilt measures honestly. |
| Onward processing | Named suppliers, services, entities, purposes and locations from section 4; written authorisation, equivalent onward duties, advance change notice and an objection process. Recommend general authorisation with 30 days' notice and a no-new-flow hold while an objection is resolved, subject to legal approval. |
| Return, deletion and evidence | Section 6 instruction, download contents, earlier verified deletion, all copies, key dependencies, exceptional holds, status/receipts and audit access. Venue retains its controller duties and receives evidence needed to exercise them. |

This outline uses the [DPC's practical contract checklist](https://www.dataprotection.ie/en/organisations/know-your-obligations/controller-and-processor-relationships):
identify processing and parties, instructions, confidentiality, security, supplier
approval, assistance, exit and audit. The proposed notice interval and technical
workflow are engineering choices; they are not legal periods established by that guide.
Execution requires actual legal entities, selected suppliers and filled annexes.

## 4. Enforce a country policy and qualify every outbound flow

Propose a versioned policy per country pack: home region, permitted backup regions,
allowed data classes, named processing exceptions, supplier/service constraints and
approval evidence. Bind placements, jobs and credentials to that revision. Refuse an
unknown pack, stale location change or unspecified destination before sending data.
A new country may have a different home; translation is not globally Spain-only.

For Spain, the owner approved **Paris `eu-west-3`** for the one extra encrypted backup
copy to separate its regional failure boundary, subject to service, contract and
recovery qualification. This is an approved engineering choice, not provider proof.
Keep operational data, logs and AWS KMS keys in `eu-south-2`.
No automatic cross-region runtime failover or key replication is authorised. Test the
extra copy with its Spain key dependencies; until that passes, make no Spain-outage
recovery promise. An unavailable Spain key can make that copy temporarily unusable.
[AWS multi-Region keys](https://docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html)
replicate key material into selected regions. For this proposed Spain-key policy,
that alternative needs a separate owner decision; a backup copy alone establishes
no independent regional recovery.

The register must distinguish stored content, in-memory processing, logs, telemetry,
backups, keys, provider support access and global control metadata. Record the exact
service/account, contracting and processing entities, location/access countries,
retention/deletion, agreement version, onward suppliers and transfer mechanism with
review date. EU storage alone does not settle outside-EEA access. The
[Commission transfer toolkit](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en)
explains transfer routes; none is preapproved here. The owner's EU policy is narrower
than the EEA: Norway, Switzerland and the UK do not satisfy it by proximity.

| Supplier/service | Selection and qualification still required |
| --- | --- |
| AWS infrastructure, storage and KMS | Provider selected; exact deployed services/accounts and entities unqualified. The [AWS DPA guidance](https://docs.aws.amazon.com/whitepapers/latest/navigating-gdpr-compliance/aws-data-processing-addendum-dpa.html) says its DPA is incorporated in Service Terms. Capture applicable terms and the service-specific [subprocessor list](https://aws.amazon.com/compliance/sub-processors/), including regional entities such as Amazon Data Services Spain SLU and global support entities. Their published change notice does not prove Cloud's notice workflow or the venue agreement. |
| Amazon SES | Owner-selected EU email exception. The [endpoint table](https://docs.aws.amazon.com/general/latest/gr/ses.html) lists Paris and Frankfurt, with no Spain endpoint. D102 selects region/account and proves sender domain, SPF/DKIM/DMARC, tracking off, authenticated bounce/complaint intake, suppression, alerts and live delivery. Recipients' mail systems and transit need separate disclosure. This exception does not relocate stored venue databases, logs or keys. |
| OpenAI API | Actual adapter, not an approved production processing location. [Data controls](https://developers.openai.com/api/docs/guides/your-data) describe default abuse-monitoring content retention up to 30 days with exceptions. Non-US residency needs approval for abuse-monitoring controls and a Modified Retention amendment, per-project configuration and regional endpoint; system data is excluded. Capture exact entity, project/model/endpoint, terms, retention approval and access/transfer evidence before enablement. `store: false` proves neither EU processing nor zero retention. |
| Anthropic / Google | Candidates only. [Anthropic commercial terms](https://www.anthropic.com/legal/commercial-terms) name Anthropic Ireland Limited for EEA customers and incorporate a DPA; they do not prove account residency. The [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum) covers specified agreements; qualify the exact paid product/account and chain, not consumer Gemini. No silent provider substitution or candidate enablement. |

**AI stays disabled while input eligibility is unresolved.** Implement a deny-all
outbound gate first. Neither venue review nor a detector establishes that arbitrary
menu text contains no personal data. Before any AI request can be enabled, a separate
privacy-reviewed rule must identify eligible input sources and exact content, with
accepted positive/refusal examples and documented limits. D101 design approval alone
does not approve that rule or enable translation. Other D101 controls can be planned
independently. Keep this open rule in the privacy questions below.

**Proposed translation boundary after that separate acceptance, unbuilt:** extract
only necessary menu names and language context, assign temporary item IDs, minimise
category/house-style text and
show the exact outbound strings for venue review. Never send staff/customer records,
orders, prices, notes, credentials, venue identifiers or logs. A menu field called
`staffName` means an internal product name in the current parser, not proof of safety.
Personal contact details, names identifying a diner, health-linked instructions or
ambiguous private text require removal or refusal before the provider call. Review is
additional protection, not permission to send personal data. Recheck every first pass,
review pass, house-style value and retry, without logging rejected text. This affects
A980 r9's boundary, not the venue's allergy field or O6 decision.

At Cloud base `60c0fbf`, [job-body.ts:27](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/translation/src/job-body.ts#L27)
checks shape/length; [prompt.ts:50](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/translation/src/prompt.ts#L50)
includes internal names, category and house style; [openai-client.ts:13](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/translation/src/openai-client.ts#L13)
defaults to the general API and [line 63](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/translation/src/openai-client.ts#L63)
sets `store: false`. These inspected paths are not a verified personal-data detector.

## 5. Give machines scoped keys and people accountable sessions

Propose separate AWS KMS-backed authority for backup decryption, application vaults,
installation credentials and signing/TLS keys. Machine identities receive one venue,
operation, artifact/key version and expiry for restore or isolated verification. They
cannot activate a fiscal writer, browse unrelated data or export a master key. Keep
verification isolated from fiscal/payment services and messages. Preserve D88's fence,
Waitron activation and `external-vault-archive-v2` gates.

For normal support, ask an authorised venue approver for each session, naming the
operator, venue, reason, actions and expiry. Enforce the approved 24-hour maximum
for one venue approval, shorter when practical, with a fresh approval to extend. Refuse missing, denied,
expired, revoked, wrong-venue or overbroad grants. Cloud staff administrator status alone
never permits personal-data reads, shell access or decryption. Reauthenticate sensitive
approvals and make every read, command, decrypt request, refusal and outcome visible
to the venue without putting payloads or secrets in the audit log.

Revocation/expiry blocks new work immediately. Recheck before each data release or
external effect; cancel active reads/streams and queued commands. For an already
accepted effect, stop at a safe boundary, preserve state and reconcile the actual
outcome. Do not claim that cancelling a session undoes a completed command or rolls
back a ledger. Long-running work needs bounded operation credentials and cancellation
acknowledgements; pending revocation is visible, never reported as already enforced.

Emergency access requires recorded evidence of **both** inability to trade and failed
contact attempts, a named operator, incident, exact recovery-only scope and short
expiry. The initial single on-call owner self-attests those facts; do not invent a
second approver. Audit before access, limit commands to keeping the venue running,
then revoke, report actions/results to the venue straight afterward and record
notification attempts until acknowledged. No fiscal edits, unrestricted console,
silent master-key access or ordinary support under the emergency label. If the audit
path is unavailable, deny data access until an independent durable audit path exists.

At Cloud base `60c0fbf`, [support-grants.ts:87](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/registration/src/support-grants.ts#L87)
defaults actions/eligibility to empty; [line 131](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/registration/src/support-grants.ts#L131)
checks grants around a database callback. It is not a production shell/command or
emergency enforcement boundary. [security-audit.ts:6](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/registration/src/security-audit.ts#L6)
has fixed event types and [line 70](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/registration/src/security-audit.ts#L70)
an owner paging surface, not every-action evidence. [keys.ts:20](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/backups/src/keys.ts#L20)
uses a supplied master key; this is not evidence of deployed AWS KMS custody.

## 6. Make cancellation, return and deletion one recorded instruction

Article 28(3)(g) says return/delete is “a elección del responsable” (at the controller's
choice), with legally required retention excepted. Recommend writing the owner's
90-day read-only recovery period into the venue's explicit contract instruction.
Cancellation alone follows that instruction; it must not override an earlier verified
delete instruction. Counsel must settle exceptions before this policy can be offered.
[GDPR Article 28(3)(g)](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807&lang=es).

The approved engineering states are: **active**, **exit preparing**, **read-only until deadline**,
**purging**, **purged**. Record cancellation receipt and effective service-end time
separately. Compute the deadline once as 90 × 24 hours after effective end, using the
authoritative database UTC clock. Show both dates to the venue. Retried requests do
not move the deadline. This clock definition is an approved engineering choice, not statutory law.

Before ending writes, reconcile in-flight sales/filing and obtain Waitron's stop/final
capture evidence. Preserve the best existing backup if final capture fails; show its
actual recovery time and missing tail. Offer a consistent full SQLite database, latest
backup in its documented format, its portable decryption key, format/version manifest,
checksums and restore instructions, including required module state. If the latest
backup is unverified, label that and also offer the last verified one. Prove download
and offline restore without the old server or Cloud account; an AWS master key is
never the export key. External application-vault dependencies must be resolved first.
Require fresh authentication and current venue-owner authority for full downloads and
key release. Use expiring venue-bound delivery, recheck access during transfer and
exclude keys/payloads from logs; a billing contact alone cannot obtain the database.
Warn plainly: **You are now responsible for keeping your fiscal records. Download and
check your copies.** Do not invent a fiscal retention period or change any fiscal row.

At effective end, stop uploads, scheduled captures, translation, messaging and support
grants for that service, revoke producer credentials, and retain backups read-only.
The recommended live runtime/disk cleanup follows confirmed export readiness and stop
proof; an unavailable export remains an explicit failure to resolve, not silent loss.
Read-only means no new venue business writes or backup mutation; restricted download,
verification and instructed recovery remain possible before the fixed deadline.

Serialize cancellation, explicit delete, export, key retirement, retention jobs and
resubscription under one venue lifecycle revision. A job started under an older
revision cannot publish a new object or credential. Track outside calls and uncertain
outcomes durably; retries resume the same operation. At a verified earlier deletion
request, withdraw download links, cancel exports/readers, reconcile unfinished uploads
and begin deletion after the approved exception review. No automatic 90-day wait.

Before the deadline, resubscription may cancel pending purge only through the same
serialized decision and evidence that the retained data still exists. Restoration uses
D88's normal fence/activation gates. Once purging starts, recommend refusing restoration
until its outcome is known; never resurrect a deleted generation from a stale job or
platform backup. After purge, resubscription creates a fresh service and cannot recover
purged data. A download already received by the venue is outside Cloud's custody.

At deadline, delete all Cloud-held venue copies: home and extra-region objects and
versions, streams/snapshots, disks/disk snapshots, replicas/caches, staging/verifier
scratch, exports, unfinished multipart uploads, queues, support attachments, logs and
identifying metadata. Inventory shared platform/database backups too. If selective
erasure is unavailable, those backups need an approved bounded expiry and isolated
restore process that reapplies deletion instructions before access. Such a residual
copy is **pending deletion**, not deleted at day 90. Qualification must reconcile this
with the owner's policy before launch; convenience cannot extend it silently.

Preserve every needed key version until all authorised return/recovery dependencies
finish, then revoke grants and retire keys only after checking all dependent copies.
Do not destroy a shared key or another venue's recovery. Key deletion alone is not
proof that all plaintext/export copies disappeared. A receipt names policy/revision,
copy classes, provider observations, retries, remaining exceptions and final key state,
without retaining deleted payloads. Unknown deletion is failed/pending, never success.

[AWS KMS deletion](https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html)
has a mandatory 7–30-day waiting period, with possible additional provider delay.
A scheduled deletion is not completed physical deletion. At the exit deadline,
withdraw access, stop readers and remove cached/plaintext data keys; observe ciphertext
and plaintext copy removal separately. Record scheduled KMS deletion and confirm its
actual completion afterward. Restorability through day 90 and physical key deletion
at day 90 cannot be asserted from a schedule. Resolve the remaining key-retention
policy and contract wording before launch, rather than silently extending the owner’s
all-data deadline. Do not delete shared platform keys to erase one venue.

Cloud's own billing records are the owner's sole routine exception. Recommend retaining
only necessary Cloud invoice/payment evidence under a separately approved schedule,
with restricted access, not the venue database or a general support archive. Counsel
must define any required minimal legal hold, support/security-log exception, authority,
review/expiry and notification. Do not silently create one through this proposal.
At base `60c0fbf`, [history-cleanup.ts:6](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/registration/src/history-cleanup.ts#L6)
lists transient cleanup categories; it is not this all-copy cancellation/purge service.

## 7. Hand rights and incidents to the right owner

Use A980's rights tools for the same application wherever it runs. Its O1–O10 were all
answered on 2026-10-22 despite the canonical header: former-staff email clears after
one year only after specialist gates, keeping the name; delete sign-in credentials at
deactivation;
privacy link goes to the venue's own page; receipt/invoice wording awaits research
and asesor advice; staff download their own data, other-person/customer exports need
admin-only permission. No allergy hint, requests dashboard list, or region/encryption
warning/block for the venue's own backup storage. Automatic reports contain only
error/version/masked logs; typed text needs manager review and manual send. Use EN/ES
guide templates. These are decisions, not a claim those application changes have landed.

Cloud forwards verified venue-data rights requests to the venue and supplies authorised
search/export/access evidence; it does not decide fiscal erasure or build competing
rights screens. Cloud answers requests for its own controller-purpose records through
its separate contact/process. Keep request evidence minimal and access-controlled;
no new venue dashboard request list. A980/A664 specialist gates and immutable ledgers
remain unchanged. A whole-service cancellation is different from deleting one person's
rows in an active venue; a request for the latter goes through those gates.

Article 33(2) requires Cloud, as processor, to tell the controller “sin dilación indebida”
(without undue delay). The controller's applicable 72-hour authority-notification duty
is separate, not a 72-hour grace period for Cloud. [GDPR Article 33](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807&lang=es).
Propose immediate incident recording and prompt initial venue notice without waiting
for complete investigation: awareness time, affected A980 categories/venues, known
scope, containment, contact and next update. Record delivery/acknowledgement and
escalate failed notice attempts without waiting for the next scheduled update. Supply phased evidence to A980's breach
guide; D104's single-owner on-call path handles failed delivery/contact attempts.
Do not expose identifiers or payloads on the public status page. D103 sets measured
alert thresholds later. Reuse reviewed customer diagnostics before asking for logs;
A980 O9 masking and Q57 role resolution also apply at Cloud intake and onward sharing.

## 8. Prove the boundaries before enablement

These are approved engineering acceptance cases, not executed tests. The linked
[roadmap](../plans/2026-10-22-cloud-data-protection.md) maps them to implementation slices.

| Case | Required observable result |
| --- | --- |
| Spain job targets an unknown region or global default | No data sent; refusal identifies missing policy evidence without recording content. Extra backup goes only to the qualified EU destination; logs/keys stay home. |
| EU SES mail and another country's translation | SES uses the separately qualified D102 exception. Another approved country pack can translate without a Spain-only gate; no unspecified provider/location fallback. |
| Menu says “Croquetas”, then “Marta 600123456, sin frutos secos” | Even reviewed dish text remains blocked until the separate eligibility rule is accepted, then only eligible content may reach a qualified provider. Personal/contact/health-linked text is removed or refused before **any** model pass, including house style/retry; no payload in refusal logs. Ambiguous names require review/refusal, not detector assurance. |
| Support denied, wrong venue, revoked or expires during a command | No new data/effect; active streams stop, accepted effects reconcile; venue sees actor, scope, refusal/outcome and any pending stop. No admin bypass. |
| Venue cannot trade but answers the phone; or is unreachable but trading | Emergency access refused. Both conditions and failed contact evidence are required; valid emergency is scoped, expires and produces immediate venue report. |
| Machine verifies an older-key backup | Only that venue/artifact/key version opens; no business workers, activation or unrelated decrypt. Venue-approved human support is a distinct route. |
| Cancel twice; export crashes; earlier verified delete arrives | One fixed deadline, resumable export, actual backup freshness, delete supersedes retention; in-flight readers/uploads cannot recreate data. No fiscal row edits. |
| Resubscribe races day-90 purge; provider delete loses its reply | One serialized outcome; no stale restore, deadline extension or blind success. Reconcile all regions/versions/platform copies, then keys; residuals remain visible. |
| Incident or rights request arrives | Correct venue receives minimal evidence, Cloud-own records follow their own process, no duplicate application rights tools or public personal data. |

## 9. Conditional delivery and the one owner decision now

1. **Design approval recorded:** the owner approved the complete D101/D88 data-protection engineering design from PR283 on 2026-10-22 around 08:30 for build planning only. O1 is answered, including the 24-hour maximum, conditional Paris destination and exit/retry/concurrency rules. Broader D88 hosting/isolation and shared contracts are not approved.
2. **Roadmap approved, local slices 1–5 authorised:** the [roadmap](../plans/2026-10-22-cloud-data-protection.md) records the reviewed slices. Slice 1 was authorised on 2026-10-22; local slices 2–5 were authorised on 2026-10-23, slices 2/3 first and 4/5 subject to the actual migration slot. Slices 6–12 remain unauthorised. Complete lawyer-reviewed annexes, shared A980/Waitron contracts and supplier/location evidence before affected flows can be enabled. All six section 10 questions remain open; AI additionally requires separate privacy review and owner acceptance of eligibility examples and limits.
3. **Slice 1 implemented locally:** the outbound AI boundary refuses production calls; only explicit synthetic loopback proof is available. Later authorised work covers country-policy controls, support/KMS authority, export/90-day/purge and incident handoffs, with refusal/concurrency evidence. Reuse actual landed interfaces; D79 migration 043 and PR5/6 are landed; PR7 final local integration/release qualification remains incomplete. Reconcile Lane G's actual migration reservations before schema work; slices 1–3 are SQL-free.
4. **Before enablement:** satisfy the [launch evidence gate](../../launch-evidence.md#pass-the-production-evidence-gate), legal/provider/location and KMS deletion-waiting policy, D102 email evidence and applicable D88/A951/fiscal/isolation contracts. D68 is landed, but hosting/recovery costs and reliability still need measurement. D103's first C39 monitoring design is approved for planning only; release/compute remain separate. D102/D104 hands-on work waits until 3 November.

**O1, answered:** full data-protection engineering design approved for build planning
only on 2026-10-22 around 08:30. No repeat owner question. AI eligibility, all six lawyer
questions, KMS deletion-waiting policy, provider qualification and runtime proof remain
open. Local build authority now covers slices 1–5, without spending, deployment or contracts. Slices 6–12 remain unauthorised.

## 10. Questions for the lawyer, not engineering guesses

1. Complete the Article 28 agreement and annexes for the actual entities/services. Does the instructed 90-day recovery period, with earlier verified return/delete choice, satisfy the intended contract? Resolve any mandatory retention/blocking exceptions without changing immutable fiscal ledgers.
2. Which minimal Cloud billing evidence must remain, for what justified period? Can any support/security log or legal hold survive exit, on what authority, with what access, notice, review and final deletion? No period is assumed here.
3. Approve the supplier authorisation/objection process and actual AWS/SES/AI entity, access-location and transfer evidence. What additional safeguards or refusal of a supplier are required? Regional storage and standard terms alone do not answer this.
4. Confirm the proposed normal/emergency support instructions, single-on-call evidence and audit access, and the purpose-specific roles for Cloud's own account/security records. Use **A980 Q57** for relay/bug-report roles rather than duplicating it.
5. Does any shared-backup expiry conflict with the promised deletion deadline? Agree an honest contract and measurable all-copy process before launch, including limited deletion evidence, KMS waiting periods and key dependencies.

6. What concrete input-eligibility rule can uphold the no-personal-data AI instruction?
Venue review and automated detection do not establish it for arbitrary strings.
Keep outbound AI disabled until the rule, examples and documented limits receive
separate privacy review and owner acceptance; do not approve a weaker promise by default.

## 11. Source provenance and limits

Read on 2026-10-22: the D101 source notes, the owner's documentation style, Cloud
ownership/launch/operations/email/backlog documents and inspected code at `60c0fbf`.
Read A980 at the Waitron pins in section 2; reconcile its stale owner-pending wording
with lane B `questions.md:4008–4023`, which records all ten answers. Cloud decisions
come from lane D D101/D102/D103 and the supplied 2026-10-21 walkthrough answers.
Campaign notes are drafting receipts, not repository deliverables or runtime evidence.

Official sources are linked beside claims. The three tiny Spanish quotations above
come from the BOE GDPR text, with explanatory translations. The DPC checklist and
Commission Article 28 model are drafting aids. AWS/SES/OpenAI and candidate supplier
pages describe published terms/capabilities, not selected-account or deployed proof.
The [EDPB 07/2020 index](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en)
was supplied as context; no conclusion here relies on unread PDF paragraphs. No live
AWS/API calls, production checks or legal approval were performed for this draft.
