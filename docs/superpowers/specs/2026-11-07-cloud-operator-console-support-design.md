# D609: Support and the operator console

You would report a problem or suggest a feature through Cloud forms in Waitron's dashboard and the Cloud account site. Free and paid accounts could report; venues without an account would register free first. You would see your reports and their progress, and every venue could see feature requests, vote and comment. Bugs and diagnostics would stay private in your country. Where diagnostics exist, you could send a previewed, sanitised copy or approve support access to Cloud's stored summary for 24 hours, with shorter choices. Staff would gain no repair powers. This proposes reporting and limited inspection, with customer-visible history and no help desk or ticket workflow.

**Proposed; no build or landing follows.** Authority: owner via watcher, 2026-11-08 12:33 and 13:24, replacing anonymous intake and the one-hour default. Retain 2026-11-07 23:08's diagnostic choices and 22:20's recorded email displays and common console/command-line history. Source references are readings, not runtime verification.

## Report and follow progress

Both forms would require a signed-in Cloud account and rate-limit submissions per account. The dashboard would prompt for Cloud sign-in too; a box signature alone would not replace it. The form would use your venue's language, or your chosen account language before pairing. A boxless report would belong to your country organisation and its owner, without inventing a venue or installation. It would offer no copy or grant when there is nothing to inspect.

Your report list would show **open**, **being worked on**, or **fixed in version X**. Bugs and their descriptions/diagnostics would be visible only to the sending venue (or boxless organisation) and authorised country staff. Feature requests would never carry diagnostics. Proposed public-content rules: no author/venue identity, one vote per organisation, and staff can hide text containing personal data. Comments would have the same rules.

For either report type, staff would initially rewrite product-relevant text into a matching GitHub issue, without names, diagnostics or account/venue/installation/report identifiers. The association would stay in country. The proposed status link would read only a fixed status and validated release version: open by default, being worked on with a designated work label, fixed in version X only with an explicit release marker. Closing an issue alone would not mean fixed. Arbitrary GitHub text would not flow back. Automatic issue copying remains separate work; customers would not need GitHub accounts.

**Publication scope remains open:** recommend sharing sanitised feature and comment text and anonymous vote totals across countries, with original submissions, individual votes and customer associations kept in country. Every venue's visibility is the owner's choice; it must not silently export customer data through the worldwide staff service. No cross-country sharing would start until this scope and its country-data boundary are approved.

## Share only permitted diagnostics

Every outgoing box diagnostic would contain only permitted fields and values, never personal names, emails, phones, tax numbers or secrets. You would preview it first. Waitron's [A982 plan](https://github.com/clintongormley/waitron/blob/147914ca764a66a6dfc7fbe8500ea66c53763100/docs/superpowers/plans/2026-10-22-a982-one-touch-problem-reports.md#privacy-resource-bounds-and-retry-behavior) owns box capture, preview and policy. Its planned allow-list lives in `packages/diagnostics/src/trail-policy.ts`, with `report-codes.ts`, `report-screens.ts` and `path-patterns.ts` defining allowed values and masked routes. Unknown box fields are dropped. URL-password-only `redactSecrets` is insufficient.

Cloud would independently check allowed keys/values and size/event limits. Its [existing box receiver](../../../packages/registration/src/box-error-reports.ts#L49) rejects unknown keys; retain rejection of unsupported payloads, rather than accepting unreviewed fields from a newer box. Cloud's stored-summary key/value policy would live alongside the explicit [response projection in diagnostics.ts](../../../packages/account-http/src/diagnostics.ts#L39). Its existing output is a starting shape, not completed privacy qualification. A grant preview would show permitted fields and current values; later reads could change those values within the same policy. Your typed description would remain separate, previewed with a warning against personal information and secrets, and never copied verbatim to GitHub.

**Next owner question:** [automatic error reports](2026-10-24-cloud-monitoring-alerting-status-design.md) already run under venue agreement without a per-send preview. Recommend showing their permitted fields and sample values when seeking that agreement. Whether this satisfies the new preview rule, or every automatic send must wait for a preview, needs an explicit answer. No exception is approved here.

## Keep country and staff authority separate

The [P3 operator boundary](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority), single-owner lifecycle and separately qualified country support permissions remain prerequisites. Your approval cannot make staff eligible. No email match, customer-permission fallback or support takeover would replace those checks. Ownership changes would revoke former-owner access and authority derived from it.

Customer/report/contact/grant/history data would stay in country. Console browsers would read countries directly and clear private results when switching. The console would find an account, venue or report, show its state and offer the permitted diagnostic action. Worldwide failure would stop staff access while country customer diagnostics, grant/revoke and history remain independent.

## Choose a copy or temporary access

Reading a submitted copy would need no grant; revocation could not recall it. Fresh inspection of Cloud's stored summary would require exact `venue.diagnostic.read`, limited to one venue. The report's installation must remain current, unrevoked and in that venue, without substitution. No live-box query, SSH, repair, activation, fiscal, recovery or key powers follow.

The report view would show the proposed access request. The current sole Cloud owner would authenticate afresh and review operator, venue, action, reason and duration. Staff could not self-approve. Cloud would set expiry using its own clock at approval: **24 hours as standard**, shorter choices, refusing longer durations. Extension or changed operator/action/scope needs fresh agreement. Active grants would be visible and revocable. No production email is authorised.

Preserve [grant transaction and revocation rules](../../temporary-support-grants.md#protect-database-work): check authority/time after waits and before disclosure. Protected work and history commit together or neither does. Revocation waits for running protected work, then blocks later work; expiry rolls back protected effects. Network calls and shell commands stay outside. Disclosed data cannot be recalled.

## Show staff activity

Record each owner-email display, identifying list, report read, diagnostic access and customer-associated refusal in [country customer history](../../security-audit.md), with actor, action/outcome, time and scope/reference, never contents, email values or secrets. Recording failure denies disclosure; record refusals after rollback. Unassociated refusals include no entered customer IDs.

Adapt the [report reader](../../../packages/operations/src/staff-problem-reports.ts#L9), retaining installation-plus-report identity, empty logs and late/absent descriptions. The [command-line reader](../../../packages/operations/src/staff-reports-cli.ts#L7) would use the same authenticated country route and history, without direct SQL bypass.

Both forms, shared features/votes/comments, private report views, GitHub status link, console and grant/history integration remain unbuilt. Privacy/retention and publication choices remain open. This design does not approve implementation.
