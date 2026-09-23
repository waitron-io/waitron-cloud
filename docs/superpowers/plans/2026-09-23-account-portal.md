# Cloud Account Portal Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan
> inline, task by task. Use one Claude whole-branch review during finish-branch.

Status: proposed for implementation review, 2026-09-23.

**Goal:** You can create a Cloud account, sign in and recover access in English or
Spanish without a working venue server.

**Architecture:** Add a Lit application in `apps/portal`, built with esbuild and
served by the existing account server on the API origin. Extend the encrypted email
payload with an optional language. Keep browser routing, account requests, session
state and rendering separate; retain the API-only server mode.

**Tech Stack:** Node 24, pnpm 9.15.0, TypeScript, Lit 3.3.3, esbuild 0.28.2,
`@waitron-io/ui-core@0.1.0`, Hono, PostgreSQL, Playwright 1.63.0 and Mailpit.

**Spec:** [Approved account portal design](../specs/2026-09-23-account-portal-design.md).

## Global constraints

- English and Spanish, browser-language selection and a visible language switch.
- One business name normally supplies both the legal business and organisation name;
  allow a different organisation name behind a disclosure. Show Spain, submit `ES`.
- New passwords require at least 15 Unicode code points and at most 1024 UTF-8 bytes.
  Do not impose the new-password minimum at login.
- Store only the language preference in browser storage. Keep tokens in memory,
  remove them from the address bar before rendering or account requests, and never
  submit them automatically. Accept existing query-token links.
- Preserve account transactions, single-use tokens, generic email-request responses,
  cookies, CSRF, host checks and rate limits. No database migration is needed.
- Static traffic must not spend account-operation counters or admission slots.
- No automatic write retries, automatic login after completion or silent account switch.
- The account page is the endpoint of this slice. Pairing, services, billing, platform
  administration and public deployment remain separate backlog work.
- Use TDD, signed-off commits and focused local checks. CI runs the full suite.
  Finish and land automatically under the owner's standing authorization.

## Review focus

1. A successful transaction whose reply is lost must offer recovery without claiming
   rollback or repeating the write: task 3 failure tests and task 4 browser tests.
2. A link opened while another account is signed in must remain usable without changing
   that session: task 3 routing tests and task 4 two-account journey.
3. Old queued emails, old links and blocked browser storage must keep working:
   task 1 payload tests and task 3 link/language tests.
4. Concurrent session responses must not restore stale authenticated state after
   logout, expiry or a newer login: task 3 controlled response-order tests.
5. Page loads during eight admitted account operations must still work without weakening
   account limits: task 2 real HTTP concurrency and counter tests.

## Files and responsibilities

| Files | Responsibility |
| --- | --- |
| `packages/registration/src/account-input.ts`, `signup.ts`, `password-recovery.ts` | Optional locale contract and transactional propagation |
| `packages/registration/src/email-outbox.ts`, `account-mail.ts`, `local-mailer.ts`, `smtp-mailer.ts` | Encrypted locale, compatible decoding, translated mail and fragment links |
| `packages/account-http/src/request.ts`, `app.ts` | Optional allowed fields, route validation and locale forwarding |
| New `packages/account-http/src/portal.ts`; existing `server.ts`, `server-cli.ts` | Explicit static asset loading, document routes and optional CLI configuration |
| New `apps/portal/package.json`, `tsconfig.json`, `build.mjs`, `src/index.html`, `src/styles.css` | Browser package, build and responsive shell |
| New `apps/portal/src/locale.ts`, `links.ts`, `api.ts`, `session.ts` | Language, secret capture, HTTP boundary and session lifecycle |
| New `apps/portal/src/main.ts`, `app.ts`, `screens.ts` | Bootstrap, route/form state and shared-control rendering |
| New `apps/portal/test/*.test.ts`, `test/fixtures.ts` | Pure state tests, controlled browser failures and real account journeys |
| Root `package.json`, `pnpm-lock.yaml`, `.env.example`, `.github/workflows/ci.yml`, `README.md` | Build/serve commands, dependency lock and CI integration |
| `packages/account-http/README.md`, `docs/backlog.md`, this plan | API additions, local usage and completed/open work |

Paths in each task below are relative to the repository root. Keep existing behavioral
assertions when updating email fixtures. Do not edit Waitron or republish the UI package.

## Task 1: Carry language through account emails

**Files:** Registration files above; `packages/registration/src/index.ts` for exports;
`packages/account-http/src/{request,app}.ts`;
`packages/registration/test/{signup,password-recovery,email-outbox,local-mailer,smtp-mailer}.test.ts`,
`packages/registration/test/fixtures/delivery.ts`; new
`packages/registration/test/account-mail.test.ts`; `packages/account-http/test/account-http.test.ts`.

