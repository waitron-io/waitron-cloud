# One Cloud owner: handover and lost access (D608)

**Proposed design. Claude read the first draft; owner decisions remain. Nothing built.** No implementation is authorised.

Scope authority, watcher 2026-11-07 21:01, quoting lane D `questions.md`:

> "The owner chose Cloud launch items 5 and 6: D608 (one owner per account: handover and lost-owner recovery) and D609 (support and the operator console). Both are design only, at most two pages each, Claude read, then me. Blocks are near the top of queue.md. Start D608 now."

This approves writing a draft, not its product choices. The [P3 boundary](../plans/2026-10-22-cloud-global-country-split.md#3-single-owner-authority-and-future-handover) is one owner per organisation per country, without invitations, managers or concurrent owners. You would transfer one organisation; your other organisations and other-country account would remain separate. Its legal businesses and taxpayer identities would stay unchanged. Selling assets to a different taxpayer would need a separate Waitron process, not continuation of the seller's fiscal records. P3's separate fiscal and Waitron checks would remain required before owner replacement became available.

## Recover your own sign-in first

Source reading at `400e8742ada4`, not runtime verification:

- Use an enrolled passkey ([passkeys.ts:148](../../../packages/registration/src/passkeys.ts#L148)).
- Reset your password through your previously verified email. Reset ends sessions but preserves an enrolled authenticator ([password-recovery.ts:37](../../../packages/registration/src/password-recovery.ts#L37), [password-recovery.ts:76](../../../packages/registration/src/password-recovery.ts#L76)).
- With your password, use your authenticator or a saved, single-use factor recovery code ([password-login.ts:89](../../../packages/registration/src/password-login.ts#L89), [password-login.ts:41](../../../packages/registration/src/password-login.ts#L41)). A recovery code alone cannot sign you in.

These restore the same owner, not another person. Mailbox access alone can recover a password-only account. Do not claim that this protects a subsequent handover from mailbox compromise.

## Proposed handover

1. You would freshly authenticate and name the recipient's country account by its verified email. The response would not reveal whether an account exists. An old browser session alone would not suffice. The stronger proof required for transferring ownership is the first owner decision below.
2. The recipient would independently sign in, verify that email and confirm the exact organisation and transfer. This would give them no organisation access. Existing signup creates an organisation and legal business ([signup.ts:71](../../../packages/registration/src/signup.ts#L71)); it must not force a first-time recipient to invent either. A small account-only receiving route remains a later owner choice, not an approved signup change.
3. You would see the recipient's verified account and email and explicitly confirm with fresh authentication. This final check catches a wrong recipient before an irreversible change. One displayed expiry would cover both confirmations. The transfer would bind the organisation, both exact account identities and the current ownership version; changing recipient would require cancellation and a fresh start.
4. One transaction would replace exactly one owner and remove the former owner's organisation access together. There would never be two active owners. The recipient's fresh confirmation would supply their sign-in, without a separate session-age mechanism.

Proposed defaults: one pending transfer; no extra waiting period after both confirmations. Either party could cancel before completion. Cancellation, expiry or abandonment would leave the existing owner unchanged. If a box recovery or replacement were active, completion would refuse until that operation reached a known outcome; it would not strand a restore halfway through.

Completion would recheck identity, ownership, version, authentication and expiry after waits. Concurrent completion or cancellation would have one outcome. Password reset, password change, factor changes and adding or removing a passkey would cancel affected pending transfers. A lost reply would resume the same transfer and show its outcome without repeating or undoing it. Private details would require current authority; the former owner could read only their own minimal completion result.

P3's revocation rules would apply: end affected former-owner management sessions, revoke outstanding ownership-derived approvals and prevent old reset/enrolment paths restoring removed access. A shared account session could end, requiring another sign-in to an unrelated organisation; that organisation and account would not be disabled. Box-recovery/replacement approvals, support grants and relay/translation consent would not pass to the recipient. Queued private alerts and work relying on withdrawn authority would become ineligible before dispatch. Relay and translation would pause until independently permitted consent was renewed. Other machine services would retain their own rules; completed external effects could not be recalled. Cloud ownership would grant no Waitron staff, operator, fiscal or activation permission.

Shared attempt limits and generic refusals would protect requests. Only bound participants would see transfer details. Country security history would record outcomes; both verified addresses would receive notices at initiation and completion. Mail links alone would grant no authority.

## Owner decisions, one at a time

**First: require proof independent of mailbox recovery before a handover? Recommendation: yes.** An existing passkey or password plus an enrolled factor could supply that proof, but one added after mailbox recovery must not automatically qualify. Source reading shows first-factor enrolment accepts a password-authenticated session ([authenticator-factor.ts:82](../../../packages/registration/src/authenticator-factor.ts#L82)). Requiring a newly enrolled factor alone would therefore leave the takeover route open. How a password-only owner first becomes eligible is unresolved; handover must stay unavailable until this policy is agreed.

Example: someone takes Marta's mailbox, resets her password, enrols their own authenticator and names their own Spanish account. That sequence must not permanently take her organisation. No waiting period or new recovery service is silently proposed here.

**Next, not yet put as a second question:** total loss or a deceased/departed owner. First offer the sign-in routes above. Recommend no reassignment without surviving independent proof; this leaves total loss unresolved. If Marta dies without a usable sign-in path, Luis paying the bills would not establish authority. No support takeover, operator override or email/name/card match would replace her. The first-time-recipient route and exact expiry would also need agreement before building.

Future checks would cover abandonment, simultaneous completion, security changes, mailbox-reset enrolment, active box recovery, independent consent renewal and unrelated-organisation access. These are proposed outcomes, not executed tests.
