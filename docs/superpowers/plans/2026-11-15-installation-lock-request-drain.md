# Installation lock request drain
`~/waitron-campaign-g/queue.md`, D580-DRAIN, watcher 15 November 05:13; `docs/backlog.md`, “Registration expiry checks during lock waits (D580)”.
“Drain the outstanding request on that failure path in a follow-up, retaining the lock limits and all authority assertions.”
Build still waits for watcher clearance, including identical final-read cleanup. Claude has read this approach; no clearance or owner design approval is claimed.
- [ ] At `packages/registration/test/installations.test.ts:173/179/220`, drain the existing assertion promise with `await Promise.allSettled([pending])` or `[expired]` inside finally AFTER COMMIT and release. Keep outside awaits, every literal assertion, clocks, lock limits, existing helpers and other cleanup unchanged.
- [ ] TDD in a disposable copy beside the original test: observe the actual PostgreSQL lock, throw only a controlled observation timeout, delay real-request settlement briefly, catch only that timeout in the outer wrapper, then assert no request pending before reset. Probe cleanup drains tracked requests after recording the result, even when that assertion fails.
Observe old cleanup fail and repaired cleanup pass; the unchanged old copy also represents deleting the added drains. Delete probe copies; verify only intended files remain. Commit no harness/helper.
Use `~/waitron-campaign-shared/disposable-test-run.sh G <checkout> node scripts/test-postgres.mjs --dir packages/registration exec node --test --test-name-pattern='request freshness|proof expiry' test/installations.test.ts` (3 cases). Original box helper failed 255 on DNS; no direct Mac Docker fallback.
Finish with the entire named file (omit pattern): expect 15 passed, 0 failed/skipped; CI owns package suites.
Size: production 0; cleanup +3/−3, under 15 changed lines; delete only completed D580 backlog paragraph; plan about 15 lines. No new helper or framework.
