# Local relay worker implementation plan

**Goal:** Deliver D46's encrypted messages only to disposable loopback SMTP, with bounded retries and no automatic resend after an uncertain handoff.

**Spec:** [Version 1 relay contract](../../transactional-email-relay-contract.md), slice 3. The campaign authorises inline implementation and one Claude security/run-it review.

**Architecture:** A separate `RelayWorker` claims one existing relay row, validates current authority using the existing reservation replay, and commits `sending` before SMTP. Claimed queued work can be cancelled; an expired sending claim becomes uncertain. This commit is the handoff boundary: revocation committed before it prevents delivery; later revocation cannot recall mail. Reuse Nodemailer for a loopback-only capture adapter, without changing the account-mail adapter's different retry rules.

**Constraints:** No production switch, provider, Waitron edit, live message or allowance decision. Four globally active claims, 60-second lease, 15-second SMTP deadline, at most 20-second worker deadline, eight attempts with 30-second exponential retry capped at 900 seconds and bounded by expiry. Retain reservation/replay tombstones indefinitely pending retention policy. Clear all terminal ciphertext. Keep fixed reason/status counters without message content or identifiers.

## Tasks

- [x] Add failing PostgreSQL/SMTP tests using signed D46 admission: default disabled; two workers/accounts; accepted templates; cancel before/after handoff; authority loss and lock races; deadline; suppression; missing/rotated keys; temporary/permanent failure; post-DATA disconnect; restart after process death; status redaction; constraints and tombstones.
- [x] Add migration 033 for leases, attempts, scheduling and state/reason pairs, plus keyed local suppression. Add `RelayWorker(pool, config?)`, `runOnce(): Promise<boolean>`, `suppress(recipient): Promise<void>` and `status()` with fixed counters. No default startup wiring. Existing D46 cancellation clears claim metadata as well as ciphertext.
- [x] Add local SMTP adapter and fixed English/Spanish plain-text templates, verifying the encrypted origin and structured fields before rendering. Explicit SMTP refusals are known non-acceptance; only demonstrated pre-DATA failures may retry; unknown errors/timeouts are uncertain. Keep SMTP logging, URL/file access and real destinations disabled.
- [x] Run focused worker, grant/admission and existing account-mail suites and typecheck. Delete critical guards in an owned disposable copy and observe failed behavioural tests. Update contract/backlog with proof boundaries and remaining Waitron, joint proof, policy/provider work.
- [x] Finish once: rebase, isolated Claude run-it/security review, triage fixes, normal push and CI. [CI 36855902107](https://github.com/waitron-io/waitron-cloud/actions/runs/36855902107) passed on the rebased implementation head `7b5cdb1f50449e4a9c2d50e59f757aa1c1cd8716`.

The campaign ledger owns landing and exact-merge CI receipts. Land only a green current head under the shared lock. After exact-merge success, prepare the authorised AWS account handoff in the campaign questions ledger. Do not provision anything.

## Review focus

Cancellation and grant revocation must share a well-defined boundary with handoff. Suppression must survive key rotation and fail closed if historical keys disappear. Crashes after the durable handoff must never turn back into queued work. A successful SMTP call followed by a database write failure must leave uncertain recovery, not trigger a resend. Expiry and claim ownership must be checked after every lock wait; unknown errors must not leak content.

**Verification:** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=30000 test/relay-worker.test.ts test/relay-grants.test.ts test/email-outbox.test.ts test/smtp-mailer.test.ts`; separate account HTTP admission suite; `pnpm typecheck`. CI owns the complete workspace suite.

Implementation receipts: the initial worker suite failed on the absent exported worker. A post-DATA disconnect then exposed Nodemailer's generic CONN error, so only proven pre-acceptance failures retry. The expiry-after-lock regression reproduced accepted mail after grant expiry and now rechecks wall time. A separate expired-content/key-loss regression requires cleanup before checking suppression keys. Existing HTTP sending fixtures gained claim ID/lease fields; their assertions are unchanged. The migration list pin adds 033 while preserving all prior names/order. The Waitron source trace confirms query token/purpose and fragment email; the new template expectation was corrected to that existing contract.

Review complete once (1,024 seconds). Added stolen/expired-claim and late-result tests; the final handoff update now checks the original worker claim. Two-schema blocking and a volatile-default table rewrite were reproduced and fixed. The worker suite now has 36 cases. Retained conservative uncertainty on unclassified timeouts and documented its tradeoff, fixed public refusal meanings, missing-key claim occupancy and experimental pre-worker sending-row migration limits. No repeated whole-branch review is needed for these bounded fixes. The rebased implementation passed CI as recorded above; later commits still require their own current-head checks.
