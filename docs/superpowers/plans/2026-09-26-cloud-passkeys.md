# Optional Cloud Passkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an existing Waitron Cloud customer enrol, use and remove optional discoverable passkeys without weakening password recovery or account authority.

**Architecture:** The registration package owns durable WebAuthn ceremonies and credential records on PostgreSQL, using SimpleWebAuthn for standards encoding and verification. The account HTTP package supplies strict same-origin routes and existing session cookies, while the Lit portal supplies deliberate browser ceremonies and bilingual controls. A real Chromium virtual authenticator proves the complete flow.

**Tech Stack:** Node.js 24, TypeScript 7, PostgreSQL, Hono, Lit 3, SimpleWebAuthn 14, Playwright 1.63 and `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-26-cloud-passkeys-design.md`

## Global Constraints

- Passkeys remain optional; password sign-in and email recovery continue to work.
- Use `@simplewebauthn/server` 14.0.3 and `@simplewebauthn/browser` 14.0.0.
- The configured portal hostname is the exact RP ID and the complete portal origin is the only expected origin.
- Registration requires a discoverable credential and user verification; authentication requires user verification.
- Registration and removal require the live session, its CSRF token and the current password.
- Ceremonies expire after five minutes and are consumed by the first completion attempt, successful or not.
- Public authentication failures remain generic and never expose whether an account or credential exists.
- No raw challenge, public key, credential response or password enters a log or public error.
- No staff role, support bypass, password removal, mandatory MFA or live deployment is part of this work.

## Review Focus

- A completion arriving after logout, suspension or session expiry must not enrol or remove a passkey.
- A replayed or concurrently completed ceremony must not create a second credential or session.
- A credential from another account, RP ID or origin must not authenticate or become removable.
- A stale signature counter must not overwrite a newer stored counter after concurrent authentication.
- A lost successful HTTP reply must be recoverable through the ordinary session check or a refreshed passkey list without repeating the mutation.

---

### Task 1: Persist passkey identity state and fresh authority

**Files:**
- Create: `packages/registration/migrations/019_passkeys.sql`
- Modify: `packages/registration/src/migrate.ts`
- Modify: `packages/identity/src/sessions.ts`
- Modify: `packages/identity/src/index.ts`
- Modify: `packages/identity/README.md`
- Modify: `packages/registration/test/identity.test.ts`

**Interfaces:**
- Produces: `createSession(client: PoolClient, accountId: string): Promise<SessionCredentials>`.
- Produces: `requireCurrentPassword(client: PoolClient, accountId: string, password: string): Promise<void>`.
- Produces: tables `cloud_passkey_users`, `cloud_passkeys` and `cloud_webauthn_ceremonies` with the constraints in the spec.

- [ ] **Step 1: Write the failing identity and migration tests**

