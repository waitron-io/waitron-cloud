# Cloud Account HTTP Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan inline, task by task, with TDD. The owner's standing workflow uses one Claude whole-branch review during `finish-branch`, then automatic `land-branch`. Do not add per-task agents or a second whole-branch review.

**Goal:** Make the existing Cloud account flows available through the protected HTTP contract, verified over real PostgreSQL, HTTP and Mailpit.

**Architecture:** A new `@waitron-cloud/account-http` package hosts Hono routes around the existing registration and identity stores. PostgreSQL holds shared request counters; the Node host owns connection limits, configuration and shutdown. Keep account transactions and email delivery in their existing packages.

**Tech Stack:** Node.js >=24, pnpm 9.15.0, TypeScript, Hono ^4.13.8 and @hono/node-server ^2.1.1 (the inspected Waitron versions), pg, node:test, PostgreSQL 18 and Mailpit. Use an established IP parser (`ipaddr.js`) for IPv6 canonicalisation; verify its supported API/version before installation.

**Spec:** [Approved account HTTP design](../../account-http-design.md), approved by the owner's “go” on 2026-09-23.

## Global Constraints

- All account routes live under `/api/account`. POST bodies must be JSON objects.
- Limit bodies to 16 KiB while reading, including chunked bodies.
- Require an exact Origin match on every POST, including login and unauthenticated requests.
- Production session cookie: `__Host-cloud_session`; Secure, HttpOnly, SameSite=Lax, Path=/, no Domain.
- Production CSRF cookie: `__Host-cloud_csrf`; identical scope, readable by the portal.
- Only the session store verifies `X-CSRF-Token`; cookies alone do not authorise mutations.
- Minimum 300 ms response duration on login and email-request routes, measured after receiving the body. This is not a constant-time guarantee.
- Default limits: all routes 120/min/IP; login 10/min/IP and 30/15min/address; each email-request route 10/15min/IP; each completion route 10/15min/IP and token.
- Store rate identities as HMAC digests with a dedicated secret; never store raw IPs, emails or tokens in the rate table.
- Socket peer is authoritative unless it is an explicitly configured trusted proxy. Only one forwarded client address is supported; group IPv6 clients by /64.
- Preserve existing signup, reset, session, outbox and lock-order behaviour. Add migration 007; never edit an applied migration.
- Keep Waitron files, shared UI, pairing, live provider configuration and public deployment outside this branch.
- Every commit has `git commit -s`; never bypass hooks. Focus local tests on changed behaviour and use current-head CI as the final gate.

## Review Focus

1. Two API instances racing on the same counter must admit no more than the allowance; normalised IP/email spellings must not create new allowances. Task 1 tests this.
2. A trusted proxy's malformed forwarding header must not fall back to a fresh rate identity; an untrusted peer cannot select its identity using headers. Task 2 tests this over the app boundary, Task 3 over a socket.
3. Duplicate session cookies, a CSRF token from another session, and expiry while waiting for a lock must not permit mutation. Task 2 retains database checks and adds HTTP assertions.
4. Slow or chunked requests must not occupy an admission slot indefinitely, and errors must release slots without leaking input. Task 3 tests actual sockets and subsequent successful requests.
5. A committed signup/reset followed by a lost response cannot be undone or replayed into another account/session. Task 2 tests replay and subsequent login; Task 3 tests client disconnects and shutdown.

## File ownership and test commands

Create `packages/account-http/package.json` with a private ESM package, a `src/index.ts` export, `typecheck` using the root tsconfig, and `test` using `node --test --test-timeout=30000 test/*.test.ts`. Declare direct runtime dependencies on registration, identity, pg, Hono, the Node adapter and the IP parser. Declare the required pg/IP types as development dependencies.

Keep files focused:

- `src/rate-limit.ts`: shared PostgreSQL counters and bounded expiry cleanup.
- `src/client-address.ts`: socket/proxy interpretation and canonical rate identity.
- `src/config.ts`: validated origin, listener, proxy and secret configuration.
- `src/request.ts`: strict body reading, Origin/authority validation and fixed errors.
- `src/cookies.ts`: cookie parsing, issuance and clearing.
- `src/app.ts`: eight account routes and shared protection/error handling.
- `src/server.ts`, `src/server-cli.ts`: Node host, resource limits and process lifecycle.
- `test/fixtures.ts`: each test suite's own schema, app/HTTP host and Mailpit helpers.
- `test/rate-limit.test.ts`, `test/account-http.test.ts`, `test/server.test.ts`: behavioural tests.

