# D609: Support and the operator console

**Proposed design; owner review required. Build nothing.** Ordinary problems stay self-service. Venue owners do not pay for support; asking for help is D603’s problem report, not a help desk.

**Authority:** lane D `questions.md`, watcher 2026-11-07 22:20 (owner may overrule): show verified owner email and audit every display; retain CLI report reads with the console’s customer-visible history. These choices settle neither the whole design nor build authority.

## Find, see and act

Cloud’s owner chooses a country, finds an account, venue or report by known IDs or report navigation, sees stored state and acts. Reuse stored associations and D603’s [grouped reader](../../../packages/operations/src/staff-problem-reports.ts#L9). Exact-ID lookups and authorised country browser routes are new work; no search service, index, customer store or location work.

The reader returns submitted descriptions, error codes, details and code/version groups. Preserve empty-log reports and [late or absent descriptions](../../../packages/registration/src/box-error-reports.ts#L148). A report’s identity is installation ID plus report ID. Its existing bulk list discloses up to 100 reports: scope it to the selected country and record each disclosed report in its affected customer’s history, for console and CLI alike. Group counts disclose no additional report content. Before diagnostic approval, show submitted content, associations and verified owner email. A report never authorises private inspection.

Propose one protected action: the customer’s [Download diagnostic](../../operations-status.md#download-a-customer-diagnostic), extracting its [safe projection and freshness rules](../../../packages/account-http/src/diagnostics.ts#L12). Select the report’s installation only while it remains current, unrevoked and in the approved venue; otherwise refuse rather than substitute another installation. The grant covers the venue, without a new installation field. No live box query; customer self-service needs no staff access.

## Keep authority separate

[P3 §4](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority) is prerequisite: separate global operator identity, country-local final authority and a qualified support adapter. Customer agreement never creates operator eligibility. No legacy, email-matching or customer-permission fallback. The current grant store’s country account reference and eligibility permissions must become a qualified country operator binding. P3’s sole-owner enforcement is also unbuilt and required; today’s store accepts any current owner. Preserve P3/D608 handover revocation.

Customer records, grants and history stay in country; global holds only operator/security state. Browser reads go directly to country, never through global; clear private results on switching. Independent [P4 action screens and permissions](../plans/2026-10-22-cloud-action-controller.md) remain planned. This grant adds no repair, fiscal, activation, recovery, key or SSH powers.

## Prepare access for customer approval

From a product-bug report, prepare diagnostic access and display the verified owner email, recording every display before disclosure. **Choose manual approval-link delivery:** the [outbox’s four message kinds](../../../packages/registration/src/email-outbox.ts#L64) and [fixed templates](../../../packages/registration/src/account-mail.ts#L18) have no approval request. Automatic sending adds work. Manual mail copies contact/link into the operator’s mailbox; its country/privacy handling remains unqualified. No production mail is authorised.

Without a request store, the link carries an untrusted proposal: proposed grant ID, operator ID, country, organisation, venue, action, reason and duration. It grants nothing. Country resolves the operator’s display name from its qualified binding and rechecks every input. The current sole owner reviews the exact scope and approval-relative end time, authenticates freshly, and approves or declines. The operator cannot self-approve. Only agreement calls adapted [grant approval](../../../packages/registration/src/support-grants.ts#L92); the console reads the resulting grant by its proposed ID under the same operator/scope checks. No ticket, contact service or notification workflow.

The adapter must reject an organisation-wide `venueId: null`, require exactly the diagnostic action and fresh authentication, and enforce [D88’s 24-hour ceiling](2026-10-22-cloud-data-protection-design.md#5-give-machines-scoped-keys-and-people-accountable-sessions); the generic store does not supply these restrictions. Propose one hour from approval, shorter selectable. Changed scope, operator, action or extension needs fresh agreement. Declining creates no grant; the portal lists active grants and revoke controls. After approval, choose **Run diagnostic**.

Preserve [transaction-only protection](../../temporary-support-grants.md#protect-database-work): live operator eligibility, owner authority, scope and time checks after waits and before disclosure. External revoke waits for the in-flight transaction, then blocks later work; expiry rolls back protected effects. No network/shell side effects inside it. Disclosed data cannot be recalled.

## Record staff activity without payloads

Reuse the [country security audit](../../security-audit.md), extending its fixed event/actor/subject types and database constraints through a new migration. Report reads, contact displays, identifying list disclosures and refusals need entries; P3 operator identity and the composite report reference need representation. This deliberately extends today’s exclusion of passive reads. Show actor, fixed action/outcome, UTC time, scope and report/grant reference; no email values, parameters, descriptions, results or secrets. Reuse P4 records rather than duplicate history.

Commit protected database work and audit together; recording failure denies disclosure. Record refusals separately from rolled-back work; preserve operation identity across retries. Unbound failed lookups are global operator/security events: only operator, country, fixed outcome and time, never entered IDs or customer data. Country must send them; browser self-report is insufficient. That transport remains unresolved P3 work.

**Keep D603’s CLI**, calling the same country route with operator identity and audit, without a database credential or general write privilege. [Today’s CLI](../../../packages/operations/src/staff-reports-cli.ts#L9) instead uses a read-only database connection with no operator/audit wrapper. Direct database reads bypass history; routine staff reads must use the common route. Maintenance reading no customer report stays outside.

No retention choice. If global/console fails, operator access stops; country customer diagnostics, grant/revoke and history remain independent. Console, grant UI, common CLI wrapper and history extensions are unbuilt. Source observations are reading only, not runtime verification.

**Next owner question:** for a café’s printer-fault report, start with the owner downloading and sending their diagnostic, or build the proposed grant path? Download needs less work; grants avoid customer file handling and permit fresh reads. An emailed diagnostic also leaves customer history and needs qualified country handling. Set duration only after choosing grants.