Add tests that call `requireCurrentPassword` with the correct password, a wrong password, an oversized password, a disabled account and a password changed while derivation waits. Add a test that calls `createSession` for a live account and rejects a disabled account. Assert migration 019 creates a unique 32-byte user handle, a globally unique credential ID, the unsigned counter bound, matching ceremony account/session nullability and a five-minute expiry supplied by the writer.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/identity.test.ts
```

Expected: FAIL because migration 019 and both identity exports are absent.

- [ ] **Step 3: Add the schema and minimal identity helpers**

Create the three tables with UUID row IDs, `bytea` handles/public keys, base64url credential/challenge text, `bigint` counters constrained between 0 and 4294967295, text-array transports, device/backup flags and timestamps. Bind registration ceremonies to an account and session token hash; authentication ceremonies have neither. Add 019 to the immutable migration list.

Refactor the existing session creation at the end of `login` into:

```ts
export async function createSession(client: PoolClient, accountId: string): Promise<SessionCredentials>
```

Keep the account enabled check and existing token/cookie semantics. Add:

```ts
export async function requireCurrentPassword(
  client: PoolClient,
  accountId: string,
  password: string,
): Promise<void>
```

It pays one password derivation, then locks the account before the credential row and rejects a changed hash or disabled account with `IdentityError('credentials_invalid')`.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run the Step 2 command. Expected: all identity tests pass with no warnings.

- [ ] **Step 5: Commit the schema and identity boundary**

```sh
git add packages/registration/migrations/019_passkeys.sql packages/registration/src/migrate.ts packages/identity/src/sessions.ts packages/identity/src/index.ts packages/identity/README.md packages/registration/test/identity.test.ts
git commit -s -m "feat: add passkey identity state"
```

### Task 2: Implement durable WebAuthn ceremonies

**Files:**
- Create: `packages/registration/src/passkeys.ts`
- Create: `packages/registration/test/passkeys.test.ts`
- Modify: `packages/registration/src/index.ts`
- Modify: `packages/registration/package.json`
- Modify: `packages/registration/README.md`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `createSession`, `requireCurrentPassword`, `resolveSession`, `transaction` and migration 019.
- Produces: `PasskeyStore`, `PasskeyError`, `PasskeySummary`, `PasskeyRegistrationOptions` and `PasskeyAuthenticationOptions`.
- Produces methods:

```ts
registrationOptions(token: string, csrfToken: string, password: string): Promise<PasskeyRegistrationOptions>
verifyRegistration(token: string, csrfToken: string, ceremonyId: string, response: RegistrationResponseJSON): Promise<PasskeySummary>
authenticationOptions(): Promise<PasskeyAuthenticationOptions>
authenticate(ceremonyId: string, response: AuthenticationResponseJSON): Promise<SessionCredentials>
list(token: string): Promise<PasskeySummary[]>
remove(token: string, csrfToken: string, id: string, password: string): Promise<boolean>
```

- [ ] **Step 1: Add SimpleWebAuthn and write failing store tests**

Run:

```sh
pnpm --filter @waitron-cloud/registration add @simplewebauthn/server@14.0.3
```

Write PostgreSQL tests whose ceremony adapter returns literal options and verification results while the store exercises real rows and transactions. Cover opaque stable user handles, existing-credential exclusion, required resident/user-verification options, five-minute expiry, first-attempt consumption, wrong ceremony kind, same-session binding, logout/suspension between begin and finish, duplicate credential IDs, cross-account list/removal, current-password removal, generic authentication failure, exact user-handle comparison, counter advance and a concurrent stale-counter attempt. Each adapter fixture must match the full SimpleWebAuthn response/result type; assertions target store state, not adapter calls.

- [ ] **Step 2: Run the store test and confirm RED**

Run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/passkeys.test.ts
```

Expected: FAIL because `PasskeyStore` does not exist.

- [ ] **Step 3: Implement the store and real SimpleWebAuthn adapter**

Use `generateRegistrationOptions`, `verifyRegistrationResponse`, `generateAuthenticationOptions` and `verifyAuthenticationResponse`. Configure:

```ts
authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
attestationType: 'none'
userVerification: 'required'
timeout: 300_000
```

Store an opaque `randomBytes(32)` user handle and `randomUUID()` ceremony/credential row IDs. Consume a locked ceremony in a transaction before verification. Registration re-resolves the bound session both before consuming and before inserting. Authentication locks the credential, verifies exact origin/RP/challenge/user handle, advances only to the verifier's new counter, records `last_used_at`, then calls `createSession`. Convert malformed or library failures to `PasskeyError` without copying their messages.

- [ ] **Step 4: Run store and identity suites and confirm GREEN**

Run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/passkeys.test.ts test/identity.test.ts
pnpm --filter @waitron-cloud/registration typecheck
```

Expected: all tests and type checks pass.

- [ ] **Step 5: Commit the ceremony store**

```sh
git add packages/registration/src/passkeys.ts packages/registration/test/passkeys.test.ts packages/registration/src/index.ts packages/registration/package.json packages/registration/README.md pnpm-lock.yaml
git commit -s -m "feat: implement durable passkey ceremonies"
```

### Task 3: Expose strict account passkey routes

**Files:**
- Create: `packages/account-http/src/passkeys.ts`
- Create: `packages/account-http/test/passkeys.test.ts`
- Modify: `packages/account-http/src/app.ts`
- Modify: `packages/account-http/src/request.ts`
- Modify: `packages/account-http/README.md`

**Interfaces:**
- Consumes: `PasskeyStore`, existing `readSessionCookie`, CSRF cookie/header convention, `writeSessionCookies`, `AccountRateLimiter` and `portalOrigin`.
- Produces: the six HTTP operations in the spec under `/api/account/passkeys`.
- Produces: `readBoundedJsonObject(request: Request): Promise<Record<string, unknown>>` with the existing 16 KiB and five-second bounds.

- [ ] **Step 1: Write failing HTTP tests**

Test exact nested request shapes, content type/encoding/declared and streamed size bounds, missing or foreign Origin, session and CSRF enforcement, wrong current password, same-session registration completion, generic invalid authentication, passkey-specific IP/challenge rate limits, successful session/CSRF cookies, passive list reads, account suspension and cross-account removal. Include lost-reply tests that read the committed session/list rather than retrying a consumed ceremony.

- [ ] **Step 2: Run the HTTP test and confirm RED**

Run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/passkeys.test.ts
```

