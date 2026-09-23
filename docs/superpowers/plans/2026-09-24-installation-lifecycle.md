# Installation lifecycle implementation plan

> Use `superpowers:executing-plans` inline, with TDD, one whole-branch review per repository and the normal push/CI/landing gates. The owner authorised all five programme tasks and delegated decisions; continue without another approval pause.

**Goal:** Two real local Waitron installations obtain renewable, scoped Cloud access,
report independent status and lose that access when explicitly revoked.

**Architecture:** The paired key signs machine requests. Cloud signs one-hour leases
and serialises mutations on the installation row. Waitron persists pending operations
and cached status outside its venue database; a background worker refreshes access.

**Tech stack:** Node crypto, TypeScript, PostgreSQL, Hono, Lit, pnpm, real SQLite
Waitron servers, Node test runner/Vitest/Chromium.

**Spec:** `docs/superpowers/specs/2026-09-24-installation-lifecycle-design.md`.

## Constraints and review focus

- Local integration only; no fiscal or primary-activation changes.
- One-hour leases, renewal with ten minutes left, signed request skew ±60 seconds,
  observations stale after five minutes; exact configured origins.
- Private identity state never reaches a browser, logs or managed backup.
- Test stolen lease without its private key and a valid lease naming another venue.
- Test revocation contending with renewal and session expiry while waiting for a lock.
- Test lost renewal/revoke responses across a process restart with the same operation.
- Test reports out of order and prior-revision observations after configuration changes.
- Test Cloud outage separately from revocation, and worker shutdown during an exchange.

## 1. Cloud proof and lease primitives

Files: `packages/registration/src/installation-proof.ts`,
`packages/registration/test/installation-proof.test.ts`, shared fixed JSON vectors.

Interfaces:
```ts
type MachineAction = 'renew' | 'configuration' | 'report' | 'revoke';
type SignedEnvelope = {payload: string; signature: string};
type MachineClaims = {origin:string; action:MachineAction; installationId:string;
  operationId:string; issuedAt:number; lease:string; body:string};
// Key handles are parsed and validated at startup, never accepted from requests.
// encodeMachine, verifyMachine, issueLease and verifyLease own canonical wire formats.
```

- [x] Write failing behavior tests and pin literal wire vectors and every field's binding,
  lease expiry, wrong audience/issuer/algorithm, noncanonical encodings, unknown
  fields and body bounds. Run only `node --test .../installation-proof.test.ts`.
- [x] Implement the two canonical arrays from the spec using Ed25519 and strict
  base64url/UUID/schema checks; require finite integer dates and bounded strings.
- [x] Prove removing a binding/expiry check fails its test. Commit with sign-off.

## 2. Durable Cloud operations and HTTP boundary

Files: migration `009_installation_lifecycle.sql`, `src/installations.ts`, barrel,
`test/installations.test.ts`, `packages/account-http/src/installations.ts`,
`app.ts`, server configuration/CLI, HTTP tests and migration-count assertions.

Interfaces: `InstallationStore(pool, issuer)` provides
`renew(claims)`, `configuration(claims)`, `report(claims)`, `revoke(claims)`,
`listWithSession(token)`, `revokeWithSession(token, csrf, input)` and an internal
`configure(installationId, expectedRevision, services)` for trusted provisioning.
No HTTP route exposes that internal configuration writer.

- [x] Seed two real registered installations. Assert missing/wrong proof cannot
  fetch either configuration and a copied lease cannot be used by the other key.
- [x] Add lease/operation/configuration/observation/revocation persistence. Use the
  installation row lock for every grant or mutation; account/session/membership locks
  precede it for owner actions. Use wall time after lock waits.
- [x] Test separate pools renewing/revoking concurrently, committed results after
  restart, same operation/different body conflicts, expired retries and revoked
  pairing completion. Keep the existing registration assertions.
- [x] Test three services remain unconfigured until trusted configuration changes;
  report revisions cannot advance or roll back desired state; stale health is Unknown.
- [x] Mount bounded POST `/api/installations/{renew,configuration,report,revoke}` and
  session-protected account listing/revoke paths. Apply IP/installation/account limits,
  reject browser Origin on machine routes, require CSRF/Origin for account mutations.
- [x] Test real sockets, cookies, forgery, oversized bodies, disabled owner/membership,
  foreign installation and expiry during contention. Update startup migration guard.
- [x] Commit with sign-off.

## 3. Waitron client, worker and local management surface

Files in Waitron: `cloud-client.ts` and a focused `cloud-installation.ts` helper,
`cloud-api.ts`, `cloud-worker.ts`, boot/config/errors, server tests and fixture.
Keep existing pairing tests through any extraction of node-state helpers.

- [x] Extend the fixed vector test to the new signed request/lease formats.
- [x] With a real loopback Cloud service, assert renewal intent is saved before
  sending, lost results retry the same operation, and cross-installation/configuration
  mismatches never overwrite state. Observe each failure before implementation.
- [x] Add refresh/report/revoke operations with durable pending intent and the existing
  local file gate. Bound network work and preserve the last good state on outages.
- [x] Add a worker that checks once per minute, renews with ten minutes left and
  cancels on shutdown. Fake only scheduling; exercise real client exchanges in tests.
- [x] Expose cached status through GET and explicit refresh/revoke through the live
  manager gate. Validate exact request fields and recheck authority before revocation.
- [x] Run focused server/boot tests and types. Commit with sign-off.

## 4. Self-service screens and local integration

Files: Cloud portal account/installation controller and screens, locale/API tests;
Waitron Cloud services screen, client DTOs, locale/error catalogue and browser tests;
Cloud `scripts/test-waitron-pairing.mjs`, both guides/backlogs.

- [x] Write failing English/Spanish browser journeys showing lease/contact information
  and each independent service state. Test stale/unavailable/revoked distinctions.
- [x] Add explicit Stop Cloud access confirmation with consequences; require owner in
  Cloud and local manager in Waitron. Keep private keys and lease signatures out of DTOs.
- [x] Test double-click, lost reply, account change/detached view and phone accessibility.
- [x] Extend the real two-server runner: scoped configuration, renewal/lost reply/restart,
  independent observations, revocation, rejected subsequent renewal and unaffected other venue.
- [x] Update current implementation docs and stale pairing-next-step text. Commit.

## 5. Finish and land

- [ ] Rebase each branch initially, run one bounded Claude run-it review in an independent
  disposable clone, triage with reproductions and fix accepted findings test-first.
- [ ] Push through normal hooks and verify every required current-head CI result.
  Use the normal protected merge path: automatic approval review rejected `--admin`
  in task 2, so rebase if GitHub requires an up-to-date branch.
- [ ] Merge both PRs, refresh both main checkouts, clean registered worktrees and local/
  remote branches, verify backlog state and preserve review/validation receipts.
- [ ] Continue directly to programme task 4: local remote access.
