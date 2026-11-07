# D609: Support and the operator console

**Proposed; awaits owner review. Build nothing.** Ordinary problems stay self-service; this design adds no paid support. Asking for help is a problem report, without a help desk or ticketing.

**Authority:** lane D `questions.md`, watcher 2026-11-07 23:08, OWNER: "both should be options for the customer. and remember, non-customers should also be able to report bugs with diagnostics". Retain watcher 22:20 choices: audit every verified-owner email display; console and CLI customer-report reads share customer-visible history.

## Choose each time

You can **send a one-off diagnostic copy**, downloaded or sent from the app, or **grant time-limited support access**. The copy contains box diagnostics; the grant shows Cloud’s stored diagnostic summary for the venue. Neither replaces the other. Submitted content is a fixed copy: revocation cannot recall it. Only fresh/private inspection needs a grant, never reading the copy already sent. Customer self-service needs no staff grant.

Hand off capture, exact allowlisting, bounded diagnostics and preview to lane F **A982 Report a problem**, using its [pinned plan](https://github.com/clintongormley/waitron/blob/147914ca764a66a6dfc7fbe8500ea66c53763100/docs/superpowers/plans/2026-10-22-a982-one-touch-problem-reports.md). Current A982 scope is local capture, dialog and download; Cloud forwarding is later, and A1308 holds `bug_reports`. Do not design the box twice. Forwarding is neither built nor approved here.

## Receive and read reports

Cloud customers keep D603’s authenticated staff-report route. **Propose Cloud as the receiver for non-customers**, subject to the owner’s choice of Cloud or a separate Waitron receiving route; A982 currently supplies local capture/download only. If Cloud is chosen, venues without accounts send to a write-only country-local intake without signup. The sender chooses the country before sending. Apply A982’s allowlist, description preview/warning and byte/event bounds at both receivers; revalidate server-side and reject arbitrary attachments. Rate-limit sources and total country admission, cap concurrency/storage admission, and refuse saturation before acceptance. The new intake is unbuilt.

[D603's receiver](../../../packages/registration/src/box-error-reports.ts#L94) requires machine authentication and an installation; [its schema](../../../packages/registration/migrations/052_box_error_reports.sql#L1) requires that installation. If Cloud receives non-customer reports, its intake needs a write-only admission route, a server-assigned country report ID and schema/reader adaptations for reports without customer associations. Never create a fake account/installation. Treat content and claimed identity as untrusted: they establish neither ownership nor links to customer data. Provide no public read or identifier-lookup path.

The qualified operator chooses a country and reads both report kinds in the console's country report view. Reuse [D603's grouped reader](../../../packages/operations/src/staff-problem-reports.ts#L9), preserving empty logs and late/absent descriptions. Customer-report identity remains installation ID plus report ID. Exact-ID account/venue lookups and browser routes are new work. Scope lists (currently up to 100 reports) to country; record every disclosed customer report in its customer's history. Counts expose no extra content. Reports confer no private-inspection authority.

## Keep authority separate

[P3 §§1/4](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority) is prerequisite: separate global operator identity, country-local final authority and qualified support adapter. Customer agreement never creates operator eligibility. Replace the grant store's country-account eligibility binding with qualified country operator binding; no legacy, matching-email or customer-permission fallback. P3 sole-owner enforcement is required and unbuilt; today's store accepts any current owner. Preserve P3/D608 handover revocation.

Customer records, report payloads, contact, associations, grants and history stay in country. Global holds only operator/security metadata, never report/contact data or identifiers. Browser reads go directly to country; clear private results on country switching. [P4](../plans/2026-10-22-cloud-action-controller.md) remains planned; no repair, fiscal, activation, recovery, key or SSH powers follow.

## Approve diagnostic access

Use exactly `venue.diagnostic.read`: extract [Download diagnostic's safe projection and freshness rules](../../../packages/account-http/src/diagnostics.ts#L12). Use the report's installation only while current, unrevoked and in the approved venue; otherwise refuse, never substitute. Scope the grant to that venue, with no new installation field or live-box query.

Display verified owner email only after recording each display. Deliver the approval link manually: the [outbox](../../../packages/registration/src/email-outbox.ts#L64) and [templates](../../../packages/registration/src/account-mail.ts#L3) lack approval mail. Manual delivery copies contact/link into the operator mailbox; country/privacy handling remains unqualified. No production mail is authorised.

Without a request store, the link carries an untrusted proposal: grant ID, operator ID, country, organisation, venue, exact action, reason and duration. The link grants nothing. Country resolves the operator name from qualified binding and rechecks inputs. The current sole owner freshly authenticates, reviews exact scope and approval-relative expiry, then approves or declines; no operator self-approval. Only agreement calls adapted [grant approval](../../../packages/registration/src/support-grants.ts#L92). Read the result by proposed ID under identical operator/scope checks.

The adapter must reject `venueId: null` and require fresh authentication and exactly that action; the generic store lacks these restrictions. Propose **one hour from approval**, shorter selectable, with [D88's 24-hour ceiling](2026-10-22-cloud-data-protection-design.md#5-give-machines-scoped-keys-and-people-accountable-sessions). Changed scope/operator/action or extension needs fresh agreement. Decline creates no grant; portal lists active grants and revoke controls. Then choose **Run diagnostic**.

Preserve [transaction-only protection](../../temporary-support-grants.md#protect-database-work): recheck live operator eligibility, owner authority, scope and time after waits and before disclosure. External revoke waits for in-flight work, then blocks later work; expiry rolls back protected effects. No network/shell effects inside; disclosed data cannot be recalled.

## Record staff activity

Extend the existing [country audit](../../security-audit.md) through a new migration: fixed event/actor/subject types, qualified operator identity, composite customer-report references and report-only non-customer subjects without an organisation. Current audit requires an organisation; this adaptation is unbuilt. Customer reads, identifying list disclosures, contact displays and refusals enter customer-visible history. Non-customer actions enter country operator audit, available in that report view; no customer-account history is promised.

Record actor, fixed action/outcome, UTC time, scope and report/grant reference, never payloads, email values, parameters, results or secrets. Reuse P4 records. Commit protected work/audit together; audit failure denies disclosure. Record refusals separately after rollback; preserve operation identity across retries. Unbound failures carry only operator/country/outcome/time globally, never entered IDs. Country-to-global security transport remains unresolved P3 work; browser self-report cannot replace it.

Keep [the CLI](../../../packages/operations/src/staff-reports-cli.ts#L9), replacing direct read-only SQL with the same authenticated/audited country route and no database credential/general write privilege. Routine reads cannot bypass history. Maintenance reading no customer report stays outside.

No retention decision. Global/console failure stops operator access; country customer diagnostics, grant/revoke and history remain independent. Intake, console, grant UI, CLI adapter and history extensions are unbuilt. Cross-repository reading covered only the pinned A982 plan; all source observations are reading only, with no runtime verification.

**Next owner question:** should Cloud receive non-customer reports? Recommend this conditional country-local intake rather than a separate receiving service. A Spanish café without an account sends its printer diagnostic to Spain, where the qualified operator reads it. This adds a public write route, abuse controls and storage/audit adaptations. Then settle retention/privacy and the proposed one-hour grant default.