**Interfaces:** Export `AccountLocale = 'en' | 'es'` and
`AccountNotification = {email: string; locale?: AccountLocale}` from `account-input.ts`.
Make `AccountEmail` extend that shape with its existing token and expiry fields.
Use `request(email: string, locale: AccountLocale = 'en')` on both stores and
`PasswordRecoveryStore.complete(token: string, password: string, locale: AccountLocale = 'en')`.
Return types remain unchanged. Mailers and the outbox accept `AccountNotification` for
password-change mail. `accountMail` retains its current return shape.

- [ ] Add a failing mail-rendering test, then run
  `pnpm --filter @waitron-cloud/registration exec node --test test/account-mail.test.ts`:

  ```ts
  const token = 'a'.repeat(43);
  const mail = accountMail(new URL('https://cloud.example'), 'verification', {
    email: 'owner@example.com', token, expiresAt: '2030-01-01T12:00:00.000Z', locale: 'es',
  });
  assert.match(mail.text, /\/signup#token=a{43}&lang=es/);
  assert.doesNotMatch(mail.text, /\?token=/);
  assert.match(mail.text, /UTC/);
  ```

  Cover all three message kinds in both languages, and omitted locale in English.
  A missing export/type is an initial failure; then observe the behavioral assertions
  fail on the old renderer before replacing it.
- [ ] Extend strict body parsing with
  `readAccountBody(request: Request, required: readonly string[], optional: readonly string[] = [])`.
  Reject missing required fields, non-string present values and unknown fields.
  Allow only `locale` on signup request, reset request and reset completion, then
  validate `en`/`es` before invoking stores. Add HTTP tests for omitted, valid, invalid,
  null and unexpected locale fields; signup completion still rejects locale.
- [ ] Trace all mail payload consumers with `rg 'AccountEmail|sendPasswordChanged|searchParams.get' packages`.
  Add queue/store tests proving locale survives encryption and worker delivery, while
  old payloads without locale render English. Reject an explicit unsupported locale
  as an invalid payload; preserve existing key, token-hash and expiry checks.
  Extend delivery fixtures to pass optional locale while preserving old callers.
- [ ] Implement locale propagation inside existing transactions, preserving cooldowns
  and single-use behavior. Build links and format expiry explicitly:

  ```ts
  link.hash = new URLSearchParams({token: message.token, lang: message.locale ?? 'en'}).toString();
  const expiry = new Intl.DateTimeFormat(message.locale ?? 'en', {
    dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC',
  }).format(new Date(message.expiresAt));
  ```

  Use complete English/Spanish templates for subjects, expiry and notification text.
  Update mail tests that extract query tokens to read fragment tokens; retain the
  legacy query behavior as browser tests in task 3.
- [ ] Run the mail test plus the changed store/queue/adapter tests through
  `node scripts/test-postgres.mjs --filter @waitron-cloud/registration test`, and
  the HTTP locale cases through the same runner with the account-http filter and
  `exec node --test --test-name-pattern=locale test/account-http.test.ts`.
  Commit with `git commit -s -m "Support English and Spanish account emails"`.

## Task 2: Serve an optional portal without spending account capacity

**Files:** New `packages/account-http/src/portal.ts` and
`packages/account-http/test/portal.test.ts`; existing server, CLI, app and server tests;
new portal package/build/index/style files; root package scripts, lockfile and env example.

**Interfaces:** `loadPortalAssets(directory: string): Promise<ReadonlyMap<string, {body: Uint8Array; contentType: string}>>`
loads exactly `index.html`, `app.js` and `app.css` at startup. Add optional `portalAssets`
with that return type to `startAccountServer` options. The CLI loads it only when
`CLOUD_PORTAL_ASSETS_DIR` is set; a configured missing/broken build fails startup.
The map uses URL keys `/index.html`, `/app.js`, `/app.css`; only document routes can
serve index content. Keep filesystem paths out of request resolution.

- [ ] Add real HTTP tests: all six document paths (`/`, `/signup`, `/login`,
  `/forgot-password`, `/reset-password`, `/account`) return HTML for GET and no body
  for HEAD; assets have explicit MIME types. Unknown paths, `/index.html`, encoded
  traversal, unknown assets and unsupported methods do not serve the shell.
  Query-bearing `/signup` and `/reset-password` permit old email links; other queries
  remain rejected. API query rejection remains unchanged.
- [ ] Run
  `node scripts/test-postgres.mjs --filter @waitron-cloud/account-http exec node --test test/portal.test.ts`
  and confirm these routes fail before implementation.
