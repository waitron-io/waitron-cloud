# Cloud signup in three steps

## Business management, shipped in #1361

On Account you can see the businesses in each organisation you own, register
another business, rename its group and see which businesses a handover includes
(`apps/portal/src/screens.ts:75`, `apps/portal/src/account-businesses-screen.ts`).

## Handover invitation, slice 2

A recipient can open the invitation and learn what will change before signing in
or creating an account. The owner asked for a different landing page on
21 November at 17:01. The watcher narrowed this slice to that page at 18:40 and
19:05 and kept whole-organisation transfer at 21:03. Lane K's campaign notes
record those directions.

- Add public `/receive-business` to the existing document list in
  `packages/account-http/src/portal.ts`. The local and Amazon test proxies
  forward ordinary paths to Account. Keep the existing method, host and query checks.
- In `apps/portal/src/{app,screens,locale}.ts`, explain in English and Spanish
  that a handover transfers the whole organisation and its businesses, and
  that the recipient reviews and accepts it on Account. Use the current
  title, language selector, theme and link helper. Give the page its own screen
  branch before the email form, with links to `/login` and `/signup` and no form.
  Tell new recipients to use the invited email and choose **I’m receiving a
  business** after verification to create an account without a new business.
  Visitors with a session see the same explanation under the current enrolment rules.
- In `packages/registration/src/account-mail.ts`, send that fixed link with
  `#lang=en` or `#lang=es` matching the invitation language. Say “Open Waitron
  Cloud to see how to receive the business.” Use “Abre Waitron Cloud para ver
  cómo recibir el negocio” in Spanish. Keep the notice links after acceptance and
  cancellation. Signup verification, transfer signup and its refusal, and the
  normal return to Account continue through their existing routes.
- Update `docs/cloud-signup-implementation.md` and remove the delivered page
  from the open work in `docs/backlog.md`. Add the route to
  `packages/account-http/README.md`. General account-only signup and
  individual business moves remain open. Venue setup and the completed hosted
  check are outside this slice. The watcher dropped the box confirmation slice.

## Focused checks

- Start with failing checks. In `packages/registration/test/account-mail.test.ts`,
  require the same fixed invitation link in each language and preserve existing
  privacy checks. Add the page to the GET and HEAD list in
  `packages/account-http/test/portal.test.ts`.
- In `apps/portal/test/owner-transfer-browser.test.ts`, start the existing new
  recipient journey at the invitation link. Check the localized explanation
  including the checkbox instruction and sign-in destination. Take the signup
  link and keep the checks through verification, enrolment and acceptance. Add
  the page to `apps/portal/test/accessibility.test.ts` and inspect it in both
  languages and themes at 390 and 1280 pixels.
- Build with `pnpm --dir apps/portal build`. Run these checks and list changed
  test assertions in the pull request.

```sh
node --test packages/registration/test/account-mail.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/portal.test.ts
node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 test/owner-transfer-browser.test.ts test/accessibility.test.ts
pnpm typecheck
```

Estimate 25–40 added product lines, 15–30 test lines and 8–15 guide and backlog
lines beyond this plan.
