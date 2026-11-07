# D609: Support and the operator console

**Scope-corrected proposal; owner choices remain. No build authority.** You should solve ordinary problems at the screen. Venue owners do not pay for support; asking for help is the problem report D603 receives, not a help desk or tickets.

Drafting direction, lane D `questions.md`, watcher 2026-11-07 22:03:

> “D609: cut it back to the ask before its second Claude read”; “the console reads what Cloud already stores”; “D603's command-line report reader stays”.

## Find, see and act

Propose a console for Cloud's owner to find an account, venue or received report, see stored state and act. Choose a country, navigate reports or enter exact known account/venue/report IDs. Reuse existing readers and associations, with no new country search/report service, index or customer store. Thin browser transport may be needed. This proposes no free-text customer search or new Waitron location.

Reuse D603's [grouped reader](../../../packages/operations/src/staff-problem-reports.ts#L9): sent descriptions, structural logs and error-code/version groups. Preserve individual empty-log reports and [late or absent descriptions](../../../packages/registration/src/box-error-reports.ts#L148). Before diagnostic approval, show only identifiers/associations and submitted report content. Sending a report does not authorise private venue inspection.

Reuse the customer's [Download diagnostic](../../operations-status.md#download-a-customer-diagnostic) and its [safe field projection and freshness rules](../../../packages/account-http/src/diagnostics.ts#L12). The proposed single action generates that same diagnostic from stored data for one selected installation in one venue under grant authority. It makes no live box query. Customer self-service remains available without staff access.

## Keep authority separate

[P3 §4](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority) is a prerequisite: separate global operator identity, country-local final authority and a separately qualified support adapter. Customer approval never creates operator eligibility. No legacy, email-matching or customer-permission fallback. The adapter must bind the named operator to eligible country support authority and enforce the selected installation; that binding remains an owner choice, not an implemented route.

Customer records, reports, grants and customer-bound activity stay in country. Global keeps operator/security state only, with no copied customer metadata. The browser reads the selected country directly into memory and clears private results when switching. The global server neither proxies nor retains those responses. Link independent [P4 action screens and permissions](../plans/2026-10-22-cloud-action-controller.md) separately. This grant adds no repair, fiscal, activation, recovery, key or SSH powers.

## Start access from a product-bug report

Propose that the operator opens a report and chooses diagnostic access. Display a specific approval in the existing customer portal. Prepare an approval link the operator can give the customer; opening it grants no authority. The portal rechecks the target and shows the full approval, without a new owner-contact service or requirement to contact support. Add no request store, ticket, messaging, notification service or triage workflow.

The current sole country owner reviews the exact named operator, country, organisation, venue, installation, single diagnostic/action, reason and end time, then approves or declines with fresh authentication. The operator cannot self-approve. Only after agreement does [SupportGrantStore.approve](../../../packages/registration/src/support-grants.ts#L92) receive the complete approval input. Declining creates no grant. The portal shows active grants and revoke controls. Customer-started access may remain an option.

Propose one hour, shorter selectable, within [D88's 24-hour maximum](2026-10-22-cloud-data-protection-design.md#5-give-machines-scoped-keys-and-people-accountable-sessions); the generic store does not enforce that maximum. Changed scope/operator/action or extension needs fresh agreement. After approval, the operator chooses **Run diagnostic** in the console.

Preserve the [existing transaction-only grant](../../temporary-support-grants.md#protect-database-work): live operator eligibility, approving-owner authority, scope and time checks after waits and before disclosure. External revoke waits for the in-flight transaction, then blocks later work; expiry during it rolls back protected effects. No network or shell side effects belong inside it. Disclosed data cannot be recalled. Preserve P3/D608 handover revocation requirements.

For example, a synthetic Spanish café reports “Printer stopped after upgrade.” The operator opens it and prepares diagnostic approval. At 14:00 UTC the café owner agrees until 15:00 UTC. The operator runs the diagnostic and sees service/backup metadata. Revoking blocks the next read; customer history shows the report open, grant and diagnostic outcome.

## Record staff activity without payloads

Propose every staff action recorded and visible to the affected customer through the [country security audit](../../security-audit.md). Customer-bound successful reads/actions, identifying list disclosures and refusals remain country-local. Show actor, fixed action/outcome, UTC time, scope and report/grant reference; never parameters, descriptions, results or secrets. Interpret `support.accessed` through the grant's single action. Reuse P4 records rather than duplicate history.

An unbound failed lookup is a **global operator/security event**, consistent with P3: only operator, country, fixed outcome and time. Never entered IDs, customer IDs, descriptions, details or raw target data. It has no affected-customer history entry.

Commit protected database work and its audit together; if recording fails, deny the read. Record refusals separately from rolled-back work; recording failure never permits access. Preserve operation identity across retries.

**D603's CLI stays.** Source-reading [staff-reports-cli.ts](../../../packages/operations/src/staff-reports-cli.ts#L4) shows direct database access, without this activity wrapper; it was not runtime-tested here. Before routine staff use under the proposed recording guarantee, apply the same operator identity, country scoping and audit wrapper to the existing CLI reader and console. Preserve the tool without parallel history. Exceptional infrastructure access has no complete-history guarantee here.

No retention choice is made. If console/global is unavailable, operator access stops; country customer diagnostics, grant/revoke and history remain independent. Console, grant UI and full staff history are unbuilt. All source observations above are reading, not runtime verification.

**First question for the watcher to take to the owner:** approve operator-initiated diagnostic access from a received product-bug report, with the exact portal approval above? Recommend yes. Duration, action catalogue and operator binding remain choices. Next: second Claude read, then watcher; no implementation plan.
