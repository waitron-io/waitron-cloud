# D609: Support and the operator console

**Proposed; awaits owner review. Build nothing.**

You choose each time: send a one-off copy of your box diagnostic, or approve time-limited support access to Cloud's stored venue diagnostic summary. Cloud staff can read submitted reports and, with your approval, that summary. They gain no repair or recovery powers. Their actions on customer data appear in your history. A venue without a Cloud account can also send a bug report and diagnostic. The proposed receiver is Cloud in the country the sender chooses, without signup; the owner must still confirm that receiver. Ordinary problems remain self-service, with no paid support, help desk or ticketing. The owner still decides privacy, retention and the proposed one-hour access default.

**Authority:** lane D `questions.md`, watcher 2026-11-07 23:08, OWNER: "both should be options for the customer. and remember, non-customers should also be able to report bugs with diagnostics". Retain watcher 22:20 choices: record every display of the verified Cloud account owner's email; console and command-line customer-report reads share customer-visible history.

## Choose each time

You can download or send the diagnostic copy from the app. Neither sharing option replaces the other. Revoking access cannot recall a submitted copy. Staff need your grant for fresh or private inspection, but not to read the copy you sent. You need no staff grant for self-service.

Waitron's [Report a problem plan](https://github.com/clintongormley/waitron/blob/147914ca764a66a6dfc7fbe8500ea66c53763100/docs/superpowers/plans/2026-10-22-a982-one-touch-problem-reports.md) owns capture, permitted fields, diagnostic size/event limits and preview. Its current scope is local capture, dialog and download; forwarding to Cloud comes later and is neither built nor approved here. The separate Waitron task A1308 controls changes to the `bug_reports` database table; that hold remains. Do not duplicate the box design.

## Receive and read reports

Cloud customers keep the existing authenticated route for venue staff reports. **Cloud is the proposed non-customer receiver**, subject to the owner's choice of Cloud or a separate Waitron route. If chosen, its new, unbuilt intake accepts submissions without signup in the sender's chosen country, but permits no reading. Both receivers apply Waitron's permitted fields, description preview/warning and size/event limits, recheck them on the server and reject arbitrary attachments. Limit each source and total country intake, simultaneous submissions and accepted storage; refuse before acceptance when full.

