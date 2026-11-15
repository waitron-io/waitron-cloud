# Installation lock request drain
`~/waitron-campaign-g/queue.md` D580-DRAIN, watcher15November05:13; `docs/backlog.md` “Registration expiry checks during lock waits (D580)”.
“Drain the outstanding request on that failure path in a follow-up, retaining the lock limits and all authority assertions.”
Before build: Claude read, then watcher clearance explicitly including identical final-read cleanup; no owner approval claimed.
- [ ] In `packages/registration/test/installations.test.ts:171/179/219-221`, drain each assertion promise using `await Promise.allSettled([pending])`/`await Promise.allSettled([expired])` inside finally AFTER COMMIT and blocker.release; retain outside awaits. Cover freshness/session-expiry, setup0/600, and final-read.
Keep every assertion literal, robust t.after drains, production behavior, clocks, locking, bounds, helpers/fixtures unchanged.
- [ ] Before fixing, disposable-copy real-PostgreSQL probe: waitForLock observes actual lock then throws controlled observation timeout; delay wrapped real-request settlement against timing races. Outer copied-test wrapper catches only expected observation error; assert nothing pending BEFORE next reset.
Old cleanup fails → repaired passes → delete drain fails → restore passes. Commit no probe/harness/helper.
Reuse database/reset/fixtures via shared test-box/disposable helper, never direct MacDocker: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-name-pattern='request freshness|proof expiry' test/installations.test.ts`.
Finish: entire named file passes unchanged (omit pattern), counts checked; CI owns package suites.
Size: production0; cleanup+3/-3 or <15 changed; `docs/backlog.md` remove only completed D580 paragraph; this plan <15 lines. No redesign/framework/protocol/ledger.
