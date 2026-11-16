# RELAY-EXTRA-ADMISSION — investigation plan

Watcher assignment: `laneGqueue.md`, 16 November 2026, 16:57; historical failure: CI run `40484554632`, account HTTP shard 3.
Status: plan only; Claude must read it and the watcher must clear it before implementation. No owner plan approval is claimed.
Finish line: either reproduce and narrowly fix a third admission, or demonstrate current serialization with a failing disposable lock-removal control; update the existing backlog with commands and limits.

1. Against current main, run the existing HTTP case once through real PostgreSQL, retaining its complete output and revision. Use the authorised test box, or the Mac fallback permitted by the lane Rules; do not retry for a failure.
   `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-name-pattern='^account contention across installations admits only the explicit fixture allowance$' test/relay-messages.test.ts`
2. Trace admission before choosing a fix: `packages/registration/src/relay-grants.ts:146` takes the account transaction lock before policy/count/insert; `packages/registration/src/relay-messages.ts:31–45` wraps each submission in a transaction.
   Read migration `048_billing_allowances_traffic.sql` and the optional monthly-debit path alongside the legacy policy; distinguish them rather than enabling new billing behaviour in the HTTP fixture.
3. Reuse `relayFixture` in `packages/account-http/test/fixtures/relay.ts` and the schema/query/blocker-specific PostgreSQL waiter pattern in `packages/registration/test/installations.test.ts:86–99`; no fake store or new lock framework.
   Control six submissions from two installations on one account with allowance 2. Observe actual backend waiters and their blocker chain before releasing transactions; release holders and collect pending requests even on failure.
   Investigate the fixture's 3600-second policy (`fixtures/relay.ts:13`) crossing an hour by recording database admission times and reservation periods; this is a hypothesis, not a diagnosis. Do not change its allowance or expected results.
4. Grant-store tests own account serialization: add `controlled account contention admits only two reservations` in `packages/registration/test/relay-grants.test.ts`; retain existing three-unit and foreign-account assertions unchanged.
   HTTP tests own returned responses and no extra charge: strengthen the existing named case in `packages/account-http/test/relay-messages.test.ts`, retaining `[202,202,429,429,429,429]`, foreign-account 202 and reservation count 2, plus every ownership check.
5. If controlled ordering demonstrates extra admission, first watch the regression fail for that cause, then change only the responsible production code and rerun it to pass. No production fix is selected by this plan.
   If no current extra admission appears, demonstrate the actual waiter chain and remove the relevant lock only in a disposable copy; require a third admission under controlled ordering, then restore and pass. Record this control in the PR; commit no mutation harness.
   Account for policy/table insertion locks that may also serialize requests; do not claim advisory-lock removal alone must reproduce it. If the control needs wider scope or an unspecified changed test check, stop for the watcher.
6. Run the strengthened HTTP case with command 1 and the focused store check below; inspect executed test counts. Use existing `billing-allowance-relay.test.ts` checks only if the demonstrated cause reaches monthly debits; CI owns full package suites.
   `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-name-pattern='^controlled account contention admits only two reservations$' test/relay-grants.test.ts`
   If monthly debits are touched: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/billing-allowance-relay.test.ts`
7. Update `docs/backlog/relay-contention-extra-admission.md` and its “CI execution budget” reference in `docs/backlog.md` with the demonstrated cause or lock/control evidence; leave historical CI timing unattributed unless proved.
   Finish through the concurrency full-review path: two Claude run-it reviews, a fresh Claude read of fixes, and every selected current-head CI job. Report readiness for `finish-branch` when implementation validation is complete.

Likely changes: the two test files above, the two backlog files, and `packages/registration/src/relay-grants.ts` only if the reproduced cause requires it; revisit the watcher for a wider departure.
Expected size: production 0–50 lines; tests 100–300; evidence/backlog 20–50. Prefer the smallest sufficient proof; the ask's 150–500 total changed lines is a sizing range, not a minimum to fill.
Excluded: schema changes, allowance/response/ownership changes, unrelated relay tests, new release steps or protocols, other billing behaviour and billing pages (D604). No deployed-service claim follows from local evidence.
