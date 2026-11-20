# Cloud identity source review and guest language limit

Review all 17 mapped Waitron commits through `60dcf75a5132af8878d8a88aee36d78deb125c54`. Record which security changes Cloud already covers and which apply only to Waitron. The source comparison found no identity code to port. In the same pull request, make the guest menu use the first 32 comma-separated language entries, as Waitron #3701 does. Claude reviews this plan before the watcher clears the build.

## Update the source review

- [ ] Add a dated table with one decision per commit to `docs/identity-upstream-review.md`. Use the mapped source and test diffs from `node scripts/identity-upstream.mjs ~/workspace/repos/waitron <revision>`. Cite Cloud's corresponding source and distinguish inspections from tests you run.
- [ ] Keep Cloud's PostgreSQL identity and its existing tests. Pay particular attention to async scrypt (#3216), session ownership (#3554), passkey challenge scope and expiry (#3573), the pending email request (#3586), normalised email uniqueness (#3603) and purpose-bound authenticator encryption (#3618). Security-change mail (#3476) and sign-in history (#3586) are upstream features outside this port. If evidence identifies an applicable fix, bring its smallest code and test change back to the watcher.
- [ ] Advance the marker in the dated review and `packages/identity/SOURCE.md` only after the table is complete. Keep the original copy pins and mappings. Run the report again at the fixed revision and check that the commits array is empty. Run `node --test scripts/identity-upstream.test.mjs` and the existing `packages/identity/test/secret-hash.test.ts` and `packages/identity/test/authenticator-crypto.test.ts` files. Bring `docs/backlog/identity-and-organisations.md` up to date.

## Cap guest language preferences

- [ ] Add focused cases to `packages/account-http/test/guest-menu-preferences.test.ts`. Check that a malformed entry counts, entry 32 is considered and entry 33 is ignored. Check that repeated ranges count towards 32. Check that a case-insensitive duplicate retains its highest weight and that entry's position, keeping the earliest position at equal weight. Run this file with `node --test` and observe the new assertions fail before changing the parser.
- [ ] In `packages/account-http/src/guest-menu-preferences.ts`, bound the initial split to 32 entries, keep one strongest entry per lowercase range and retain the existing weight and position sort. Keep the current grammar and exclusion of wildcard and zero-weight preferences. Re-run the same file and preserve its existing checks. Run the existing “HTTPS follows phone preferences unless lang is explicit” case in `packages/account-http/test/guest-menu-server.test.ts` through disposable PostgreSQL, and remove the completed cap sentence from `docs/backlog/guest-menu.md`.

Expect 15–25 changed code lines, 25–45 added test lines and 45–65 changed documentation lines including the plan. The root backlog already links to both detailed entries and has no stale cap or review date. Use the full branch review path the queue calls for, then verify every current-head CI job before landing.
