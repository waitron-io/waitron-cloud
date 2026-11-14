# A670: guest-menu content-language tags

Watcher request, `/Users/clintongormley/waitron-campaign-g/questions.md`, 2026-11-14 06:21:
“Small fix, top of your queue: accept Waitron's canonical content-language tags (BCP 47 as Waitron stores them) within the existing 2 MiB body bound, keeping default and explicit choice and refusing malformed tags. One test each for ca-ES-valencia and fr. No new action, version or table. Tell lane D in its questions.md when it lands.”

1. **Smallest fix.** In `packages/remote-access/src/guest-menu.ts`, replace the four-language list with a small reusable validator using native `Intl.Locale`, as Waitron's read-only `packages/shared/src/content-languages.ts` does. Validate body `defaultLanguage` and every `pages` key; reuse the validator for `lang` in `packages/account-http/src/guest-menu-server.ts`. Accept canonical stored tags, including `ca-ES-valencia` and `fr`, without normalising or relabelling keys. Keep exact-key selection and absent-translation fallback. Preserve the exact 2,097,152-byte body bound and all signing, authority, host, duplicate-query, rate and takedown checks.

2. **TDD, inline after Claude review and watcher clearance.** In `packages/remote-access/test/guest-menu.test.ts` and `packages/account-http/test/guest-menu-server.test.ts`, add cases for Valencian default with optional French/explicit choice, and French default with explicit choice. Assert exact stored/read HTML and language, HTTP HTML and `Content-Language`, and absent-translation fallback. Watch these fail on the lists before implementing, then pass. Deliberately replace existing invalid-`fr` body cases and invalid-`xx` query case with malformed tags such as `fr_XX`; retain malformed-default/key/query refusal. No security assertion changes. Keep exact-limit acceptance and over-limit refusal assertions unchanged.

   Run each named file against real throwaway PostgreSQL, for `remote-access` then `account-http`:
   `node scripts/test-postgres.mjs exec pnpm --dir packages/<package> exec node --test test/<named-file>.test.ts`
   (`guest-menu`, then `guest-menu-server`); run `pnpm typecheck`. CI owns full suites.

3. **Close the prose gap.** Update the hosted-menu sections in `docs/waitron-integration-contract.md`, `docs/backlog.md`, `docs/backlog/guest-menu.md`, and existing `docs/superpowers/plans/2026-11-14-a670-cloud-guest-menu.md`: replace stale four-language restrictions; record local evidence and remaining sender/public-access work. After landing, notify Lane D in its `questions.md`.

Expected change: production ~10–25 added/5 removed lines; tests ~30–50 added/5 removed; support zero. No new runtime dependency, table, action, version or protocol; no UI rendering change or public deployment.