Allow the existing disposable-container harness to run selected pnpm commands, preserving its default behaviour:

```js
// scripts/test-postgres.mjs, where it currently spawns pnpm:
const command = process.argv.length > 2 ? process.argv.slice(2) : ['test:packages'];
child = spawn('pnpm', command, { stdio: 'inherit', env: testEnvironment });
```

`testEnvironment` here is the existing environment object at that call site, kept unchanged, including the three container connection variables. Do not introduce shell evaluation. Verify the selected command runs inside the same lifecycle and cleanup path.

For each task, use this focused container command, substituting its named file:

```sh
node scripts/test-postgres.mjs --filter @waitron-cloud/account-http exec node --test --test-timeout=30000 test/rate-limit.test.ts
```

Run dependency installation only after plan approval. Keep the current feature branch's committed design; use the repository's worktree workflow if isolation is needed, without touching Waitron's development environment.

### Task 1: Shared request limits

**Files:** New package manifest and `src/rate-limit.ts`; new `test/rate-limit.test.ts` and schema fixtures; new `packages/registration/migrations/007_account_http.sql`; update registration migration list, its ledger-count assertion, container harness and lockfile.

**Interfaces:**

```ts
export interface RateRule { scope: string; subject: string; limit: number; windowSeconds: number; }
export interface RateDecision { allowed: boolean; retryAfterSeconds: number; }
export class AccountRateLimiter {
  constructor(pool: Pool, key: string); // exactly 64 hex characters, captured on construction
  consume(rules: readonly RateRule[]): Promise<RateDecision>;
  prune(): Promise<number>; // delete at most 1,000 expired counters
}
```

- [x] Write failing tests against a private PostgreSQL schema migrated by the real registration runner. A minimal stub may throw `not implemented` so failures reach behavioural assertions rather than unresolved imports. Pin the first invariant:

```ts
const rule = {scope: 'login-ip', subject: '192.0.2.1', limit: 10, windowSeconds: 60};
const left = new AccountRateLimiter(pool, rateKey);
const right = new AccountRateLimiter(secondPool, rateKey);
const results = await Promise.all(Array.from({length: 30}, (_, i) =>
  (i % 2 ? left : right).consume([rule])));
assert.equal(results.filter(result => result.allowed).length, 10);
assert.ok(results.filter(result => !result.allowed).every(result => result.retryAfterSeconds > 0));
```

Here `pool` and `secondPool` are independent connections to the test schema; `rateKey` is `randomBytes(32).toString('hex')`. Add tests for independent scopes, multiple applicable limits, expiry reset using SQL to move the saved deadline into the past, no mutation by client clocks, counter saturation, bounded pruning, missing/invalid key and database failure. Inspect every stored row to assert absence of the submitted subject.
- [x] Run the focused `test/rate-limit.test.ts` command. Expected: the new allowance, privacy and expiry assertions fail with the stub.
- [x] Implement migration 007: a digest primary key, window deadline and nonnegative bounded count, plus a deadline index. HMAC input includes unambiguous scope/subject encoding. Use PostgreSQL wall time and atomic upserts under one transaction; sort keys before locking and cap denied counters. A window begins with its first attempt and resets only after its stored deadline. All applicable counters record the attempt, including a refused attempt; return the longest applicable wait. Validate rule bounds internally and propagate database errors for the HTTP layer to turn into 503.
- [x] Run focused tests and `pnpm typecheck`. Expected: all pass. Run the migration ledger test with all seven migrations and rerun migration to prove idempotence.
- [x] Commit with sign-off: `Add shared PostgreSQL account request limits`.

### Task 2: Account routes and browser protection

**Files:** `src/app.ts`, `src/request.ts`, `src/cookies.ts`, `src/client-address.ts`, `src/config.ts`, `src/index.ts`; extend `test/fixtures.ts`; add `test/account-http.test.ts`. Export the existing registration `transaction` helper through its index for identity calls instead of importing another package's internal path.

**Interfaces:**

```ts
export interface AccountHttpConfig {
  portalOrigin: string;
  production: boolean;
  rateKey: string;
  trustedProxyIps: readonly string[];
}
export function createAccountApp(options: {
  pool: Pool; outbox: EmailOutbox; config: AccountHttpConfig;
}): Hono<{ Bindings: HttpBindings }>;
export function clientAddress(peer: string, forwarded: string | undefined,
  trustedProxyIps: readonly string[]): string;
```

