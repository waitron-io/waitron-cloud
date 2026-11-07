# D609: Support and the operator console

**Proposed draft for Claude read, then owner approval. Nothing built.** Venue owners do not pay for support. Almost everything except a product bug must be solvable by the person at the screen.

Scope authority, watcher lane D `questions.md`, 2026-11-07 21:01:

> "The owner chose Cloud launch items 5 and 6: D608 (one owner per account: handover and lost-owner recovery) and D609 (support and the operator console). Both are design only, at most two pages each, Claude read, then me."

This authorises drafting only. D608 is parked on a separate owner decision, not a design dependency. No new service, signed protocol, approval system, tickets, manual support process, AI, paging, production transport or spending is proposed.

## What exists, from source reading only

D603 #1079 supplies the report receiver ([box-error-reports.md:106](../../box-error-reports.md#L106)) and a local grouped reader ([staff-problem-reports.ts:9](../../../packages/operations/src/staff-problem-reports.ts#L9), [staff-reports-cli.ts:7](../../../packages/operations/src/staff-reports-cli.ts#L7)). Asking for help means a received problem report. Reuse its error-code/version groups, sent description and structural logs; submitting one never authorises arbitrary private venue inspection. Reuse [status readers](../../operations-status.md#L71) for state.

[SupportGrantStore](../../../packages/registration/src/support-grants.ts#L85) and the [customer audit](../../security-audit.md#L19) exist; grant configuration defaults empty. This is source reading, not runtime qualification. No tests ran. Console, customer grant UI, action catalogue and complete staff history remain unbuilt. P4's [ActionConsole is documented future work](../plans/2026-10-22-cloud-action-controller.md#L253).

## Find, see and act within one country

You, the Cloud operator, explicitly choose a country, then find an account, venue or report and see its state. Country APIs independently authorise metadata/report reads and record disclosures. A support grant supplies neither console permission nor customer impersonation.

Preserve revised [P3 sections 3–4](../plans/2026-10-22-cloud-global-country-split.md#L49), which are future operator-only boundaries, not enabled functionality. Its initial `cloud.actions.owner` permission does not enable support. Before runtime use, a separately qualified country adapter must bind the distinct global operator to the eligible legacy platform identity required by [the store](../../../packages/registration/src/support-grants.ts#L71). Never match email/customer accounts or infer owner/support authority.

Keep customer data, grants and history country-local. The global store contains no customer identifiers, reports, results or search data. The browser reads country responses directly into memory and clears them on country change, following [P3](../plans/2026-10-22-cloud-global-country-split.md#L15). Searching another country requires choosing it explicitly; no global aggregation or copying.

“Act” means view grouped reports, request a narrow diagnostic grant, run approved diagnostics, or reuse separately authorised Cloud actions through P4's documented console. Preserve its exact configured operator, `cloud.actions.owner`, current country grant, country/cell/action limits and final checks ([P4:193](../plans/2026-10-22-cloud-action-controller.md#L193), [P3:77](../plans/2026-10-22-cloud-global-country-split.md#L77)). Support approval bypasses none. Add no triage states, Waitron location, owner recovery, fiscal or activation authority.

## Customer agreement and the first actions

**Proposed owner choice:** start with read-only Cloud diagnostics: installation service state and connection/backup health metadata. These are descriptions, not approved identifiers. Exclude customer content, secret/key retrieval, configuration edits, recovery, replacement and fiscal/activation actions. One venue per grant; no organisation-wide first catalogue.

Propose **one hour**, with shorter duration selectable. Enforce the existing 24-hour maximum and fresh approval to extend ([backlog:418](../../backlog.md#L418), [D88/D101 design:186](2026-10-22-cloud-data-protection-design.md#L186)); the generic store alone does not enforce that maximum.

The current sole country owner approves or revokes. Show exact country, organisation, venue, named staff, reason, fixed actions and end time before agreement. Declining preserves ordinary self-service and leaves the report received. Extending time or changing staff/actions requires fresh approval. Transfer invalidates relevant grants; the recipient grants anew, without implementing D608 here.

Recheck current owner, operator, scope and time after waits and before disclosure/commit. Expiry or revocation refuses further work. Honour [the transaction boundary](../../../packages/registration/src/support-grants.ts#L131): external revocation waits for the current database transaction, then blocks later actions; expiry during it rolls back protected effects. No SSH, shell or remote network side effects enter the callback. Promise neither immediate shell termination nor recall of disclosed data.

For example, a synthetic Spanish café reports “Printer stopped after upgrade.” You choose Spain, find its grouped report and read what was sent. Suspecting a product bug, you request service/connection/backup diagnostics for that venue. At 14:00 UTC its owner approves Alex until 15:00 UTC. You read metadata, not receipts or printer configuration. Revocation blocks your next diagnostic; the report remains received. Customer history shows “Alex read Cloud diagnostics, succeeded, 14:05 UTC.”

## Every staff action visible

Existing `support.accessed` exports identify grant and actor but omit action name and outcome ([security-audit.ts:67](../../../packages/registration/src/security-audit.ts#L67)); this is not an understandable complete activity list. Extend the immutable country customer audit minimally: fixed human-readable action/outcome, actor, UTC time, affected scope and associated report/grant reference where applicable. Exclude raw parameters, results, reason, typed searches, secrets and descriptions.

Record successful changes with protected database effects in one transaction. Record customer-bound attempted/denied operations separately so rollback cannot erase refusals. For search/read, record each affected tenant's disclosure; foreign results and searches must not leak into another tenant's history. Failed searches with no target go only to operator security history, with no invented customer association.

Present this in the portal's customer security history using the existing audit, alongside active grants and revoke controls; these screens are proposed. Staff cannot bypass history: unavailable recording denies the action/disclosure. Choose no new retention; [production audit retention remains open](../../security-audit.md#L65).

Future acceptance covers country isolation, independent permissions, exact consent, decline, changed staff/actions, ownership transfer, waits, expiry/revoke races, and complete tenant-safe history without private payloads. These are future cases, not a build plan.

**Owner decision:** is this initial diagnostic-only catalogue enough, or which exact additional repair actions are needed? Recommend diagnostic-only: the printer example permits investigation, not a silent power to edit or restart it.
