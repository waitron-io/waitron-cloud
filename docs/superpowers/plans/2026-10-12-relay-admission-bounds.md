# D57: Relay admission bounds implementation plan

**Goal:** Enforce independent shared recipient/grant counts and retained encrypted
payload bytes without changing account units or ingress limits.
**Spec:** [Design](../specs/2026-10-12-relay-admission-bounds-design.md).
**Architecture:** PostgreSQL serializes counter reservations; a database trigger
accounts for every payload mutation and enforces the byte ceiling.
**Stack:** Node 26, TypeScript, `pg`, PostgreSQL 18, existing Node test/HTTP fixtures.
**Execution:** Drive implementation inline, using test-first cycles. Read the TDD
skill before writing implementation or tests. No mandatory subagent workflow.

## Delivery boundary

First finish a docs-only plan PR. Then deliver all production implementation below
in **one cohesive PR**. Tasks are development checkpoints, never independently
landed slices: configuration, counters, triggers, migration and worker-path
acceptance must ship together. Keep relay disabled by default and local-proof only.
Use local fixtures only. All commits use `git commit -s`; never bypass hooks.

## Task 1: Shared configuration and counter reservation

**Create:** `packages/registration/src/relay-bounds.ts`,
`packages/registration/migrations/034_relay_admission_bounds.sql`,
`packages/registration/test/relay-bounds.test.ts`.
**Modify:** registration `src/{relay-messages,migrate,index,history-cleanup}.ts`,
`test/history-cleanup.test.ts`, `test/fixtures/relay-worker.ts`, and account-http
`src/relay-messages.ts`, `test/fixtures/relay.ts`.

**Interfaces:** Export the design's `RelayBoundsConfig` and
`RelayBounds(pool: Pool, config: RelayBoundsConfig)` with
`check(client: PoolClient): Promise<void>`,
`reserve(client: PoolClient, input: {grantId: string; recipient: string}): Promise<Date>`,
`prune(client: PoolClient, limit: number): Promise<number>`, and
`status(): Promise<{retainedPayloadBytes: string; counterRows: number}>`.
All client methods require a transaction. `check` serializes policy binding/live-key
validation with the schema-scoped admission lock; `reserve` reuses that lock.
`reserve` returns the reserved window end for the final rollover check, avoiding mutable
state shared between calls. `prune` deletes only database-expired window data, up to its row limit.
Export `RelayBoundsError` with `rate_limited | relay_unavailable`; map the trigger's
fixed `P0001/relay_bytes_exhausted` exception to `rate_limited`.

- [ ] Add named tests `invalidBoundsConfiguration`, `sharedPolicyMismatch`,
  `windowKeyRotation`, `boundedCounterRetention`, `transactionRequired`,
  `authorityExpiryWhileWaiting`.
  Assert omitted/unknown fields, zero/negative/fractional/unsafe numbers, invalid
  epochs/keys, absent active key and incompatible instance policies are refused.
  Assert different active IDs use one live window; changed material/missing old
  keys fail closed; expiry permits retirement; repeated rotations never replenish
  counts. Assert cleanup cannot remove live rows and row counts stay bounded.
  Block the bounds lock, pass proof/lease/grant deadlines, then release it:
  assert refusal and no new debit, counter or ciphertext.
- [ ] Run the first command below red. Implement immutable policy/window/counter storage,
  key pinning and expiry cleanup; require explicit fixture bounds. Rerun to green.
- [ ] Integrate after locked proof verification and existing replay/conflict checks.
  Reverify signature, lease, installation/grant and message deadlines after bounds-
  lock waits and after INSERT has acquired the tally. Reuse already locked authority
  and verified lease data; take no new authority/message locks after the tally.
  If the reserved counter window ends during the INSERT wait, roll back the whole
  admission with retryable `503 relay_unavailable` and a one-second retry hint. Map bound
  exhaustion to fixed `429 rate_limited` with bounded `Retry-After`; leave existing
  `allowance_exhausted`, ingress limits and conflicts unchanged.

Local test choices only: recipient limit 2, grant limit 3, 60-second windows,
64 counter rows; generate separate recipient keys. Set byte limits from measured
fixture ciphertext lengths. Existing fixture suites receive explicit ample local
budgets, never implementation defaults.

## Task 2: Byte accounting, migration and every clearing path

**Modify:** the new SQL and bounds store; registration
`test/{relay-worker,registration,schema-compatibility}.test.ts`.
**Create:** `packages/registration/test/relay-bounds-migration.test.ts`.
Trace registration `src/relay-{messages,payload,worker,grants}.ts` and migrations
031–033; retain their authority and state assertions.

- [ ] Add red `retainedBytesInvariant` assertions at each mutation:
  admission INSERT; API queued cancellation/expiry UPDATE; worker claim and sending
  transitions; temporary refusal/backoff; terminal accepted/refused/uncertain;
  expired sending-claim recovery; expiry, authority loss, suppression, exhausted
  attempts and payload-key failure in handoff. Check actual `octet_length` sums.
  Claim/sending/backoff retain bytes; every payload clear releases once; stale claims
  cannot double-release. Add direct payload replace/delete/truncate checks and
  non-ASCII content to distinguish UTF-8 bytes from character counts.
