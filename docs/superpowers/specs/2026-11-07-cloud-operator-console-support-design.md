# D609: Support and the operator console

**Proposed design; owner choices remain. Build nothing.** Ordinary problems stay self-service. Venue owners do not pay for support; asking for help is D603’s problem report, not a help desk.

Drafting direction, lane D `questions.md`, watcher 2026-11-07 22:03:

> “D609: cut it back to the ask before its second Claude read”; “the console reads what Cloud already stores”; “D603's command-line report reader stays”.

## Find, see and act

Cloud’s owner chooses a country, finds an account, venue or report by known IDs or report navigation, sees stored state and acts. Reuse stored associations and D603’s report-list query. Exact-ID lookups and authenticated country browser routes are new work, not a new search/report service, index or customer store. A report lookup needs installation ID plus report ID, its existing identity. No free-text search or location work.

Reuse D603's [grouped reader](../../../packages/operations/src/staff-problem-reports.ts#L9): sent descriptions, structural logs and error-code/version groups. Keep empty-log reports and [late or absent descriptions](../../../packages/registration/src/box-error-reports.ts#L148). Before diagnostic approval, show identifiers/associations and submitted report content; the proposed owner-contact disclosure below needs approval. Browser delivery must be explicitly authorised: today’s reader is CLI-only. Sending a report does not authorise private venue inspection.

Reuse the customer's [Download diagnostic](../../operations-status.md#download-a-customer-diagnostic) and its [safe field projection and freshness rules](../../../packages/account-http/src/diagnostics.ts#L12). Extract the private projection from its owner-only handler. The proposed single action generates that diagnostic for one current installation still belonging to the approved venue. Approval covers the venue, not a pinned installation. No live box query; customer self-service needs no staff access.

## Keep authority separate

[P3 §4](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority) is a prerequisite: separate global operator identity, country-local final authority and a separately qualified support adapter. Customer approval never creates operator eligibility. No legacy, email-matching or customer-permission fallback. The current store instead references a country platform account and its permissions. Its identity reference and eligibility check must change to the country operator binding; unchanged legacy approval cannot accept a global operator. The qualified binding remains unresolved.

Customer data, grants and activity stay in country. Global holds only operator/security state. The browser reads the country directly, clears private results when switching and never proxies responses through global. Link the planned independent [P4 action screens and permissions](../plans/2026-10-22-cloud-action-controller.md) separately. This grant adds no repair, fiscal, activation, recovery, key or SSH powers.

## Start access from a product-bug report

The operator opens a report and chooses diagnostic access for customer approval in the portal. Propose showing the verified owner email beside the report so the operator can manually give them an approval link; today’s report reader supplies no contact. This additional disclosure needs owner approval and a customer audit entry. Opening the link grants no authority. The portal rechecks the target. No owner-contact service or requirement to contact support. Add no request store, ticket, messaging, notification service or triage workflow.

The current sole country owner reviews the exact named operator, country, organisation, venue, single diagnostic/action, reason and end time, then approves or declines with fresh authentication. The operator cannot approve for the customer. Only after agreement does the adapted [grant approval](../../../packages/registration/src/support-grants.ts#L92) receive the complete input. Its adapter must enforce fresh authentication and exactly the one allowed action; the generic store supplies neither restriction. Declining creates no grant. The portal lists active grants and revoke controls.

Propose one hour, shorter selectable, within [D88's 24-hour maximum](2026-10-22-cloud-data-protection-design.md#5-give-machines-scoped-keys-and-people-accountable-sessions); the generic store does not enforce that maximum. Changed scope/operator/action or extension needs fresh agreement. After approval, the operator chooses **Run diagnostic** in the console.

Preserve the [existing transaction-only grant](../../temporary-support-grants.md#protect-database-work): live operator eligibility, approving-owner authority, scope and time checks after waits and before disclosure. External revoke waits for the in-flight transaction, then blocks later work; expiry during it rolls back protected effects. No network or shell side effects belong inside it. Disclosed data cannot be recalled. Preserve P3/D608 handover revocation requirements.

For example, a synthetic Spanish café reports “Printer stopped after upgrade.” Its owner approves from 14:00 to 15:00 UTC. The operator runs the diagnostic and sees service/backup metadata. Revoking blocks the next read; history shows the report open, grant and diagnostic outcome.

## Record staff activity without payloads

Record console staff actions visibly to the affected customer through the [country security audit](../../security-audit.md). Customer-bound successful reads/actions, identifying list disclosures and refusals remain country-local. Show actor, fixed action/outcome, UTC time, scope and report/grant reference; never parameters, descriptions, results or secrets. Interpret `support.accessed` through the grant's single action. When P4 exists, reuse its records rather than duplicate history.

An unbound failed lookup is a **global operator/security event**, consistent with P3: only operator, country, fixed outcome and time. Never entered IDs, customer IDs, descriptions, details or raw target data. It has no affected-customer history entry. A country-owned sender must report the outcome to global; a browser’s self-report cannot be authoritative. That transport is unresolved P3 support-adapter work; no new protocol is designed here.

Commit protected database work and its audit together; if recording fails, deny the read. Record refusals separately from rolled-back work; recording failure never permits access. Preserve operation identity across retries.

**D603's CLI stays.** [Its source](../../../packages/operations/src/staff-reports-cli.ts#L4) forces read-only database access with no operator identity or audit wrapper; no runtime test ran here. Owner choice: retain it as restricted infrastructure access outside the staff-history promise, or adapt routine staff use to the same identity/scoping/audit path as the console. Recommend the infrastructure boundary to preserve the simpler read-only tool. Complete staff-history scope remains unresolved; exceptional infrastructure access is not recorded by this design.

No retention choice is made. If console/global is unavailable, operator access stops; country customer diagnostics, grant/revoke and history remain independent. Console, grant UI and full staff history are unbuilt. All source observations above are reading, not runtime verification.

**First owner question:** may the console show the verified owner email for manual delivery of diagnostic approval? Recommend yes. The café’s staff report the printer fault; the operator needs to reach its owner. This discloses one existing contact and records the read, without a new contact service. Then settle the CLI boundary, action and duration.
