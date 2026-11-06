# Test-box address route amendment

Implement inline only after the parent's Claude prebuild read. This amends
`2026-11-07-test-address-lookup.md`; retain its client boundaries.

## Authority

Owner step5, `~/waitron-campaign-shared/a951-simple-brief-20261106.md`, 6 November
19:29: “Add one Cloud route over Google”; “Keep manual entry, Google's attribution,
no stored provider responses and the request limits in `docs/address-lookup-scope.md`.”

Watcher, `~/waitron-campaign-d/questions.md`, 7 November 00:47:
“Chosen: the conservative trial. One allowance unit per workflow, abandoned holds
stay counted, eight suggestions and one validation per workflow, existing counter
rows for the rest, this one box only. No cancellation accounting. Remove the
exception when the real service is scoped.” Also: “Do not land the client alone ...
Finish the client, then write the route amendment for its Claude read and land
them together.”

## Contract and authority

- [ ] Add `src/address-lookup.ts` under account-http; wire optional injected
  provider through `app.ts`/`server.ts`. Extend registration's
  `installation-proof.ts` action list with `address-lookup`; reuse the signed
  envelope, POST `/api/installations/address-lookup`, standard host/origin/body/IP/key
  guards (`staff-certificates.ts`). No caller-selected account/provider/key.
  Require the configured account/venue/installation tuple, test environment,
  verified owner and live matching lease. Follow `billing-display-machine.ts`
  parent-lock ordering; recheck proof freshness, authority, revocation,
  replacement and expiry after **all** lock waits, immediately before admission commits.
- [ ] Signed `operationId` identifies each call; `workflowId` is a UUID in strict
  bodies `{version:1,kind:"suggest",workflowId,query,language}` or
  `{version:1,kind:"validate",workflowId,selectedText}`. First suggest opens the
  workflow; validation needs its existing hold. Replies contain workflowId,
  expiresAt and the client's provider/candidates or fields. No extra sequence
  protocol. An existing counter row marks each operationId consumed before sending;
  duplicate calls refuse, never cache/replay address replies. Closed/expired
  workflows refuse; errors retain the client's dispatched flag and ordinary
  HTTP authority, conflict and quota refusals.

## Durable admission

- [ ] Reuse `billing-allowances.ts`/migration048 reservations: one unit,
  workflow operation_id, server reservation UUID as Google token. Immutable
  ≤256-ASCII binding contains version, leaseId, creation/expiry instants only.
  Expiry is earliest of 15 minutes, lease expiry, next UTC month or Los Angeles
  month. Never recreate expired workflows. Missing allowance configuration refuses.
  Serialize account admission; independently enforce 10 held/spent workflows/account/UTCmonth
  across tiers. Abandoned holds remain; validation spends/closes before sending.
- [ ] Extend `rate-limit.ts` with dedicated calendar/cursor admission using existing
  `account_rate_limits` rows, not its ≤86400-second first-hit windows. Atomically
  enforce 8 suggestions/1 validation/workflow; account suggestions 100/UTCmonth,
  20/UTCday; Google validations 500/month,50/day and suggestions 4000/month,400/day
  in America/Los_Angeles. Lock deterministically; recompute calendars after waits.
  Commit call identity, counters and consumption before dispatch. No refunds/retries,
  including uncertain sends. Never store address bodies/results/hashes, including
  in `installation_operations`, logs or metrics. No table/job/grant/cancellation endpoint.
- [ ] Serialize provider dispatch with a shared session advisory lock, retained
  through the network attempt and a 500ms gap afterward, then released in finally.
  Commit quota consumption before sending; never hold a database transaction
  across the network. Lost database authority stops dispatch. No durable busy latch
  or new operator approval/recovery step.

## Verification and handoff

- [ ] Real PostgreSQL/HTTP TDD in `packages/account-http/test/address-lookup.test.ts`: observe assertion
  failures, implement minimally, then pass; cover concurrent/replayed sends,
  restart/uncertain consumption, every ceiling, month/DST/pruning boundaries, authority changes
  during waits and content-free storage. Run `node scripts/test-postgres.mjs exec
  node --test packages/account-http/test/address-lookup.test.ts`, client tests and
  `pnpm exec tsc -p tsconfig.json`. Keep tests ≤about twice implementation.
- [ ] Joint fake-provider handoff to E's existing screens: manual entry, Google
  attribution, editable fields, separate confirmation, refusal/expiry. Retain
  billing/storage acceptance and public terms/privacy links. No Waitron edits.
  Retain deployment key drops and old/v1/new-path refusals. Live wiring remains
  absent pending watcher key and owner's outside-usage confirmation; build no
  account-verification system. Watcher supplies `/root/waitron-address/google.env`
  server-only, file0600/parent0700. No live requests/spending; translation's
  production refusal/consent/cap/paging stays unchanged.
