# D608 slice 12b: first-time recipient handover

**Assignment:** “Plan the next coherent first-time-recipient signup slice (12b), then organisation-limited box recovery (13), under the normal Claude plan read and watcher clearance.” Source: `/Users/clintongormley/waitron-campaign-g/queue.md`, D608, Next step. **12b only; awaiting Claude read and watcher clearance, not owner plan approval.**

**Spec:** [owner lifecycle, lines 33–35](../specs/2026-11-07-cloud-single-owner-lifecycle-design.md), [parent slice 12](2026-11-11-d631-owner-lifecycle-build.md#12-organisation-handover), [completed 12a](2026-11-17-d608-handover.md). Source read at `12be3d62ae`; no runtime verification was performed for authoring.

**Finish line:** you follow the invitation, verify its addressed email and create an account without an organisation, business or membership. Sign in, enrol proof, re-sign in/re-prove, then explicitly accept the exact unexpired offer on the existing page. Its transaction replaces the sole owner and revokes former-owner access; nothing grants recipient organisation access before acceptance.

**Reuse:** registration `src/signup.ts:24–91` supplies verification/password/recognition; `src/owner-transfer.ts:23–47,54–109` supplies unbound offers, acceptance/revocation and initial-enrolment preservation. Existing proof invalidation is in `src/account-action-proof.ts:41–48`; app activation ends sessions at `src/authenticator-factor.ts:152–174`. Reuse session and enrolment controls unchanged.

**Exclude:** standalone account-only signup, box recovery, billing, providers, country/global interfaces, new policies, response ledgers, owner revisions and minimum-owner triggers. Keep business signup unchanged. Reuse `signup_requests`, encrypted mail and the same `owner_transfers` row; no new protocol/table/migration.

## 1. Attach the verified account to the exact offer

- [ ] Modify `packages/registration/src/signup.ts`: add `requestForTransfer(email,offerId,locale)` returning accepted and `completeForTransfer(token,{offerId,password,rememberBrowser?})` returning `{accountId,browserToken?}`. Share current verification/credential internals. Request queues mail only for a matching live offer/address; retain generic answers and existing cooldown.
- [ ] In `src/owner-transfer.ts`, add `attachOwnerTransferRecipient(client,offerId,accountId): Promise<void>` within account creation. Lock sorted participant accounts, organisation, offer, then sender membership. Recheck null recipient, exact verified email, enabled parties, current sender/address/ownership and live offer after waits. Attach only that offer with `recipient_needs_enrolment=true`.
- [ ] Atomically create credentials, attach, consume verification and optionally remember the browser; create no membership/session. Recheck both expiries at completion; rollback on refusal. Preserve duplicate-email protection and existing first-enrolment exception/proof invalidation; later security changes cancel the bound offer.
- [ ] Extend `src/{account-input,email-outbox,account-mail}.ts` to carry optional `offerId` in existing verification mail only. Keep token rules. Every invitation gets identical sign-in and `/signup#offer=<id>&lang=<locale>` links; verification carries token plus offer across browsers. Offer IDs convey context, never authority; retain handover mail guards.
- [ ] Store owner: `packages/registration/test/owner-transfer.test.ts` adds attachment/no-access, wrong/missing/cancelled/expired offer refusal, cancellation/expiry during lock waits, duplicate completion and initial-enrolment/fresh-acceptance checks. Existing signup tests own shared token/password rules; retain acceptance/revocation/security assertions.
- [ ] Mail owners: `test/{account-mail,email-outbox}.test.ts` checks encrypted context and EN/ES links. Replace only the obsolete existing-account-limit wording assertion; preserve uniform invitations/no private details and list the changed check in the PR.

## 2. Connect the invitation to signup and the existing account page

- [ ] `packages/account-http/src/app.ts`: public POST `/signup/transfer/request` accepts `email,offerId[,locale]`; `/signup/transfer/complete` accepts `token,password,offerId[,rememberBrowser]`. Reuse parsing, Origin checks, signup budgets/errors/cookies. Return generic 202/account-only 201, without session cookies; reject business fields. Its `test/owner-transfer.test.ts` owns only distinct HTTP answers and admission, not the store matrix.
- [ ] `apps/portal/src/{links,app,api,screens,locale}.ts`: capture/scrub one UUID offer on `/signup`; preserve through resend/verification. This branch asks for password/browser choice without business fields, validates public responses and retains transport/stale-reply guards. Always offer existing-account sign-in without existence disclosure.
- [ ] Return through normal sign-in to `/account`; reuse `owner-transfer-{controller,screen}.ts` and enrolment/proof controls. Recipient binding survives reload/sign-out; display exact parties/business and require explicit acceptance, never automatic acceptance.
- [ ] Portal owners: extend `test/links.test.ts`, `signup-reset-transport.test.ts` and `signup-reset-response-boundary.test.ts` for changed contracts. Add one EN/ES first-time end-to-end journey in `owner-transfer-browser.test.ts`: delivered mail, creation, real sign-in/email proof, app enrolment, re-sign-in/app proof and acceptance. No seeded recipient proof. Inspect signup/pending/accepted visuals in EN/ES, light/dark, 390/1280 using that journey.

## 3. Verify and finish the coherent slice

- [ ] Observe RED then GREEN in owning tests; preserve existing checks. Use synthetic accounts/local mail and the approved test-box route. No authoring tests.
- [ ] Store/mail: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/owner-transfer.test.ts test/signup.test.ts test/account-mail.test.ts test/email-outbox.test.ts`.
- [ ] HTTP: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/owner-transfer.test.ts test/account-http.test.ts`.
- [ ] Portal: `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/links.test.ts test/signup-reset-transport.test.ts test/signup-reset-response-boundary.test.ts test/owner-transfer-browser.test.ts`; inspect generated visuals and run `pnpm typecheck`. CI owns full selected package suites.
- [ ] Update `docs/cloud-signup-implementation.md`, `packages/{registration,account-http}/README.md`, parent slice 12 and D608’s unfinished `docs/backlog.md` paragraph; leave recovery open and historical 12a intact. Run normal `finish-branch` review/current-head CI.

**Forecast additions/removals:** production +350/−45; tests +420/−15; support +0/−0; docs +80/−15 including plan: **925 changed lines, 3 hours to PR**, excluding watcher/outage waits. Re-cut with watcher if forecast exceeds 1,000 lines/3h; outside opinion past 1.5× (about 1,390 lines/4.5h). No interface blocker found by reading; runtime remains unverified.