The app gets its peer from `c.env.incoming.socket.remoteAddress`, not request-controlled app variables. App tests supply this binding explicitly; Task 3 proves the real adapter supplies it. The config parser validates and copies values on construction. HTTP origins are allowed only for explicit loopback development; HTTPS origins have no credentials, path, query or fragment.

- [x] Add a test fixture with isolated schema and fresh encryption/rate keys. Construct real signup/recovery stores and `EmailWorker` with Mailpit on the test ports. Mailpit lookup must filter by a unique test recipient as well as subject; never clear the shared test inbox. Capture real Set-Cookie headers and send Cookie headers explicitly in Node HTTP tests; do not claim this is a browser cookie-policy test.
- [x] Write failing route tests using the eight paths and success/status shapes from the spec. The main journey sends verification via Mailpit, extracts the token, completes signup, logs in, reads the session, renews activity, resets the password through Mailpit, rejects the old session/password and signs in with the new password. Add explicit assertions like:

```ts
assert.equal(signup.status, 201);
assert.equal(signup.headers.has('set-cookie'), false);
assert.equal(loginResponse.status, 200);
assert.ok(loginResponse.headers.getSetCookie().some(value =>
  value.startsWith('__Host-cloud_session=') && value.includes('HttpOnly') && value.includes('Secure')));
assert.equal((await sessionRead()).status, 200);
assert.equal((await postActivity({csrfToken: anotherSessionCsrf})).status, 403);
assert.equal((await oldSessionReadAfterReset()).status, 401);
```

`sessionRead`, `postActivity` and `oldSessionReadAfterReset` are fixture requests to the named HTTP routes using cookies captured from the real login responses. Never seed a fake authenticated identity in the app.
- [x] Add refusal tests: every POST with absent/null/foreign Origin; false authority; query tokens; unknown fields; nonobject/malformed JSON; form bodies; wrong types; oversized/chunked bodies; duplicate session cookies; stale/revoked/missing sessions; cross-session CSRF; generic login/email responses; no session secrets in JSON; no cache/referrer headers missing on errors. Confirm rejected writes leave account/session/outbox rows unchanged. Test case-folded email budgets, IPv4-mapped IPv6 and IPv6 /64 grouping, untrusted spoofed forwarding, trusted malformed/multihop forwarding, and database limiter failure. Measure the 300 ms floor for real unknown/wrong-password and eligible/ineligible/cooldown requests with a small scheduler tolerance, while asserting generic status/body independently of timing.
- [x] Run the focused `test/account-http.test.ts` command. Expected: meaningful HTTP status/state assertions fail against the stub app.
- [x] Implement the specified routes with the existing stores, transaction helper and Task 1 limiter. Map only known domain errors to fixed 4xx codes; unexpected database errors become fixed 503. Apply shared headers in the error boundary too. Validate bodies before domain calls, enforce Origin before state changes, and pass actual CSRF headers to `resolveSession`. `/session` uses `{touch:false}`; `/session/activity` uses CSRF and normal touch; logout resolves first under account-first lock order before ending the session. Catch only unavailable/expired sessions for idempotent logout, never swallow a CSRF or database failure. Resolve cookie ambiguity by refusing duplicate session cookie names.
- [x] Run route tests and `pnpm typecheck`. Expected: green. Retain existing registration/identity tests unchanged apart from the migration ledger count, and run affected identity/reset integration tests if transaction behaviour changed.
- [x] Commit with sign-off: `Expose protected Cloud account HTTP routes`.

### Task 3: Executable host and real network limits

**Files:** `src/server.ts`, `src/server-cli.ts`, extend `src/config.ts`; `test/server.test.ts`; root scripts and `.env.example`.

**Interfaces:**

```ts
export function startAccountServer(options: {
  pool: Pool; outbox: EmailOutbox; config: AccountHttpConfig;
  host?: string; port?: number;
}): Promise<{server: import('node:http').Server; close(): Promise<void>}>;
export function accountHttpConfig(env: NodeJS.ProcessEnv): AccountHttpConfig;
```

