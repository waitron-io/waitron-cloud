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

Watcher, same file, 7 November 01:05: “Approved: ten holds a UTC month,
eight suggestions a workflow, twenty a UTC day”; “No calendar, Los Angeles or
DST code.” “Take the one lock, wait out the 500 ms under it, send, release.
If the lock is unavailable refuse busy. A crash can shorten one gap: state that
in one sentence in the PR and stop there. No crash test, no committed per-second
counter, no extra guarantee. Build it, and hand E the route.”

## Contract and authority

- [ ] Add `src/address-lookup.ts` under account-http; wire optional injected
  provider through `app.ts`/`server.ts`. Extend registration's
  `installation-proof.ts` action list with `address-lookup`; reuse the signed
  envelope, POST `/api/installations/address-lookup`, standard host/origin/body/IP/key
  guards (`staff-certificates.ts`). No caller-selected account/provider/key.
  Require the configured account/venue/installation tuple, test environment,
  verified owner and live matching lease. Use `reserveAllowance` on every call for write-lock ordering and authority.
  Do not prelock the venue FOR SHARE. Recheck proof, matching lease, test tuple,
  revocation, replacement and expiry after all waits before admission commits.
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
  ≤256-ASCII binding contains version, creation and expiry only. Expire at the
  earlier of 15 minutes or next UTC month; do not bind to one renewed lease ID.
  Never recreate expired workflows. Missing published allowance refuses.
  Serialize account admission; independently enforce 10 held/spent workflows/account/UTCmonth
  across tiers. Abandoned holds remain; validation spends/closes before sending.
- [ ] Reuse `AccountRateLimiter.consume` unchanged inside admission: workflow
  eight suggestions/900s, account-plus-UTC-date twenty suggestions/86400s,
  installation-plus-call-ID one attempt/300s. Check held before spending validation;
  close before send. Roll back every failed admission. Never refund uncertain sends.
  Ten held/spent workflows/month × eight gives ≤80 suggestions/month, satisfying
  100/account/month. An LA month intersects at most two UTC months: ≤160 suggestions
  and20 validations, below4000/500; daily ceilings400/50 also hold. Owner's outside
  usage confirmation remains external. No calendar extension or DST code.
- [ ] Borrow a client, install an error listener/abort signal, then take a schema-keyed
  `pg_try_advisory_lock` before admission. Busy refuses without consuming anything.
  Wait500ms under the lock, admit/commit, then call the provider and unlock in finally;
  no transaction spans network. Final proof/expiry/connection checks precede send.
  Abort on connection loss; discard a session when unlock fails, following
  `packages/backups/src/catalogue.ts:90-103`. No durable busy latch, per-second
  counter, crash test, extra guarantee or operator recovery step. PR states:
  “A crash can shorten one dispatch gap in this one-box trial.”
- [ ] No address bodies/results/hashes in storage, logs or metrics, including
  installation_operations. No new table/job/grant/cancellation endpoint.

## Verification and handoff

- [ ] Real PostgreSQL/HTTP TDD in `packages/account-http/test/address-lookup.test.ts`: observe assertion
  failures, implement minimally, then pass; cover concurrent/replayed sends,
  uncertain consumption, trial caps, UTC month/day/pruning boundaries, authority changes
  during waits and content-free storage. Run `node scripts/test-postgres.mjs exec
  node --test packages/account-http/test/address-lookup.test.ts`, client tests and
  `pnpm exec tsc -p tsconfig.json`. Keep tests ≤about twice implementation.
- [ ] Joint fake-provider handoff to E's existing screens: manual entry, Google
  attribution, editable fields, separate confirmation, refusal/expiry. Retain
  billing/storage acceptance and public terms/privacy links. No Waitron edits.
  Retain deployment key drops and old/v1/new-path refusals; add the new-path
  refusal to `deploy/test-cloud/free-services-mail.test.mjs`. Record the trial’s
  counted-abandonment exception for removal with the real service in the existing backlog. Live wiring remains
  absent pending watcher key, owner’s outside-usage/quotas confirmation, published
  allowance and tested stop control; build no
  account-verification system. Watcher supplies `/root/waitron-address/google.env`
  server-only, file0600/parent0700. No live requests/spending; translation's
  production refusal/consent/cap/paging stays unchanged.
