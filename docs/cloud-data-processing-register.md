# Know which Cloud purpose a data flow serves

Before you approve a destination, identify the service, the people whose data it
handles and the evidence for that exact use. An EU storage location does not tell
you where support staff, telemetry or in-memory processing operate. Use this
register with the [draft annexes](cloud-processing-annexes.md) to record those
separate decisions.

**Register revision:** `cloud-processing-register-v1`, reviewed 2026-10-23 against
Cloud `d0f89fbf105f4b15360bf21821b8b22d6fffe0d8` and the
[D101 design](superpowers/specs/2026-10-22-cloud-data-protection-design.md).
This is the documentation deliverable for roadmap slice 2. Every supplier evidence
record below is **unqualified**. Publication supplies no signature, legal opinion,
provider qualification or permission to send data. Existing local tests keep their
original scope.

## Give each purpose its own identity

The `serviceId` identifies one flow purpose. Keep it stable when an implementation
changes. The `evidenceId` identifies the qualification record for that purpose and
supplier surface. The [slice 3 country function](country-policy.md) matches the exact supplier,
account, endpoint, data class, region and policy revision. An ID alone grants no
access. Changed supplier scope needs a new reviewed evidence version; do not turn
an unqualified row into a general permission.

Use [A980 section 2](https://github.com/clintongormley/waitron/blob/96a1129e385447e9b9a6dc545673009953a2c551/docs/superpowers/specs/2026-10-22-a980-data-protection-design.md#2-the-data-map)
as the single application map. Its `s`, `c`, `d` and `r` IDs refer to staff,
customers, operational data and routes there. This register names Cloud purposes
and references those categories; it does not copy application fields. Cloud's own
account and service records need their own inventory even when a contact is also
a venue employee.

Roles below are **proposed**: a processor acts on the venue's instructions; a
controller decides a purpose for Cloud's own records. D101 lawyer question 4 and
[adviser confirmation P8](https://github.com/clintongormley/waitron/blob/2a4443a2ba01676e51fdb119a82d224f9d1cece7/docs/compliance/2026-11-06-adviser-questions.md#for-the-privacy-specialist)
share one confirmation: processor for venue support and the replacement remote
transport, controller for product repair and Cloud's own security records. A951
retires the old relay, so its Q57 question is retired too. Use the 6 November
English adviser list; it replaces the 5 November Spanish batch. Legal confirmation
remains open, and encryption alone does not settle a role.

| `serviceId` | Purpose and subjects/categories | Proposed role | Recipients and permitted access to qualify | Retention authority and cutoff | `evidenceId` and current status |
| --- | --- | --- | --- | --- | --- |
| `cloud-account` | Account/contact and organisation membership for account holders, owners and invited members; Cloud-owned records | Cloud controller | Current account/member permissions; Cloud operations only for the separate administration purpose | Separate account schedule unresolved under lawyer questions 2/4; no automatic billing exception | `ev-cloud-account-v1`: unqualified; local account implementation is not a production schedule |
| `cloud-authentication` | Password/session, verification and recovery material for account holders | Cloud controller | Authentication service and scoped recovery worker; no passwords, tokens or secrets in audit output | Credential/session expiry and existing transient cleanup do not define all-copy exit; schedule unresolved | `ev-cloud-authentication-v1`: unqualified; production custody/access evidence missing |
| `cloud-account-email` | Account verification, reset and necessary account notices to account contacts | Cloud controller | Account email queue/worker, selected SES service and recipient mail systems; body, envelope and delivery metadata scoped separately | Purpose-specific queue/metadata schedule unresolved; never retain reset contents as billing evidence | `ev-ses-account-mail-v1`: blocked on D102 and approved schedules |
| `venue-email` | Venue-instructed transactional mail; A980 r7, applicable s2/s13 and c1/c2 | Cloud processor | Authenticated venue relay, scoped worker, SES and recipient mail systems; no marketing or unrelated reuse | Venue instruction and D101 exit, with queue/outcome uncertainty reconciled; exact metadata cutoff unresolved | `ev-ses-venue-mail-v1`: blocked on D102 and accepted caller contract |
| `cloud-support` | Approved read/command/decrypt assistance involving only the action's required s/c/d categories | Cloud processor for venue work | Named eligible operator with per-session approval, at most 24 hours; narrower emergency route requires both facts | Service instruction and D101 exit; any surviving support record needs lawyer-approved authority, scope and cutoff | `ev-support-access-v1`: unqualified; active cancellation/every-action evidence unbuilt |
| `cloud-audit` | Minimal actors, approvals, refusals and outcomes; no payloads or secrets | Processor for venue evidence; separate Cloud security purpose requires role review | Venue-authorised evidence viewers and narrowly authorised security staff | No blanket security exception; legal basis, expiry and notice unresolved under questions 2/4 | `ev-cloud-audit-v1`: unqualified; existing fixed events are narrower than proposed full audit |
| `cloud-usage` | Metering and service usage associated with an account/venue | Cloud controller for subscriptions; content processing remains separate | Scoped service metering and account billing access; no raw venue content | Necessary evidence only; schedule and link to billing need legal review | `ev-cloud-usage-v1`: unqualified; no general content-retention permission |
| `cloud-billing` | Cloud's own invoice/payment evidence for subscribers and billing contacts | Cloud controller | Restricted billing personnel; proposed SumUp card and Stripe SEPA surfaces below; contracting entities and accounting recipients unknown | Sole routine exit exception; exact necessary fields, recipients and period unresolved under question 2 | `ev-cloud-billing-v1`: unqualified; depends on the applicable `ev-sumup-card-v1` or `ev-stripe-sepa-v1` record; no invented statutory period |
| `cloud-gateway-security` | Transport/security metadata for connected devices, addresses and identifiable users; A980 r10 and relevant d1/d4–d8 | Cloud-purpose security role unresolved; payload purpose stays separate | Gateway and narrowly authorised operations staff; provider support/global metadata require separate evidence | Minimal approved security schedule unresolved; a useful log is not a billing record | `ev-aws-gateway-metadata-v1`: unqualified; P8 confirmation and provider evidence open |
| `cloud-incidents` | Awareness, affected categories, containment, contact and delivery/acknowledgement evidence for affected people | Processor for venue incidents; separate controller purpose for Cloud-own incidents | Verified venue contact and D104 on-call path; public status excludes identifiers and payloads | Minimal private incident evidence; legal schedule/exception unresolved | `ev-cloud-incidents-v1`: unqualified; runbook exists, delivery/paging qualification open |
| `cloud-export-delivery` | Full exit bundle, keys and delivery metadata for an authenticated current owner; applicable s/c/d through r1–r3 | Cloud processor | Freshly authenticated current owner; billing contact alone cannot download; expiring venue-bound readers | Fixed instructed exit deadline or earlier verified delete after exception review; downloaded customer copies leave Cloud custody | `ev-cloud-export-v1`: blocked; portable export, lifecycle and full cleanup unbuilt |
| `hosted-venue` | Hosted application payloads; applicable s1–s13, c1–c8, d1–d9 through r1–r3, including health-linked content | Cloud processor | Venue-authorised application users; scoped machines; human access only through approved support | Service term and instructed exit; preserve fiscal rows and Waitron activation authority | `ev-aws-hosted-v1`: blocked on hosting/isolation/shared contracts and provider qualification |
| `venue-backup-home` | Spain managed streams/snapshots and restore; applicable s/c/d through r1–r3 | Cloud processor | Venue/artifact/key-version-bound capture, isolated verifier and authorised recovery machines | Instructed service retention and exit; last verified protection does not extend exit | `ev-aws-backup-home-v1`: unqualified; intended home `eu-south-2`, keys separately qualified |
| `venue-backup-extra` | Additional encrypted Spain backup copy containing the same venue categories | Cloud processor | Scoped replication and recovery, with Spain-key dependencies | Same exit instruction across versions, staging and copies; no silent residual retention | `ev-aws-backup-paris-v1`: unqualified; intended `eu-west-3`, recovery/contract proof missing |
| `venue-key-custody` | Backup key versions and scoped decrypt requests, separate from application vault, installation and TLS secrets | Cloud processor for venue recovery | Exact machine purpose/artifact/version/expiry; approved human routes only; no master-key export | Preserve required recovery dependencies, then observed retirement; waiting policy unresolved under question 5 | `ev-aws-keys-v1`: unqualified; intended Spain KMS, no deployed custody claim |
| `venue-remote-transport` | Encrypted remote transport/public routing; A980 r10 and only the route's relevant s/c/d | Proposed processor, subject to P8 confirmation | Exact venue route and authenticated tunnel; staff/public routes and hostnames remain separate | Venue instruction and minimal separately justified transport metadata; unresolved cutoff stays open | `ev-aws-remote-v1`: unqualified; A951 contract/route qualification remains open |
| `venue-translation` | Intended menu-only translation, A980 r9; arbitrary dish/style text may contain contact or health data | Proposed processor; supplier and eligibility approval outstanding | Actual OpenAI adapter, no qualified production destination; every model pass/retry remains denied | No production processing permitted; supplier retention evidence unresolved, not zero by assumption | `ev-openai-translation-v1`: blocked; slice 1 refuses production outbound calls |
| `cloud-diagnostics` | Bounded error/version/masked logs, A980 d9 and d4–d8; accidental s/c content requires review | Venue instruction and Cloud repair purpose require P8 confirmation | A980 O9 manager review/manual send for typed text; no automatic database/raw-log attachments | Minimal purpose-bound evidence; any support/security survival needs question 2 resolution | `ev-cloud-diagnostics-v1`: unqualified; existing bounded diagnostics are not broad report permission |

Future services need new reviewed rows before they send data. In particular, the
[candidate inventory](backlog.md#initial-services-and-future-candidates) keeps rota
solving with staff personal data and opt-in comparisons in the backlog. They have
no qualified supplier, purpose evidence or production permission in this register.

## Qualify supplier surfaces separately

These `supplierId` values are stable inventory names, not legal entity names:
`aws-infrastructure`, `amazon-ses`, `openai-api`, `anthropic-candidate` and
`google-candidate`, `sumup-payments` and `stripe-payments`. AWS infrastructure and EU SES are owner-selected; OpenAI is
the actual translation adapter. Anthropic and Google remain candidates only.
Selection does not qualify an account or service. Local Mailpit, SeaweedFS and
fake model endpoints supply local tests, not production supplier evidence.

For **every** evidence ID below, the exact production account/project, contracting
entity, processing entities, human access countries, onward chain, applicable
agreement/version, transfer evidence and provider review date are **unknown and
unqualified**. The register review date is 2026-10-23; it is not a provider review
date. The intended regions are instructions to qualify, not observations. No real
account IDs, credentials or customer data belong in this public register. Store
private evidence under access control and reference its immutable version/digest.

| Evidence IDs | `supplierId`; intended exact service/surface | Location/access boundary still to prove | Missing evidence and release condition |
| --- | --- | --- | --- |
| `ev-aws-hosted-v1`, `ev-aws-remote-v1` | `aws-infrastructure`; hosted runtime, memory processing and network ingress/transport; exact deployed services unknown | Spain home for Spain payloads; runtime memory, support and network control metadata separately unqualified | Named account/services/entities, isolation, accepted Waitron/A951 interfaces, access countries and runtime observations |
| `ev-aws-backup-home-v1` | `aws-infrastructure`; intended object/stream/snapshot storage | Spain `eu-south-2`; support and global metadata unknown | Actual service/bucket/account, version/multipart inventory, scoped credentials, restore/deletion evidence and applicable supplier terms |
| `ev-aws-backup-paris-v1` | `aws-infrastructure`; intended encrypted extra backup | Paris `eu-west-3`; Spain keys remain a dependency | Actual replication/copy services and account, complete versions/exit inventory and recoverability with Spain keys; no Spain-outage promise |
| `ev-aws-keys-v1` | `aws-infrastructure`; intended AWS KMS, distinct from stored backups | Spain `eu-south-2`; no key replication granted | Actual key/account/region and access evidence, dependency inventory, grant cancellation, scheduled versus observed deletion; never destroy a shared key |
| `ev-aws-gateway-metadata-v1`, `ev-cloud-audit-v1` | Intended AWS logs/telemetry and Cloud audit stores; actual services/recipients unknown | Spain venue logs stay home; telemetry, global control metadata and provider support access need distinct qualification | Log fields/sinks, processing/access countries, purpose role, justified cutoffs and deletion evidence; bucket region is insufficient |
| `ev-ses-account-mail-v1`, `ev-ses-venue-mail-v1` | `amazon-ses`; account and venue mail are separate purposes | Selected EU exception; Stockholm `eu-north-1` configured default or Paris `eu-west-3`, both owner-accepted; exact account/provider qualification unresolved by D102; recipient mail systems/transit separately disclosed | D102 sender, domain, tracking-off, bounce/complaint authentication, suppression, alerts and controlled live delivery; exact entities/chain/terms and content/metadata retention |
| `ev-openai-translation-v1` | `openai-api`; model memory processing, provider logs and system/abuse metadata | Exact project/model/endpoint, processing/access locations and retention approval unqualified | Separate accepted eligibility rule/examples/limits, supplier/location/terms evidence and later enabling change; `store: false` is insufficient |
| `ev-sumup-card-v1` | `sumup-payments`; card setup API, embedded card widget and authentication frames | Processing region/location identifier, support/access countries and onward recipients unknown; sandbox hostnames prove no country | **UNQUALIFIED**. Exact account, entities, endpoint/data-class/location bindings, agreements, retention for card/setup/token/metadata and support, and browser/onward-recipient evidence remain missing |
| `ev-stripe-sepa-v1` | `stripe-payments`; customer/setup API, hosted Checkout, payment method and SEPA mandate | Processing region/location identifier, support/access countries and onward recipients unknown; global API hostname proves no country | **UNQUALIFIED**. Exact account, entities, endpoint/data-class/location bindings, agreements, retention for customer/setup/method/mandate/metadata and support, and hosted-browser evidence remain missing |
| No qualified evidence ID allocated | `anthropic-candidate`, `google-candidate`; unspecified candidate AI services | All processing, retention, support and transfer locations unknown | New selection decision and complete purpose/service evidence first; no fallback from the actual denied adapter |

The remaining `ev-cloud-*` IDs in the purpose table are first-party evidence
records. Each must name the real deployed stores, memory processing, logs,
backup/key dependencies, authorised personnel and any supplier recipients before
qualification. They do not inherit AWS evidence from unrelated flows. The
[D101 supplier discussion](superpowers/specs/2026-10-22-cloud-data-protection-design.md#4-enforce-a-country-policy-and-qualify-every-outbound-flow)
owns the source links and their original limitations; this register makes no new
claim about current supplier terms.

### Trace the current payment test paths

Use the [test-provider receipt](billing-provider-test.md#local-account-panel-78-november-2026)
for the measured sandbox journey and its source links. This inventory was added on
18 November 2026 from the [provider adapter](../packages/account-http/src/billing-method-providers.ts),
[local bindings](../packages/account-http/src/billing-method-binding.ts),
[request authority](../packages/account-http/src/billing-methods.ts),
[card widget](../apps/portal/src/billing-card.ts) and
[browser policy](../packages/account-http/src/portal.ts). It qualifies no supplier.

For SumUp, your browser enters card details in the provider widget and handles its
consent/authentication screens. Cloud sends synthetic customer names/email, a
synthetic customer ID, setup/checkout reference, merchant reference, amount,
currency, description and recurring-setup purpose to `api.sumup.com/v0.1`.
Cloud retrieves the checkout and saved-card token/active state. The browser loads
`gateway.sumup.com` and the receipt lists the observed API, authentication-frame
and static-asset origins. These direct browser requests never pass through the
generic country-matching function; each recipient needs separate evidence, including its onward chain.

For Stripe SEPA, your browser enters the IBAN and mandate consent in hosted
`checkout.stripe.com`. Cloud sends a synthetic customer name/email, customer
reference, setup mode, currency, payment type and Cloud return URLs to
`api.stripe.com/v1`. It retrieves checkout/setup-intent, payment-method and mandate
references and their status. Cloud stores the verified method and mandate IDs;
it does not treat them as payment or renewal evidence.

Provider JSON also reaches Cloud memory before the adapter selects the references
it stores. Extra response fields, provider metadata and support access still need
an inventory and retention evidence; the selected IDs are not the whole surface.

The organisation, legal-business, owner, session and security-revision bindings
stay in Cloud’s [local setup row](../packages/account-http/src/billing-method-binding.ts).
The setup ID does cross the SumUp boundary as its checkout/customer reference.
The adapter’s fixed names and email are synthetic test fields; live identity
fields are undecided. Qualify the applicable supplier record before qualifying
`ev-cloud-billing-v1`; neither inherits status from the other. Live accounts,
processing/access locations, data-class names, retention and support terms remain
unknown. Choose no location from an API hostname and no retention period from a
successful sandbox run.

## Walk a proposed flow to its stopping point

| Example | Exact purpose/evidence | Decision today |
| --- | --- | --- |
| Spain snapshot copied to Paris | `venue-backup-extra` / `ev-aws-backup-paris-v1`, with `venue-backup-home` and `venue-key-custody` dependencies | Block production qualification until copy, contract and Spain-key recovery evidence exists; encrypted location alone is insufficient |
| Cloud password-reset email | `cloud-account-email` / `ev-ses-account-mail-v1` | Block production SES use pending D102; local Mailpit proof stays local |
| Venue booking confirmation | `venue-email` / `ev-ses-venue-mail-v1` | Block pending D102 and accepted venue caller; never reuse account-reset purpose as venue authority |
| Support operator reads a backup | `cloud-support` / `ev-support-access-v1`, plus `venue-key-custody` | Block production qualification until approval/current scope, expiry, active cancellation and audit/decrypt evidence is complete |
| Save a card or SEPA mandate | `cloud-billing` / `ev-cloud-billing-v1`, with `ev-sumup-card-v1` or `ev-stripe-sepa-v1` as applicable | **UNQUALIFIED**. Inventory above records test paths only; qualify exact server and browser recipients, account, data classes, locations, terms and retention before live data |
| AI translates “Croquetas” | `venue-translation` / `ev-openai-translation-v1` | Production adapter refuses even apparently clean text; no eligibility or supplier exception is inferred |

## Keep every legal decision open until answered

The [six D101 lawyer questions](superpowers/specs/2026-10-22-cloud-data-protection-design.md#10-questions-for-the-lawyer-not-engineering-guesses)
remain open. These labels only route the work; they do not supply answers.

| Question | Open decision and affected evidence |
| --- | --- |
| 1 | Actual parties/agreement, instructed 90-day recovery and earlier return/delete; all venue-purpose annexes |
| 2 | Necessary Cloud billing evidence and any narrowly authorised support/security hold, with cutoffs/notice; account, billing, audit, incident and diagnostics records |
| 3 | Supplier authorisation, objection, exact entities/access countries/transfers; every supplier record |
| 4 | Normal/emergency support instructions and Cloud-own roles; reuse adviser confirmation P8 for replacement transport, repair and security roles |
| 5 | Shared backup expiry, all-copy evidence and KMS waiting/dependencies against the exit deadline; backups, keys and exports |
| 6 | Concrete no-personal-data AI eligibility rule, examples and limits; outbound remains disabled |

Next, fill the [annexes](cloud-processing-annexes.md) with actual parties and
reviewed evidence. Slice 3 may use these stable IDs for pure refusal decisions;
publishing them enables no flow.


## SES feedback evidence remains unqualified

The [offline qualification guide](ses-feedback-qualification.md) inventories
primary/dead-letter queue contents, pseudonymous attempts and suppression,
audit/deduplication, retained keys and backup copies for both email purposes.
Its synthetic policy validation is implementation evidence only. Keep
`ev-ses-account-mail-v1` and `ev-ses-venue-mail-v1` unqualified until their exact
supplier/entity/contract, access/transit/recipient boundaries and retention/deletion
schedules are accepted. It chooses no retention duration or cleanup policy and
grants no second-country sharing or movement of Spain venue keys. Historical
Paris-only and calendar-based wording does not expand the current authority.
