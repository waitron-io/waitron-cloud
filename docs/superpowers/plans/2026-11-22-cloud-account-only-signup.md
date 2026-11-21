# Cloud account-only signup

Verify your email and set a password in English or Spanish. After signing in,
register your first business on Account or accept an invitation sent to that
email. From Waitron setup, return to the original tab and save your first venue.

The owner’s 21 November 17:01 request is in Lane K’s queue under
CLOUD-SIGNUP-THREE-STEPS. #1361 shipped the Account list grouped by organisation,
including legal names, countries and tax numbers, plus business registration and
group rename. #1363 shipped the handover introduction. The watcher’s 18:40 and
19:05 notes keep normal signup from that page and automatic filing on the box.
The 21:03 note keeps handover to the whole organisation.

- [ ] In `packages/registration/src/signup.ts`, add
  `completeAccount(token, {password, rememberBrowser?})` through `#complete`.
  Reuse verification, password screening, email uniqueness, offer attachment
  and optional browser recognition. In `packages/account-http/src/app.ts`,
  allow token and password on POST `/signup/complete` and keep its current
  business request when all three business fields are present. Reject partial
  business details. Keep shared limits, legacy responses and the transfer
  endpoint’s live-offer refusal. Test account-only creation and replay in
  `packages/registration/test/signup.test.ts` and both request shapes and cookie behavior
  in `packages/account-http/test/account-http.test.ts`. The country check applies when
  business details are supplied, including when registering on Account.
- [ ] In `apps/portal/src/{app,api,screens,locale}.ts`, keep labelled email and
  password controls, new-password autofill, and the existing language picker
  and email locale. Remove business inputs and signup checkboxes. Keep
  Remember this browser at sign-in. Require HTTP 201 with a nonblank account ID
  for the new request and all three IDs for legacy business requests.
  Update the named portal checks below for the new body and keep validation,
  acknowledgement, timing, lost-reply and cookie coverage. Move the country
  refusal journey into the existing Account business browser test, preserving
  translated refusal, field retention, non-submitting selection and retry.
- [ ] In `packages/registration/src/account-mail.ts` and portal `locale.ts`,
  direct new recipients to the invited email and Account in both languages.
  Keep the fixed `/receive-business` link and invitation privacy checks.
  In `owner-transfer-browser.test.ts`, keep verification through acceptance,
  including zero membership beforehand. Use the no-offer browser case to
  register a first business after signup. Transfer refusal stays covered in
  the existing HTTP and store tests.
- [ ] In `pairing-browser.test.ts`, use account-only signup and keep the
  original-tab return after enrolment and fresh sign-in. In registration’s
  `pairing.test.ts`, check v5 redemption without early registration and first
  venue save under the typed tax number using existing `businessForVenue` and
  `createFirstOrganisation`. Setup services become available after filing.
  Early provisional tax reassignment and other box changes are separate work.
- [ ] Update `docs/{backlog,cloud-signup-implementation,account-http-design,product-and-platform}.md`,
  `docs/backlog/account-http-boundaries.md` and both package READMEs where they
  describe signup. This slice leaves individual business moves and hosted
  qualification of the revised flow open.

Run each new check before its fix and then again with the fix. Run the named
PostgreSQL checks on an approved test host. Inspect signup and the handover
page in English and Spanish, light and dark, at 390 and 1280 pixels.

```sh
pnpm portal:build
node --test apps/portal/test/{signup-reset-response-boundary,signup-reset-transport,account-retry-clock,signup-reset-acknowledgement-browser}.test.ts packages/account-http/test/http-password-boundary.test.ts packages/registration/test/account-mail.test.ts
node scripts/test-postgres.mjs exec node --test --test-timeout=120000 packages/registration/test/{signup,pairing,owner-transfer}.test.ts packages/account-http/test/{account-http,account-businesses,owner-transfer}.test.ts
node scripts/test-postgres.mjs exec node --test --test-timeout=120000 apps/portal/test/{forms,form-error-clearing-browser,login-cooldown-scope-browser,journey,sign-in-check-browser,owner-transfer-browser,pairing-browser,account-businesses-browser,accessibility}.test.ts
pnpm typecheck
```

Estimate 120–180 changed product lines, 240–360 test lines and 90–150 guide
lines. Count additions and removals separately and name changed assertions in
the pull request.
