# D609: Support and the operator console

You would report bugs and suggest features from the box, using its paired organisation account without staff Cloud sign-in. Your Cloud account site would show your private bugs and their status, country feature requests with votes and comments, exact Sent reports and staff history. Diagnostics would stay private in country; you could send a copy or grant temporary access to Cloud's stored summary. Shared text would show no author name, and staff could hide text containing personal data. The owner approved this design and both choices; implementation needs its own approved plan.

Owner decisions via watcher, 2026-11-08 12:33, 13:24 and 13:48–13:50; design and both proposals approved at 14:28, recorded in Lane G questions.md. All source pointers below are readings only, not runtime verification.

## Report from the box

The form would live on the dashboard and till, in your venue's language, not on the Cloud account site. Every bug or feature report would be tied to the paired organisation and venue. Unpaired boxes would prompt free registration and pairing. Reuse the [paired sending route](../../../packages/account-http/src/box-error-reports.ts#L7), extending it only as needed later; this does not claim a feature form exists.

Your Cloud account site would show your own private bugs and diagnostics, with status **open**, **being worked on**, or **fixed in version X**. Features and comments would carry no diagnostics, with one vote per organisation. Every venue in a country sees that country's list; joining lists waits for a second country and an owner decision.

Staff would rewrite product-relevant text into GitHub issues without customer identities, diagnostics or internal identifiers. Links would stay in country. A designated work label would mean being worked on; an explicit release marker and validated version would mean fixed. Closing alone would not mean fixed, and arbitrary GitHub text would not return. You would need no GitHub account.

## See what leaves

The owner's reason is: "i think we should show a preview so that the user knows what they're sending. they don't know that we sanitise the data". Automatic reports would send under venue agreement without per-send intervention. At switch-on, show exactly which information kinds leave and a real report example. Every automatic or manual send would appear in **Sent reports** on the Cloud account site, openable with its exact content. Manual sends would show their file before sending.

[A982's PR1 plan at Waitron commit 0e61c78](https://github.com/clintongormley/waitron/blob/0e61c78b539c9ff4a3656920ae17ff38f2cf9154/docs/superpowers/plans/2026-11-08-a982-client-only-report-first.md) adds read-only preview before local download, not on main. A982 has no Cloud call. Box-to-Cloud sending with its preview check is new work.

All outgoing and Cloud-stored diagnostics would follow named allowed field/value rules, never containing personal names, emails, phones, tax numbers or secrets. Waitron's planned `packages/diagnostics/src/{trail-policy,report-codes,report-screens,path-patterns}.ts` would define fields, codes, screens and masked routes. Cloud would independently check keys, values and bounds, retaining [unsupported-payload rejection](../../../packages/registration/src/box-error-reports.ts#L49). A new stored-summary policy would accompany the [response projection](../../../packages/account-http/src/diagnostics.ts#L39). Typed descriptions would remain separate, previewed with a personal-data warning, never copied verbatim to GitHub.

## Limit support access

Before support access can be built, Cloud must check which staff may help in each country and which customer owns the account, following the [P3 country rules](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority). Your approval would not let an otherwise unauthorised staff member help or take over your account. It would permit no repairs, access to your running box, tax changes, server activation, recovery or key access.

A submitted copy needs no grant and cannot be recalled. A grant would cover only Cloud's stored summary for one venue, with permitted fields and current values shown first. The report's installation must remain current, unrevoked and in that venue, without substitution. The sole owner would authenticate afresh and approve operator, action, reason and duration. Cloud would calculate **24 hours as standard** from approval, offer shorter choices and refuse longer ones. Extension or changed operator, action or scope needs fresh agreement; active grants remain visible and revocable. Preserve the [transaction and revocation rules](../../temporary-support-grants.md#protect-database-work): save each action and its history together, check permission again after any wait, undo changes if permission has expired, and finish that database work before contacting another service.

## Make staff access visible

The console would find accounts, venues and reports, displaying email only with recorded history. Customer data stay in country; switching countries clears results. Console and [CLI](../../../packages/operations/src/staff-reports-cli.ts#L7) would share authenticated country routes/history, without direct SQL bypass. Keep each report tied to the box that sent it, allow reports with no logs, and keep descriptions added later, as the [current report reader](../../../packages/operations/src/staff-problem-reports.ts#L9) does.

A staff-history page on the Cloud account site would show actor, action/outcome, time and scope for identifying lists, email displays, report/diagnostic reads and customer-linked refusals, without contents or secrets. Failed recording would block disclosure. If an action is refused, Cloud would undo its changes before recording the refusal. If it cannot identify the customer, that record would leave out any customer details entered. Today's [audit documentation](../../security-audit.md#read-or-export-a-page) exposes JSON export and excludes passive reads; it does not establish this UI or coverage.

Build in small usable pieces, starting with the box sending a report and the venue opening it in Sent reports. Nothing else comes first. New to build: box forms and checked Cloud sending, automatic-report switch-on information, exact Sent reports, private bugs/status, country features/votes/comments, GitHub links, console, common authenticated routes, grant integration and customer-visible staff history. Privacy/retention and qualified country support authority remain prerequisites.
