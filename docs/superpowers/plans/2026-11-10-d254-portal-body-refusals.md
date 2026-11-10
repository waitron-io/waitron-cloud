# D254: Portal request-body refusals

Lane G, plan only. The watcher reviews and clears this plan before implementation; no owner approval step.
Request: `~/waitron-campaign-g/queue.md`, D254, watcher 21:02 on 10 November:
> The passkey piece landed in #1122; extend the same 408/413/415 handling (packages/account-http/src/request.ts:3-21) to the account, security, alerts, backups, diagnostics, installations, recovery, remote access, translation consent and usage screens, EN/ES, through one shared helper if it removes repetition. Leave out billing (D604 parked), pairing (pairing v2 gated) and malformed JSON (a portal bug, not a person's). About 300–600 lines. One-page plan first.

Deliver EN/ES explanations of interruption (408), unaccepted size (413), or unsupported format (415), with an existing next action. Do not blame fields or promise waiting/resending repairs size/format refusals.

## Request boundary, from source reading

- `apps/portal/src/api.ts:50–60` sends POST only when supplied a body. `packages/account-http/src/request.ts:3–21` emits these statuses with `invalid_input`; 400 stays outside this change.
- Account: signup and password-reset request/completion (`app.ts:260–284`), password/factor login (`authenticator-controller.ts:39–58`), sign-out and activity (`session.ts:50–68`). Security: session revoke and authenticator begin/activate/remove/regenerate/cancel.
- Include JSON POSTs for alert save, backup list/pagination, diagnostic download, installation revoke, recovery inspect/approve/close/replace, remote status/DNS/apply, consent agree/withdraw and usage read (corresponding `*-controller.ts` request calls). Reads using POST qualify.
- Exclude GET `/session`, `/sessions`, `/authenticator`, `/installations`, `/alerts`, `/translation-consent` and passkey lists. Gate classification on the body-sending branch in mixed controllers.

## Exact production files and approach

- Create `apps/portal/src/body-refusal.ts`: `bodyRefusal(result: Extract<ApiResult<unknown>, {ok: false}>): 'Interrupted' | 'Size' | 'Format' | undefined`. Classify only `invalid_input` with 408/413/415; return undefined otherwise. No recovery, retry, state or message policy belongs here.
- Modify `apps/portal/src/app.ts`, `session.ts`, `screens.ts`, `locale.ts`, `authenticator-screen.ts` and these files under `apps/portal/src/`: `account-security-controller.ts`, `authenticator-controller.ts`, `alert-controller.ts`, `backup-controller.ts`, `diagnostic-controller.ts`, `installation-controller.ts`, `recovery-controller.ts`, `remote-controller.ts`, `translation-consent-controller.ts`, `usage-controller.ts`.
- Controllers select contextual locale keys and existing actions: account submission/sign-in, authenticator check, session reconciliation, snapshot/status refresh, download, alert save, consent choice and usage refresh. Extend the authenticator refresh condition to its three new keys (`authenticator-screen.ts:34`). Session-list refresh is unavailable after successful reconciliation (`account-security-screen.ts:18–19`); do not promise it.
- Keep `PortalSession.logout()` boolean and session states. Add an optional localized failure key: accept activity feedback only within sequence/generation guards, clear it on an accepted session check, and display it in the existing error summary while unavailable. `app.ts` uses the logout-specific key with existing focus/route guards.
- Preserve clearing, confirmations, cooldowns, reconciliation and list-confirmed success. Other codes retain their handling, including network/5xx uncertainty, credentials and permissions. Preserve alert confirmation invalidation independently of the changed display key (`alert-controller.ts:28–33`).
- Keep passkeys unchanged; reuse their boundary example (`passkey-controller.ts:78–87`, `test/passkey-refusal.test.ts`). Exclude backend/API changes, dependencies, billing, pairing, malformed JSON, new records/tables/protocols/ledgers, retry mechanisms and speculative branches.

## Build and focused verification after watcher clearance

- [ ] Append behavioral tests, observe expected failure, implement minimally, rerun. Keep every existing assertion.
- [ ] Helper: new `apps/portal/test/body-refusal.test.ts` tests causes and other status/code boundaries. Controllers: append to the ten `*-controller.test.ts` files below using existing injected requests/fixtures. Cover all body actions, GET exclusion, pending completion, no replay and retained recovery/state behavior.
- [ ] Session: extend `apps/portal/test/session-http-boundary.test.ts` using its document/clock/fetch fixture. Test activity/logout causes, unchanged states/boolean, clearing after passive checks, stale replies and retry delays.
- [ ] UI/account: create `apps/portal/test/body-refusal-browser.test.ts`; adapt esbuild/Playwright routing and synthetic data from `account-permission-guidance-browser.test.ts` and `signup-reset-acknowledgement-browser.test.ts`. No new support module/database fixture. Exercise actual submissions/panel actions, localized guidance, usable recovery, no false success/replay and logout focus. Native tests own exhaustive status/action combinations.
- [ ] Run from `apps/portal`: `node --test test/body-refusal.test.ts test/account-security-controller.test.ts test/authenticator-controller.test.ts test/alert-controller.test.ts test/backup-controller.test.ts test/diagnostic-controller.test.ts test/installation-controller.test.ts test/recovery-controller.test.ts test/remote-controller.test.ts test/translation-consent-controller.test.ts test/usage-controller.test.ts test/session-http-boundary.test.ts test/passkey-refusal.test.ts`.
- [ ] From `apps/portal`: `node --test test/body-refusal-browser.test.ts`; then root `pnpm typecheck`. Read test counts; CI owns full suites. Visually inspect all changed surfaces once per item across EN/ES, light/dark, 390/1280; do not repeat the grid per native case.
- [ ] Update D254 in `docs/backlog.md` and `docs/refusal-self-service-audit.md:138–141` with actual receipts; retain excluded open work. Complete normal lane branch review and PR steps.

Estimated added/removed lines: production **+180/−20**, behavioral tests **+240/−0**, inline browser setup/support **+40/−0**, documentation including this plan **+65/−5**; total **+525/−25**. No test-support framework. Budget three active hours to PR: 80 minutes implementation/native tests, 45 browser coverage, 15 visual/docs, 40 review fixes and PR.

This plan records source inspection only; no tests or browser checks have run. Watcher review and clearance are pending.
