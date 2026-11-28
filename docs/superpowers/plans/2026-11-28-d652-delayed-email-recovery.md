# D652 · Recover your Cloud account after losing every sign-in method

> the owner, 2026-11-28, "yes" to: should someone who has lost every sign-in method get back in with just their email? Chosen: email plus a waiting period of about 72 hours when no connected box can approve, warning every address on the account at once, cancellable from any of them; then they enrol a new passkey or app.

Record `~/waitron-campaign-shared/desk/done/20261128-1054-G-account-recovery.md`. This covers the first-box lockout on Test Cloud. Box approval still gives immediate recovery (`docs/cloud-signup-implementation.md:109`).

**Eligibility.** For a previously scoped account require current ownership of that organisation in this country service and keep the restriction. For an unrestricted account propose no memberships or just one owner membership in this country service. Refuse accounts with platform permissions. Save the eligible organisation, if any, and recheck it. An eligible box meets the chooser’s owner and country checks, is neither revoked nor replaced, and has `installations.last_contact_at` within 15 minutes (`owner-recovery.ts:70`, `installations.ts:148`, `monitoring.ts:45`). Check at start and completion. If a box comes back online, use the existing box approval.

**Start, wait and cancel.** Consume a live reset link to start one seven-day attempt per account. Append `packages/registration/migrations/094_delayed_owner_recovery.sql` and register it in `packages/registration/src/migrate.ts`. Reuse `password_reset_requests` with a distinct purpose and a hash of a random, cancel-only token. Queue the warning in the same transaction. Today one credential row holds one email (`002_identity.sql:1`), so one message covers all current verified account addresses. Extend `packages/registration/src/{email-outbox,account-mail,local-mailer,smtp-mailer}.ts` and `deploy/test-cloud/capture-mailer.mjs`. When the worker marks the warning sent, atomically set readiness to database time plus 72 hours once. A failed or suppressed send leaves recovery blocked. The warning’s fragment link offers an explicit cancellation POST until completion. Cancellation consumes the attempt and grants no access.

**Finish.** The waiting screen directs you to request a fresh 30-minute reset link and choose recovery again. Require its creation after readiness and match the live attempt’s account, verified address and password fingerprint. In `packages/registration/src/{owner-recovery,account-action-proof,password-recovery}.ts`, serialise start, cancel, finish and security changes on the account, then lock credentials and requests. Security changes retire pending attempts. Lock owned venues and current boxes before the final eligibility read. Reuse the box path’s password screening and authority reset. Ending sessions, clearing old factors, codes and pending approvals, consuming both links and creating an enrolment-only session commit together. Set cookies after commit. Persist required enrolment independently of account scope and enforce it on later sign-ins in `packages/identity/src/sessions.ts`. Clear the requirement on successful passkey or app enrolment.

**Prove it.** Write each failing test first. Registration proves stale-link refusal, scope, box and security-change races, replay and rollback. The worker proves when the clock starts. `packages/account-http/src/owner-recovery.ts` handles same-origin, rate-limited `delay`, `cancel` and `complete-delayed` POSTs. Test that only completion sets cookies. Extend `apps/portal/src/{app,links,owner-recovery-controller,owner-recovery-screen,locale}.ts` and `packages/account-http/test/mail-capture.ts`. Use Mailpit and advance database timestamps to prove cancellation before and after readiness and required enrolment with country policy off. Inspect both languages and themes at 390 and 1280 pixels. Update migration pins and `docs/{cloud-signup-implementation,password-recovery-implementation,backlog}.md`.

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node \
  --test --test-concurrency=1 test/{owner-recovery,password-recovery,email-outbox}.test.ts \
  test/{account-mail,migration-history}.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node \
  --test test/owner-recovery.test.ts
pnpm --dir apps/portal build
node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node \
  --test test/owner-recovery-browser.test.ts
node --test deploy/test-cloud/capture-mailer.test.mjs
```

Medium estimate, production +360–480/−25–45 lines and tests +200–280/−10–20 lines. Review the proposed meaning of a box that can approve, the exclusion of platform accounts, and the seven-day attempt lifetime.
