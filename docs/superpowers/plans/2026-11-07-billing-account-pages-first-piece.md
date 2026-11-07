# D604 piece 1: start Connected’s existing trial

Authority: watcher, lane G questions, **2026-11-07 14:52**:
> “Confirmed: piece 1 is choosing Connected by starting the existing 30-day trial
> through BillingStore.transition, using the existing trial eligibility and
> permission rules, with no renewal anchor, no provider call and no CSP change.
> Trim the plan to one page for that piece and build it.”

D570 keeps priority. [Billing design](../specs/2026-10-29-cloud-billing-design.md#4-trials)
applies. Synthetic test accounts/venues only; Node ≥26, pnpm 9.15.0; inline TDD.
Cards, tax, cancellation, closure, hosting, suppliers, reminders and live billing
remain open. No migration, new billing state, ledger, permission or trial rule.
Session discovery below repairs the reviewed chooser regression; no new config,
endpoint or payment-method work.

- [ ] **Store:** `packages/registration/src/billing-store.ts` adds
  `executeOn(client:PoolClient,scope:BillingScope,event:BillingEvent,command:BillingCommand):Promise<BillingReceipt>`
  and `transitionOn` for `PermissionCommand`. Share validation and private applyOn(client,…) logic, including enrol/internal-source
  checks. Existing wrappers validate before borrowing a connection. New On methods
  validate, then applyOn after a shared billing-transaction-guard.ts helper extracts
  trial-usage’s SAVEPOINT/RELEASE guard (25P01 maps to invalid_billing_input;
  rethrow others). Keep trial-usage’s SET TRANSACTION local; never run it in On
  methods. Preserve enrol semantics. Export readBillingVenue, readVenueHistory and effectiveVenueLevel;
  mayStartTrial already exists.

- [ ] **HTTP:** create `packages/account-http/src/billing-account.ts`; wire
  `app.ts`, `server.ts`, `config.ts` and `server-cli.ts`. Optional
  `billingAccount.accountIds` defaults off; retain synthetic-account allowlist
  because venue flags alone do not identify a synthetic account. Require existing
  `test-venue-levels` mode. Reuse consent’s origin/CSRF, bounded bodies, cookies,
  rate limits, verified credentials and owner-membership locks.
  In `app.ts`, successful `GET /session` and `POST /session/activity` replies add
  optional `billingTrialAvailable:true` only when the resolved current account is
  in configured `billingAccount.accountIds`; omit otherwise. Activity retains
  discovery so ordinary interaction cannot hide a configured chooser. This is
  display/discovery only: retain every endpoint permission, origin, CSRF, account,
  verified-credential, owner and test-environment guard.
  `POST /api/account/billing/read {}` returns
  `{venues:[{venueId,level,trial:TrialView|null,canStartTrial:boolean}]}`;
  `/start-trial {venueId}` returns that view. Derive organisation/business from
  owned venues, including multiple businesses and no installation.

- [ ] **Reads and writes:** read route is no writes in one ordinary transaction (not BEGIN READ ONLY): use billing venue,
  history, eligibility and effective-level helpers with the database’s UTC date.
  READ COMMITTED results may be slightly stale; start revalidates. Never call
  mutating readVenuePermissions or ensure_business from read.
  Read venue→organisation/business without locking. Inside existing transaction, lock
  account→session→credential→is_owner membership only; never pre-lock venue/business
  parents as consent does. executeOn(ensure_business) takes parent locks,
  then `transitionOn(start_trial,level:'connected')`; reuse the store’s venue
  binding/test checks. Generate a fresh random internal event key per command.
  Read `clock_timestamp()` immediately before transition; derive `on` and
  `occurredAt` from that same reading. Final session recheck covers expiry during
  waits; held locks serialize revocation/owner removal. Re-read the database UTC
  day before commit; if it differs from on, roll back and let the owner retry. Any refusal leaves the
  transaction and rolls everything back; refresh in a separate read transaction.
  Use identical touch:false/CSRF proof for the final resolveSession. Map scope-not-found
  to the same forbidden answer as non-owner; map IdentityError, BillingError and
  existing plain permission_denied. canStartTrial is exactly test-environment
  plus mayStartTrial, with no extra level/price gate.
  Never write anchor, connectedFrom, paid level/period, charge or payment method.

- [ ] **Portal:** create `apps/portal/src/billing-{types,controller,screen}.ts`;
  integrate `app.ts`, `screens.ts`, `api.ts`, `locale.ts` and shared controls.
  Propagate `billingTrialAvailable?:true` through `session.ts`’s Session type and
  API validation (absent or literal true only). `PortalApp.#sessionChanged` gives
  billing an account and initiates reads only for strict `===true`; otherwise
  clear the controller to fence late replies, including same-account capability
  loss. Existing billing browser fixtures advertise true; ordinary fixtures omit it.
  Show effective level, active trial and eligibility. Show last trial day as endsOn−1.
  Price display joins the later paid-plan/card piece; this first choice is free.
  Fence late account/venue/sign-out replies. No new Waitron location or CSP change.

- [ ] **Verify and finish:** TDD in registration `test/{billing-store,venue-service-permissions}.test.ts`,
  HTTP `test/billing-account.test.ts`, portal `test/{billing-browser,billing-account-fencing}.test.ts`
  and existing API/portal/config tests. Pin wrapper/replay/enrol parity, active
  transaction guard, real lock waits, rollback, revocation/expiry/owner/scope loss,
  concurrency, midnight crossings, trial/end eligibility, foreign/production/default-off
  refusal, no-installation reload, unchanged CSP and zero providers. Retain every
  assertion, including security and unrelated no-write checks. Add HTTP discovery tests for off,
  foreign and allowlisted accounts on both session replies, retaining route
  refusals; portal API/browser/fencing cases cover absent/false/malformed (no read),
  true (read), activity retention and same-account loss with a late reply.
  CI regression: driver reproduced one authenticator failure, actual
  `['/billing/read']`, expected `[]`; preserve
  `authenticator-setup-enter-browser.test.ts:135` and
  `usage-shared-countdown-browser.test.ts:75`. Failing tests first, then repair.
  Focused commands (repository root; database command on approved box):
  `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/billing-account.test.ts test/account-http.test.ts`;
  `pnpm --dir apps/portal exec node --test test/api.test.ts test/billing-browser.test.ts test/billing-account-fencing.test.ts test/authenticator-setup-enter-browser.test.ts test/usage-shared-countdown-browser.test.ts`.
  Run named registration tests via approved box’s `scripts/test-postgres.mjs`,
  build portal, inspect English/Spanish × light/dark ×390/1280, keyboard/axe/overflow,
  and typecheck; CI owns full suites. Update only own billing backlog lines and
  stale guides, including the design header’s citation to the approved Billing backlog heading. Claude reads this
  amendment before build; retain the existing whole-branch review, without another;
  inspect every current-head job. Cards get their own later plan.
