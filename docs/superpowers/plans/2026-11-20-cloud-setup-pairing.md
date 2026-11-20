# Register a box from Waitron

Sign in or sign up after creating the box administrator, before the venue form. The same tab returns to Waitron and keeps the staged forms. Saving the venue files it under the matching business. Skip keeps manual addresses and your own mail server. Connect later from Cloud services. The owner set the outcome on 20 November at 13:49, 13:54 and 14:16 in Lane K's questions. Lane K owns Cloud and defines the requests below. Lane D owns the Waitron calls and shared signing package release. This supersedes the [link-only plan](2026-11-19-cloud-one-click-pairing.md).

## 1. Connect an installed test box

An administrator connects a previously unpaired box from Cloud services using an existing Cloud account. Cloud registers it and files the saved venue without a business picker or second pairing confirmation. Scope the new flow to signed test requests in `test-venue-levels` with the exact HTTPS callback configured for the test box's public key. Keep the released pairing and recovery flows. Remove venue shipped in #1330.

Every box call is a POST to `/api/pairing/{start,redeem,status,complete}` with the existing `{payload,signature}` envelope. Sign the exact UTF-8 JSON array `["waitron-cloud-pair-v4",cloudOrigin,action,requestId,publicKey,"test",issuedAt,args]`. Reuse the Ed25519 SPKI key, unpadded base64url, UUID checks, exact re-encoding and 60-second timestamp rule. This version creates only new venues.

| Action | Signed args in order | Successful response |
| --- | --- | --- |
| Start | `[redirectUri,state,codeChallenge]` | `{requestId,state:"awaiting_cloud",expiresAt,authorizationUrl}` |
| Redeem | `[code,codeVerifier]` | `{requestId,state:"account_bound",expiresAt}` |
| Status | `[]` | `{requestId,state,expiresAt}`, plus `registration` when complete |
| Complete | `[countryCode,venueName,[addressLine1,addressLine2,postalCode,city,province],taxNumber,legalName]` | `{requestId,state:"complete",expiresAt,registration}` with the existing registration shape |

The box generates independent random state and verifier from 32 bytes each, encoded as base64url. The challenge hashes the verifier using [PKCE S256](https://www.rfc-editor.org/rfc/rfc7636.html#section-4.2). Save the attempt against the initiating browser and box key. Start returns the same expiry and URL on an identical retry. Send the same tab to `/login?request_id=…&state=…&code_challenge=…&code_challenge_method=S256` on Cloud. Compare those values with the signed start. Keep them through the existing sign-in and passkey or factor checks. After fresh enrolled Cloud account proof, the portal sends a same-origin, CSRF-checked `POST /api/account/pairing/authorize` with `{requestId,state,codeChallenge}`. Cloud returns `{returnUrl}` for same-tab navigation to the stored redirect URI plus `request_id`, `state` and `code`. The redirect URI has a fixed callback path chosen by Lane D, no query or fragment, and must exactly match its configured value. Remove callback parameters from history before loading other resources. Keep them out of logs and referrers.

Check the initiating tab's state, then require the original fresh local administrator session and same origin on the box POST before signing redeem. The code expires after 60 seconds and the request after 10 minutes. Redeem verifies the box key and verifier and consumes the code in the transaction that binds the account. Store only the code hash against the verified account, session and security revision. Reuse existing pending account proof checks. Signed status recovers successful redeem and complete after a lost response. If an unfinished attempt expires, start afresh and retain the local forms.

Complete uses the existing account and organisation lock order and `RegistrationStore`. Match a unique nonblank country and trimmed, case-insensitive tax number within owned, registration-enabled businesses. With no match, create the business under the sole eligible owned organisation, or create the account's first organisation and business. An ambiguous match or organisation leaves the local venue usable and explains why Cloud filing needs business details corrected. Create one fresh venue for the unpaired box, keep the existing business details, and return the same registration on retry.

Change `packages/account-http/src/pairing.ts`, `packages/registration/src/pairing.ts` and `apps/portal/src/app.ts` with its pairing controller. Add one migration and update `migrate.ts`. Both packages’ `test/pairing.test.ts` cover legacy compatibility, redirect and key binding, expiry, lost replies, scoped matching and concurrent completion. Portal `test/pairing-browser.test.ts` and the joint box walkthrough cover same-tab return and a forwarded link in another browser. Estimate 280–420 code and 160–250 test lines.

## 2. Reuse the trip during setup

Bind the attempt to the browser running setup. Today Admin Next stages forms in that browser and the first owner claim runs at Venue. Prove the forms survive the trip, Skip and later Connect. Extend `registration/src/signup.ts` with verified signup before business details. Use the bound request for synthetic address lookup through `account-http/src/address-lookup.ts`. For the email walkthrough, discover the existing test relay grant after saving the venue through signed configuration and receive mail in Mailpit. Ordinary relay consent and origin verification and real address calls have separate gates. Cover these in registration `test/signup.test.ts`, account-http `test/address-lookup.test.ts` and the joint setup browser tests. Estimate 190–300 code and 155–250 test lines.

## 3. Require a trial or paid plan for guest menus

Reuse venue billing eligibility in `remote-access/src/guest-menu.ts` and `account-http/src/guest-menu{,-server}.ts` for enabling, publishing and public reads. While ineligible, a previously shared menu returns the existing public 404. Keep withdrawal and takedown available. Portal Remote access and the box's Guest menu preview explain the refusal and offer **Start free trial**. In `test/guest-menu.test.ts`, `test/guest-menu-server.test.ts` and portal `test/guest-menu-browser.test.ts`, cover Registered refusal, already shared copies, trial expiry and a paid plan. Estimate 100–170 code and 75–130 test lines.

Run the named PostgreSQL tests through `scripts/test-postgres.mjs` and run `pnpm typecheck`. Update the integration contract, backlog and affected guides with each slice. Check English and Spanish in both themes at 390 and 1280 pixels.
