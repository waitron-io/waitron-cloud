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
  validate, then applyOn after a shared billing-transaction-guard.ts helper extracts
  trial-usage’s SAVEPOINT/RELEASE guard (25P01 maps to invalid_billing_input;
  rethrow others). Keep trial-usage’s SET TRANSACTION local; never run it in On
  methods. Preserve enrol semantics. Export readBillingVenue, readVenueHistory and effectiveVenueLevel;
  mayStartTrial already exists.

- [ ] **HTTP:** create `packages/account-http/src/billing-account.ts`; wire
  `app.ts`, `server.ts`, `config.ts` and `server-cli.ts`. Optional
  `billingAccount.accountIds` defaults off; retain synthetic-account allowlist
  because venue flags cannot identify synthetic accounts. Require
  `test-venue-levels`; reuse consent’s origin/CSRF, bounded bodies, cookies,
  rate limits, verified credentials and owner-membership locks.
  `app.ts` adds `billingTrialAvailable:true` to successful `/session` and
  `/session/activity` replies only for configured allowlisted accounts; omit
  otherwise, using validated `billingAccount`. Discovery grants no authority; retain every guard.
  `POST /api/account/billing/read {}` returns
  `{venues:[{venueId,level,trial:TrialView|null,canStartTrial:boolean}]}`;
  `/start-trial {venueId}` returns that view. Derive organisation/business from
  owned venues, including multiple businesses and no installation.

- [ ] **Reads and writes:** ordinary READ COMMITTED transaction; read billing
  venue/history/eligibility/effective-level helpers with database UTC date. No writes,
  `readVenuePermissions` or `ensure_business` in reads; start revalidates stale reads.
  Resolve venue→organisation/business unlocked; lock account→session→credential→owner
  membership, never venue/business parents first. `executeOn(ensure_business)` takes
  parent locks, then `transitionOn(start_trial,level:'connected')` reuses binding/test
  checks. Each command gets a fresh internal event key. Read `clock_timestamp()`
  immediately before transition; derive `on`/`occurredAt` together. Recheck session
  with identical touch:false/CSRF proof; held locks serialize revocation/owner removal.
  Before commit re-read UTC day; if changed, roll back and offer retry. Every refusal
  rolls back; refresh separately. Map scope-not-found like non-owner; map IdentityError,
  BillingError and plain permission_denied. Eligibility is test-environment plus
  mayStartTrial, without price/level gates. Never write anchor, connectedFrom, paid
  level/period, charge or payment method.

- [ ] **Portal:** create `apps/portal/src/billing-{types,controller,screen}.ts`;
  integrate `app.ts`, `screens.ts`, `api.ts`, `locale.ts` and shared controls.
  `session.ts` carries `billingTrialAvailable?:true`; API validation accepts
  absent or literal true, rejects false/malformed replies as session unavailable.
  `#sessionChanged` gives billing an account and reads only for strict true;
  otherwise clear its controller, fencing same-account capability loss too.
  Show effective level, trial, eligibility and last trial day (endsOn−1).
  This choice is free; prices join later paid-plan/card work.
  Fence late account/venue/sign-out replies. No new Waitron location or CSP change.

- [ ] **Verify and finish:** retain every unrelated/security assertion and prior
  store, locking, transaction, expiry, midnight, trial and production-refusal tests.
  Add real-PostgreSQL discovery cases in HTTP `test/billing-account.test.ts`: both
  session replies omit the hint when off/foreign and include true when allowlisted;
  every billing route refusal remains. In portal `test/api.test.ts`, reject false
  and malformed hints. In `test/billing-browser.test.ts`, configured fixtures add
  true; retain 403/503 panel-absence assertions with flagged sessions, because
  discovery grants no authority. Add separate ordinary-account zero-read cases
  after installations settle, including ordinary activity. In `billing-browser.test.ts`,
  cover activity retention, same-account loss during a delayed read, and one new
  read when the hint returns. Keep existing
  `authenticator-setup-enter-browser.test.ts:135` and
  `usage-shared-countdown-browser.test.ts:75` unchanged; both prohibit unrelated
  requests.
  TDD: run named API tests through approved box's `scripts/test-postgres.mjs`;
  run portal `api.test.ts`, `billing-browser.test.ts`, `billing-account-fencing.test.ts`
  and those two regressions explicitly. Check types/build and inspect English/Spanish,
  light/dark, 390/1280, keyboard/axe/overflow. CI owns full suites. Update only own
  billing backlog lines; README explains true-or-absent validation and removing
  this temporary hint with the synthetic allowlist, not extending the pattern. Correct
  the controller comment to cover refused flagged accounts. Claude reads this
  amendment before build; retain the completed whole-branch review. Inspect every
  current-head CI job before authorised finish/land. Cards get their own plan.
