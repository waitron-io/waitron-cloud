# Owner handover authenticator fixture

**Outcome:** the first-time recipient completes enrolment, sign-in, app action proof and explicit acceptance across request rollover, retaining every assertion, timeout and eight language/theme/width combinations. Source: `~/waitron-campaign-k/queue.md`, CLOUD-OWNER-HANDOVER-TOTP-WAIT. Review and execution belong to the lane driver.

**Evidence/reuse:** `~/waitron-campaign-k/receipts/remote-name-records/handover-observer.mjs` and `handover-rollover-causal-control.log` record a 2,479 ms activation hold, HTTP 403 and the `.factor-codes` timeout. The fixture at `apps/portal/test/owner-transfer-browser.test.ts:119–122` uses -1/0/+1 codes. `packages/registration/src/password-login.ts:28–63` shares database time and replay records across activation, sign-in and action proof; `packages/identity/src/authenticator-crypto.ts:29` accepts adjacent periods. Changing only the first offset risks the next submission.

1. **Red before editing the fixture.** Use the historical observer with Playwright resolved from the checkout root. Build with `pnpm --dir apps/portal build`, then run from that root:

   `K_HANDOVER_ROLLOVER=1 node scripts/test-postgres.mjs exec node --import /tmp/handover-observer.mjs --test --test-timeout=120000 --test-name-pattern='first-time recipients' apps/portal/test/owner-transfer-browser.test.ts`

   Require boundary crossing, activation 403 and the original wait failure; keep evidence outside Git.

2. **Fixture-only fix.** In `apps/portal/test/owner-transfer-browser.test.ts`, borrow the connected-client proxy pattern from `packages/registration/test/fixtures/database-clock.ts`. Capture database time before each recipient's enrolment; hold it through all three submissions. Locally wrap this fixture's pool connections: recognise that recipient's factor-row lock, reset state each transaction, and replace only `SELECT clock_timestamp() AS now` results after executing the real query. Explicitly pass through the same clock read following the session-row read (`packages/identity/src/sessions.ts:97–102`). Other accounts/transactions, inline SQL clocks, browser/Node time and timers stay real. Disarm after action proof; restore in cleanup.

   Add optional third argument `nowMs=Date.now()` to `actionTestTotp` in `packages/registration/test/fixtures/action-proof.ts`; generate -1/0/+1 from the captured instant. Keep real HTTP, encryption, permissions, verifier and replay writes; seed no authority or replay changes.

   **Trade-off:** query-shape coupling buys narrow clock control without product changes. Driver: trace affected reads and probe that session clocks and unrelated transactions stay real; the existing broad helper would freeze session expiry too. This journey stops testing elapsed factor time; unchanged expiry/rollover tests cover it.

3. **Green/checks.** Repeat the identical probe: require activation success and all eight completed combinations. Also probe rollover holds at sign-in and action proof; inspect distinct consumed steps without secrets. Without observer/filter, run portal `test/owner-transfer-browser.test.ts` and `test/authenticator-rollover.test.ts` through the wrapper above. Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/authenticator-factor.test.ts test/password-login.test.ts test/account-action-proof.test.ts test/owner-transfer.test.ts`, then `pnpm typecheck`. Read counts; retain permission/replay/expiry assertions. No permanent self-mutation test.

4. Update “Owner handover enrolment wait” in `docs/backlog/portal-panel-waits.md` and its `docs/backlog.md` index paragraph with red/green receipts and #1321 run 44530811170. Describe the reproduced fixture issue's status; the exact historical CI cause stays unverified.

**Size:** about 0 product lines, 45–75 test/support lines, 20–35 backlog docs lines plus this plan. Exclude production changes, general clock machinery, retries, longer waits, changed assertions, deployment and campaign state.
