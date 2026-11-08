# D609: Support and the operator console

You would report a problem or suggest a feature through Cloud forms in Waitron's dashboard and the Cloud account site, in your venue's language. Free and paid accounts could report; venues without an account would register free first. You would see your reports and their progress, and every venue could see feature requests, vote and comment. Bugs and diagnostics would stay private in your country. Each time, you could send a previewed, sanitised diagnostic copy or approve support access to Cloud's stored summary for 24 hours, with shorter choices. Staff would gain no repair powers. This proposes reporting and limited inspection, with customer-visible history, without a help desk or ticket workflow.

**Proposed design for owner approval; no build follows.** Authority: owner via watcher, 2026-11-08 12:33 and 13:24, superseding anonymous intake and receiver/default questions; retain 2026-11-07 23:08's choice each time and 22:20's email-display and shared-history requirements. Source references below are readings, not runtime verification. All new behaviour is proposed.

## Report and follow progress

Both forms would require a signed-in free or paid Cloud account and rate-limit submissions per account. There would be no anonymous Cloud intake. Your own report list would show **open**, **being worked on**, or **fixed in version X**. A bug report would be visible only to its sending venue and authorised staff for that country. Its description and diagnostic would remain private in Cloud in the venue's country.

The new account-authenticated form would also accept reports before a box is paired, without inventing an installation. Existing box reports would retain their installation-plus-report identity.

Feature requests would be visible to every venue, with votes and comments. Initially, staff would open a sanitised matching GitHub issue without a venue name or diagnostic, checking any description before copying product-relevant text. GitHub status would flow back to the Cloud report view. An automatic copy step would remain separately unbuilt. Customers would use Cloud rather than needing GitHub accounts.

**One owner choice remains:** what feature/comment content may cross countries? Recommend sharing only staff-sanitised product text and anonymous vote totals, without author or venue identifiers; original submissions, individual votes and customer associations would stay in country. This limited publication scope needs owner approval before cross-country sharing; universal feature visibility must not silently export customer data.

## Share only permitted diagnostics

Every diagnostic leaving a box, through any route, would contain only explicitly permitted fields and values. Personal names, emails, phone numbers, tax numbers and secrets would never leave. You would preview the actual outgoing diagnostic first. Receivers would independently enforce the same rules, including size/event limits, rather than trust the sender.

Waitron's [A982 plan](https://github.com/clintongormley/waitron/blob/147914ca764a66a6dfc7fbe8500ea66c53763100/docs/superpowers/plans/2026-10-22-a982-one-touch-problem-reports.md#privacy-resource-bounds-and-retry-behavior) owns box capture, preview and policy. Its planned allow-list home is `packages/diagnostics/src/trail-policy.ts`, with `report-codes.ts`, `report-screens.ts` and `path-patterns.ts` defining permitted codes, screens and masked routes. It specifies field-key/value checks, masked parameter paths and dropping unknown keys. These are planned requirements, not a claim of delivery. URL-password-only `redactSecrets` is insufficient. Cloud would reuse that standard rather than duplicate box capture.

Cloud's stored summary would meet the same allow-list and preview standard. Its starting shape is the explicit [response projection in diagnostics.ts](../../../packages/account-http/src/diagnostics.ts#L39); any extension would need equally explicit field/value rules. A source projection alone is not privacy qualification. Your typed description would remain separate from diagnostics, previewed with a warning against personal information and secrets. It would never become public diagnostic content or be copied verbatim to GitHub.

## Keep country and staff authority separate

The [P3 operator boundary](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority) and single-owner customer lifecycle would remain prerequisites. Staff would need separate worldwide identities and independently qualified country support eligibility. Customer approval could not confer that eligibility. No email match, customer permission fallback or support takeover would substitute for it. Ownership changes would retain P3's revocation of former-owner access and derived authority.

Customer, report, contact, grant and history data would stay in country, never in the worldwide staff service. Console browsers would read the country directly and clear private results when switching countries. Worldwide service or console failure would stop staff access without stopping country customer diagnostics, grant/revoke or history.

Within the chosen country, the console would find an account, venue or report, show its state and offer the permitted diagnostic action.

## Choose a copy or temporary access

A submitted copy would be distinct from grant access: reading that submission would need no grant, and revocation could not recall it. Fresh inspection of Cloud's stored summary would require a grant. It would never query the live box.

The sole permitted action would be exact `venue.diagnostic.read`, limited to one venue, never organisation-wide. The report's installation would have to remain current, unrevoked and in that venue; otherwise access would refuse without substitution. Staff would gain no SSH, repair, activation, fiscal, recovery or key-management powers.

The current sole verified Cloud account owner would authenticate afresh and review the named eligible operator, venue, exact action, reason and expiry before approving or declining. Staff could not self-approve. Standard duration would be **24 hours from customer approval**, with shorter choices and no longer options. Extension or changed scope, action or operator would need fresh agreement. You would see active grants and could revoke early. Approval delivery would remain country-owned; this design authorises no production email.

Preserve the [grant transaction, expiry and revocation semantics](../../temporary-support-grants.md#protect-database-work): recheck authority and time after waits and before disclosure; protected work commits together or rolls back together. External revocation waits for running protected work, then blocks later work; expiry rolls back protected effects. Network calls and shell commands stay outside that transaction. Disclosed data cannot be recalled.

## Show staff activity

Every display of the verified owner's email, identifying report list, report read, diagnostic access and customer-associated refusal would enter the customer's common console/command-line history. Extend [country security history](../../security-audit.md) with actor, action/outcome, time and scope/reference, never email values, report contents or secrets. Protected disclosure and history would commit together; recording failure would deny disclosure, with refusals recorded after rollback. Unassociated refusals would include no entered customer identifiers.

Adapt the [report reader](../../../packages/operations/src/staff-problem-reports.ts#L9), preserving installation-plus-report identity, empty logs and late or absent descriptions. The [CLI](../../../packages/operations/src/staff-reports-cli.ts#L7), a tool operated by typed commands, would use the same authenticated country route and history as the console, without direct SQL bypass.

New work remains: both forms, the shared feature list/votes/comments, own private report view, GitHub status link, country console, grant screens and history/CLI integration. Separately qualified support authority, privacy/retention decisions and the prerequisites above remain outstanding. The parent submits this design for owner approval; it is not an implementation plan.
