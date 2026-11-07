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

- [ ] **Store:** `packages/registration/src/billing-store.ts` adds
  `executeOn(client:PoolClient,scope:BillingScope,event:BillingEvent,command:BillingCommand):Promise<BillingReceipt>`
  and `transitionOn` for `PermissionCommand`. Share validation and private applyOn(client,…) logic, including enrol/internal-source
  checks. Existing wrappers validate before borrowing a connection. New On methods
  validate, run billing-trial-usage.ts’s SAVEPOINT/RELEASE guard (25P01 maps to
  invalid_billing_input; rethrow others), then applyOn. Preserve enrol semantics.
  Export readBillingPrice, readBillingVenue, readVenueHistory and effectiveVenueLevel;
  mayStartTrial already exists.

- [ ] **HTTP:** create `packages/account-http/src/billing-account.ts`; wire
  `app.ts`, `server.ts`, `config.ts` and `server-cli.ts`. Optional
  `billingAccount.accountIds` defaults off; retain synthetic-account allowlist
  because venue flags alone do not identify a synthetic account. Require existing
  `test-venue-levels` mode. Reuse consent’s origin/CSRF, bounded bodies, cookies,
  rate limits, verified credentials and owner-membership locks.
  `POST /api/account/billing/read {}` returns
  `{price:BillingPriceVersion|null,venues:[{venueId,level,trial:TrialView|null,canStartTrial:boolean}]}`;
  `/start-trial {venueId}` returns that view. Derive organisation/business from
  owned venues, including multiple businesses and no installation.

- [ ] **Reads and writes:** read route is no writes in one ordinary transaction (not BEGIN READ ONLY): use billing venue,
  history, eligibility and effective-level helpers with the database’s UTC date;
  never call mutating `readVenuePermissions` or `ensure_business`. Missing prices
  make only price display unavailable; they never block a free trial.
  Read venue→organisation/business without locking. Inside existing transaction, lock
  account→session→credential→is_owner membership only; never pre-lock venue/business
  parents as consent does. executeOn(ensure_business) takes parent locks,
  then `transitionOn(start_trial,level:'connected')`; reuse the store’s venue
  binding/test checks. Generate a fresh random internal event key per command.
  Read `clock_timestamp()` immediately before transition; derive `on` and
  `occurredAt` from that same reading. Final session recheck covers expiry during
  waits; held locks serialize revocation/owner removal. Any refusal leaves the
  transaction and rolls everything back; refresh in a separate read transaction.
  Use identical touch:false/CSRF proof for the final resolveSession. Map scope-not-found
  to the same forbidden answer as non-owner; map IdentityError, BillingError and
  existing plain permission_denied. canStartTrial is exactly test-environment
  plus mayStartTrial, with no extra level/price gate.
  Never write anchor, connectedFrom, paid level/period, charge or payment method.

- [ ] **Portal:** create `apps/portal/src/billing-{types,controller,screen}.ts`;
  integrate `app.ts`, `screens.ts`, `api.ts`, `locale.ts` and shared controls.
  Show actual effective level, active trial, eligibility and configured monthly
  prices before VAT, with no guessed figures. Show last trial day as endsOn−1.
  Fence late account/venue/sign-out replies. No new Waitron location or CSP change.

- [ ] **Verify and finish:** TDD in registration `test/{billing-store,venue-service-permissions}.test.ts`,
  HTTP `test/billing-account.test.ts`, portal `test/{billing-browser,billing-account-fencing}.test.ts`
  and existing API/portal/config tests. Pin wrapper/replay/enrol parity, active
  transaction guard, real lock waits, rollback, revocation/expiry/owner/scope loss,
  concurrency, trial/end eligibility, missing prices, foreign/production/default-off
  refusal, no-installation reload, unchanged CSP and zero providers. Retain every
  assertion. Run named database tests via approved box’s `scripts/test-postgres.mjs`,
  build portal, inspect English/Spanish × light/dark ×390/1280, keyboard/axe/overflow,
  and typecheck; CI owns full suites. Update only own billing backlog lines and
  stale guides, including the design header’s approval citation to docs/backlog.md:733. Claude reads this
  plan before build and executes one whole-branch review before finish/land;
  inspect every current-head job. Cards get their own later plan.
