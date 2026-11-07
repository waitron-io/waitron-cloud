# Machine tunnel provision implementation plan

**Authority:** Owner’s lane D request; `~/waitron-campaign-shared/a951-simple-brief-20261106.md`; watcher D, 2026-11-07 03:06 and 03:36. Obtain one short Claude read through `~/workspace/tools/claude-seat.sh review-branch` before building; no additional owner approval.

**Scope:** One configured test box. No table, job, protocol, ledger, callback, CLI switches, configurable port or live wiring. Translation/address await keys; G5/admission remain closed. This is not the joint appliance protocol. Replacement risk is accepted for this unreplaced trial box; no replacement query.

- [ ] **Test first.** Add `packages/account-http/test/tunnel-provision.test.ts`; run `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/tunnel-provision.test.ts`, observing the expected failure before implementation. Cover wire/errors, options propagation/validation, disabled/production/foreign-installation refusals, forged/foreign/expired leases/proofs, revocation/supersession, malformed/extra fields, Origin/body/rate limits, operator provisioning and concurrent same-key retries. Use real PostgreSQL policy/installation/cell/peer lock waits: changed key/venue/environment or expired authority rolls back placement, hostnames, counter, service and revision writes, including same-key restoration; unchanged authority succeeds. Test withdrawn permission only at policy wait. Preserve existing assertions.

- [ ] **Share provisioning.** In `packages/remote-access/src/placement.ts`, extract store method `provisionInTransaction(client,installationId,cellId,peerPublicKey,port)` including validation, plan checks and PostgreSQL `23505` conflict handling. Keep operator `provision` wrapping it; update operator-only comment. Retain policy→installation→cell→peer locking and checks in modes that have them; permit `existing` only for the configured box through this route. Export existing `view` as `installationView` from registration’s `installations.ts`/`index.ts`.

- [ ] **Add route.** Create `packages/account-http/src/tunnel-provision.ts`; register before generic installation routing in `app.ts`. Extend registration’s `MachineAction`/parser. Validate optional `tunnelProvision:{installationId,cellId}` in app/server only; require issuer, default disabled, fixed port 443. Select only configured IDs. Before waits/allocation, capture initial public key/venue and refuse production. Within the transaction, provision, read the existing view, then use one fresh statement after all policy/installation/cell/peer waits and the view, under installation lock immediately before commit: recheck signature/proof time, trusted canonical live lease/time, revocation/supersession, test environment and unchanged venue/key. Failure rolls everything back.

  Exact `POST /api/installations/tunnel-provision`: JSON `{payload,signature}`, signed `machine-v1`, action `tunnel-provision`, canonical body `{"peerPublicKey":"<canonical 32-byte WireGuard base64>"}` only. Return 200 existing v1 `InstallationView`, three services, no new lease; `remote_access.configuration` `{version:1,...Placement}`. Same key/cell/443 reuses allocation/revision except existing setup restoration; changed key is terminal 409 regardless of operation ID.

  Follow address-route order: shared all-IP 120/minute, method, Origin, enabled, installation-IP 60/minute, body, authentication, installation 30/minute, execution. Leave address routing unchanged. Reuse `readAccountBody`: 16,384 bytes/5 seconds.

  | Error | HTTP reply `{error:code}` |
  |---|---|
  | permission_denied; revoked | 403 same code |
  | invalid_proof | 401 invalid_proof |
  | placement_conflict; 23505 | 409 placement_conflict |
  | cell_full/cell_unavailable/installation_unavailable/disabled | 503 temporarily_unavailable; Retry-After: 1 |
  | invalid input/body timeout/size/type | 400/408/413/415 invalid_input |
  | Origin; method; limits | 403 forbidden; 405 method_not_allowed; 429 rate_limited with Retry-After |

- [ ] **Verify/handoff.** Add disabled-path coverage in `deploy/test-cloud/free-services-mail.test.mjs`; pass new tests, focused placement/direct-wait/installation tests via PostgreSQL wrapper and `pnpm typecheck`; CI owns full suites. Update integration contract, required review records and existing backlog only; `remote-access-http.md` has nothing to delete. Send E exact request/reply: persist private key before calling; retry with fresh proof/same key; changed-key 409 is terminal. Add replacement limitation to existing backlog only if required before real venues.
