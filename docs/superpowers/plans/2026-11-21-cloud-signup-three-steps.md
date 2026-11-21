# Cloud signup in three steps

The Lane K queue records the owner’s request from 21 November at 17:01. When this is ready, you can register an account with email, password and language, register or receive a business, and add a venue to a business from Waitron setup.

## What Account shows today

Account shows security and handovers (`apps/portal/src/screens.ts:74`). Venues shows one organisation at a time. Its venue cards give the legal business in Details and usage covers the selected organisation (`apps/portal/src/installation-screen.ts:23`). The `/connect` picker lists eligible businesses, including those without venues (`packages/registration/src/pairing.ts:78`). Account has no business list or rename form.

## 1. Register your account

Keep `/signup` and its email verification, then ask for the password. Remove the business fields and signup checkboxes. Reuse the verification transaction in `registration/src/signup.ts` for `completeAccount`. It creates only the verified account and attaches existing offers without granting access. Keep `completeForTransfer` and its refusal when no offer is waiting. Both use the existing password, replay, rate and sign-in rules.

In `account-http/src/app.ts`, accept token and password on `/signup/complete` and return the account ID. Keep the full legacy request and three-ID acknowledgement for older tabs, HTTP callers and `scripts/test-cloud-integration.mjs:545`. The three business fields must arrive together or be absent. Keep one completion limit across all forms. Match the acknowledgement to the submitted shape in `apps/portal/src/api.ts`.

Link the bilingual invitation to `/receive-business`. Existing accounts sign in. New recipients use the shared signup request and its encrypted email, with one fixed choice to address the verification link back to this page. Use a same-origin fragment for token and language, scrub it and call `completeForTransfer`. Existing queued messages keep their paths. Both recipients then use the default sign-in and enrolment journey to Account and see offers there. Change registration `account-{mail,input}.ts` and `email-outbox.ts`, account-http `portal.ts` and portal `links.ts`, `app.ts`, `screens.ts` and `locale.ts`.

## 2. Register or receive a business

Put the business list and **Register a business** on `/account`. Show legal name, tax number and country for each business, including those without venues. Use the first business's name for the organisation. Name the group the business will join. Offer an owner-only **Organisation name** edit with “This name groups your businesses”. Link the empty `/connect` screen to registration.

Add `account-businesses.ts` in registration and account-http and wire the existing HTTP app. GET and POST `/api/account/businesses` list and create. POST `/api/account/organisations/rename` changes the name. Reuse the configured-country refusal, billing field limits and setup's country and normalised tax match. Require a tax number and keep its entered form. Ask which owned organisation to use when several are eligible. Create the first organisation only for an unrestricted account without memberships. Share first-organisation locking with setup, and recheck owner and recovery scope after waits. Use the existing enrolled-session and write checks. In portal, wire the business controller and screen through `app.ts`, `screens.ts`, `api.ts` and `locale.ts`.

Handover transfers the whole organisation and revokes the former owner’s grants and consent (`packages/registration/src/owner-transfer.ts:82–89`). Paired-box recovery also works at organisation scope (`packages/registration/src/owner-recovery.ts:154`). Keep that scope and show affected business names before handover. The watcher needs to settle whether the owner wants to transfer a single legal business out of a group.

## 3. Add a venue from Waitron

Reuse Cloud’s signed setup return and tax match. With a match, file the venue there. With no match, ask the person on the box before creating the business and filing. Agree the smallest signed confirmation with Lane D and enable it only for boxes that can send it. Keep current v4 and v5 saves, including blank-business reuse. Preserve permissions, original-tab return, expiry and retry in `registration/src/setup-pairing.ts` and the existing HTTP pairing handler.

Early address lookup and staff mail need a temporary venue, currently created only for a sole business without a tax number or venues (`setup-pairing.ts:246–249,300–301`). Before switching signup, agree what a new account without a business can use. Recommend early services for a sole eligible registered business without venues, with country and tax match checked on final save, and services after filing for an account without a business. The hosted check still needs Lane D’s after-Admin order.

## Delivery and checks

Ship Account business management and handover scope first (220–280 production lines, 150–190 test lines). Ship account-only signup and the invitation after settling early setup services (180–235 and 135–180). Ship the coordinated box confirmation as its own Cloud change (100–145 and 80–110). Start each behaviour with a failing focused case.

- Registration owns transactions, first-group races and transfer scope in `test/signup.test.ts`, new `test/account-businesses.test.ts` and existing `test/{owner-transfer,owner-recovery,pairing}.test.ts`. Mail and outbox tests own the trusted link and intent.
- Account HTTP checks exact acknowledgements, authorised writes and country and no-match refusals in `test/{account-http,owner-transfer,pairing}.test.ts` and new `test/account-businesses.test.ts`.
- Portal checks signup fields, country refusal, two businesses and rename, invitation through enrolment, and original-tab setup return in `test/{signup-country,owner-transfer,pairing}-browser.test.ts` and new `test/account-businesses-browser.test.ts`. Keep the response-boundary and retry checks for signup.

Run the named database tests through `scripts/test-postgres.mjs`. Build the portal for browser tests, check English and Spanish in both themes at 390 and 1280, and run `pnpm typecheck`. Update `docs/cloud-signup-implementation.md` for signup and group handovers, the HTTP and pairing guides, and `docs/backlog.md` with each change. The hosted qualification stays with CLOUD-ONE-CLICK-PAIRING.
