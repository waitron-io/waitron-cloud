# D624: Review upstream identity changes

**Finish line:** Classify all 11 mapped Waitron commits after `b9440c685e440d37d5bc65a7feade840ceacf1c9`, port any demonstrated applicable security fix with a regression, then advance the reviewed marker to the fixed inventory target `0b7f37048f4bc5dff92b0b527d33c7767fbf49eb`. Keep original copy revisions. Source comparison is not runtime proof.

**Reuse and possible port:** Cloud already binds passkey kind, account and session (`registration/src/passkeys.ts:204–223`). Upstream `d4cb66280385` additionally refuses sessions last seen over 30 minutes ahead and challenges created over 60 seconds ahead. Cloud uses PostgreSQL time instead of the box's JavaScript clock; establish applicability before claiming a Cloud defect. Reuse existing PostgreSQL fixtures, `transaction`, `signIn` and `FixtureAdapter`.

1. Reproduce in `packages/registration/test/identity.test.ts` and `passkeys.test.ts` by setting persisted timestamps relative to database time, preserving the five-minute ceremony constraint. Existing forward-expiry tests remain. Test sessions clearly beyond and within 30 minutes ahead, and both passkey consumers clearly beyond and within 60 seconds ahead. Refusal precedes session touching and credential verification. An allowed value beside each boundary prevents refusing everything.
2. If reproduction establishes an applicable missing protection, watch its regression fail, minimally change `packages/identity/src/sessions.ts` and/or `packages/registration/src/passkeys.ts`, then watch it pass. Use their existing post-lock database time and generic errors. Add no clock framework, dependency or schema. Otherwise record the executed no-port evidence.
3. Before changing gates, trace `resolveSession`, `requirePlatformPermission`, `listAccountSessions` and `revokeAccountSession` callers and duplicate eligibility SQL in `sessions.ts`; inspect passkey verification/HTTP callers and `registration/src/history-cleanup.ts`. Preserve forward idle/absolute expiry, post-lock/passive reads, CSRF, suspension, account/session ownership, wrong-kind and single use. Keep existing assertions in place.
4. Extend the existing upstream-review table, one decision per commit with Cloud file/line or executed-test evidence:

| Commit | Classify against |
| --- | --- |
| `69fb3fdf0fd6` | Staff deletion comment/test; retain Cloud generic refusals. |
| `80563e1420e9` | Hash-prefix export for personal-data export; compare unchanged format. |
| `521292d7fb97` | Purpose/person binding; compare existing Cloud kind/session tests. |
| `d4cb66280385` | Backward-time checks; decide from steps 1–2. |
| `ccbec1f3c178` | Provider names instead of client labels; presentation follow-up. |
| `da87ffa7d846` | HMAC email-to-ID lookup for box handover; compare Cloud email login. |
| `cc8bab7db1ac` | Shared role-type imports; independent Cloud permissions. |
| `2aa12bf9689a` | Schema imports moved to `@waitron/db`; Cloud PostgreSQL adapters. |
| `eed41cc3c02b` | Waitron migration-test setup; Cloud migration history stays. |
| `fb497ef8ede8` | Expired anonymous-challenge cleanup; compare existing history cleanup. |
| `049ddd9db95f` | Fresh-proof test for backup/export; no new Cloud action-proof flow. |

5. After applicable ports and classifications pass, update `packages/identity/SOURCE.md`, `docs/identity-upstream-review.md`, `docs/backlog/identity-and-organisations.md` and the existing identity entry in `docs/backlog.md`.

**Checks:** Through the campaign test-box wrapper, run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/identity.test.ts test/passkeys.test.ts`. Those files own session and ceremony behavior. For the cleanup classification run only the existing `history-cleanup.test.ts` case `one run removes an expired WebAuthn ceremony before its ended session`. Run `node --test scripts/identity-upstream.test.mjs`; after marker advancement, rerun the inventory against the fixed target and expect zero unclassified commits. Typecheck code changes; CI owns full package suites.

**Size/exclusions:** Estimated production +12/−3, tests +80/−0, documentation +45/−7, plus this plan. No staff privacy workflow, export API, email-to-ID seam, local-box handover, public passkey-check ceremony or identity architecture. Driver checks/signs this plan; one Claude read and watcher clearance precede building.
