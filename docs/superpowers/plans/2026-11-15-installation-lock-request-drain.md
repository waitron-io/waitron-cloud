# Installation lock request drain
`~/waitron-campaign-g/queue.md`, D580-DRAIN, watcher 15 November 05:13; `docs/backlog.md`, “Registration expiry checks during lock waits (D580)”.
“Drain the outstanding request on that failure path in a follow-up, retaining the lock limits and all authority assertions.”
The watcher cleared the build, including final-read cleanup, on 15 November at 05:41 after Claude’s approach read. This is not owner approval.
- [ ] At `packages/registration/test/installations.test.ts:173/179/220`, drain the existing assertion promise with `await Promise.allSettled([pending])` or `[expired]` inside finally AFTER COMMIT and release. Keep outside awaits, every literal assertion, clocks, lock limits, existing helpers and other cleanup unchanged.
- [ ] TDD in a disposable copy beside the original test: observe the actual PostgreSQL lock, throw only a controlled observation timeout, delay real-request settlement briefly, catch only that timeout in the outer wrapper, then assert no request pending before reset. Probe cleanup drains tracked requests after recording the result, even when that assertion fails.
Observe old cleanup fail and repaired cleanup pass; the unchanged old copy also represents deleting the added drains. Delete probe copies; verify only intended files remain. Commit no harness/helper.
Use `~/waitron-campaign-shared/mac-docker-run.sh G <checkout> node scripts/test-postgres.mjs --dir packages/registration exec node --test --test-timeout=30000 --test-name-pattern='request freshness|proof expiry' test/installations.test.ts` (3 cases). The command passes the package’s existing 30-second limit; the green Mac run did not pass it and finished 15 cases in 14.4 s. The physical box failed 255 on DNS and the disposable helper returned capacity 75; watcher 06:17 cleared `mac-docker-run.sh`.
Finish with the entire named file (omit pattern): expect 15 passed, 0 failed/skipped; CI owns package suites.
Size: production 0; cleanup +3/−3, under 15 changed lines; delete only completed D580 backlog paragraph; a one-page plan. No new helper or framework.

Watcher 15 November 05:41: “drains after COMMIT and release in the two expiry-loop finally blocks and the final-read finally”; normal awaits and literal assertions stay. Watcher 06:17 cleared `mac-docker-run.sh` for green and full-file checks, without Docker start, restart or repair.
