# Complete the processing instructions before offering the service

You need a service-specific agreement whose promises match the evidence. These
five draft annex groups turn the [D101 section 3 outline](superpowers/specs/2026-10-22-cloud-data-protection-design.md#3-complete-the-processing-agreement-before-offering-it)
into a completion record. Read them with the [purpose and supplier register](cloud-data-processing-register.md).
They are **unsigned and unqualified**, revision `cloud-processing-annexes-v1`,
reviewed 2026-10-23 against Cloud `d0f89fbf105f4b15360bf21821b8b22d6fffe0d8`.
They do not replace legal drafting, select an actual contracting entity or certify
a supplier. D101 owns the legal quotations and sources; they are not rewritten here.

## 1. Parties and documented instructions

Use one completed record per venue and selected service order. Reference the
register's `serviceId` and reviewed `evidenceId` versions so that a changed supplier
or destination cannot quietly expand an instruction.

| Required field | Draft instruction and current completion status |
| --- | --- |
| Venue controller and Cloud processor | Actual legal names, registered addresses and contacts **unfilled**; no assumed trading name is a legal-party answer |
| Service order | Venue/account identifier, selected purposes and service term **unfilled**; account administration/billing have their separate proposed Cloud-controller purpose |
| Authorised approvers | Actual people, current venue authority, identity verification and permitted instruction scope **unfilled**; a billing contact or platform administrator is not automatically an approver |
| Instruction record | Country pack/revision, permitted operations/data classes, exact destination/evidence versions, request/approval time and change history **unfilled**; no global destination default |
| Changes and conflicts | Record who approved each change; refuse an instruction identified as unlawful and notify the venue for legal resolution; no undisclosed expansion while a conflict is unresolved |
| Restrictions | No advertising, model training or unrelated reuse of venue content. No fiscal row edits or permission to start a second writer. Cloud supply of keys does not replace Waitron activation authority |

The instruction/approver workflow is a proposed control, not a deployed legal
approval route. Lawyer questions 1 and 4 remain open.

## 2. Subject, duration and people

Select only the service purposes that the venue orders: hosted operation, remote
transport, managed backup/recovery, approved support, messaging or a future
separately qualified service. Hosting/backup/export can carry all applicable A980
s1–s13, c1–c8 and d1–d9, including health-linked categories c6 and s10. A narrow
email or support action does not authorise processing that whole database.

| Required field | Draft instruction and current completion status |
| --- | --- |
| Subject and operations | Exact `serviceId` selection and allowed capture/store/read/transfer/restore/delete operations **unfilled**; list machine and human operations separately |
| People and categories | Staff, diners, invoice recipients and identifiable device users as applicable in [A980's single map](https://github.com/clintongormley/waitron/blob/96a1129e385447e9b9a6dc545673009953a2c551/docs/superpowers/specs/2026-10-22-a980-data-protection-design.md#2-the-data-map); actual selected categories **unfilled**, without a duplicate application field map |
| Duration | Actual service start/effective end **unfilled**; proposed instructed read-only recovery ends once at effective end plus 90 × 24 hours using database UTC time; retries do not extend it |
| Earlier return/delete | Verified earlier deletion supersedes ordinary recovery retention after approved exception review; actual requester verification/instruction **unfilled** |
| Own-purpose records | Account/authentication, subscription/usage, billing and necessary security records have separate purpose/access/schedule entries; no venue-content reuse by relabelling it billing |

These are engineering instructions for legal review, not statutory retention
periods. The five lifecycle states and cancellation/return controls remain unbuilt.

## 3. Security, assistance and evidence access

Keep a measure's implementation status beside its promised effect. An existing
local test or fixed audit event does not prove active-session cancellation, deployed
key custody or all-copy erasure.

| Measure | Required instruction/evidence | Current boundary |
| --- | --- | --- |
| Confidentiality and staff | Named authorised roles, confidentiality duties, training, least necessary access and revocation evidence | Actual personnel, training and production permissions unqualified |
| Location and separation | Spain venue data/logs/keys home in `eu-south-2`; conditional encrypted Paris copy `eu-west-3`; exact service/account/endpoint evidence | Country-policy runtime enforcement and provider qualification unbuilt |
| Normal support | Named eligible operator, venue, reason, exact actions and expiry; fresh venue approval per session, maximum 24 hours, shorter when practical | Existing disabled-by-default grant core is narrower; full every-action audit and active cancellation unbuilt |
| Emergency support | Both inability to trade and failed contact evidence; named single on-call operator, incident, recovery-only actions, short expiry, durable pre-access audit and immediate venue report | No second approver invented; emergency enforcement/notification qualification unbuilt |
| Machines and keys | Venue/artifact/key-version/purpose/expiry binding; separate backup, application-vault, installation and TLS domains; no master-key export or fiscal activation | KMS-backed release, active cancellation and real provider custody unqualified |
| Revocation and expiry | Stop new data/effects, cancel active streams/queued commands and reconcile already accepted outcomes; show pending stops honestly | Full cross-service cancellation and acknowledgement unbuilt; no promise to undo completed commands |
| Rights assistance | Verify and route venue-data requests to the venue; Cloud-own records use their separate process; follow A980 permissions/specialist gates | No competing rights dashboard or fiscal erasure; later D101 handoff unbuilt |
| Incident assistance | Record awareness, send prompt initial notice then phased updates; retain delivery/acknowledgement and escalate failed delivery immediately through D104 | Runbook exists; provider paging/email setup and handoff qualification remain open until separately authorised work |
| Assessments and audits | Provide necessary security/impact-assessment assistance, evidence access, audits/inspections and recorded remediation; identify scope, contacts and arrangements | Actual evidence access/audit arrangements **unfilled**, subject to legal review |

Keep payloads, raw logs, keys and personal identifiers out of public status/audit
output. A980 O9 requires manager review and manual send for typed report text;
reuse Q57 for the repair/relay role question. Cloud has no 72-hour incident-notice
grace period. The draft uses D101's existing incident instruction and
[D104 runbook](incident-response.md), without making a new legal conclusion.

## 4. Onward processing and supplier changes

For each selected `serviceId`, complete the register evidence with exact supplier
service/account, contracting/processing entities, storage/memory/log/telemetry/key
surfaces, human access countries, onward chain, applicable agreement/transfer
evidence, immutable version and review date. Every record is currently unqualified.
AWS and EU SES selection, the actual OpenAI adapter and candidate Anthropic/Google
status remain distinct; no automatic supplier fallback follows.

The proposed authorisation process is **general written authorisation with 30 days'
advance supplier-change notice**, subject to lawyer question 3. Thirty days is a
proposal, not an established legal deadline or a signed customer term. Record the
venue's authorised contact/approvers, notice content and delivery, the changed
purpose/destination/evidence, objection window, objection and resolution.

Keep a **no-new-flow hold** while an objection remains unresolved. Do not send data
to the changed supplier or expand a purpose before resolution and the required
authorisation. Existing work also requires its own still-valid qualification;
the notice period does not extend an expired permission. The actual hold,
notification, equivalently protective onward duties and remediation/exit process
need legal review and implementation. No supplier agreement is executed here.

## 5. Return, deletion and evidence

Record the venue's actual return/delete instruction and verify the current owner
before releasing a full export or key. Service cancellation differs from erasing
one person's rows in an active fiscal ledger; Waitron retains the latter authority.

| Required field/control | Draft instruction and open proof |
| --- | --- |
| Return contents | Consistent full database, latest documented backup and portable key, required module state, versioned manifest/checksums and offline restore instructions. Label freshness/missing tail; include last verified backup if latest is unverified. Portable Waitron consumer/restore proof remains open |
| Download authority | Fresh authentication, current venue-owner permission, expiring venue-bound readers and checks during transfer; billing-only access refuses. Full export/reader cancellation is unbuilt |
| Stop and final capture | Accepted Waitron stop/final-state evidence, outstanding effects reconciled, best earlier backup preserved on failure; no silent runtime cleanup when export is unavailable and no second fiscal writer |
| Recovery clock | One effective-end UTC deadline, 90 × 24 hours later; read-only instructed recovery before it, earlier verified delete after exception review; no retry/resubscription extension or restoration once purge outcome is uncertain |
| All-copy scope | Home/Paris object versions and delete markers, streams/snapshots, disks/replicas/caches, verifier/staging scratch, exports, multipart uploads, queues, support attachments, logs/identifying metadata and shared platform/database backups |
| Residual copies | Unselectively erasable shared backups need approved bounded expiry and isolated restore that reapplies deletion instructions before access. A surviving copy is pending deletion; no silent day-90 extension |
| Keys | Preserve authorised restore dependencies, withdraw readers/plaintext/cached keys at deadline and observe copy removal separately from scheduled/completed key deletion. Do not destroy another venue's or a shared key; KMS waiting policy remains open |
| Exceptions | Cloud's own necessary billing evidence is the sole routine exception. Any other hold needs explicit authority, narrow scope, review/expiry and notice under lawyer questions 1/2/5; no period or new exception supplied here |
| Receipt/audit | Policy/revision, copy classes, observed outcomes/retries, remaining exceptions and final key state, with evidence access/audit arrangements. Unknown is pending/failed, never completed; no payloads retained as deletion evidence |

The owner receives this warning with the future export: **You are now responsible
for keeping your fiscal records. Download and check your copies.** This draft
does not invent a fiscal-retention period or change immutable records. Lifecycle,
portable export, all-copy purge and real-provider key completion remain unbuilt.

## Resolve the remaining gates before signature or enablement

All [six lawyer questions](cloud-data-processing-register.md#keep-every-legal-decision-open-until-answered)
remain open: agreement/exit instructions; billing and exceptional holds; supplier
authorisation/transfers; support/roles including Q57; shared copies/KMS waiting;
and AI eligibility. Actual parties, selected order, approvers, contacts, supplier
evidence and audit arrangements remain unfilled. Legal review must settle these
fields and the applicable terms; this document is documentary acceptance of a
drafting inventory only.

The owner authorised local D101 slices 2–5 on 2026-10-23, with slices 2/3 first
and later schema work taking an actually available migration slot. Slices 6–12
remain unauthorised. None of those build decisions signs these annexes, enables
AI or grants provider resources, spending, deployment or customer-service access.
