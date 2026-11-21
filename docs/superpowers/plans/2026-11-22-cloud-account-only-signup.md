# Cloud account-only signup

Verify your email and set a password in English or Spanish. After sign-in,
register your first business on Account or accept an invitation sent to that
email. From Waitron setup, return to the original tab, use address lookup,
choose staff email and save your first venue.

The owner's 21 November 17:01 request is in Lane K's queue under
CLOUD-SIGNUP-THREE-STEPS. #1361 shipped the business list, registration and
group rename. #1363 shipped the handover introduction. Claude read the plan
in Lane K's `account-only-plan-review.md`. The watcher cleared the plan with
the changes below in Lane K's questions.md on 22 November at 00:08 CET.

- In `packages/registration/src/signup.ts` and
  `packages/account-http/src/app.ts`, use the existing account creation
  transaction for the single POST `/signup/complete` request with token and
  password. The browser requires 201 and the account ID. Keep screening,
  link expiry and replay, email uniqueness, request limits and offer attachment.
  Leave browser recognition to sign-in. Retain the internal fixture method
  that seeds accounts with a business. Move the integration runner in
  `scripts/test-cloud-integration.mjs` to signup, sign-in and the existing
  Account business route. Check the request contract and sign-in in the
  account HTTP tests and the password and observer-login boundary tests.
- In `apps/portal/src/{app,api,screens,locale,pairing-screen}.ts`, remove
  the business fields and signup checkboxes. Keep the language picker, password
  autofill, validation and uncertain-reply handling. On installed-box Connect,
  link to Account for business registration and explain how to restart Connect.
  Update the focused signup, session, acknowledgement and Connect browser
  tests. Account business browser tests already cover the country refusal.
- In `packages/registration/src/account-mail.ts` and portal copy, tell
  recipients in both languages to sign up with the invited email and accept on
  Account. Keep the existing link and proof required for acceptance. Check
  no membership before acceptance, the full handover and first business
  registration without an offer in the owner-transfer tests.
- In `packages/registration/src/{setup-pairing,account-businesses}.ts`,
  reuse first organisation creation at setup redeem for an account without
  memberships. Create its empty business for the box's country, then use the
  current provisional registration. Fill missing group and business names
  from the signed legal name on save. Keep saved names, billing identity and
  IDs. Run the existing allowance and staff-email consent checks using the
  account-only request in `pairing.test.ts` and
  `packages/account-http/test/setup-email-consent.test.ts`.
- Update the root and both package READMEs and the affected signup, account
  HTTP, pairing, product, backlog and service-contract guides. Check signup,
  handover and Connect in English and Spanish, light and dark, at 390 and
  1280 pixels.

If you register a business on Account before box setup, its tax number means
you enter details manually during setup. Moving one business by itself,
filing a new tax number when you own several groups, and release qualification
on a hosted Cloud and real Waitron box stay open.

Estimated changed lines: 120–180 product, 240–360 tests and 90–150 guides.