- [ ] Route non-API traffic with configured assets before the account admission gate;
  apply the same validated host rules and security headers. Preserve the existing API
  path and API-only behavior. Return bounded 404/405 responses for static misses.
  Test malformed/foreign Host and eight blocked account operations alongside static
  GET/HEAD requests. Assert page/asset traffic leaves rate-counter rows unchanged,
  then prove the ninth account request remains rejected.
- [ ] Add the Lit/esbuild package with pinned dependencies matching `ui-smoke`, its
  own browser tsconfig (`skipLibCheck: false`), and an external-script HTML entry.
  Build only `dist/index.html`, `dist/app.js`, `dist/app.css`, without source maps.
  The initial entry can render a shared card so static/CSP browser checks are real.
  Use this starting CSP, then verify shared styles actually render under it:

  ```text
  default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'
  ```

  Inline styles are allowed for Lit/shared-control styling; inline scripts remain
  prohibited. Add no-store, no-referrer and nosniff to documents and account responses.
  Preserve transport deadlines, header limits, maxConnections and shutdown behavior.
- [ ] Add `portal:build` = `pnpm --filter @waitron-cloud/portal build` and document
  `pnpm portal:build` then
  `CLOUD_PORTAL_ASSETS_DIR=apps/portal/dist pnpm account:serve` in `.env.example`.
  Re-run focused server tests, browser rendering and typechecking. Commit with
  `git commit -s -m "Serve optional portal assets from the account server"`.

## Task 3: Implement the account screens and session lifecycle

**Files:** All portal source modules in the file map; new
`apps/portal/test/{links,locale,session,forms}.test.ts` and `test/fixtures.ts`.

**Interfaces:** Keep the following browser contracts explicit:

```ts
// locale.ts
export type Locale = 'en' | 'es';
export function chooseLocale(saved: string | null, languages: readonly string[]): Locale;
// links.ts: invalid covers duplicate, malformed or conflicting token parameters.
export type CapturedLink = {token?: string; locale?: Locale; invalid: boolean};
export function captureLink(url: URL, replace: (url: string) => void): CapturedLink;
// api.ts: errors are structured; response messages never become raw HTML.
export type ApiResult<T> = {ok: true; value: T} | {
  ok: false; status: number; code: string; retryAfterMs: number;
}; // network errors use status 0, code 'network_error'
export function accountRequest<T>(path: string, body?: Record<string, string>): Promise<ApiResult<T>>;
// session.ts
export type SessionState = {kind: 'checking' | 'anonymous' | 'unavailable'} |
  {kind: 'authenticated'; accountId: string; expiresAt: string};
export class PortalSession {
  constructor(changed: (state: SessionState) => void);
  check(): Promise<void>;
  activity(event: Event): Promise<void>;
  logout(): Promise<boolean>;
  dispose(): void;
}
```

- [ ] Write pure link and locale tests before implementation. This link example must
  fail with the old query-only behavior:

  ```ts
  let clean = '';
  const result = captureLink(new URL('https://cloud.example/signup#token=' + 'a'.repeat(43) + '&lang=es'),
    value => { clean = value; });
  assert.equal(result.token, 'a'.repeat(43));
  assert.equal(result.locale, 'es');
  assert.equal(clean, '/signup');
  ```

  Cover legacy query links, duplicate tokens even if identical, query/fragment
  conflicts, invalid token shapes, tokens on other routes, back/forward and reload.
  Clean secret-bearing URLs even when invalid. Use link language for that arrival,
  otherwise saved preference, then supported browser languages, then English.
  Storage access exceptions must not prevent boot or language changes.
- [ ] Run pure tests with
  `pnpm --filter @waitron-cloud/portal exec node --test test/links.test.ts test/locale.test.ts`.
  Implement capture before initial render or requests, retain secrets only in form
  memory and discard them when leaving that completion flow. Add complete keyed
  translation dictionaries with matching keys; switch language without resetting
  form inputs, token, request state or cooldown.
- [ ] Write controlled request tests for session states and response ordering.
  `accountRequest` uses same-origin credentials, JSON POSTs and the matching readable
  CSRF cookie only on activity/logout. It handles 204, fixed error codes and both
  Retry-After forms; it never retries writes or exposes raw error bodies.
  A malformed successful response is unavailable, not authenticated.
- [ ] Implement `PortalSession`: passive initial/visible/protected-action reads,
  trusted keyboard/pointer activity on the authenticated screen at most once per
  minute, and expiry-triggered passive reads. Ignore synthetic/background activity.
  Coalesce overlapping checks; invalidate older responses on logout/new login.
  Distinguish 401 from 503/network failures; failed logout retains a retry action.
  Dispose listeners/timers. Test fake time and delayed replies without minute-long sleeps.
