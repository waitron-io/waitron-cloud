# D604 piece 1: start Connected’s existing trial

Authority: watcher, lane G questions, **2026-11-07 14:52**:
> “Confirmed: piece 1 is choosing Connected by starting the existing 30-day trial
> through BillingStore.transition, using the existing trial eligibility and
> permission rules, with no renewal anchor, no provider call and no CSP change.
> Trim the plan to one page for that piece and build it.”
> “D570's fix keeps priority at every pause.”

Scope: owned synthetic test venues only. Entire F, sandbox cards (piece 2),
providers, tax, cancellation, account closure, hosting, supplier and live work
remain open. No money, keys, migrations, new state, ledger, permission rules or
trial calculations. This replaces signed `944fadc6`’s unsafe unpaid anchor and
open-ended paid grant. Spec: [billing design](../specs/2026-10-29-cloud-billing-design.md#4-trials),
restricted by the authority above. Node ≥26; pnpm 9.15.0; implement inline.

- [ ] **Store.** In `packages/registration/src/billing-store.ts`, add
  `executeOn(client:PoolClient,scope:BillingScope,event:BillingEvent,command:BillingCommand):Promise<BillingReceipt>`
  and equivalent `transitionOn` accepting `PermissionCommand`. Both reuse one
  validated, locked apply path; retain transaction-owning `execute`/`transition`
  wrappers and the enrol flag semantics. Require an active transaction using the
  existing SAVEPOINT/RELEASE pattern; do not change `transaction.ts` or duplicate
  SQL invariants. Export `readBillingPrice`, `readBillingVenue`, `readVenueHistory`,
  `mayStartTrial`, `effectiveVenueLevel` through registration `src/index.ts`.

- [ ] **HTTP.** Create `packages/account-http/src/billing-account.ts`; wire
  `app.ts`/`server.ts` and optional `billingAccount:{accountIds:readonly string[]}`
  server configuration, absent/off by default. Require `test-venue-levels` mode
  and the synthetic-account allowlist. Follow `translation-consent.ts` for bounded
  bodies, cookies, origin, CSRF, account/IP limits and errors.
  `POST /api/account/billing/read {}` returns
  `{price:BillingPriceVersion,beforeVAT:true,venues:[{venueId,level,trial:TrialView|null,canStartTrial:boolean}]}`;
  `/start-trial {venueId}` returns the freshly read same view.
  List owned venues directly, including multiple businesses and no installation.
  Use existing `mayStartTrial`, history, effective-level and authority readers;
  preserve enrollment/service gates. Read effective configured prices, never guessed
  figures; missing prices return unavailable without writes.

- [ ] **Atomic authorization.** Inside existing `transaction`, resolve session
  (`touch:false`, CSRF), lock verified credentials and owner membership as consent
  does; derive organisation/business from the venue, never request identities.
  Use `executeOn(ensure_business)` for existing parent/business lock order, then
  lock/revalidate the venue’s full binding and test environment. Recheck session
  after waits; call `transitionOn(start_trial,level:'connected',on:serverUTCday)`.
  Preserve `billingDate`, `trialEnd`, UTC wall time and exclusive end semantics.
  Recheck session and owner/scope before returning; any refusal rolls back
  initialization, events, trial and authority. Never issue anchor or `set_venue`.
  Repeated/concurrent starts follow existing trial refusal; refresh actual state.

- [ ] **Portal.** Create `apps/portal/src/billing-{types,controller,screen}.ts`;
  integrate `app.ts`, `screens.ts`, `api.ts`, `locale.ts`, shared controls. Show
  actual active trial/end after reload, eligibility, configured monthly prices
  before VAT in English/Spanish; fence late account/venue/sign-out replies.
  No installation dependency or new Waitron location. Keep I1073 overlaps in
  `app.ts`/`index.ts` to distinct hunks under the owner’s 1-Nov queue rule;
  never mutate its checkout.

- [ ] **TDD and finish.** Observe expected failures before implementation, then
  focused passes. Extend registration `test/{billing-store,venue-service-permissions}.test.ts`;
  add HTTP `test/billing-account.test.ts`: real parent/venue/authority/installation
  lock waits, revocation/expiry,
  owner loss, changed venue binding, concurrent/retried requests, rollback,
  eligibility/end boundary, foreign/production/unverified/default-off refusal;
  store wrapper/replay parity and out-of-transaction rejection.
  Assert no stale success, anchor, paid-level/date/period,
  charge or payment-method write; preserve assertions and service gates.
  Add portal `test/{billing-browser,billing-account-fencing}.test.ts`; extend
  `api.test.ts` and HTTP `portal.test.ts`: malformed replies, CSRF/origin, reload,
  no-installation venues, unchanged CSP and zero provider calls.
  On the approved test box use `node scripts/test-postgres.mjs exec pnpm --dir
  packages/account-http exec node --test test/billing-account.test.ts`;
  repeat for named registration/portal files above; read counts. Build portal; inspect
  English/Spanish × light/dark × 390/1280 screenshots, keyboard, axe and overflow;
  run `pnpm typecheck`. No blanket suites. Update only own billing lines in
  `docs/backlog.md` and affected guides. During finish-branch obtain one final
  Claude execution review after initial rebase, using a disposable complete
  candidate checkout with dependencies; fix findings and inspect every current-head CI job.
