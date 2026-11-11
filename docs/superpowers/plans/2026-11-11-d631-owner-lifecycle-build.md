# D631: single-owner sign-in, handover and recovery build plan

**PLAN FOR APPROVAL — source assessment only. Nothing authorises implementation.**
The owner approved D608's design, not this plan or a build. A separate GPT-6.1 Sol/high invocation drafted this plan. The driver checked this
draft and obtains Claude plan review and watcher clearance; the watcher puts the build
go-ahead to the owner as one question. This writer runs no tests and builds nothing.

**Request, verbatim as supplied from local `waitron-campaign-g/queue.md`, D631:**

> Cloud backlog launch item 5: the owner approved the D608 design (`docs/superpowers/specs/2026-11-07-cloud-single-owner-lifecycle-design.md`) on 9 November 2026; "Sign-in, handover and recovery remain unbuilt; implement them under their own approved plan." Write that plan, in slices of one pull request each, starting with the smallest usable one (the design's "Sign in, then prove risky actions" section against what `packages/account-http` already does today: list what exists, what is missing). Handover and recovery come as later slices in the same plan. Say what each slice gives a person.

**Goal:** complete the [D608 lifecycle](../specs/2026-11-07-cloud-single-owner-lifecycle-design.md)
in fifteen independently landable PRs. Start with remembering the existing passkey
sign-in choice. Keep country-local PostgreSQL identity, WebAuthn, app proof, session
locking, request limits and encrypted email outbox; add only state required by a
named behavior. Node 26+, TypeScript, Hono, Lit, node:test, Playwright and Mailpit;
no new library or generic action registry.

## EXISTS versus MISSING

Assessment at Cloud `f5423eb74165512367994ee06a087ec4e29d084b`. These are
**source receipts, not execution claims**. “Missing” below means the inspected path
does not supply the named D608 behavior; it does not mean all sign-in is unbuilt.

| Area | EXISTS: exact source receipt | MISSING for D608 / owning slice |
| --- | --- | --- |
| Standalone passkeys | `packages/registration/src/passkeys.ts:134` creates email-free discoverable options; `:148` verifies device unlock, origin, RP, handle and counter before creating a session. `packages/account-http/src/passkeys.ts:33` exposes it. | Remember preference / 1. Preserve existing standalone sign-in. |
| Password plus app | `packages/registration/src/password-login.ts:86` checks password and issues a challenge when an app is active; `:118` consumes app/recovery proof before session creation. `packages/identity/src/sessions.ts:32` refuses the simpler login helper when an app is active. | App requirement is already implemented; preserve it across every new fallback / 2–5. |
| Password without app | `packages/registration/src/password-login.ts:97` immediately creates a session, including when a passkey exists. | Email check for unavailable-passkey fallback; familiar/new-device distinction for password-only accounts; chosen SMS integration / 2. |
| Recovery codes | `packages/registration/src/authenticator-factor.ts:158` generates ten 128-bit codes, stores hashes and retires older codes; `packages/registration/src/password-login.ts:36` consumes them through active app state. | Codes independent of app enrollment, including passkey-only and later SMS-only accounts / 3. |
| Security controls | `packages/registration/src/authenticator-factor.ts:82` requires current password/session; `:116` requires active app proof; `:153` ends sessions on committed changes. Passkey add/remove instead require only session/current password (`packages/registration/src/passkeys.ts:70`, `:193`). | Proof appropriate to current methods for every security change, including passkey start/completion; signed-in password/email change flows / 5–6. |
| Sessions and reset | `packages/identity/src/sessions.ts:83` rechecks time after locks; `:117` lists/revokes account sessions. `packages/registration/src/password-recovery.ts:65` locks account, preserves factors, consumes pending app state and ends sessions. | Recognition invalidation and all newly introduced challenges on reset; in-flight WebAuthn reset fence / 2, 5–6. |
| Portal | `apps/portal/src/passkey-controller.ts:115`, `authenticator-controller.ts:41`, `account-security-controller.ts:67`, `session.ts:42` implement passkey/app login, session reconciliation and revocation; `apps/portal/src/app.ts:259` connects password login. | Preference, email/device check, required enrollment, action proof, transfer and lost-proof screens / respective slices. |
| Existing protection | `packages/account-http/src/app.ts:117`, `:171`, `:186` enforce shared limits, exact Origin, generic login and delayed responses; `packages/account-http/src/rate-limit.ts:14` supports transactional counters. | New flows must use these mechanisms, not independent counters / 2 onward. |
| Enrollment gates | Pairing approval/completion (`packages/registration/src/pairing.ts:87`, `:102`; `src/index.ts:194`) checks registration authority. Remote owner checks (`packages/account-http/src/remote-access.ts:28`) and payment start/verify guards (`src/billing-methods.ts:51`) recheck existing authority. | Enrolled app/passkey/SMS gate and fresh action proof, including completion/replay after waits / 7–9. |
| Backup recovery | `packages/backups/src/recovery-request.ts:44`, `replacement.ts:111` use owner sessions and exact recovery/replacement bindings. `packages/account-http/src/recovery.ts:85` rechecks before returning recovery credentials. | Fresh account proof for download/restore authorization; these are backup recovery, not lost-account recovery / 10. |
| Ownership/signup | `packages/registration/src/signup.ts:63` creates account, organisation, business and owner membership together. `packages/registration/migrations/003_signup.sql:5` adds an owner flag, not sole-owner replacement. | Account-only recipient creation; transfer lifecycle / 11–13. D112/P3 owns sole-owner country authority. |
| Lost proofs | D608 `:25`–`:29` requires verified mailbox plus actual local admin on a currently paired, owned box. Existing backup recovery above does not establish that authority. | Waitron approval interface, restricted recovery and fresh enrollment / 14–15. |

Current security descriptions: `docs/account-http-design.md:33` (routes), `:80`
(limits), `:151` (app policy), `docs/backlog/identity-and-organisations.md:50`
(passkeys), `:206` (app controls), and `docs/authenticator-app.md`. Update current
guides with each behavior; retain historical design provenance.

## Dependencies and execution boundaries

- **D112/P3 is separate.** Its plan `2026-10-22-cloud-global-country-split.md:49`
  owns sole-owner revision/country authority; `:65` names transfer revocations.
  Slices 1–10 reuse current local code without waiting for global separation.
  Transfer acceptance requires the landed sole-owner interface, not a competing
  owner table. Account-only signup must not infer country from a form field.
- **D610 is separate.** No SMS enrollment or sending here. Email/app/passkey paths
  can land first. Where SMS is named, accept only D610's durable verified enrollment
  and bound, single-use verification interface once available. Until then show no
  selectable SMS capability. SMS never replaces an enrolled app at password login;
  SMS enrollment alone does satisfy the three service enrollment gates.
- **Waitron check, read-only:** local `main` and `origin/main` both resolve to
  `af9b80e404b8cd633c0d977212a5a49df49b2505`. Its
  `apps/server/src/setup-api.ts:1186` exposes backup restore requests;
  `docs/developers/cloud-connection.md:400` describes replacement requiring
  `system.manage`, not lost-Cloud-proof approval. Cloud's integration contract
  `docs/waitron-integration-contract.md:2164` describes a different emergency-hosting
  code and explicitly separates machine authentication from local person authority
  (`:2177`). Neither is permission to reuse it for account recovery.
  `gh api repos/clintongormley/waitron --jq '{full_name,default_branch}'` and
  `gh pr list --repo clintongormley/waitron --state open --limit 100 --json number,title,headRefName`
  both failed with `error connecting to api.github.com`. Live main/open PR status is
  **unverified**, not evidence that no interface exists. Before 14, the driver must
  check both and pin the accepted currently-paired-box/local-admin interface and its
  owning tests. No competing machine protocol is designed here.
  Driver follow-up on11November2026: host `gh pr list --repo clintongormley/waitron --state open --limit 100 --json number,title,headRefName` succeeded with12open PRs (saved locally as `receipts/d631/plan-20261111/waitron-prs.json`); main/origin-main were `e963c6a9e9ddfe4062bd845b080659763aa3bd9e`. This resolves the sandbox network failure, not qualification of the still-unpinned recovery interface; check actual main/open-PR implementations before slice14.
- **P6 machine handover is separate.** Organisation transfer neither promotes a
  hosted writer nor settles a running recovery/replacement. Require its known
  outcome; do not change fiscal data, provider calls, recovery authority or
  activation permission. No cross-repo implementation, deployment or real messages.
- **Decisions needed before affected slices:** 2 needs recognition mechanism,
  expiry, shared-browser behavior, and email code format/lifetime/request and guess
  limits. Prefer an opaque browser cookie with a server-side hash, not fingerprinting,
  but this is a recommendation, not a settled choice. Existing login limits are
  10/IP/minute and 30/address/900 seconds (`app.ts:188`); reuse them. App policy
  numbers remain explicitly configured (`packages/account-http/src/config.ts:20`),
  not newly defaulted. WebAuthn remains five minutes (`passkeys.ts:26`); recovery
  codes remain ten 128-bit codes (`authenticator-factor.ts:159`). Do not transplant
  reset-link numbers into short email-code guessing limits. Before 3 settle how a
  code substitutes for standalone passkey sign-in (including its account identifier
  and whether password is also needed); never silently make a recovery code an
  account-discovery endpoint. Before 5 settle action-proof validity across waits.
  Before 14 settle box approval expiry/limits with the accepted interface. Before 15
  pin how organisation-limited recovery remains limited on later sign-ins and how
  independently proving another organisation releases that limit. Current P3
  `resolveCustomer`/`requireCustomerOwner` signatures (`:59`) do not specify this.
  For 13, also pin which management sessions are affected when the former owner owns
  several organisations: today's sessions contain an account, not an organisation
  (`packages/identity/src/sessions.ts:10`, `:76`). Do not silently disable unrelated
  ownership or pretend current sessions already provide scoped revocation.

For each future slice, write the owning behavioral test, observe the expected
failure, implement minimally, then rerun it. Database locking/transactions use
`node scripts/test-postgres.mjs exec pnpm --dir <owning-package> exec node --test <named-test-files>`;
browser cases additionally use `--test-timeout=120000`. Native controllers use
`node --test <exact-test-file>`. These are future instructions, **not runs made here**.
Use focused tests; CI owns full selected package suites and workspace typechecking.
Test dependency outages once at their store/adapter owner; route tests cover only
distinct answers, cookies, body validation or queued work. Preserve existing
behavioral assertions; list deliberately changed checks in each PR. Every visual
slice checks English/Spanish, light/dark, 390/1280 widths and delayed account changes.

Every slice includes its relevant current-guide and `docs/backlog.md` update.
Estimates below separate added/removed production and test lines (SQL included in
production); allow a small prose change. Each targets at most roughly three hours
and about 1,000 changed lines. Dependencies must be ready before assignment; if
their landed interface makes a slice larger, return that slice for focused
re-slicing before building. Do not add preparatory framework PRs. Any required
migration is new, unnumbered until assignment, registered in
`packages/registration/src/migrate.ts`, with the owning schema and
`packages/registration/test/migration-history.test.ts` checks updated. Never edit
landed SQL or apply a migration under this publication.

## 1. Remember the existing passkey sign-in choice

**Outcome:** after a successful standalone passkey sign-in with “Remember me”
selected, your next sign-in goes straight to saved passkeys. You can choose password
instead; cancellation or unsupported WebAuthn leaves a usable sign-in form.

**Files:** modify `apps/portal/src/{app,passkey-controller,screens,locale}.ts`;
extend `apps/portal/test/passkey-controller.test.ts`, `passkey-browser.test.ts` and
new `apps/portal/test/passkey-preference-browser.test.ts`. Keep the existing
email-free options/verification endpoints and their backend assertions unchanged.

**TDD:** preference is saved only after verified success with an explicit checked
choice; unchecking clears it. Store only a country-origin-local preference boolean,
never email, account ID, credential ID or proof. No account/passkey-existence lookup.
Test next visit, password fallback, browser storage refusal, cancellation, one prompt
per visit and late replies after navigation/sign-out. Use the existing virtual
authenticator for the returning-browser journey; no session lifetime extension.

**Migration:** none. **Dependencies:** none beyond existing passkey code; no D112,
D610 or recognition-policy wait. Preference persists until cleared/unselected; it is
not a recognised-device credential. **Estimate:** production +90/−15; tests +170/−10.

## 2. Check password fallback and recognise familiar browsers

**Outcome:** password plus an enrolled app always needs its app code. Without an
app, unavailable-passkey fallback requires email (or later chosen SMS); accounts
with neither app nor passkey can use password alone only on a recognised browser.
Successful new-browser verification recognises that browser under the settled policy.

**Files:** modify `packages/registration/src/{password-login,password-recovery,email-outbox,account-mail}.ts`,
`packages/account-http/src/{app,config,cookies}.ts`, and
`apps/portal/src/{app,authenticator-controller,authenticator-types,screens,locale}.ts`;
add `packages/registration/src/sign-in-check.ts`. Owners:
`packages/registration/test/{password-login,password-recovery,email-outbox,account-mail}.test.ts`,
new `sign-in-check.test.ts`, `packages/account-http/test/authenticator-factor.test.ts`,
new `apps/portal/test/sign-in-check-browser.test.ts`.

**TDD:** no session before required verification; app wins over email/SMS/recognition.
Codes are hashed, expiring, one-use and bound to account, password state and exact
login; counters survive refused guesses. Test competing completion, reset/disable
and expiry during waits once at the store. Unknown/wrong-password requests retain
generic responses. Queue through the encrypted outbox, with final eligibility checks;
outbox failure cannot grant access. Recognition is separate from slice 1's preference.
Reset atomically forgets all recognition and invalidates these challenges, while
preserving enrolled methods/codes and ending sessions.

**Migration:** necessary for recognition, email challenges and the new outbox kind;
reuse existing counters/outbox, not a new delivery queue. **Limits/dependencies:**
settle recognition/code policy first; D610 only blocks SMS, never email or app.
**Estimate:** production +480/−65; tests +360/−35.

## 3. Recovery codes for every enrolled method

**Outcome:** passkey-only owners can obtain and use recovery codes too; app owners
retain their codes. D610's later SMS enrollment uses the same account-code facility.

**Files:** add `packages/registration/src/account-recovery-codes.ts`; modify
`src/{password-login,authenticator-factor,passkeys}.ts` in that package,
`packages/account-http/src/{passkeys,authenticator-factor}.ts`, and
`apps/portal/src/{passkey-controller,authenticator-controller,authenticator-screen,locale}.ts`.
Owners: new `packages/registration/test/account-recovery-codes.test.ts`, existing
`test/{password-login,passkeys,authenticator-factor}.test.ts`,
`packages/account-http/test/passkeys.test.ts`,
`apps/portal/test/{passkey-browser,authenticator-browser}.test.ts`.

**TDD:** ten single-use 128-bit codes shown once after enrollment/regeneration;
hashed account-bound storage, one winner under concurrent use, old codes retired
only by an authorised change. Preserve unused existing app codes on upgrade and
mailbox reset. Consume without needing an app secret or its decryption key; code
substitution must not disable the account's remaining protection. Test passkey-only,
app and the D610 adapter contract at this owner, not across every route.

**Migration:** necessary to remove the active-app-version assumption in code storage;
extend existing hashed recovery state rather than introducing a parallel code ledger.
**Dependencies:** settle standalone substitution semantics first; preserve existing
app-plus-password recovery assertions. D610 owns SMS integration; no sending here.
Fresh-proof management is completed in 5. **Estimate:** production +300/−100;
tests +330/−35.

## 4. Optional administrator requirement

**Outcome:** an administrator can explicitly require app or passkey enrollment at
sign-in. The setting is off by default; SMS alone does not satisfy this particular
requirement. Users see why enrollment is needed.

**Files:** `packages/account-http/src/{config,app,passkeys,authenticator-factor}.ts`,
`packages/registration/src/{password-login,passkeys}.ts`,
`packages/identity/src/sessions.ts`, `apps/portal/src/{app,session,screens,locale}.ts`.
Owners: `packages/registration/test/{identity,password-login,passkeys}.test.ts`,
`packages/account-http/test/authenticator-factor.test.ts`, new
`apps/portal/test/required-enrollment-browser.test.ts`.

**TDD:** missing/false configuration preserves existing sign-in. Enabled policy
blocks ordinary account access until enrollment; verified login grants only the
enrollment operations needed to finish it. Check every session issuer, including
recovery-code/password completions, and ordinary session resolution; a normal cookie
must not bypass policy. Completing verified app/passkey enrollment unlocks access;
cancellation, lost replies and policy changes during waits do not. Keep ordinary
passkey sign-in independent of app-key outages.

**Migration:** only if durable enrollment-only session status needs an additive
session field; no new administrator-role catalogue or settings UI. Reuse explicit
server configuration, never a customer-supplied flag. **Dependencies:** 2–3; this
policy is separate from the app/passkey/**SMS** service gates in 7–9.
**Estimate:** production +230/−25; tests +300/−20.

## 5. Fresh proof for passkey and app controls

**Outcome:** a signed-in person proves authority again before adding/removing a
passkey, enrolling/replacing/removing an app or regenerating recovery codes. Signing
in another way does not evade the required proof.

**Files:** add `packages/registration/src/account-action-proof.ts` and
`packages/account-http/src/account-action-proof.ts`; modify registration
`src/{passkeys,authenticator-factor,password-recovery}.ts`, HTTP
`src/{app,passkeys,authenticator-factor}.ts`, portal
`src/{passkey-controller,authenticator-controller,app,locale}.ts`. Owners: new
`packages/registration/test/account-action-proof.test.ts`, existing registration
`test/{passkeys,authenticator-factor,password-recovery}.test.ts`, HTTP
`test/{passkeys,authenticator-factor}.test.ts`, portal
`test/{passkey-browser,authenticator-browser}.test.ts`.

**TDD:** verify a device-unlocked passkey, app proof/recovery substitute, or email
for password-only accounts, with chosen SMS only where permitted. Bind proof to the
session, exact action/target, current credential state and deadline; never a reusable
“recently authenticated” account flag. Test substitution, replay and dependency
failure once here. Start and completion both check authority, including passkey
verification's out-of-transaction wait. Reset cancels pending enrollment/action
challenges and prevents in-flight old ceremonies issuing new authority; preserve
registered methods and unused recovery codes. Existing app password/fresh-proof
assertions stay strict.

**Migration:** narrowly extend durable ceremony/challenge bindings for action proof;
no generic registry or separate approval system. **Dependencies:** 2–3 and settled
proof deadline; reuse 4's enrollment-only session restriction where applicable.
**Estimate:** production +430/−110; tests +350/−35.

## 6. Change your password or verified email with fresh proof

**Outcome:** you can change a password or email from Account after fresh proof.
Changing email also verifies the new mailbox. Mailbox password reset remains a
password-only reset and cannot remove or replace an enrolled method.

**Files:** add `packages/registration/src/account-security.ts`,
`packages/account-http/src/account-security.ts`; modify registration
`src/{password-recovery,email-outbox,account-mail}.ts`, HTTP `src/app.ts`, portal
`src/{account-security-controller,account-security-screen,locale}.ts`. Owners: new
`packages/registration/test/account-security.test.ts`, existing registration
`test/{password-recovery,email-outbox,account-mail}.test.ts`,
`packages/account-http/test/account-security.test.ts`,
`apps/portal/test/account-security-browser.test.ts`.

**TDD:** start and commit require slice 5's exact-action proof plus current session;
preserve existing current-password checks. New mailbox must be verified before
replacement; duplicate/unknown addresses get no existence-revealing answer. Concurrent
reset/security changes invalidate old pending authority. End sessions/challenges and
recognition on password reset; keep enrolled proofs/recovery codes and enforce them
at next sign-in. Queue security notices to verified addresses atomically with changes;
lost replies reconcile without repeating a code or committing twice.

**Migration:** new email-change binding and outbox kinds only; password changes reuse
credentials. **Dependencies:** 5 and settled email code limits from 2. Later transfer
hooks cancel affected pending transfers; recipient initial enrollment gets only the
exact exception in 12. **Estimate:** production +390/−35; tests +400/−25.

## 7. Prove authority before connecting a box

**Outcome:** connecting a box explains and enforces enrollment of app, passkey or
verified SMS, then fresh proof for that connection; local machine approval remains
independent.

**Files:** `packages/registration/src/{pairing,index}.ts`,
`packages/account-http/src/pairing.ts`,
`apps/portal/src/{pairing-controller,pairing-screen,locale}.ts`; reuse 5's helper.
Owners: `packages/registration/test/{pairing,registration}.test.ts`,
`packages/account-http/test/pairing.test.ts`,
`apps/portal/test/pairing-choice-browser.test.ts`.

**TDD:** protect Cloud approval, direct registration approval and final machine
completion, including saved-result branches, waits and current-owner changes. A
machine's unauthenticated pairing start may create a request, but cannot create
customer access; gate the account-authorised start as well as completion. Carry
the exact connection's proof binding through existing request state, recheck its
validity/enrollment after waits, and require reproof if it expires. A previously
enrolled method removed mid-connection refuses; app/passkey succeeds and verified
D610 SMS satisfies enrollment. Possession of a pairing code alone is insufficient.
Retain local proof, registration permission and plan checks.

**Migration:** add only action-proof binding to existing connection/pairing state if
needed for separate completion. **Dependencies:** 5; D610 only for the SMS adapter.
Do not depend on D112's future worldwide split or change the machine wire format.
**Estimate:** production +230/−35; tests +360/−30.

## 8. Prove authority before enabling remote access

**Outcome:** remote setup requires enrolled app/passkey/SMS and fresh proof before
enabling or changing remote access; waiting for DNS does not preserve stale authority.

**Files:** `packages/account-http/src/{remote-access,tunnel-provision}.ts`,
`packages/remote-access/src/placement.ts`,
`apps/portal/src/{remote-controller,remote-screen,locale}.ts`. Owners:
`packages/account-http/test/{remote-access,venue-service-remote}.test.ts`,
`packages/remote-access/test/placement.test.ts`,
`apps/portal/test/remote-browser.test.ts`.

**TDD:** cover owner setup admission, hostname apply completion after DNS, and the
actual provisioning path. Existing `TunnelProvisionMachine.execute` calls
`provisionInTransaction` (`tunnel-provision.ts:43`); it cannot create an alternative
machine-only way around the owner's fresh setup proof. Reuse the existing placement
or installation setup binding, checking proof/enrollment before enabling and after
waits. Read-only status needs no fresh prompt. Ordinary already-authorised machine
renewal and independent staff permissions retain their meaning. Removing proof,
changing owner/installation or expiring authority during DNS/allocation refuses
without publishing setup. Route tests own refusal/response changes; shared proof
outages remain tested in 5.

**Migration:** only an existing setup-row proof binding if required; no new remote
approval queue. **Dependencies:** 5 and a compatible owner-setup binding accepted by
the existing machine adapter; no cross-repo request fields invented. D610 is optional
for SMS; all current test-only/provider gates stay. **Estimate:** production +270/−35;
tests +340/−25.

## 9. Prove authority before adding a payment method

**Outcome:** adding/verifying a payment method requires enrolled app/passkey/SMS
and fresh proof, including when a provider response arrives later.

**Files:** `packages/account-http/src/{billing-methods,billing-method-binding}.ts`,
`apps/portal/src/{billing-controller,billing-screen,locale}.ts`. Owners:
`packages/account-http/test/{billing-method-routes,billing-method-binding}.test.ts`,
`apps/portal/test/billing-methods-browser.test.ts`.

**TDD:** protect `/billing/method/start` and `/verify`, their provider-admission
callback, final bind/complete and already-verified reply. Recheck enrollment, exact
owner, venue/business, setup and proof after waits; a stale/lost response cannot
attach a method to another setup or revive retired authority. Bind to existing
`MethodSetup`, not a second payment operation. Test its distinct queued/prepared work
and refused result; shared proof failure cases belong to 5. Never put provider
references or payment details in proof payloads, logs or public error messages.

**Migration:** only extend existing setup persistence for the proof binding if its
current fields cannot express it. **Dependencies:** 5; D610 for SMS-only use. Preserve
`billing-methods.ts:14` test-mode and configured-account restrictions. This plan
authorises neither a provider call nor a new account/resource; tests use the existing
fake client. **Estimate:** production +180/−25; tests +300/−25.

## 10. Fresh proof for backup download and restore

**Outcome:** the owner must prove authority again before authorising backup bytes,
restore or completing replacement; passive backup/history reads stay usable.

**Files:** `packages/account-http/src/recovery.ts`,
`packages/backups/src/{recovery,recovery-request,replacement}.ts`,
`apps/portal/src/{recovery-controller,recovery-screen,locale}.ts`. Owners:
`packages/backups/test/{recovery-request,recovery,replacement,continuous-recovery}.test.ts`,
`packages/account-http/test/{recovery-v2,venue-service-recovery}.test.ts`,
`apps/portal/test/recovery-browser.test.ts`.

**TDD:** fresh proof binds to the exact requested snapshot/continuous source, target
and operation. Check authorisation start, owner approval/replacement completion and
saved-result reads; retain it in the existing operation so authenticated machine
downloads can recheck that authority after storage-reader waits. Challenge expiry,
factor removal or owner/session revocation cannot leak credentials after a wait.
No repeated human prompt for each byte/read of the same still-valid authorised
operation; a different download/restore needs its own proof. Preserve source
verification, explicit data-loss/replacement confirmations and all machine proofs.

**Migration:** extend existing recovery operation proof binding only.
**Dependencies:** 5; P6 activation remains separate. Keep current storage reads in
`packages/backups/src/recovery.ts:142` and `replacement.ts:124`; these are
`backup_locations` storage bindings, not authority from a Waitron location. Do not
add a Waitron location read or build recovery authority on one.
**Estimate:** production +270/−40; tests +410/−30.

## 11. Recipient account-only signup

**Outcome:** a new recipient can verify their mailbox and create an account, then
enroll proof without creating a business or getting organisation access. Existing
customers can sign in instead without public account-existence disclosure.

**Files:** `packages/registration/src/signup.ts`,
`packages/account-http/src/{app,config}.ts`, `apps/portal/src/{app,screens,locale}.ts`.
Owners: `packages/registration/test/signup.test.ts`,
`packages/account-http/test/account-http.test.ts`, new
`apps/portal/test/recipient-signup-browser.test.ts`.

**TDD:** explicitly distinguish account-only completion from ordinary first-business
signup; keep the latter's atomic account/business/owner assertions. Reuse hashed
verification requests, password screening and encrypted verification mail. Account-only
completion creates no membership, business, service consent or session. Independent
links racing for an address create one account with generic conflicts; the verified
email and country account must later match the transfer. Standard sign-in and
enrollment work even while no transfer is accepted. No invitation/member role.

**Migration:** only bind signup requests to their intended completion kind/country
if the current request cannot distinguish them; no second signup-token system.
**Dependencies:** 2–5. Reuse D112's country-local origin binding if landed; otherwise
add an explicit server-selected `ES` binding for the local signup path (the portal
currently submits `ES`, `apps/portal/src/app.ts:266`), not a caller-selected country.
This is an addition, not a claim that country account configuration exists today.
No global customer identity or dependency on P6 machine handover.
**Estimate:** production +180/−25; tests +300/−15.

## 12. Send, inspect and cancel one pending transfer

**Outcome:** a freshly proved owner can name a recipient; both see a 24-hour
deadline and can cancel. The recipient can verify/sign in/enroll and inspect the
exact offer. Until 13 lands, acceptance is explicitly unavailable and nobody gains
access: the usable result is a cancellable pending offer, not a completed handover.

**Files:** add `packages/registration/src/owner-transfer.ts`,
`packages/account-http/src/owner-transfer.ts`,
`apps/portal/src/{owner-transfer-controller,owner-transfer-screen}.ts`; modify
HTTP `src/app.ts`, registration `src/{email-outbox,account-mail}.ts`, portal
`src/{app,locale}.ts` and security-change owners from 5–6. Owners: matching new
`owner-transfer.test.ts` in registration/HTTP, new portal
`test/owner-transfer-browser.test.ts`, registration `test/email-outbox.test.ts`.

**TDD:** one pending transfer per organisation; recipient changes require cancellation.
Bind exact sender, verified recipient, country and owner revision. Pending/expired/
cancelled state gives no access. Inspect/cancel require current participant authority;
generic responses and shared attempts prevent discovering accounts. Security changes
cancel affected transfers, except required initial recipient enrollment: bind its
new proof to that transfer, not a general exemption. Queue participant notices through
existing outbox with live eligibility checks and no secrets in saved results.

**Migration:** necessary for the transfer itself, unique pending constraint and new
mail kinds, not a second audit ledger. Use existing security audit.
**Dependencies:** 5–6, 11 and D112's landed country sole-owner/revision reader. No
acceptance enabled without 13. **Estimate:** production +430/−20; tests +390/−20.

## 13. Accept once; replace the sole owner and revoke old access

**Outcome:** the verified, signed-in recipient freshly proves enrolled authority and
explicitly accepts the exact offer. One transaction replaces the sole owner and
ends the former owner's organisation access. No later sender confirmation.

**Files:** extend the four `owner-transfer` files from 12; integrate D112's landed
`packages/registration/src/global-country/customer-authority.ts`; use existing
`packages/registration/src/{support-grants,relay-grants,email-outbox}.ts`,
`packages/translation/src/consent.ts` and backup `src/{recovery,replacement}.ts`
revocation owners. Owners: registration/HTTP `test/owner-transfer.test.ts`, portal
`test/owner-transfer-browser.test.ts`, existing registration
`test/{support-grants,email-outbox}.test.ts`, translation `test/consent.test.ts`
and backups `test/replacement.test.ts` only for newly affected behavior.

**TDD:** lock and recheck country, parties, verified email, owner revision, sessions,
enrollment, fresh proof, expiry and known recovery/replacement outcome after waits.
Acceptance/cancellation races have one outcome; lost-reply retries return it only
to currently authorised participants. At commit revoke old organisation sessions/
approvals, recovery/replacement authority, support grants, relay/translation consent
and queued owner-derived work. Recipient renews consent independently. Keep unrelated
organisations and independently authorised machines; never transfer fiscal, staff,
operator or writer-activation powers. A recipient inheriting connected services must
still have enrolled app/passkey/SMS at completion.

**Migration:** none beyond 12 if its result/version fields suffice. **Dependencies:**
D112's landed sole-owner schema/reader and consumer revocation boundaries must be
pinned first; this slice implements the replacement transaction, not D112. Its plan
alone is insufficient. If the revocations require broad new consumer
changes, this slice is not a three-hour assignment until re-sliced with that owner.
P6's pending machine operation must reach a known outcome, never be auto-promoted.
**Estimate with those dependencies ready:** production +330/−45; tests +480/−30.

## 14. Request lost-proof recovery using mailbox and paired-box admin

**Outcome:** after losing all usable proofs/codes, you verify your existing mailbox,
request recovery for one owned organisation/venue, and see whether that currently
paired box's actual local administrator has approved it. This slice grants no account
session or restored access; completion is visibly unavailable until 15.

**Files:** add `packages/registration/src/owner-recovery.ts`,
`packages/account-http/src/owner-recovery.ts`,
`apps/portal/src/{owner-recovery-controller,owner-recovery-screen}.ts`; modify
registration `src/{password-recovery,email-outbox,account-mail}.ts`, HTTP `src/app.ts`
and portal `src/{app,locale}.ts`. Owners: new registration/HTTP
`test/owner-recovery.test.ts`, portal `test/owner-recovery-browser.test.ts`,
registration `test/email-outbox.test.ts`.

**TDD:** require a verified-mailbox reset link plus approval from the accepted Waitron
local-admin interface, bound to exact reset request/account/country/organisation/
venue/current pairing and installation key. Machine signature alone, email/browser
claims, an old/replaced box or another owned organisation cannot approve. Expiry,
replay and relationship changes during waits refuse. Shared limits, generic public
answers, expiring single-use approval and private status reads belong here. No
mailbox or no usable currently paired box means this route is unavailable; offer
available proofs/recovery codes first. No staff/support/operator override.

**Migration:** necessary for the pending recovery request and bound approval, plus
mail kind; reuse reset-token/outbox mechanisms, not a new recovery protocol.
**Dependencies:** 2–6 (including enrollment-only access), D112 relationship authority,
and the pinned Waitron interface/open-PR check described above. Do not fabricate
local-admin evidence or ship an accepting fake adapter.
**Estimate:** production +400/−20; tests +420/−20.

## 15. Complete restricted recovery and enroll fresh proof

**Outcome:** mailbox plus valid box approval recovers the same account for that
box's organisation only. Lost methods and sessions end; you must enroll a fresh
proof before account access. Other organisations do not become accessible through
this recovery, including on later sign-ins. Notify the verified mailbox.

**Files:** extend 14's `owner-recovery` files; integrate
`packages/identity/src/sessions.ts`, registration
`src/{passkeys,authenticator-factor,password-login,password-recovery}.ts` and D112's
`src/global-country/customer-authority.ts`; portal `src/{app,session}.ts`.
Owners: registration/HTTP `test/owner-recovery.test.ts`, existing registration
`test/{identity,passkeys,authenticator-factor}.test.ts`, portal
`test/owner-recovery-browser.test.ts`.

**TDD:** after all waits recheck mailbox token, one-use box approval, ownership/version,
current pairing/key, exact organisation, country and reset request. One atomic
completion invalidates lost methods/recovery codes, sessions, recognition and pending
security/transfer authority, preserving taxpayer identity and ownership. Issue only
restricted enrollment authority; session reads and direct private routes cannot
escape it. Fresh enrollment is mandatory before access; cancellation/uncertain
replies never issue unrestricted sessions or replay approval. Test second-organisation
reads/writes, later password/passkey sign-ins and recovery racing handover at the
authority owner, plus route-specific answers. No manual fallback.

**Migration:** only the durable organisation restriction/enrollment state required by
the accepted country authority/session interface. **Dependencies:** 14 and the
explicit D112 scope boundary/other-organisation restoration decision. Neither current
unscoped sessions nor a portal filter suffices. Pin that interface and its consumer
tests before assignment; if absent, this remains a named build dependency, not an
excuse to issue account-wide access or design a competing authority system here.
**Estimate with scope boundary ready:** production +320/−50; tests +440/−30.

## Coverage and publication boundary

D608 sign-in rules map to 1–4; all named fresh-proof actions and reset effects to
5–10; recipient signup and transfer defaults/atomicity/revocation to 11–13;
verified-mailbox/current-paired-local-admin, organisation-limited recovery and fresh
enrollment to 14–15. D610 alone supplies SMS enrollment/delivery; D112 supplies
country/sole-owner authority; P6 retains machine handover/activation. The policy and
interface decisions listed above remain explicit dependencies. No test was run,
provider accessed, message sent, migration applied or implementation approved by
this source-only plan publication.
