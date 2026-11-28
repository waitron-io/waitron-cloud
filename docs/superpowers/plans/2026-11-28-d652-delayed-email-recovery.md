# D652 · Recover your Cloud account after losing every sign-in method

> the owner, 2026-11-28, "yes" to: should someone who has lost every sign-in method get back in with just their email? Chosen: email plus a waiting period of about 72 hours when no connected box can approve, warning every address on the account at once, cancellable from any of them; then they enrol a new passkey or app.

**Eligibility.** A verified, password-bearing customer account keeps its existing memberships and any restriction from earlier box recovery. Check for an eligible box on every owned business in that account’s current scope. Use the chooser’s ownership, country and current pairing checks, plus signed contact within 15 minutes (`owner-recovery.ts:70`, `installations.ts:148`, `monitoring.ts:45`). Check at start and completion. An online box whose administrator is away still requires box approval. If a box returns, the instant approval path is available. Privileged platform accounts are outside this proposal.

**Start, wait and cancel.** Trade a valid reset link for one seven-day attempt. Add the next registration migration and append it to `migrate.ts`. Reuse `password_reset_requests` with a distinct purpose and a new row keyed by a random cancel token’s hash. Queue a warning in the same transaction and bind the attempt to that outbox row. The current schema stores one verified email per account (`002_identity.sql:1`), so the warning goes to the same mailbox that started recovery. Extend `packages/registration/src/{email-outbox,account-mail,local-mailer,smtp-mailer}.ts` and `deploy/test-cloud/capture-mailer.mjs`. Adjust the reset-purpose and outbox-kind constraints. A sent warning’s stored finish time starts the 72-hour wait. An unsent warning grants no access. A terminal failure ends the attempt and the waiting screen explains how to retry. The mail link opens a confirmation screen. Cancellation uses a POST and works until completion.

**Finish.** Request a fresh 30-minute reset link after the wait and choose recovery again. In `packages/registration/src/{owner-recovery,account-action-proof,password-recovery}.ts`, serialise start, cancellation, recovery and security changes on the account. Under the relevant locks, require a link created after the wait and recheck the warning, verified address, password binding and box eligibility. Security changes retire pending attempts. Reuse box recovery’s password screening and credential replacement. Consume both links, retire old sign-in methods and sessions, and create an enrolment-only session in one transaction. Set cookies after commit. Save the enrolment requirement on the account and check it in `packages/identity/src/sessions.ts`, including on later sign-ins, until a new passkey or app is enrolled. Later factor management follows the existing policy.

**Prove it.** Write failing tests first. Registration proves delivery timing and failure, cancellation versus completion, stale links after ordinary password reset, box eligibility, preserved scope and mandatory enrolment. `packages/account-http/src/owner-recovery.ts` uses same-origin, rate-limited POSTs for start, cancel and completion. Test that only completion sets cookies. Extend `apps/portal/src/{app,links,owner-recovery-controller,owner-recovery-screen,locale}.ts` and `packages/account-http/test/mail-capture.ts`. Run the real worker against Mailpit for the browser journey. Check English and Spanish in both themes at 390 and 1280 pixels. Update current migration pins and `docs/{cloud-signup-implementation,password-recovery-implementation,authenticator-app,backlog}.md`.

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-concurrency=1 \
  test/{owner-recovery,password-recovery,email-outbox,account-mail,local-mailer,smtp-mailer,identity,migration-history,relay-worker}.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-concurrency=1 \
  test/{owner-recovery,mail-capture}.test.ts
pnpm --dir apps/portal build
node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/owner-recovery-browser.test.ts
node --test deploy/test-cloud/capture-mailer.test.mjs
```

Medium estimate, production +360–480/−25–45 lines and tests +200–280/−10–20 lines. Watcher clearance covers recent box contact, platform exclusion, the attempt lifetime and when the enrolment requirement ends.
