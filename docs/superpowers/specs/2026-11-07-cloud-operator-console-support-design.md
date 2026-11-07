# D609: Support and the operator console

**Proposed design; owner decisions remain. Nothing built.** You should be able to solve ordinary problems at the screen. Cloud staff access is for investigating a product bug.

Scope authority, watcher lane D `questions.md`, 2026-11-07 21:01:

> "The owner chose Cloud launch items 5 and 6: D608 (one owner per account: handover and lost-owner recovery) and D609 (support and the operator console). Both are design only, at most two pages each, Claude read, then me."

The D609 queue also states: "venue owners do not pay for support" and "asking for help is the problem report D603 already receives, not a help desk." These instructions authorise this draft, not its product choices.

## Start with what already exists

D603 receives administrator-sent descriptions and structural error logs and supplies a [local grouped list](../../../packages/operations/src/staff-problem-reports.ts#L9). Reports with empty logs remain individual reports; descriptions can arrive later or never. A sent report permits investigation of that content, not arbitrary private venue inspection. These are source observations, not executed checks.

First let the customer inspect their existing [Download diagnostic](../../operations-status.md#download-a-customer-diagnostic). Its [redacted projection](../../../packages/account-http/src/diagnostics.ts#L12) contains service/connection health and backup times without raw errors, content or secrets. The proposed single support action reads this same document for the selected installation in one venue. Reuse its projection and freshness rules, with grant authority replacing the customer-only ownership check. No live box query, SSH, shell, configuration change, key retrieval, recovery, replacement, fiscal or activation action is included.

The [grant store](../../../packages/registration/src/support-grants.ts#L85) defaults to no eligible identities or actions. The [customer audit](../../security-audit.md) exists; the console, grant screens and full staff activity view do not. No runtime capability is qualified here.

## Find an account, venue or report

The operator chooses a country and opens its report list, or enters an exact known account, venue or report ID. A report leads to its venue and owning account. Propose no free-text search across customers. Before a grant, show only identifiers and their association, report presence, and content the venue has sent. Service, connection and backup state require the diagnostic grant. This country lookup/report API is new work; fleet [status totals](../../operations-status.md) are not a private venue reader.

Reuse error-code/version grouping. Record customer-identifying list disclosures, successful lookups and report opens in the affected customer's history. Anonymous aggregate browsing exposes no customer identifiers or descriptions. Never put another customer's result or typed search in a customer's history.

Preserve [P3's separate operator boundary](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority). Country APIs independently authorise reads; customer consent does not confer operator permission. Propose Cloud's owner as the sole initial operator, with no staff roles. P3 must supply its operator authentication, sole-owner country authority and separately qualified support adapter before this console can run. The adapter must reconcile the store's eligible country platform identity with the separate operator identity, without email matching or copied customer permissions; its exact binding remains unresolved. Do not enable legacy permissions as a fallback.

Customer data, grants and activity remain country-local; the global store receives none. The browser reads the selected country directly and clears private results when switching. Cloud infrastructure repairs keep [P4's separate permissions and console](../plans/2026-10-22-cloud-action-controller.md); a support grant changes none of them. This design does not build P3 or P4.

## Let the customer start access

**Proposed simplification for owner approval:** from their venue card or received report, the current sole country owner chooses “Let Waitron read this venue's diagnostic”. There is no stored staff request, notification, ticket or declined state. Choosing nothing leaves the report received and self-service available.

Show the named Cloud operator, country, organisation, venue, selected installation, diagnostic action, reason and end time before fresh authenticated agreement. Propose one hour, shorter selectable, within the existing [24-hour maximum](2026-10-22-cloud-data-protection-design.md#5-give-machines-scoped-keys-and-people-accountable-sessions). The generic store does not enforce that maximum. Extending time or changing scope/operator/action needs fresh agreement. The portal lists active grants with revoke controls.

Recheck operator, approving owner, scope and time after waits and before disclosure. Preserve the store's [transaction boundary](../../../packages/registration/src/support-grants.ts#L131): external revocation waits for the current database transaction, then denies later work; expiry during it rolls back protected effects. Never promise to recall disclosed data. Ownership loss already invalidates an approving owner's use; preserve P3/D608's wider handover revocation rules without implementing them here.

For example, a synthetic Spanish café sends “Printer stopped after upgrade.” The operator opens that report. At 14:00 UTC the café owner permits the existing diagnostic until 15:00 UTC. The operator reads service metadata, not receipts or printer configuration. Revoking access blocks the next read. History shows who opened the report and read its diagnostic, with UTC times and outcomes.

## Show every staff action

Use the existing immutable customer audit. For diagnostic successes, interpret `support.accessed` through its grant's single fixed action, rather than adding a general details field. Add fixed lookup/report-read events and grant-bound refusal outcomes; [D88 requires visible refusals](2026-10-22-cloud-data-protection-design.md#5-give-machines-scoped-keys-and-people-accountable-sessions). Unbound failed lookups belong only in country operator security history, without raw search values. Preserve operation identity on retries to avoid duplicate history.

Record successful protected database work and audit together. Record refusals separately so rollback cannot erase them; failed refusal recording never permits access. If a successful read cannot be recorded, disclose nothing. Show actor, fixed action/outcome, time, scope and report/grant reference, never parameters, results, descriptions or secrets. Surface applicable P4 actions from its existing records without a duplicate action store.

These guarantees require console/API access only: withdraw the direct-database report CLI and credentials from routine operator use before enablement. Exceptional infrastructure access is outside this design's complete-recording claim. Keep existing retention decisions open. If console/global is unavailable, operator access stops; country customer diagnostics, grant/revoke and history remain available.

Future acceptance covers isolated lookups/report reads, empty logs, late descriptions, exact consent, waits, expiry/revoke races, retries, ownership loss and payload-free history. No implementation plan follows this draft.

**First owner question:** should the customer start access as above, instead of Cloud sending a request? Recommend yes. The café owner explicitly opens one hour of diagnostic access, with no pending request or notification flow. Catalogue, duration and the identity binding remain subsequent choices.