Expected: FAIL with passkey routes returning 404.

- [ ] **Step 3: Implement the bounded reader and route adapter**

Extract the stream/content-type/timeout parsing from `readAccountBody` into `readBoundedJsonObject`; retain the old exact-string-field validation on top. In `passkeys.ts`, accept only the specified keys and validate UUIDs plus SimpleWebAuthn JSON as bounded objects before calling the store. Apply existing general limits and additional scopes `passkey-auth-options-ip`, `passkey-auth-verify-ip`, `passkey-auth-verify-ceremony` and authenticated account mutation limits. Map all authentication verification failures to `401 {"error":"credentials_invalid"}` and all raw verifier faults to the existing safe error vocabulary.

- [ ] **Step 4: Run focused HTTP and existing account tests and confirm GREEN**

Run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/passkeys.test.ts test/account-http.test.ts test/server.test.ts
pnpm --filter @waitron-cloud/account-http typecheck
```

Expected: all tests and type checks pass.

- [ ] **Step 5: Commit the HTTP boundary**

```sh
git add packages/account-http/src/passkeys.ts packages/account-http/test/passkeys.test.ts packages/account-http/src/app.ts packages/account-http/src/request.ts packages/account-http/README.md
git commit -s -m "feat: expose account passkey routes"
```

### Task 4: Add bilingual portal controls

**Files:**
- Create: `apps/portal/src/passkey-controller.ts`
- Create: `apps/portal/src/passkey-screen.ts`
- Create: `apps/portal/src/passkey-types.ts`
- Create: `apps/portal/test/passkey-controller.test.ts`
- Modify: `apps/portal/src/api.ts`
- Modify: `apps/portal/src/app.ts`
- Modify: `apps/portal/src/screens.ts`
- Modify: `apps/portal/src/locale.ts`
- Modify: `apps/portal/src/styles.css`
- Modify: `apps/portal/test/api.test.ts`
- Modify: `apps/portal/test/forms.test.ts`
- Modify: `apps/portal/test/accessibility.test.ts`
- Modify: `apps/portal/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `startRegistration`, `startAuthentication`, `browserSupportsPasskeys`, account API responses and the current `PortalSession`.
- Produces: `PasskeyController` states for support, loading, enrolment, authentication, removal, cancellation, uncertainty and reconciliation.
- Produces: English/Spanish login and account controls with no conditional autofill.

- [ ] **Step 1: Add the browser library and write failing controller/screen tests**

Run:

```sh
pnpm --filter @waitron-cloud/portal add @simplewebauthn/browser@14.0.0
```

Write tests for validated option/list responses, CSRF headers on passkey mutations, unsupported-browser fallback, browser cancellation, wrong fresh password, enrolment/removal list refresh, lost-reply reconciliation, route changes cancelling stale answers, and passkey sign-in replacing the session controller. Add English/Spanish form and accessibility assertions for the separate passkey action and account controls.

- [ ] **Step 2: Run the portal tests and confirm RED**

Run:

```sh
pnpm --filter @waitron-cloud/portal test -- test/passkey-controller.test.ts test/api.test.ts test/forms.test.ts test/accessibility.test.ts
```

Expected: FAIL because passkey response validators, controller and screens are absent.

- [ ] **Step 3: Implement the controller and screens**

The controller calls `startAuthentication({optionsJSON})` and `startRegistration({optionsJSON})` only after the customer's click. It keeps raw browser responses in local variables just long enough to submit them and never stores them in browser storage. Treat `NotAllowedError` as cancellation, network/5xx after completion as uncertain, 401 as an ended session and 403 fresh-authority errors as a password-field error. On uncertain sign-in, run the ordinary session check; on uncertain enrol/remove, reload the account-scoped list.

Add a secondary **Sign in with a passkey** button. On the account page, add the password-confirmed add flow and one remove action per server row ID. Keep installation and sign-out controls independent. Add matching Spanish copy, visible focus, disabled/loading states and phone-width wrapping.

- [ ] **Step 4: Run portal tests, build and typecheck and confirm GREEN**

Run:

```sh
pnpm --filter @waitron-cloud/portal test
pnpm --filter @waitron-cloud/portal typecheck
pnpm --filter @waitron-cloud/portal build
```

Expected: all portal tests, type checks and build pass without browser console errors.

- [ ] **Step 5: Commit the portal flow**

