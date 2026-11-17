# D112-S: configured-country signup

Proposed by Codex, the separate Lane G plan author; awaiting Claude review and watcher clearance, not owner approval. Source inspection only; no tests run.
Ask (`~/waitron-campaign-g/queue.md`, D112-S remaining PR 1): “Spain serves Spain only: the site knows its country from configuration and sign-up refuses another country, with the owner's wording; about 30–60 lines plus tests.”
Direction: `docs/superpowers/plans/2026-10-22-cloud-global-country-split.md`; `docs/backlog.md`, D112-S.

**Finish line:** on Spain's site, select France and see “Waitron Cloud isn't available in France yet”, or “Waitron Cloud todavía no está disponible en Francia”. Select Spain and complete signup with the same email link.
**Reuse:** `packages/registration/src/signup.ts:44` owns business creation; preserve account-only `completeForTransfer` and all token/password/ownership/security checks.
Runtime: `packages/account-http/src/server-cli.ts:42,68` → `src/server.ts:29` → `src/app.ts:101,132`. Extend this configuration flow; no new startup path.
Readers: account HTTP `src/request.ts` checks strict string bodies; `src/app.ts:91` maps errors; `apps/portal/src/api.ts:86` admits error codes. Preserve request schemas and unknown-error rejection.
Reuse portal `pairing-screen.ts:23`'s native select, existing styles, fields, translations and focused error summary. The installed UI package exports no country control/catalogue; use the `Intl.DisplayNames` region idiom in `packages/translation/src/job-body.ts:9,15`, without importing that backend package.

**Production edits (only):** `packages/registration/src/signup.ts`; `packages/account-http/src/config.ts`, `packages/account-http/src/app.ts`; `apps/portal/src/app.ts`, `apps/portal/src/screens.ts`, `apps/portal/src/api.ts`, `apps/portal/src/locale.ts`; `.env.example`.
**Tests:** extend `packages/registration/test/signup.test.ts`, `packages/account-http/test/account-http.test.ts`, `packages/account-http/test/server.test.ts`; add `apps/portal/test/signup-country-browser.test.ts`. Reuse their helpers, CLI launcher and `apps/portal/test/fixtures.ts`.
**Docs:** `packages/registration/README.md`, `packages/account-http/README.md`, `docs/cloud-signup-implementation.md`, `docs/account-http-design.md`, `docs/backlog.md`: document country/config/error; remove stale signup claims and completed D112-S signup work, retaining console work.

- [ ] **Store red:** one PostgreSQL case: valid token + FR + remember-browser raises `country_unavailable`; account/credential/organisation/business/membership/recognised-browser rows remain absent, request/outbox rows unchanged. Retry the token with lowercase `es` successfully. Keep existing detailed Spain-success assertions.
- [ ] Run the store command below; observe the refusal assertion fail.
- [ ] **Store green:** optional fourth constructor argument `countryCode = 'ES'`, preserving screening. After existing syntax validation/uppercasing, compare country and raise the new `SignupError` code before `#complete`. Rerun store checks.
- [ ] **HTTP red:** assert exactly HTTP 400 `{"error":"country_unavailable"}`, protected headers and no cookies for foreign signup. Database invariants belong only to store tests.
- [ ] **CLI red:** prove unset country defaults ES and explicit FR configuration refuses ES signup. Add unknown `ZZ` and malformed `Spain` to the existing invalid-settings table; no separate failure suite.
- [ ] Run the HTTP command; observe configuration/response failures.
- [ ] **HTTP green:** optional `AccountHttpConfig.countryCode`; read `CLOUD_COUNTRY_CODE` in `accountHttpConfig`. In `validateConfig`, default omission to ES, require uppercase recognized two-letter regions excluding ZZ, and retain the value in frozen output. Pass it to SignupStore; map its new error to the response above. Rerun HTTP checks.
- [ ] **Browser red:** reuse the real portal fixture; EN/ES × light/dark × 390/1280. Select FR, assert actual submitted `countryCode: 'FR'` and exact localized refusal/focus; select ES, assert submitted ES and success. Keep database checks at the store.
- [ ] Run the browser command; observe missing-selector/message failure.
- [ ] **Browser green:** initialize/reset `fields.countryCode` to ES. Replace the fixed Spain paragraph with a labelled native select; enumerate AA–ZZ, keep regions named by `Intl.DisplayNames` (`fallback: 'none'`, excluding ZZ), sort localized labels. These options declare business country, not service availability.
- [ ] Preserve other fields on change, clear refusal, disable while pending, and submit selection. Admit the new error only for HTTP 400 on `/signup/complete` in `api.ts`.
- [ ] Add EN `Waitron Cloud isn't available in {country} yet` and ES `Waitron Cloud todavía no está disponible en {country}`. Render the submitted country's localized name as escaped text; language switching retains country and translates refusal. Rerun browser checks.
- [ ] Update named docs and `.env.example` (`CLOUD_COUNTRY_CODE=ES`); visually inspect all eight combinations, keyboard/focus/overflow. Preserve existing checks; list changed checks in the PR. CI owns full package suites.

**Focused commands (implementation stage only; run from this worktree, Node ≥26/pnpm 9.15.0):**
`node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/signup.test.ts`
`node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-name-pattern='country|CLI fails closed with fixed diagnostics' test/account-http.test.ts test/server.test.ts`
`pnpm --dir apps/portal build`
`node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/signup-country-browser.test.ts test/signup-reset-acknowledgement-browser.test.ts`
`pnpm typecheck`; `node --test scripts/ci-docs.test.mjs`. Read counts; use Lane G's approved container-test host route.

**Estimated added / removed:** production/config +45–60 / −8–12; tests +130–170 / −0; test support +0 / −0; implementation docs +18–28 / −8–12; this plan separately +39 / −0. Localized selection/error wiring accounts for the production upper end.
**Omitted:** console, owner recovery, handover changes, country services/future-country abstractions, helpers/frameworks/dependencies/migrations, config endpoint, infrastructure/provider actions, AWS/spend/deploy and real mail.
