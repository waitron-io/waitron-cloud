# D609: Support and the operator console

**Proposed design; owner review required. Build nothing.** Ordinary problems stay self-service. Venue owners do not pay for support; asking for help is D603’s problem report, not a help desk.

**Authority:** lane D `questions.md`, watcher 2026-11-07 22:20 (owner may overrule): verified-owner contact disclosure and common console/CLI audit are settled below. This is not full owner approval or build authority.

## Find, see and act

Cloud’s owner chooses a country, finds an account, venue or report by known IDs or report navigation, sees stored state and acts. Reuse stored associations and D603’s report-list query. Exact-ID lookups and authenticated country browser routes are new work, not a new search/report service, index or customer store. A report lookup needs installation ID plus report ID, its existing identity. No free-text search or location work.

Reuse D603's [grouped reader](../../../packages/operations/src/staff-problem-reports.ts#L9): sent descriptions, structural logs and error-code/version groups. Keep empty-log reports and [late or absent descriptions](../../../packages/registration/src/box-error-reports.ts#L148). Before diagnostic approval, show identifiers/associations, submitted report content and the verified owner email. Browser delivery must be explicitly authorised: today’s reader is CLI-only. Sending a report does not authorise private venue inspection.

Reuse the customer's [Download diagnostic](../../operations-status.md#download-a-customer-diagnostic) and its [safe field projection and freshness rules](../../../packages/account-http/src/diagnostics.ts#L12). Extract the private projection from its owner-only handler. The proposed single action generates that diagnostic for one current installation still belonging to the approved venue. Approval covers the venue, not a pinned installation. No live box query; customer self-service needs no staff access.

## Keep authority separate

[P3 §4](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority) is a prerequisite: separate global operator identity, country-local final authority and a separately qualified support adapter. Customer approval never creates operator eligibility. No legacy, email-matching or customer-permission fallback. The current store instead references a country platform account and its permissions. Its identity reference and eligibility check must change to the country operator binding; unchanged legacy approval cannot accept a global operator. The qualified binding remains unresolved.

Customer data, grants and activity stay in country. Global holds only operator/security state. The browser reads the country directly, clears private results when switching and never proxies responses through global. Link the planned independent [P4 action screens and permissions](../plans/2026-10-22-cloud-action-controller.md) separately. This grant adds no repair, fiscal, activation, recovery, key or SSH powers.

## Start access from a product-bug report

The operator opens a report and prepares diagnostic access for customer approval. Show the verified owner email beside the report; record every display in that customer’s history. **Choose manual approval-link delivery to that address:** the [outbox’s four message kinds](../../../packages/registration/src/email-outbox.ts#L64) and [fixed templates](../../../packages/registration/src/account-mail.ts#L18) have no approval request, so automatic sending needs implementation. Opening the link grants nothing; the portal rechecks the target. No owner-contact or delivery service, requirement to contact support or new permissions. Add no request store, ticket, messaging, notification service or triage workflow.

The current sole country owner reviews the exact named operator, country, organisation, venue, single diagnostic/action, reason and end time, then approves or declines with fresh authentication. The operator cannot approve for the customer. Only after agreement does the adapted [grant approval](../../../packages/registration/src/support-grants.ts#L92) receive the complete input. Its adapter must enforce fresh authentication and exactly the one allowed action; the generic store supplies neither restriction. Declining creates no grant. The portal lists active grants and revoke controls.

Propose one hour, shorter selectable, within [D88's 24-hour maximum](2026-10-22-cloud-data-protection-design.md#5-give-machines-scoped-keys-and-people-accountable-sessions); the generic store does not enforce that maximum. Changed scope/operator/action or extension needs fresh agreement. After approval, the operator chooses **Run diagnostic** in the console.

Preserve the [existing transaction-only grant](../../temporary-support-grants.md#protect-database-work): live operator eligibility, approving-owner authority, scope and time checks after waits and before disclosure. External revoke waits for the in-flight transaction, then blocks later work; expiry during it rolls back protected effects. No network or shell side effects belong inside it. Disclosed data cannot be recalled. Preserve P3/D608 handover revocation requirements.

For example, a synthetic Spanish café reports “Printer stopped after upgrade.” Its owner approves from 14:00 to 15:00 UTC. The operator runs the diagnostic and sees service/backup metadata. Revoking blocks the next read; history shows the report open, grant and diagnostic outcome.

## Record staff activity without payloads

Record console staff actions visibly to the affected customer through the [country security audit](../../security-audit.md). Customer-bound successful reads/actions, identifying list disclosures and refusals remain country-local. Show actor, fixed action/outcome, UTC time, scope and report/grant reference; never email values, parameters, descriptions, results or secrets. Interpret `support.accessed` through the grant's single action. When P4 exists, reuse its records rather than duplicate history.

An unbound failed lookup is a **global operator/security event**, consistent with P3: only operator, country, fixed outcome and time. Never entered IDs, customer IDs, descriptions, details or raw target data. It has no affected-customer history entry. A country-owned sender must report the outcome to global; a browser’s self-report cannot be authoritative. That transport is unresolved P3 support-adapter work; no new protocol is designed here.

Commit protected database work and its audit together; if recording fails, deny the read. Record refusals separately from rolled-back work; recording failure never permits access. Preserve operation identity across retries.

**D603's CLI stays.** Routine staff report reads must use the same operator identity, country scope and customer-visible history wrapper as the console, writing the same report-read entry. [Today’s CLI](../../../packages/operations/src/staff-reports-cli.ts#L9) forces read-only database access without operator identity or audit. The future adapter must separate the protected read-and-audit transaction from general CLI database access, without silently granting general CLI database write privilege or new access. Infrastructure maintenance reading no customer report stays outside. This wrapper is unbuilt; no runtime test ran here.

No retention choice is made. If console/global is unavailable, operator access stops; country customer diagnostics, grant/revoke and history remain independent. Console, grant UI and full staff history are unbuilt. All source observations above are reading, not runtime verification.

**Next owner question:** approve the proposed initial diagnostic action and one-hour duration, shorter selectable within the 24-hour ceiling? The unresolved P3 support adapter remains a prerequisite.
