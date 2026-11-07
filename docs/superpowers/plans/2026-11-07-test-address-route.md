# Test-box address route amendment

Implement inline after Claude reads this amendment; retain the existing client plan.

## Authority

Owner step5, `~/waitron-campaign-shared/a951-simple-brief-20261106.md`, 6 November
19:29: “Add one Cloud route over Google”; keep manual entry, attribution, no stored
responses and the scope’s limits. Watcher, `~/waitron-campaign-d/questions.md`,
7 November 00:47: “One allowance unit per workflow, abandoned holds stay counted,
eight suggestions and one validation per workflow, existing counter rows for the
rest, this one box only. No cancellation accounting.” Client and route land together.

Same file, 01:05: “Approved: ten holds a UTC month, eight suggestions a workflow,
twenty a UTC day”; “No calendar, Los Angeles or DST code.” “Take the one lock,
wait out the 500 ms under it, send, release. If the lock is unavailable refuse busy.
A crash can shorten one gap: state that in one sentence in the PR and stop there.
No crash test, no committed per-second counter, no extra guarantee. Build it,
and hand E the route.”

## Build

- [ ] Add `packages/account-http/src/address-lookup.ts`, optional injection in
  `app.ts`/`server.ts`, and `address-lookup` in registration’s two machine-action
  allowlists. Reuse POST `/api/installations/address-lookup`, signed envelope,
  standard host/Origin/body/IP/key guards. Only the configured account/venue/
  installation tuple, verified owner, current key, matching live lease and test
  environment may dispatch. Production/default absence refuses; no CLI/key wiring.
- [ ] Per-call signed operationId; client-generated lowercase UUID workflowId; strict bodies
  `{version:1,kind:"suggest",workflowId,query,language}` or
  `{version:1,kind:"validate",workflowId,selectedText}`. First suggest opens a UUID
  workflow; validation requires its existing hold. Replies: workflowId, expiresAt
  and the client’s provider/candidates or fields. No sequence protocol or cached
  replies. Export the client’s `checkInput` from its module and reuse it to reject invalid
  client input before reserving. Duplicate, expired and
  closed calls refuse; retain ordinary authority/conflict/quota HTTP errors and
  the client’s seven fixed provider errors with dispatched flag.
- [ ] Borrow a client with error listener/abort; acquire schema-keyed
  `pg_try_advisory_lock` before admission. Busy spends nothing. Wait500ms under it.
  Admit/commit, send, unlock in finally; never hold a transaction across network.
  Connection loss aborts; failed unlock discards the session, following
  `packages/backups/src/catalogue.ts:90-103`. PR states: “A crash can shorten one
  dispatch gap in this one-box trial.” No extra recovery/spacing mechanism.
- [ ] Read the installation-scoped saved reservation under the lock first. Unknown
  validate refuses without reserving; reuse saved binding/expiry unchanged. Take
  new creation time from DB clock, then call `reserveAllowance` before consume for
  authority; never prelock venue FOR SHARE. One address unit/workflow, reservation
  UUID as Google token, immutable ASCII binding with version/creation/expiry only.
  Expire by15minutes or UTC month end, never recreate an expired workflow.
  Independently cap account-wide held/spent workflows at10/month across tiers.
  Check held before validation spends/closes. Abandoned holds remain counted.
  Recheck signature, lease, revocation, replacement, connection, expiry and UTC
  date after every lock wait before committing. No extra post-commit read.
- [ ] Reuse `AccountRateLimiter.consume` unchanged: workflow8/900s suggestions,
  account-plus-UTC-date20/86400s suggestions, installation-plus-call-ID1/300s.
  Roll back every failed admission; commit consumption before sending, never
  refund uncertain sends. Ten×eight limits UTC-month suggestions to80<100.
  LA months intersect at most two UTC months: ≤160 suggestions/20 validations,
  below4000/500; daily400/50 also hold. Outside usage is an owner-confirmation gate.
  No address bodies/replies/hashes in any storage/logs/metrics or operation records.

## Verify and hand off

- [ ] Real PostgreSQL/HTTP TDD in `packages/account-http/test/address-lookup.test.ts`:
  expected assertion failures first; then minimal code/pass. Cover trial caps,
  concurrency, busy/replay/uncertain refusals, UTC rollover/pruning, authority/expiry
  after waits and content-free storage. No crash test. Run with
  `node scripts/test-postgres.mjs exec node --test packages/account-http/test/address-lookup.test.ts`;
  client tests and root tsc. Preserve assertions; temporary guard omissions only.
- [ ] Add new-path refusal to `deploy/test-cloud/free-services-mail.test.mjs`;
  retain key drops/old paths. Update existing backlog with trial-exception removal.
  Hand E the fake-provider wire for its existing screens: editable/manual fields,
  Google attribution, country-pack checks and separate whole-address confirmation.
  No Waitron edits. Live use awaits server-only key, owner usage/quotas confirmation,
  published allowance, stop control and retained terms/privacy gates. No new table,
  job, grant or cancellation accounting; translation remains unchanged. PR says
  Google activation is a separate reviewed change; this route reaches fakes only.