- [ ] Add failing form/browser tests, then render shared controls for every route:
  email request/resend/change-address, signup completion, login, reset request,
  reset completion and account/sign-out. Include ordinary links and history handling;
  `/` alone chooses account/login after resolution. Explicit `/login` and completion
  pages remain accessible with an existing session. Account requires a confirmed session.
  Submission checks must run on Enter as well as click. Include reveal, labels,
  autocomplete, error summary, field focus, busy state and live status.
- [ ] Implement form state with a single pending operation and no automatic write
  retry. Start a minimum 60-second resend cooldown after accepted email requests;
  respect a longer Retry-After. Preserve values/language through pending responses.
  Lost completion responses offer login with the chosen password and deliberate retry;
  invalid/expired/used links offer login/new link. Lost login responses trigger one
  passive session check. Show success only from a confirmed response.
- [ ] Verify `new TextEncoder().encode(password).byteLength <= 1024` and
  `[...password].length >= 15`, including astral characters and exact boundaries.
  Test legal-name limits, default/different organisation name and the `ES` payload.
  Run the portal unit/controlled browser tests and typecheck; commit with
  `git commit -s -m "Add bilingual account portal screens and sessions"`.

## Task 4: Prove real browser journeys and wire normal CI

**Files:** New `apps/portal/test/{journey,browser-failures,accessibility}.test.ts`;
`test/fixtures.ts`, portal package scripts; root README/package scripts,
`.github/workflows/ci.yml`, account-http README, backlog and this plan.

**Interfaces:** `test/fixtures.ts` provides `startPortalFixture()` returning
`{origin: string, drainMail: () => Promise<void>, close: () => Promise<void>}`.
It creates an isolated migrated schema using `TEST_DATABASE_URL`, starts the existing
account server with built assets and an encrypted outbox, and uses `EmailWorker` plus
SMTP to `MAILPIT_TEST_SMTP_PORT`. `drainMail` calls `runOnce` until drained. Read mail
through `MAILPIT_TEST_URL` filtered by each test's unique recipient. Do not delete other
tests' messages. Use the account-http fixture's schema lifecycle as the reference;
close browser/server/pools and drop only this fixture's schema in `finally`.

- [ ] Add browser tests before claiming integrated success. For both languages:
  request signup, drain mail, open the actual captured link, complete business setup,
  sign in, reload, interact, sign out, reset from email and reject the old session and
  old password. Prove existing/unknown email request screens look the same. Check
  password-changed mail language follows reset completion. Open a second account's
  completion link while signed in and assert the original session is not replaced.
- [ ] Run
  `node scripts/test-postgres.mjs --filter @waitron-cloud/portal test`.
  The test script builds once then runs `node --test --test-timeout=120000 test/*.test.ts`.
  Require the real HTTP/worker/Mailpit flow, not mocked success responses. Assert tokens
  are absent from subsequent URLs/referrers/storage, and opening a link causes no
  completion POST. Legacy links may contain the token in their initial request only.
- [ ] Use Playwright interception for delayed/double submissions, 429, 503, session
  failure and logout failure. For lost completion replies, forward the real request
  to the server before aborting the browser response, then prove the transaction
  committed and no second POST happened automatically. Also test a stale session
  response arriving after logout, language switching while pending and expired links.
- [ ] Check keyboard-only forms, Enter, focus/error announcements, native input names
  and autocomplete, phone width 375px, both themes and both languages. Add `axe-core`
  as a test dependency and run it on each screen/state; inspect screenshots for clipping
  and contrast. Fail on browser console/CSP errors. Retain the existing private-package
  smoke test. Verify HTTPS cookie attributes using the existing server test setup;
  loopback HTTP journeys alone are not evidence for production cookie behavior.
- [ ] Ensure workspace typecheck/test includes the portal and CI installs the same
  pinned Chromium revision. Keep GitHub package credentials scoped to installation.
  Document build/serve/rebuild, required env, Mailpit workflow and API locale additions.
  Mark completed plan steps and update backlog with the portal outcome and remaining
  live-provider/ingress/account-security work. Commit with
  `git commit -s -m "Verify real account portal journeys and document local use"`.
- [ ] Run finish-branch: rebase, one Claude run-it review in an isolated candidate,
  triage findings, focused fixes and normal push hook. Wait for current-head green CI,
  then land and clean up without another authorization request. Report the actual
  local/browser/CI evidence and any remaining deployment work.
