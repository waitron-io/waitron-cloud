# Cloud signup in three steps

## Business management, shipped in #1361

On Account you can see the businesses in each organisation you own, register
another business, rename its group and see which businesses a handover includes
(`apps/portal/src/screens.ts:75`, `apps/portal/src/account-businesses-screen.ts`).

## Handover invitation, slice 2

A recipient can open the invitation and learn what will change before signing in
or creating an account. The owner asked for a different landing page on
21 November at 17:01. The watcher narrowed this slice to that page at 18:40 and
19:05. Both decisions are recorded in Lane K's campaign notes.

- Add public `/receive-business` to the existing document list in
  `packages/account-http/src/portal.ts`. The local and Amazon test proxies
  forward ordinary paths to Account. Keep the existing method, host and query checks.
- In `apps/portal/src/{app,screens,locale}.ts`, explain in English and Spanish
  that a handover transfers the whole organisation and its businesses, and
  that the recipient reviews and accepts it on Account. Use the current
  heading, language selector, theme and link helper. Link to `/login` and
  `/signup`, with a reminder to sign up using the invited address.
- In `packages/registration/src/account-mail.ts`, send that fixed link with
  `#lang=en` or `#lang=es` in the bilingual invitation. Keep the current notice
  links after acceptance and cancellation. The page displays the same explanation
  to everyone. Signup verification, transfer signup and its refusal, and the
  normal return to Account continue through their existing routes.
- Update `docs/cloud-signup-implementation.md` and remove the delivered page
  from the open work in `docs/backlog.md`. General account-only signup and
  individual business moves remain open. Venue setup and the completed hosted
  check are outside this slice. The watcher dropped the box confirmation slice.

## Focused checks

- Start with failing checks. In `packages/registration/test/account-mail.test.ts`,
  require the same fixed invitation link in each language and preserve existing
  privacy checks. Add the page to the GET and HEAD list in
  `packages/account-http/test/portal.test.ts`.
- In `apps/portal/test/owner-transfer-browser.test.ts`, start the existing new
  recipient journey at the invitation link. Check the localized explanation
  and sign-in destination, then take the signup link and keep the existing
  checks through verification, enrollment and acceptance. Inspect the new page
  in English and Spanish, light and dark, at 390 and 1280 pixels.
- Build with `pnpm --dir apps/portal build`. Run the two named database test
  files through `scripts/test-postgres.mjs` and the mail test with
  `node --test packages/registration/test/account-mail.test.ts`. Run
  `pnpm typecheck`. List changed test checks in the pull request.

Estimate 20–35 added product lines, 12–25 test lines and 8–15 guide and backlog
lines beyond this plan.