- [ ] Run the migration and worker tests red, implement tally/backfill/atomic delta
  trigger and cap error mapping, then green. Preserve worker state semantics.
  Verify one-message transactions and tally-last ordering; SMTP stays outside locks.
- [ ] Add `existingCiphertextUpgrade`: seed unmodified 001–033 with queued/sending
  ciphertext, apply 034 twice and concurrently, verify bytes/data preserved, above-cap
  growth refused and draining allowed. Interrupt migration before completion,
  assert DDL/ledger rollback, retry and compare names/digests. Restore a pre-upgrade
  backup into a separate fixture with external keys; preserve the upgraded fixture.
- [ ] Append the manifest in `src/migrate.ts`. Preserve the original 33-migration
  count/tail assertions in an explicit legacy fixture; add current 34-migration
  ledger assertions. Keep all behavioral assertions. Add missing/future/changed
  manifest checks through `deploy/local-stack/runtime.mjs`'s `checkConsumerSchema`
  and release-count checks from `scripts/database-recovery-migrations.mjs`.
  Preserve the historical pinned schema-upgrade rehearsal.

## Task 3: Real cross-instance HTTP acceptance and completion

**Create:** `packages/account-http/test/relay-admission-bounds.test.ts` and
`test/fixtures/relay-http-process.ts` in that package.
**Extend:** its `test/fixtures/relay.ts` to start two child HTTP servers against the
same schema, issuer and explicit configuration. Keep `relay-process.ts`'s existing
store-restart assertions. Preserve existing relay/disabled tests, including the
cancellation test's wait on the message UPDATE.

- [ ] Add red `recipientRaceAcrossAccounts`: barrier-start different accounts and
  installations against both real HTTP servers; exactly two admissions succeed for
  one recipient. `grantRaceAcrossRecipients` admits exactly three for one grant.
  `bytesRaceAcrossAccounts` uses distinct recipients and grants: with cap `2*L`,
  exactly two equal-length ciphertexts of size `L` fit. Assert PostgreSQL counters,
  tally, messages and account reservations agree; test exact-cap and one-byte-over.
- [ ] Add `retryConflictForgeryRollback`: lost-response exact retries, including
  after process restart/window rollover, change no budget/debit/bytes; modified
  replay stays 409 even when full. Forged installation and foreign-grant requests
  leave victim counters untouched. Inject queue-insert and commit failures;
  assert no partial reservation. Key/policy mismatches return fixed unavailable
  errors. Different active IDs cannot bypass recipient limits.
- [ ] Run new HTTP tests red, complete integration, then green. Add `workerAdmissionContention`
  with two workers, cancellation, reaping and concurrent admissions; enforce a
  timeout and assert no deadlocks, overrun or premature byte release. Add
  `tallyWaitDeadlineRecheck`: hold the tally row from a second connection and observe
  the INSERT waiting. Pass each proof/lease/installation/grant/message deadline or
  the counter-window end before releasing it; assert full rollback of both counters,
  bytes, message and account debit. Rollover returns retryable 503; a fresh request
  succeeds in the new window. Use local short deadlines and database barriers without
  changing existing security assertions or proof-window values. Add
  `boundedDiagnostics`: aggregate status/errors and existing operations metrics
  contain no fixture addresses, digests, key/message IDs or such label names.
- [ ] In a disposable checkout only, delete counter serialization, pinned-key
  checks, cap predicate, delta accounting and post-wait authority/deadline guards
  individually. Each corresponding acceptance test must fail for its intended
  assertion. For serialization, race distinct recipients at `maxCounterRows`.
  Use deterministic database barriers. Restore each
  guard; baseline passes again. Never weaken or remove existing assertions.
- [ ] Record proposed checks as executed evidence only after running them. Update
  contract/backlog with actual receipts and remaining production prerequisites in
  the implementation PR. Commit with sign-off; run `finish-branch`, its whole-branch
  review, normal push hook and current-head CI before declaring readiness.

## Focused commands

From repository root, during implementation:

```sh
node scripts/test-postgres.mjs --dir packages/registration exec node --test --test-timeout=30000 test/relay-bounds.test.ts
node scripts/test-postgres.mjs --dir packages/registration exec node --test --test-timeout=30000 test/relay-bounds.test.ts test/relay-bounds-migration.test.ts test/relay-worker.test.ts test/relay-grants.test.ts test/history-cleanup.test.ts test/registration.test.ts test/schema-compatibility.test.ts
node scripts/test-postgres.mjs --dir packages/account-http exec node --test --test-timeout=120000 test/relay-admission-bounds.test.ts test/relay-messages.test.ts test/relay-disabled.test.ts
node --test deploy/local-stack/schema-consumer.test.mjs scripts/database-recovery-migrations.test.mjs scripts/verify-schema-upgrade-receipt.test.mjs scripts/schema-upgrade-fixture.test.mjs
pnpm typecheck
```

Keep runtime proof local and stop only recorded child PIDs/owned containers.
Review focus: window boundaries after waits; policy drift; dormant expired rows;
legacy over-cap queues; late worker replies. The implementation and [local acceptance commands](../../transactional-email-relay-contract.md#exercise-shared-admission-bounds)
now exercise these boundaries; production deployment and thresholds remain open.