`startAccountServer` does not own or close the supplied pool; the CLI owns its pool and ends it after host shutdown. Tests use port 0. CLI port defaults to 3000 and host to 127.0.0.1. Configuration requires `DATABASE_URL`, the existing email key ring, `CLOUD_PORTAL_ORIGIN`, `CLOUD_HTTP_RATE_KEY`; optional `CLOUD_HTTP_TRUSTED_PROXY_IPS` is a comma-separated explicit IP list, never `*`. `NODE_ENV=production` forbids insecure origins. CLI startup validates a database connection and requires migration 007 already present; it never applies migrations.

- [x] Add tests starting the host on a random loopback port and a separate CLI child with a private schema. Use Node `http.request`/`net.Socket` to send slow headers, stalled/chunked bodies, aborted requests and forged headers. Pin recovery after rejection:

```ts
assert.equal(oversizedResponse.statusCode, 413);
assert.equal((await fetch(`${origin}/api/account/session`)).status, 401);
assert.equal(await countQueuedEmails(pool), beforeCount);
```

`countQueuedEmails` executes `SELECT count(*) FROM email_outbox` in the fixture schema. Add tests for production HTTP-origin refusal, absent keys, invalid proxy configuration, missing migrations, busy admission, trusted proxy forwarding over a real socket, process restart preserving rate counters, SIGTERM shutdown, and secret-free startup/runtime diagnostics. A client disconnect after a committed operation must leave its result recoverable through normal login/replay rules.
- [x] Run focused `test/server.test.ts`. Expected: host lifecycle and network-limit assertions fail before the host implementation.
- [x] Implement the Node host with header limit 8 KiB, header/body receive deadlines 5 seconds with a 1-second server timeout-check interval, max 200 connections, at most 8 simultaneous account operations per process, and a bounded 10-second shutdown drain. Enforce body deadline/cancellation in the reader as well as Node's server settings; release admission slots in `finally`. Reject additional work with fixed 503 and Retry-After rather than queueing it unboundedly. Do not forcibly report a database operation cancelled if it may commit; preserve existing transactional semantics and document uncertain responses.
- [x] Configure the CLI pool with max 10 clients, connection timeout 5 seconds, statement timeout 10 seconds and a fixed idle-pool-error diagnostic. Run limiter cleanup once per minute without overlapping cleanups, deleting at most 1,000 expired counters per pass. Clear its timer on shutdown. Handle SIGINT/SIGTERM and terminate remaining connections after the drain deadline before ending the pool. Add `pnpm account:serve` with optional ignored `.env` loading, matching the email worker convention.
- [x] Run server tests, all account-http tests in one disposable-container invocation and `pnpm typecheck`. Expected: all green with no leaked child processes, sockets or containers.
- [x] Commit with sign-off: `Add the Cloud account server command and network limits`.

### Task 4: Documentation, whole-branch review and landing

**Files:** New `packages/account-http/README.md`; root README, `.env.example`, approved design status, identity/registration READMEs and `docs/backlog.md`. Keep exact local run, migrate, worker and status commands together, with sample placeholders only.

- [x] Document request/response examples for each route, cookie/CSRF handling, explicit session activity, rate defaults, IPv6 grouping, proxy trust, key rotation effects on counters, cleanup, error codes and shutdown. State that email links target future screens; HTTP tests do not supply those screens. Keep public-deployment requirements precise: live provider/events, compromised-password screening, MFA policy, ingress controls, timing/load evidence and secrets. Record shared UI and Waitron pairing as unblocked by SQLite and still unimplemented.
- [x] Run `git diff --check`, local documentation link checks, `pnpm typecheck` and `pnpm test` once for the integrated feature. Expected: all packages pass against the disposable services and prior account behaviour remains covered. Save red/green receipts and noteworthy design rulings in the execution ledger.
- [ ] Commit docs with sign-off. Run `finish-branch`: rebase first, prepare an independent temporary candidate with its own locked dependencies, run one Claude run-it whole-branch review, triage findings and fix accepted behavioural defects with red/green tests. Preserve the report, timing and usage receipts. No duplicate review solely for a rebase.
- [ ] Push through normal hooks, create the PR with tests and deployment limits, and confirm green CI belongs to its exact head. Run `land-branch` under the owner's existing authorisation: announce the merge, squash with sign-off, confirm MERGED, refresh main/dependencies, remove feature branches/worktree if one exists, and re-read the backlog. Confirm post-merge CI and report actual shipped scope and remaining deployment work.