```sh
git add apps/portal/src/passkey-controller.ts apps/portal/src/passkey-screen.ts apps/portal/src/passkey-types.ts apps/portal/src/api.ts apps/portal/src/app.ts apps/portal/src/screens.ts apps/portal/src/locale.ts apps/portal/src/styles.css apps/portal/test/passkey-controller.test.ts apps/portal/test/api.test.ts apps/portal/test/forms.test.ts apps/portal/test/accessibility.test.ts apps/portal/package.json pnpm-lock.yaml
git commit -s -m "feat: add optional passkeys to the portal"
```

### Task 5: Prove the real passkey journey and document the boundary

**Files:**
- Create: `apps/portal/test/passkey-browser.test.ts`
- Modify: `apps/portal/test/fixtures.ts`
- Modify: `docs/backlog.md`
- Modify: `docs/product-and-platform.md`
- Modify: `packages/account-http/README.md`

**Interfaces:**
- Consumes: the production portal bundle, account server, PostgreSQL fixture and Chromium DevTools `WebAuthn` domain.
- Produces: a real resident, user-verified virtual-authenticator journey and updated customer/operator documentation.

- [ ] **Step 1: Write the failing real-browser journey**

Use `context.newCDPSession(page)` and configure:

```ts
{
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
}
```

For English/light/desktop and Spanish/dark/phone, create an account, sign in by password, enrol a passkey after current-password confirmation, sign out, sign in through the discoverable credential, verify the account, replay the captured completion and confirm rejection, prove another account cannot list/remove it, then remove it and retain password sign-in. Assert exact RP ID/origin through the returned options and inspect browser console/page errors.

- [ ] **Step 2: Run the browser test and confirm RED**

Run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 test/passkey-browser.test.ts
```

Expected: FAIL until the fixture and UI drive the complete virtual-authenticator flow.

- [ ] **Step 3: Complete the fixture, docs and backlog**

Keep the DevTools session local to each browser context and remove its virtual authenticator during cleanup. Document the six requests, same-origin/RP configuration, five-minute ceremony lifetime, current-password requirement, optional password/recovery compatibility and local browser proof. Update the Identity/backlog entries with the landed behavior and leave D10 session/last-use controls plus D11 challenge/history retention explicit.

- [ ] **Step 4: Run the final focused checks and mutation controls**

Run:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/passkeys.test.ts test/identity.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/passkeys.test.ts test/account-http.test.ts test/server.test.ts
node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 test/passkey-browser.test.ts
pnpm --filter @waitron-cloud/portal test
pnpm --filter @waitron-cloud/identity typecheck
pnpm --filter @waitron-cloud/registration typecheck
pnpm --filter @waitron-cloud/account-http typecheck
pnpm --filter @waitron-cloud/portal typecheck
pnpm --filter @waitron-cloud/portal build
```

In a disposable copy, separately remove the consumed-at predicate, exact expected origin, session-token binding and account predicate on removal. Each mutation must make its named focused test fail. Restore the candidate tree after each control.

- [ ] **Step 5: Commit the proof and documentation**

```sh
git add apps/portal/test/passkey-browser.test.ts apps/portal/test/fixtures.ts docs/backlog.md docs/product-and-platform.md packages/account-http/README.md
git commit -s -m "test: prove optional passkey authentication"
```

### Task 6: Finish the branch

**Files:**
- Inspect: every file changed from `origin/main`

**Interfaces:**
- Consumes: all prior task commits and focused receipts.
- Produces: a reviewed PR with exact-head green CI, ready for the authorised land workflow.

- [ ] **Step 1: Re-read the spec, plan and complete diff**

Run `git diff --check origin/main...HEAD`, inspect `git diff --stat origin/main...HEAD`, and trace every new route, database field and public error consumer. Confirm the backlog distinguishes D9 from D10 and D11.

- [ ] **Step 2: Run the Codex finish-branch skill**

Use the repository's `finish-branch` skill. This is meaningful production code, so retain one Claude run-it whole-branch report from its disposable checkout, triage every finding and apply accepted fixes with a failing regression test first.

- [ ] **Step 3: Push and require exact-head CI**

Let the normal pre-push hook run. Record the PR URL, exact head SHA and current-head CI run ID only after it succeeds.

- [ ] **Step 4: Land under the shared lock and verify merge CI**

Acquire `~/waitron-campaign-shared/main.lock` exactly as RUNNER.md specifies, run `land-branch` from the main checkout, release only the lock this lane acquired, and require a successful main CI run whose `headSha` is the exact squash merge SHA.
