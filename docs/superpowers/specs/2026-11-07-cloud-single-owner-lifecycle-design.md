# One Cloud owner: handover and lost access (D608)

**Proposed design, requires owner approval. Nothing built.** Claude review and owner approval remain; this draft authorises no implementation.

Scope authority, watcher 2026-11-07 21:01, quoting lane D `questions.md`:

> "The owner chose Cloud launch items 5 and 6: D608 (one owner per account: handover and lost-owner recovery) and D609 (support and the operator console). Both are design only, at most two pages each, Claude read, then me. Blocks are near the top of queue.md. Start D608 now."

This authorises a draft, not product approval. The [revised P3 plan, section 3](../plans/2026-10-22-cloud-global-country-split.md#3-single-owner-authority-and-future-handover) supplies the boundary: one Cloud owner per customer organisation per country, without invitations, managers or a second owner. A transfer would cover one organisation, not your other organisations or other-country account. Under [documentation ownership](../../documentation-ownership.md), Waitron would retain local roles, keys, restore hooks and fiscal authority. Country sign-in and handover would not depend on global. This proposal would add no shared protocol and change no operator, fiscal or activation permission.

## Recover the same owner first

Source reading at `400e8742ada4`, not runtime verification; no tests ran. Existing routes to offer first:

- An enrolled passkey signs you in through verified authentication ([passkeys.ts:148](../../../packages/registration/src/passkeys.ts#L148)).
- Password reset uses your previously verified email and ends sessions while preserving your enrolled factor ([password-recovery.ts:35](../../../packages/registration/src/password-recovery.ts#L35), [password-recovery.ts:75](../../../packages/registration/src/password-recovery.ts#L75)).
- Password sign-in checks your password before requesting an enrolled factor or saved factor recovery code ([password-login.ts:89](../../../packages/registration/src/password-login.ts#L89)); a used recovery code is consumed ([password-login.ts:41](../../../packages/registration/src/password-login.ts#L41)).

These restore the same owner, not another person. A saved factor code cannot work without the password; access to the mailbox can reset that password. For an account without an enrolled factor, mailbox access can therefore suffice. This design would not promise protection against mailbox compromise for that account, nor silently require a new factor.

## Proposed handover

1. You would freshly sign in using an existing passkey or password with any enrolled factor, then choose the organisation and recipient. An old browser session alone would not suffice. Existing sessions check expiry after waiting ([sessions.ts:83](../../../packages/identity/src/sessions.ts#L83)); transfer-specific fresh authentication would still need building.
2. Your recipient would use a different account in the same country, independently signing in or completing existing signup and email verification. Signup currently creates its own organisation ([signup.ts:68](../../../packages/registration/src/signup.ts#L68)); receiving yours would not merge or remove that organisation. There would be no invitation, password sharing, email reassignment or access to your organisation beforehand.
3. The single-use transfer would bind the exact organisation, old and new account identities, owner revision (the version of its ownership), and displayed expiry. The recipient would freshly authenticate and confirm that exact transfer. Confirmation would grant no access. You would then see the verified recipient's exact country account and email, not merely a supplied name.
4. You would explicitly confirm final transfer with fresh authentication again. One atomic replacement would change exactly one owner and revoke the former owner's organisation access together, with no interval containing two owners. The recipient would need fresh authentication before managing it; earlier recipient sessions would not inherit access.

Proposed defaults: one pending transfer per organisation; no waiting period after both confirmations. Either party could cancel before completion. Cancellation, expiry or abandonment would leave you as owner and give the recipient nothing. Changing recipient would require cancellation and a new transfer.

Completion would recheck identities, current ownership, revision, authentication and expiry after waits. Completion would be coordinated with account recovery and organisation actions: an old request could not return private data or commit using former ownership after replacement. Concurrent completion or cancellation would have one outcome. Password reset or factor/credential changes would cancel affected pending transfers, requiring a fresh start; recovery could not preserve an old approval. A lost reply would resume the same transfer and report its outcome without transferring again or undoing completion. Private details would require current authority; the former owner could see only their own completion receipt.

Completion would end affected former-owner management sessions, including a shared account session used for this organisation, without suspending that account or its other organisations. Old sessions, reset links, enrolments and pending ownership paths could not restore the removed authority. The recipient would not inherit pending box-recovery/replacement approvals, support grants, relay/translation consent or alert preferences: those would lose authority and require fresh, independently permitted choices. Queued private alerts to the former owner and work awaiting those approvals/consents would become ineligible before dispatch. Already dispatched external effects could not be recalled. Machine services would continue under their independent rules.

Transfer requests would use shared attempt limits and generic refusals that do not reveal account existence. Only the bound participants would see transfer details. Country security history would record the outcome, with notices to both independently verified addresses at initiation and completion; mail links alone would grant no authority.

## When every existing proof is lost

A deceased or departed owner, or loss of every usable sign-in/recovery proof, would be a separate unresolved policy. Support or an operator could not take over, and matching an email, name or payment card would not establish replacement authority. No new help desk, business identity scheme or recovery key is proposed.

**Recommendation for owner consideration:** permit no reassignment without surviving existing proof. This leaves total loss unresolved. For example, if Marta alone owns a Spanish organisation and dies with no accessible passkey, mailbox, password or factor recovery path, Luis could not obtain it merely by paying its bills. The driver would send one WATCHER-NEEDED using this example and recommendation for the owner's decision.

For an ordinary future handover, Marta would select Luis's separately verified Spanish account; Luis would confirm; Marta would check that exact recipient and authenticate again. Only then would Luis replace her for that organisation.

Later acceptance cases, all future: abandonment leaves Marta owner; simultaneous confirmations replace her once; a pre-transfer reset link cannot recover organisation authority; her other organisation and machine services continue; mailbox reset still requires any enrolled factor; Luis's billing claim alone cannot reassign ownership. These are proposed outcomes, not executed checks or an implementation plan.