[The existing receiver](../../../packages/registration/src/box-error-reports.ts#L94) authenticates the box and requires its installation identity, as does [report storage](../../../packages/registration/migrations/052_box_error_reports.sql#L1). Non-customer intake needs a server-assigned country report ID and storage/reader changes for reports without customer associations. Never invent an account or installation. Submitted content and identity claims prove neither ownership nor customer-data links. Provide no public reading or identifier lookup.

Cloud staff independently authorised for support in that country read both report kinds in its console view. Reuse [the grouped reader](../../../packages/operations/src/staff-problem-reports.ts#L9), preserving empty logs and late/absent descriptions. Customer reports retain installation ID plus report ID as identity. Account/venue lookup by exact ID and browser routes are new work. Lists remain country-specific, currently up to 100 reports; every customer report disclosed enters that customer's history. Counts reveal no extra content. Receiving a report grants no private-inspection authority.

## Keep authority separate

The [country-account/operator separation](../plans/2026-10-22-cloud-global-country-split.md#4-separate-operator-authority) is prerequisite. Cloud staff need a separate worldwide identity; software in the country makes the final support-eligibility check. Your agreement cannot make staff eligible. Grant storage must use that country operator authorisation, without falling back to older account rules, matching emails or customer permissions. Enforcing one Cloud account owner per organisation remains unbuilt; today's store accepts any current owner. Preserve ownership-transfer revocation of former-owner sessions, access, approvals, support grants, consent and queued work.

Customer records, report contents, contact, associations, grants and history stay in country. The worldwide service holds only operator/security metadata, meaning records about staff identity and security, never report/contact data or identifiers. Browsers read countries directly and clear private results on country switching. The [Cloud action controller](../plans/2026-10-22-cloud-action-controller.md) remains planned. This design grants no repair, fiscal, activation, recovery or key powers, and no SSH access for running commands on a machine.

## Approve diagnostic access

The sole action, `venue.diagnostic.read`, uses [Download diagnostic's safe fields and rules for how recent data must be](../../../packages/account-http/src/diagnostics.ts#L12). Use the report's installation only while current, unrevoked and in the approved venue; otherwise refuse without substitution. Limit the grant to that venue, without a new installation field or querying the live box.

Record each display before showing the verified Cloud account owner's email. Deliver approval links manually: the [outbox](../../../packages/registration/src/email-outbox.ts#L64) and [templates](../../../packages/registration/src/account-mail.ts#L3) lack approval mail. This copies contact/link into the staff operator's mailbox; country/privacy handling remains unconfirmed. No production mail is authorised.

Without storing a request, the link carries an untrusted proposal: grant ID, operator ID, country, organisation, venue, exact action, reason and duration. It grants nothing. Country software resolves the authorised operator's name and rechecks inputs. As current sole Cloud account owner of the organisation, you authenticate again, review exact scope and expiry measured from approval, then approve or decline. Staff cannot self-approve. Only agreement calls adapted [grant approval](../../../packages/registration/src/support-grants.ts#L92). Reading its result by proposed ID repeats identical operator/scope checks.

Country support code must reject `venueId: null` (organisation-wide access), require fresh authentication and allow only that action; generic storage lacks these restrictions. Propose **one hour from approval**, with shorter choices and the [24-hour maximum](2026-10-22-cloud-data-protection-design.md#5-give-machines-scoped-keys-and-people-accountable-sessions). Changed scope/operator/action or extension needs fresh agreement. Declining creates no grant; the portal lists active grants and revocation controls. Staff then choose **Run diagnostic**.

Preserve [database transaction protection](../../temporary-support-grants.md#protect-database-work): database work commits together or rolls back together. Recheck current operator eligibility, owner authority, scope and time after waits and before disclosure. External revocation waits for running work, then blocks later work; expiry rolls back protected effects. Network calls and shell commands cannot be rolled back and stay outside. Disclosed data cannot be recalled.

## Record staff activity

Extend the [country activity record](../../security-audit.md) through a new database migration. Use predefined activity names, types of people acting and types of records affected, authorised operator identity, installation-plus-report customer references and non-customer report subjects without an organisation. Current recording requires an organisation; adaptation is unbuilt. Customer reads, identifying lists, contact displays and refusals enter customer-visible history. Non-customer actions appear in the country's operator activity record and report view, without promising customer-account history.

Record who acted, fixed action/outcome, UTC time (the worldwide time standard), scope and report/grant reference, never contents, email values, request inputs, results or secrets. Reuse the planned action controller's records. Commit protected work/history together; recording failure denies disclosure. Record refusals separately after rollback; retries retain operation identity. Failures before a customer association is established record only operator/country/outcome/time worldwide, never entered IDs. Sending country security events to the worldwide service remains unresolved; browser self-report cannot replace it.

Keep [the command-line report reader](../../../packages/operations/src/staff-reports-cli.ts#L9), a tool run by typing commands. Replace its direct database reads with the same authenticated, recorded country route, without database credentials or general write permission. Routine reads cannot bypass history. Maintenance that reads no customer reports stays outside this report history.

Retention is undecided. If the worldwide service or console fails, staff access stops; country customer diagnostics, grant/revoke and history remain independent. Intake, console, grant screens, command-line integration and history extensions are unbuilt. Cross-repository reading covered only the pinned Report a problem plan; all source observations are reading only, with no runtime verification.

**Next owner question:** confirm Cloud as non-customer receiver or choose a separate Waitron route. Recommend Cloud's country-local intake: a Spanish café without an account sends its printer diagnostic to Spain for authorised staff to read. This adds public intake, abuse controls and storage/activity-record changes. Retention/privacy and the proposed one-hour default remain open.
