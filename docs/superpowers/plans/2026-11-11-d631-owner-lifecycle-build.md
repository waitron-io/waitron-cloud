# D631: single-owner sign-in, handover and recovery build plan

**Plan only. Nothing authorises implementation.** The owner approved [D608](../specs/2026-11-07-cloud-single-owner-lifecycle-design.md), not this plan or its build. A separate Sol/high invocation drafted it; one Claude source review found excess per-action proof state and incomplete later outcomes. The watcher cleared this smaller rewrite on 11 November 2026 at 11:05: session re-proof, priority 5 owning recovery scope, email fallback separate from recognition, and complete later handover/recovery outcomes. One fresh source read completed; its sentence-level corrections below are applied. Watcher clearance and the owner’s build decision remain pending.

**Request verbatim**, local lane G queue D631:

> Cloud backlog launch item 5: the owner approved the D608 design (`docs/superpowers/specs/2026-11-07-cloud-single-owner-lifecycle-design.md`) on 9 November 2026; "Sign-in, handover and recovery remain unbuilt; implement them under their own approved plan." Write that plan, in slices of one pull request each, starting with the smallest usable one (the design's "Sign in, then prove risky actions" section against what `packages/account-http` already does today: list what exists, what is missing). Handover and recovery come as later slices in the same plan. Say what each slice gives a person.

## What exists and what is missing

This is source assessment at Cloud `f5423eb74165512367994ee06a087ec4e29d084b`, not runtime verification.

| Existing source | What remains for D608 |
| --- | --- |
| `packages/registration/src/passkeys.ts:134–179` signs in with a discoverable, device-unlocked passkey, without email discovery. Portal `passkey-controller.ts:115` already offers it. | Remember the preference and return to passkey-first sign-in (1). |
| `packages/registration/src/password-login.ts:86–118` requires password plus app/recovery proof when an app is active; without an app it immediately issues a session. | Email check for passkey/password fallback (2); familiar-browser recognition for password-only accounts (3). SMS stays with D610. |
| `packages/registration/src/authenticator-factor.ts:158` creates ten hashed 128-bit recovery codes tied to app state; `password-login.ts:23–36` uses factor-version hash inputs. | Codes usable with any enrolled method, preserving existing codes and defining removal effects (4). |
| Passkey management checks current password/session (`passkeys.ts:70,193`); app controls also require the current app proof (`authenticator-factor.ts:116`). | Common fresh-proof behavior for security and other named risky actions (6–11). Preserve existing checks. |
| `packages/registration/src/password-recovery.ts:65–80` preserves factors, cancels pending app state and ends sessions. Passkey registration rechecks its bound session after verification (`passkeys.ts:96–98,119,209`). | Reset effects for newly added recognition/challenges, with each added state tested at its owner. The existing in-flight passkey registration fence is retained, not rebuilt. |
| Current session authority/locks are in `packages/identity/src/sessions.ts:76–117`; limits/outbox are in HTTP `app.ts:117,171,186` and registration `email-outbox.ts`. | Optional administrator enrollment policy (5), session re-proof (6), and organisation-limited recovery consequences (13). |
| `packages/registration/src/signup.ts:63` creates account, business and owner together. Pairing/remote/payment/backup flows already check their existing authority. | Account-only recipient entry within complete handover (12); extra enrollment/fresh-proof gates (8–11); mailbox-plus-local-admin account recovery (13). |

## Boundaries and decisions

Reuse existing PostgreSQL transactions, session/account locks, WebAuthn, app verification, request counters and encrypted outbox. No generic action registry, new approval service or second identity system. Keep country fixed by the database scope, without country fields on signup/transfer rows. D112 supplies sole-owner revision/replacement authority; **priority 5 owns account-session consequences and recovery scope**. P6 machine handover, fiscal state, support/operator powers and activation stay separate.

D610 owns SMS enrollment/delivery and its eventual verification interface. Do not design its adapter ahead of it or show an unavailable SMS choice. SMS never bypasses an enrolled app, but verified SMS does satisfy the service enrollment gates when available. Check Waitron main and open PRs before the later box-recovery slice; its currently paired local-administrator approval interface is an explicit dependency, tracked with existing lifecycle backlog item 5.

Settle these before their affected slice, as part of the watcher's owner build question where needed:

- Before 3: browser-recognition mechanism/expiry/shared-browser policy. Recommend an opaque cookie and server-side hash, separate from passkey preference. Existing signup verification should set the recognition cookie on its completion response under the same policy, avoiding a second email check; signup itself still creates no session.
- Before 2: short email-code format/lifetime. Reuse existing login request budgets (10/IP/minute, 30/address/900 seconds, HTTP `app.ts:188`); Reuse the explicitly configured per-challenge `challengeAttempts` bound from the existing login policy; settle email-code lifetime/format without copying reset-link lifetimes.
- Before 4: how an account identifies itself and uses a recovery code when the passkey is unavailable. Codes substitute for enrolled proof, not an unmentioned account-discovery route.
- Before 5: whose administrator setting this is. Recommend country-service configuration, off by default, without a new settings/role UI.
- Before 6: explicitly ask the owner whether one re-proof may cover **any listed risky action for N minutes**, choosing the short duration and permitted methods. This is a proposed change from D608's code bound to one sign-in/action, not merely a missing duration. The watcher cleared this simpler proposal for planning, not on the owner's behalf. Require a fresh window when the owner authorises; recheck method enrollment/security revocation at later completion, without requiring the window to stay fresh. Ordinary sign-in does not silently count as being asked again. Recommend invalidating remembered-browser trust on a signed-in password change as well as a reset; the latter is already a design requirement.
- Before 13: box-approval expiry/limits and how separately recovering/proving another organisation changes the persistent restriction. Do not invent an operator override or release all organisations on an ordinary later sign-in.

## Build-ready sign-in and action slices, subject to the owner's go-ahead

Each slice is one independently useful PR, aiming for at most three build hours. Observe failing behavioral tests first; preserve existing assertions. Test shared proof/transport failures once at their store/helper; routes test only their own answer, cookie and queued work. New SQL is additive and numbered only when assigned; update `migrate.ts` and `migration-history.test.ts`. Each PR updates the relevant current guide and `docs/backlog.md`. Visual slices cover English/Spanish, light/dark, 390/1280 widths. No real mail, SMS, provider call or infrastructure work.

### 1. Remember passkey-first sign-in

**Usable:** after a verified passkey sign-in with Remember me checked, the next visit starts with saved passkeys and keeps password fallback. Store only a country-origin-local preference boolean, never account/credential/proof identifiers. Use supported browser passkey autofill; keep an explicit passkey button where browser activation is required. Do not assume a page-load prompt works on every browser.

**Files/tests:** portal `src/{app,passkey-controller,screens,locale}.ts`; existing `test/{passkey-controller,passkey-browser}.test.ts`, plus `passkey-preference-browser.test.ts`. Test save-on-success, clearing the preference, returning visit, cancellation/unsupported/storage-refused fallback and delayed navigation replies. Reuse virtual authenticator; qualify browser-specific prompting before promising it. Backend sign-in assertions stay unchanged. No migration/dependency. Production +90/−15; tests +170/−10; support 0.

### 2. Email-check password fallback for passkey owners

**Usable:** with a passkey but no app, password fallback requires a mailbox code before a session. With an app, its existing proof requirement always wins. This settled behavior does not wait for recognition policy.

**Files/tests:** registration `src/{password-login,password-recovery,email-outbox,account-mail}.ts` and new `sign-in-check.ts`; HTTP `src/{app,config}.ts`; portal existing login/controller/types/screens/locale files. Stores own new `test/sign-in-check.test.ts` and existing password-login/reset/outbox/mail files; HTTP `test/authenticator-factor.test.ts` owns its answer/cookie; portal adds `sign-in-check-browser.test.ts`.

Use existing transaction/counters/outbox; add only hashed expiring challenge/outbox-kind persistence. Store tests own one-use/replay, attempts, account/password binding, concurrent completion, expiry/reset after waits and outbox refusal; reset cancels these new challenges. No session before required proof, no address/passkey-existence leak. Email-code policy is the dependency; SMS integration remains D610. Production +260/−45; tests +270/−20; support 0.

### 3. Recognise password-only browsers

**Usable:** with neither app nor passkey, a familiar browser can use password alone; a new one completes the existing email check and is recognised. Recognition never overrides app proof or the passkey/password-fallback rule.

**Files/tests:** registration `src/{password-login,password-recovery,sign-in-check,signup}.ts`; HTTP cookies/config/app; portal sign-in controller/types/screens/locale; extend the owning files from 2 and signup tests. Add only hashed recognition state. Tests own recognition expiry, account/browser separation and reset forgetting every recognition; signup recognition shares this owner. Do not repeat slice 2's challenge matrix. Requires settled recognition policy, not D112. Production +220/−25; tests +230/−15; support 0.

### 4. Recovery codes for every enrolled method

**Usable:** passkey-only owners can obtain/use codes too; app owners keep their unused codes through upgrade and mailbox reset. Extend existing code storage/consumption rather than a parallel ledger. Preserve legacy factor-version/generation hash inputs for existing codes until consumed or explicitly regenerated; new codes can be account-bound independently of an app secret.

**Files/tests:** registration new `src/account-recovery-codes.ts`, existing password-login/authenticator-factor/passkeys; HTTP passkeys/authenticator; portal existing passkey/app screens/controllers/locale. New owning `test/account-recovery-codes.test.ts` covers single-use/concurrent consumption, legacy upgrade and regeneration; existing store/HTTP/browser tests cover their changed answers.

Keep ten 128-bit codes. Removing an app while a passkey remains preserves account codes; removing the last enrolled method retires them; adding a method does not silently regenerate codes. Confirm these lifecycle choices with the build go-ahead. D610 later integrates its enrollment at this owner, with no invented SMS contract here. New SQL is necessary to remove the app-only constraint while retaining legacy inputs. Production +240/−90; tests +290/−25; support 0.

### 5. Optional administrator enrollment requirement

**Usable:** when the off-by-default administrator setting is enabled, sign-in requires enrolling an app or passkey before ordinary account access. SMS alone does not satisfy this particular policy.

**Files/tests:** HTTP config/app/passkeys/authenticator; registration password-login/passkeys; identity sessions; portal app/session/screens/locale. Existing store/HTTP tests plus new portal `required-enrollment-browser.test.ts` own policy admission and completion. Reuse the existing session row with a narrowly restricted enrollment state if needed; test ordinary access denied until verified enrollment, each session issuer, cancellation and policy changes after waits. Preserve standalone passkey availability when app keys are down. Requires the setting's scope decision; no administrator-role catalogue. Production +170/−20; tests +220/−15; support 0.

### 6. Fresh proof for security controls

**Usable:** adding/removing passkeys or app proof, or regenerating codes, asks for the appropriate proof again. Use a **short re-proof window on the existing session row**, recording method and verification time, rather than an exact-action token/table/operation binding. The helper requires freshness at the owner’s authorising browser step. Later machine/provider completion rechecks enrollment, ownership and security/reset/session revocation under existing locks; it does not require the re-proof window or ordinary browser idle lifetime to remain unexpired. Invalidate re-proof state on security/reset changes. Keep existing current-password/app checks.

**Files/tests:** registration new `src/account-action-proof.ts` and existing passkeys/authenticator-factor/password-recovery; HTTP corresponding small proof route plus app/passkeys/authenticator; identity sessions as needed; portal existing security controllers/screens/locale. New owning registration `test/account-action-proof.test.ts` tests method eligibility, one-use verification challenge, freshness, invalidation and wait expiry; existing route/browser tests own prompts/results. Reuse existing WebAuthn/app/email challenge mechanisms; extend their bindings only as needed for this verification. A few session fields replace the draft's repeated per-operation proof records. Requires 2 and the explicit shared-window policy decision above. Production +300/−85; tests +310/−25; support 0.

### 7. Change password or verified email

**Usable:** change your password/email after session re-proof; a new email must verify before replacement. Mailbox reset stays password-only and keeps enrolled proofs/codes. Use slice 6's helper, not new proof state.

**Files/tests:** new registration/HTTP `src/account-security.ts`; existing password-recovery/outbox/account-mail/app and portal account-security controller/screen/locale. New registration `test/account-security.test.ts`; **extend** existing HTTP `test/account-security.test.ts`, preserving session-list/revocation checks; existing portal `account-security-browser.test.ts`. Stores own duplicate/generic email handling, after-wait authority, notices and security-change invalidation. Reset recognition is already owned/tested by 3; do not duplicate it. Add only pending email-change/outbox-kind state. Requires 6 and the password-change recognition choice. Production +280/−35; tests +300/−20; support 0.

### 8. Connect a box with enrolled and fresh proof

**Usable:** require enrolled app/passkey/SMS and fresh session re-proof at the owner-authorised connection step. Machine completion and saved-result branches recheck enrollment, current ownership and security/reset/revocation after waits, not browser-idle or re-proof expiry. Local machine approval remains independent.

**Files/tests:** registration `src/{pairing,index}.ts` and existing pairing/registration tests; HTTP pairing and its test; portal pairing controller/screen/locale and `pairing-choice-browser.test.ts`. Reuse 6's session helper and current ownership checks. If completion lacks the initiating session reference, retain that reference in existing pairing state; no separate per-action proof object or changed machine wire format. Tests own refusal for missing fresh proof at browser authorisation or removed proof/revoked authority at completion, plus the route's answer; shared proof outages stay in 6. Requires 6; D610 only for SMS. Production +110/−20; tests +180/−15; support 0.

### 9. Enable remote access with enrolled and fresh proof

**Usable:** owner setup requires enrollment and fresh session re-proof; delayed hostname completion rechecks enrollment, ownership and security/reset/revocation before enabling remote access, without a new freshness/idle deadline. Existing status reads and already-authorised machine renewal remain unchanged.

**Files/tests:** HTTP remote-access and corresponding venue-service tests; remote-access placement and `test/placement.test.ts`; portal remote controller/screen/locale and `remote-browser.test.ts`. Reuse existing setup/session references, adding an initiating-session reference only if completion needs it. The `tunnel-provision.ts` path is machine-signed and test-only: leave that trial adapter unchanged rather than invent an owner-setup machine protocol. If a future production path would bypass the gate, that path cannot be enabled until its own accepted owner admission exists. Requires 6; current provider/test gates remain. Production +120/−20; tests +190/−15; support 0.

### 10. Add a payment method with enrolled and fresh proof

**Usable:** payment-method browser authorisation requires enrollment and fresh session re-proof. Verify/bind after provider waits rechecks enrollment, ownership and security/reset/revocation, without requiring the short window or browser idle lifetime to remain fresh. Keep existing setup authority; no second payment/proof operation.

**Files/tests:** HTTP `src/{billing-methods,billing-method-binding}.ts`, owning `test/{billing-method-routes,billing-method-binding}.test.ts`; portal billing controller/screen/locale and `billing-methods-browser.test.ts`. Extend existing setup with a session reference only if absent. Test route-specific admission/binding/lost-reply answers, preserving provider binding assertions; shared proof failures stay in 6. Requires 6; fake clients only, and D604's owner-parked billing work must be cleared before building a billing UI slice. D610 owns SMS. Production +100/−15; tests +180/−15; support 0.

### 11. Download or restore a backup with fresh proof

**Usable:** authorising a download/restore requires current session re-proof. Existing authorised machine reads use that operation's authorising-session reference and recheck it before credentials are returned; do not prompt for each byte. Passive history/status needs no prompt. Do not broaden this into a separate replacement feature; retain replacement/source/data-loss checks unchanged.

**Files/tests:** HTTP recovery; backups recovery/recovery-request and their owning tests, HTTP `recovery-v2`/`venue-service-recovery` tests; portal recovery controller/screen/locale and `recovery-browser.test.ts`. Test fresh proof at browser authorisation and enrollment/ownership/security-reset-revocation at later completion/credential release; ordinary idle expiry must not cancel accepted authorisation; proof verification failures remain in 6. Reuse existing operation state, only adding its authorising session reference if absent. Storage `backup_locations` are not Waitron location authority; add no Waitron location dependency. Requires 6; P6 activation remains separate. Production +150/−25; tests +240/−20; support 0.

## Later complete outcomes: re-cut when dependencies exist

These are the remaining plan, **not build-ready assignments or included in the initial build go-ahead**. Recheck actual interfaces and split only at useful outcomes within three hours, rather than publishing accounts/offers/recovery requests that nobody can finish.

### 12. Complete organisation handover

**Usable end state:** one verified recipient, including a first-time account-only signup, enrolls proof and accepts the exact offer; one transaction replaces the sole owner and revokes former-owner organisation access. Until acceptance, one pending offer has the approved 24-hour expiry and either participant can cancel. No invitations/second owners, extra country columns or later sender confirmation.

Reuse signup's verification/outbox/password screening; account-only signup is part of this complete outcome, not a preparatory customer-facing PR and not inherently dependent on every new sign-in slice. Add one transfer row/unique pending constraint and notices; use D112's actual owner/revision replacement interface. Priority 5 owns session/access consequences, integrating existing approval/support/consent/queued-work owners without revoking unrelated organisations or independently authorised machines. Security changes cancel affected offers; required initial recipient enrollment binds its fresh proof to that offer as the design specifies. Recovery/replacement must have a known outcome first; no writer promotion or fiscal powers.

**Files/test owners:** registration/HTTP/portal new owner-transfer files and matching tests; signup, outbox/account-mail, security-change owners and the actual country-authority/session consumers. Store tests own acceptance/cancel races, expiry/version/party rechecks and one lost-reply outcome; each affected consumer owns its distinct revocation assertion. D112 build authority/interface and settled proof policies are dependencies. Size cannot honestly be fixed from its unbuilt interface; budget roughly production +400–650/−40–80, tests +400–650/−20–50, support 0 before recutting. Do not assign an oversized or incomplete first half.

### 13. Recover the same owner for one organisation

**Usable end state:** verified mailbox plus an actual local administrator on a currently paired owned venue box recovers the same account only for that organisation, invalidates lost proofs/sessions and requires fresh enrollment before access. Without mailbox or a usable box it is unavailable; no operator/support/manual override.

**Priority 5 owns the scope implementation.** Propose one persistent organisation restriction on the account for box-assisted recovery; every later session and organisation-authority check inherits it. An ordinary later password/passkey sign-in must not remove it. Reuse an enrollment-only session while replacing lost proof. This is a restriction on the existing account/session authority, not a competing ownership table; D112 continues owning the sole-owner relation. Settle how later independently proved organisations change this restriction before building it.

**Files/test owners:** registration/HTTP/portal new owner-recovery files and tests; identity sessions, password/passkey/app/reset stores, outbox/account-mail and actual organisation-authority readers. Add only pending mailbox/box approval state and required account/session restriction fields. The authority owner tests exact request/account/organisation/venue/current pairing/country scope, single-use expiry and all relationship changes after waits, second-organisation reads/writes and later sign-in confinement. Routes own their distinct answers; preserve fiscal/activation boundaries.

Dependencies: accepted Waitron currently-paired-box/local-admin interface (name its Waitron owner through the existing lifecycle backlog item, inspect main/open PRs), actual D112 relationships, and approved scope/expiry policy. Never accept a machine signature or browser assertion as local administrator proof. Budget roughly production +500–750/−40–80, tests +500–750/−30–60, support 0 before re-cutting with these interfaces. Ship a complete usable recovery outcome, not a pending request without completion.

**Publication:** link this corrected plan from lifecycle backlog item 5 when publishing, recording plan-only status and dependencies. Current guides change with their implementing PR, not with unbuilt behavior. No tests, provider access, mail/SMS, migration application or runtime qualification are claimed by this plan.
