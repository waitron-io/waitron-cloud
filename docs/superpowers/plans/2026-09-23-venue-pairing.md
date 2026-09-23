# Venue pairing implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. The owner authorised
> autonomous decisions, sequential implementation, finish and landing without more questions.

**Goal:** expose an expiring, signed pairing exchange with durable Cloud approval.
**Architecture:** PostgreSQL pairing state wraps the existing registration store in one
transaction. Machine signatures and browser sessions use separate HTTP routes.
**Tech stack:** Node crypto/Ed25519, PostgreSQL, Hono, TypeScript, node:test.
**Spec:** [Venue pairing design](../specs/2026-09-23-venue-pairing-design.md).

## Global constraints

- Local integration only; public launch waits for real Waitron administrator tests in task 2.
- Ten-minute pairing requests; machine signatures within 60 seconds; five bad codes maximum.
- Signed-off commits, failing behavioural tests first, preserve existing assertions.
- No machine private key in browser, URLs, logs or Cloud storage.

## Review focus

- Expiry after lock contention must roll back all linking writes (persistence test).
- A guessed code must spend its allowance even when returning an error (persistence test).
- An old signed payload must not work at another action/origin (proof tests).
- A completed request must survive restart/expiry without reviving a revoked installation (persistence test).
- Session/permission removal during approval must roll back approval (HTTP/store tests).

### Task 1: signature contract

Files: `packages/registration/src/pairing-proof.ts`, `test/pairing-proof.test.ts`.
Produces `verifyPairingProof(payload,signature,origin,action,now?)` returning validated
claims and `pairingPayload(claims)` for the canonical bytes. Claim fields and array order
are in the spec. Verify exact bytes with `crypto.verify(null, bytes, publicKey, signature)`.

- [x] Write valid Ed25519 round-trip and reject altered byte/key/action/origin/time/version/shape tests.
- [x] Run `pnpm --filter @waitron-cloud/registration exec node --test test/pairing-proof.test.ts`; see missing verifier fail.
- [x] Implement strict canonical parsing and signature validation; rerun to pass; commit with `-s`.

### Task 2: durable approval and completion

Files: migration `008_pairing.sql`, migration list, `src/pairing.ts`, `src/index.ts`,
`test/pairing.test.ts`. RegistrationStore accepts an optional existing PoolClient and
uses it for its transactional operations. PairingStore owns the outer transaction.
Produces `start(claims)`, `status(claims)`, `inspect(id,code,token,csrf)`,
`approve(id,code,org,business,token,csrf)`, `complete(claims)`, `businesses(token)`.

- [x] Add real PostgreSQL tests: no approval, changed binding, cross-installation,
  five code failures across workers, CSRF, immutable business choice, permission loss,
  expiry after waits, concurrent completion, expired completed retry/revocation,
  restart from another process and upgrade preserving an existing registration.
- [x] Run through `node scripts/test-postgres.mjs --filter @waitron-cloud/registration exec node --test test/pairing.test.ts`; observe absent behavior.
- [x] Implement migration/store and borrowed-client transaction support. Code mismatches
  return a transaction result before throwing so the failed-code count commits.
- [x] Preserve registration suite behavior and update its migration count to eight.
  Run pairing plus registration tests and types, commit with `-s`.

### Task 3: HTTP boundary and usage guide

Files: `packages/account-http/src/pairing.ts`, `app.ts`, `test/pairing.test.ts`,
registration/account HTTP READMEs, backlog and integration contract.
Consumes task 1 proof verifier and task 2 store. Routes and exact fields follow spec.

- [x] Write HTTP tests for signed start/status/complete and authenticated business
  selection/approval, separate machine/browser authority, method/host/origin/body
  refusal, persistent rate limits and generic errors.
- [x] Run focused HTTP test to fail; add handler behind shared admission/rate checks.
- [x] Run real HTTP journey with two independent keys, lost response and new app instance;
  prove no installation is linked from start or Cloud approval alone.
- [x] Update docs/backlog with exact implemented scope and local launch gate.
- [x] Run focused tests/types and signed-off commits. The finish/land workflow then
  uses current-head CI and proceeds to the Waitron screen task.

## Execution receipts

Signature tests: 3/3; pairing PostgreSQL: 17/17; existing registration: 22/22;
HTTP pairing: 5/5 including actual sockets and server restart. Missing migration
startup check failed by leaving the server running before the new gate, then passed.
Workspace typecheck passed. Full package tests remain the CI gate.

The owner authorised autonomous decisions instead of further design/plan approval
questions. Code tests preceded implementation. The first expiry test incorrectly
compared a timestamp it had deliberately modified; it now checks unchanged registration
and completed state after expiry. The real-socket fixture uses Node HTTP's explicit
Host-header handling, as the sibling transport tests do.

The Claude review took 743 seconds. Added contention tests for the final completion
expiry check and browser approval expiry; each fails with its guard removed. Retained
the passive business-read session recheck: a real table-maintenance lock reproduced
expiry during the SELECT, and removing the recheck makes its test fail. Borrowed
configuration reads now use the supplied transaction. Completed requests retain their
browser code-guess limit. Missing confirmation names refuse approval and roll it back.
The final focused run passed 42 registration/proof/pairing tests, five HTTP tests and
workspace types. The PR records current-head CI and landing. Public deployment gates,
shared-IP limits and request/account retention follow-ups are recorded in the backlog.
