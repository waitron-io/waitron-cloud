# Relay operator stop implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` inline, task by task, and read `superpowers:test-driven-development` before writing implementation or test code. The parent obtains fresh-context plan review and lands these two files docs-only first; then build one cohesive implementation PR.

**Goal:** Stop new relay admission and unstarted worker work durably across running processes while preserving real send outcomes and independent account mail.

**Architecture:** One schema-local control row serializes stop/resume against shared locks at entry to admission, claim and handoff transactions. Existing authority, replay, capacity, suppression, settlement and byte accounting remain authoritative. Trusted local CLI only.

**Tech stack:** Existing TypeScript, Node test runner, `pg`, PostgreSQL 18, hand-written transactional migrations and loopback SMTP fixtures; no new dependency.

**Spec:** [Durable relay operator stop](../specs/2026-10-13-relay-operator-stop-design.md).

## Global constraints

- Default `stopped=false`; local-proof only, normal startup off. No network permission, provider, production policy, Waitron or fiscal change.
- New submit while stopped: `403 {"error":"relay_disabled"}`, no relay spend. Ingress counters remain applicable.
- Status/cancel/exact replay retain current authority and errors. Never gate `RelayGrantStore.reserve`.
- Control lock first, byte tally last; no transaction/client lease/lock across SMTP. Sending COMMIT is the irreversible boundary described in the spec.
- Append `036_relay_operator_stop.sql`; never edit applied SQL or weaken historical ledger/behavior assertions.
- Every code slice: write failing behavioral tests, run and inspect expected failure, implement minimally, rerun focused tests, run its guard controls, then `git add` the task's files and `git commit -s -m "<task message>"`. Keep RED/GREEN/control receipts outside tracked product files. Never bypass hooks.
- Use observed `pg_stat_activity` waits with identified blocker PIDs and bounded polling, never sleep-based race ordering. Track and clean up only your fixture processes/containers.
- Label each fixture pool/process with a unique `application_name`. A wait helper must match that name, expected query and `wait_event_type='Lock'`, and assert the expected PID appears in `pg_blocking_pids(pid)` before releasing the blocker; query `pg_stat_clear_snapshot()` when polling within a transaction. A polling delay is only retry pacing, never ordering evidence.

## Review focus

- Stop between committed claim and handoff must clear only its own queued token (Task 4).
- Shared readers must block acknowledged stop through COMMIT, including a writer already waiting (Tasks 3–4).
- Expired sending, late replies and temporary refusals remain truthful while stopped (Task 4).
- Missing state, command/commit failure and incompatible schema must never report successful running/resume (Tasks 1–2).
- Old backups and post-stop backups have different stop state; preserve old ledger and receipt meanings (Task 5).

## Task 1: Control schema and transaction API

Complete locally: C1 passes 45 checks, C2 passes 17, and nine independent control
mutations fail their owning assertions. The restored candidate passes 45 checks.
The release consumer CLI fixture also keeps every original assertion and deadline
while giving each missing migration its own test; all 31 cases pass with a controlled
one-second startup cost, and deleting its manifest guard fails the 036 case.
Admission, worker, upgrade/restore and branch completion remain below; Task 2 records CLI proof.

**Create:** registration `migrations/036_relay_operator_stop.sql`, `src/relay-control.ts`, `test/relay-control.test.ts`, `test/relay-control-migration.test.ts`.
**Modify:** registration `src/{migrate,index}.ts`, `test/{registration,relay-bounds-migration,authenticator-schema}.test.ts`.
**Interface:** Export `RelayControlStatus = {stopped:boolean}` and `RelayControl(pool:Pool)` with `lock(client:PoolClient)`, `status()`, `stop()`, `resume()`, each returning `Promise<RelayControlStatus>`. `lock` requires BEGIN and holds SHARE; mutations hold UPDATE until commit. Errors use existing classes from the spec.

- [x] Add `control is durable and idempotent`: initial status exactly `{stopped:false}`, stop twice gives true, fresh pool sees true, resume twice gives false; unrelated account/queue rows unchanged. Add `control locks require transactions and missing rows fail closed`: autocommit gives `transaction_required`, no mutation; deleted row gives `relay_unavailable` for all four methods and is not recreated. Assert false singleton and duplicate row inserts are rejected by PostgreSQL.
- [x] Add `036 preserves populated 35-migration state`: seed queued/delayed/claimed/sending/terminal messages plus account/factor rows; remove only new control/036 to form release 35. Snapshot all existing rows, message table identity and full ledger. Migrate concurrently and twice: exact old rows/35 digests survive, only 036 appended and initial flag false. Stop, migrate again, assert true. For interrupted DDL, hold a conflicting schema lock (for example SHARE on `schema_migrations` blocks the 036 ledger insert); observe the migration PID waiting on that lock, cancel it, assert table and 036 entry absent, ledger/data unchanged, retry succeeds.
- [x] Preserve legacy tests explicitly: keep registration's exact 33 prefix and exact 34/35 tails, add current 36/tail. `relay-bounds-migration` removes 036/control before its existing 035/034 downgrade and still proves 33 data/restore; new latest counts are 36. `authenticator-schema` removes 036/control before forming 34, asserts exact 35 prefix after migrate plus new 036, preserving credential/session assertions. Current release gates accept 36 and reject 33/34/35/37, missing, altered and unknown names/digests.
- [x] Run C1/C2 below for RED; implement one-row SQL, append manifest, implement API using existing savepoint transaction discipline and exports; rerun GREEN. Control tests must observe a SHARE holder blocking stop, rollback releasing it, and serialized concurrent stop/resume returning committed state.
- [x] Controls in a disposable copy: remove missing-row check, transaction check or singleton constraint independently; replace control SHARE with plain SELECT; suppress the stop/resume write; reset stop during repeat migration. Each owning assertion must fail; restore and pass. Observe the stop/resume FOR UPDATE statement and its actual blocker, without claiming that deleting this SELECT lock alone defeats the later UPDATE's own row lock. Commit: `feat: persist relay operator control`.

## Task 2: Trusted local stop/resume/status command

Complete locally: 21 CLI checks pass, along with the five control and nine existing
authenticator-key checks. Eighteen independent mutations fail their intended
assertions. Two redundant checks survive deletion: URL parsing still refuses a
missing environment value, and the transaction deadline still bounds a single
ledger-read statement. Removing both statement/transaction bounds fails that read;
removing the transaction bound alone fails the cumulative-wait check. Both configured
deadlines remain. The restored CLI passes all 21 checks.

**Create:** `packages/registration/src/relay-control-cli.ts`, `packages/registration/test/relay-control-cli.test.ts`.
**Modify:** root and registration `package.json` scripts.
**Interface:** `pnpm --silent relay:control --stop|--resume|--status`; silent nested forwarding and one exact JSON line `{stopped:boolean}`. Fixed error text and exit 1 from the spec; no auto-migration or worker start.

- [x] Add subprocess tests `control commands acknowledge only committed state` and `control command refuses invalid configuration without leaks`. Assert all three modes, repeat calls, root/package forwarding, stop persistence in fresh processes, queued work unchanged, and no SMTP. Reject no argument, extra/unknown flags, missing/malformed/unreachable DATABASE_URL, missing control, and missing/extra/changed ledger entries. Seed URL/password/SQL-error/customer sentinels and assert neither stream contains them.
- [x] Hold a SHARE lock and observe CLI stop's UPDATE wait; assert no success output before release. Inject a deferred update failure, assert exit 1/no JSON and unchanged flag. Cancel a blocked command transaction and prove locks release; test connection/statement/whole-transaction deadlines and pool cleanup. For the cumulative deadline, use two fixture statements each shorter than 10 seconds whose total exceeds 10 seconds, observing their database wait events. A failed resume must leave true.
- [x] Run C3 RED; implement CLI following `authenticator-keys-cli.ts`'s complete ledger/digest validation and `usage-reconcile-cli.ts`'s 5-second connect/10-second statement and transaction bounds (one connection, no watch mode). Success prints only after awaited API commit. Rerun GREEN.
- [x] Controls: remove argument/environment guards, bypass ledger count/name/digest checks separately, print before COMMIT, swallow write/commit failure, expose raw caught error or extra status fields, remove database deadlines and pool cleanup. The 18 effective breakages fail assertions; the two overlapping checks are recorded above rather than claimed independently necessary. Restored C3 passes. Commit: `feat: add trusted local relay control command`.

## Task 3: Live admission gate without disrupting replay

Complete locally: C4 passes 61 checks, including 20 new live-process tests.
Sixteen deliberate breakages fail their owning assertions; the restored candidate
passes all 20 new tests. Removing only the reservation lease check still refuses
expired leases through admission’s later deadline check; removing both is detected.
A queued stop writer does not prevent another SHARE reader from proceeding. The
race tests observe that reader at the account lock and prove stop still waits for
its transaction. No previous authority, replay or deadline assertion changes.


**Modify:** `packages/registration/src/relay-messages.ts`.
**Create:** `packages/account-http/test/relay-operator-stop.test.ts`.
**Extend:** account-http `test/fixtures/{relay,relay-http-process}.ts` only as needed for independently labelled processes and cleanup; retain `relay-process.ts` restart assertions.
**Interface:** Existing `RelayMessages.execute` and HTTP replies stay unchanged; submit uses Task 1's SHARE at entry, then checks stopped/missing message before any reservation.

- [x] Add `two live APIs refuse new mail without relay spend`: run two real HTTP processes against one schema; admit before stop, invoke local control, deny new IDs on both with exact 403 body, snapshot unchanged reservations/messages/bounds/windows/tally. Hold an account-authority/allowance lock and prove stopped new submit still returns 403 without reaching or waiting on reservation. Resume and admit on both without restart. Restart both while stopped and repeat refusal. Assert configured initial usability and unconfigured routes still 404 after stop/resume.
- [x] Add `stopped status cancel and exact replay retain authority`: lost-reply exact submit gives 200/current state; conflicting body gives 409; status/cancel work on queued and sending/terminal rows, observed queued expiry clears bytes exactly once. Revoked grant/account/owner/installation, stale revision/key/lease, missing/foreign IDs and forged proofs retain refusal; no extra spend. Missing control yields fixed 503 for submit, including replay, while status/cancel still work. Run existing grants/admission assertions unchanged.
- [x] Add both admission races. Stop first: hold control UPDATE with stopped=true, launch submit, observe its SHARE wait, commit stop, assert 403/no spend. Admission first: hold message/bounds fixture lock, observe submit waiting there after its control SHARE, launch stop and observe UPDATE blocked by submit PID; release admission, assert its 202 COMMIT precedes stop success, then both APIs refuse new IDs. A cancelled/failed submit releases SHARE and rolls back spend. Include queued writer then a second reader; assert any admitted work commits before acknowledged stop.
- [x] Run C4 RED; prefix only submit transactions with control lock, branch on stopped/no row under message lock, keep replay/status/cancel/reserve unchanged; rerun GREEN.
- [x] Controls: remove new-submit refusal; move it after reservation (the locked-authority test must detect the wait); replace admission SHARE with plain read; release SHARE before commit; bypass existing replay/current-authority checks individually. Require intended no-spend/ordering/authority assertions to fail, then restore/pass. Commit: `feat: gate new relay admission on durable stop`.

## Task 4: Gate claims and sending independently

Complete locally: C5 passes 125 checks, including 23 new cases. Nineteen effective
breakages fail inspected assertions; the restored candidate passes all 23 cases.
Removing only the later claim or lease read check leaves the final UPDATE fence
effective; removing both is detected. The clock regression preserves the existing
one-hour production limit. All prior assertions and deadlines remain.

**Modify:** `packages/registration/src/relay-worker.ts`, `test/fixtures/relay-worker.ts`. Existing worker tests and one-shot process fixture stay unchanged.
**Create:** registration `test/relay-operator-stop.test.ts`, `test/fixtures/{relay-stop-barrier,relay-stop-process}.ts` for persistent worker processes and test-only query/IPC barriers.
**Interface:** Existing `runOnce():Promise<boolean>`, status and transport stay unchanged. Claim reads Task 1 state before capacity; reaps sending before stopped/no-claim return. Handoff separately reads control first and clears its matching queued token while stopped.

- [x] Add `two persistent workers pause and resume without restart`: drive two child worker processes with independent pools and repeated runOnce commands against one schema. Stop leaves ready/delayed/expired queued rows unchanged, no claim IDs/attempts/status changes and no SMTP; resume sends eligible rows once and expires old ones normally. Restart both while stopped, still no send. Retain capacity four and unrelated-schema independence.
- [x] Add claim/stop races: stop's UPDATE held first blocks observed claim SHARE and wins with no queued token. Claim SHARE first, blocked on capacity, blocks observed stop UPDATE; release capacity and pause after actual claim COMMIT before returning its result to runOnce. Await stop commit, release test barrier: handoff sends nothing and clears its own token with payload/attempts/revision/spend unchanged. Repeat stolen token, expired lease, cancelled and already-sending rows to prove cleanup never erases another claim/state. Do not add production callbacks; instrument fixture query results/IPC only.
- [x] Add handoff-first race: observe worker waiting at suppression after control SHARE, observe stop UPDATE blocked by that worker PID, release suppression and hold SMTP DATA response. Assert durable sending and that stop succeeds while SMTP stays held. With a worker pool of size one, complete a separate worker-status query during this hold to prove its database client was released. Release SMTP and assert real accepted, permanent refusal, temporary delayed retry and post-DATA uncertain outcomes, using SMTP phase barriers appropriate to each result. Delayed work stays unclaimed while stopped. Claim-first test above also pins handoff stop-first ordering.
- [x] Add `stopped recovery and late replies stay fenced`: expired sending becomes uncertain with payload cleared and no resend; late reply cannot overwrite it; killed child after DATA restarts while stopped and reaps once. Missing control/database failure never authorizes new claim or handoff. Settlement of an already-sending message succeeds despite missing control. Account verification/reset/alerts still deliver through existing EmailWorker while relay stopped.
- [x] Run C5 RED in small groups; implement claim prefix/reaping order, handoff prefix/matching-token cleanup, leave settlement ungated. Rerun C5 and focused account-mail/outbox tests GREEN.
- [x] Controls, independently: remove claim gate (assert token absence, not just no SMTP), remove handoff gate, remove each of the claim/handoff SHARE locks, check stop only after sending COMMIT, remove cleanup's queued-state check or matching-token check separately, skip claim clearing, gate reaping or settlement, hold a transaction/client across SMTP, and remove existing claim/deadline/authority fences. Each effective breakage fails its intended assertion; the two overlapping read checks are recorded above. Restore and pass. Commit: `feat: pause unstarted relay worker work`.

## Task 5: Release upgrade, restart and separate restore proofs

**Modify:** `scripts/{schema-upgrade-fixture,schema-upgrade-receipt,verify-schema-upgrade-receipt}.mjs` and their existing test files; extend registration `test/relay-control-migration.test.ts`.
**Read/retain:** `deploy/local-stack/{runtime,schema-consumer}.mjs`, `scripts/{database-recovery-migrations,local-stack-proof,verify-local-stack-receipt}.mjs` and tests. Their current release manifests are dynamic; no hard-coded replacement counts.
**Interface:** Add explicit `--relay-stop --old <full-sha> --new <full-sha>` upgrade mode and receipt schemaVersion 3 for exactly 35-to-36. Preserve default schemaVersion 1 and existing explicit 34-to-35 mode/schemaVersion 2, including their tests and meanings.

- [ ] Add parser/verifier RED tests: reject invalid/missing/equal SHAs, conflicting modes, wrong migration counts, unknown fields and each missing/false required check. Version 3 retains base checks except obsolete `pairingUpgraded`, and requires `accountStatePreserved`, `relayStatePreserved`, `defaultRunning`, `stopRestartPreserved`, `stopRestorePreserved`, `restoredRelayKeys`, `restoredRelayWrongKeysRefused`, `restoredRelayMissingKeysRefused`, `restoredStopEffective`, `oldBackupUpgradeDefault`, `resumeEffective`. Fix the exact check catalogue in verifier tests before implementation.
- [ ] Implement mode branches explicitly; preserve parser return shapes for old modes and add `{oldHead,newHead,factor:false,relayStop:true}` only for the new mode. Seed populated release-35 relay using synthetic explicit keys/configuration alongside existing identity/account mail/factor records. Snapshot relay rows, reservations, bounds, bytes, factor/account state and full ledger. Stop consumers, dump pre-upgrade backup, exercise actual old/new consumer gates, interrupt 036 at observed ledger lock, prove rollback, retry twice, then compare every old row/digest and default false. Stop through CLI, restart processes/migrate again, assert true/no admission or send; leave source stopped for its second backup.
- [ ] Take a second backup while stopped and restore it into a separate database with external payload/replay/suppression/bounds keys. Assert stopped survives migrate/restart, new submits and worker claims refuse, current status/cancel/exact retry still work, matching keys decrypt, wrong/missing payload and replay keys retain existing fixed failures, and historical suppression-key loss refuses handoff after a controlled resume. With matching keys, resume that restored relay and prove admission/delivery. Restore the pre-036 backup separately under old gate, upgrade to 36/default false; source data/stop/ledger remains unchanged throughout. No key material/customer content in receipts; cleanup counts zero.
- [ ] Run C6 RED/GREEN; after signed implementation commits supply literal old release-35 SHA and candidate SHA to C7. Require complete version-3 checks and old/new ledgers, stop/restore behavior and cleanup, not verifier-only evidence. Run existing packaged local-stack install/restart/rebuilt-upgrade proof once with 36 migrations and existing credentials; retain normal relay-off assertions. CI owns broad package/receipt suites.
- [ ] Controls: reset state on migrate/restore, omit control from stopped-backup preservation, skip old ledger digest/data comparisons, accept wrong/missing keys, or drop any required receipt check independently. Owning assertions fail; restored focused tests/proof pass. Commit: `test: prove relay stop across upgrades and recovery`.

## Task 6: Document guarantees and finish the cohesive implementation

**Modify:** `docs/transactional-email-relay-contract.md`, `docs/backlog.md`, `docs/database-recovery.md`; update this design/plan status only with executed evidence.

- [ ] Document three CLI examples/results, existing-config versus stop flag distinction, wait-for-commit behavior, unstarted claim cleanup, continued sending recovery, and already-committed sending that may start SMTP after stop succeeds. Explain pre-stop backup recovery and the version-3 proof command. Replace only now-completed operator-stop backlog text; preserve open provider/policy/caller/retention work.
- [ ] Record every added/changed test check in implementation PR; preserve original security/tenant/recovery assertions. Collect per-task RED/GREEN and independently inspected mutation failures, followed by restored passes. If a mutation fails only from a harness/import error, repair its behavioral test and repeat the control.
- [ ] Run `pnpm typecheck`, `git diff --check` and affected-file link checks. Run focused commands only where new changes/failed controls justify them; do not repeat broad local suites or pre-push checks. Commit documentation with `git commit -s -m "docs: explain durable relay operator stop"`.
- [ ] Announce ready for `finish-branch`; follow its initial rebase, one Claude whole-branch run-it review in an installed disposable checkout, triage, normal push hook and every current-head CI job. One implementation PR after the plan PR. Land only under the runner's shared lock after all jobs succeed; record exact merge CI and clean up only owned resources. The planning invocation performs none of these execution steps.

## Focused commands

Run from the repository root. Use `--test-name-pattern` for each task's RED test or
small group, then its complete focused file for GREEN; expect behavioral failures
described above, not infrastructure errors. Record the exact invoked command.

```sh
# C1: control/migration and preserved legacy upgrades
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/relay-control.test.ts test/relay-control-migration.test.ts test/relay-bounds-migration.test.ts test/authenticator-schema.test.ts test/registration.test.ts test/schema-compatibility.test.ts
# C2: release gates (current manifest and preserved receipt versions)
node --test deploy/local-stack/schema-consumer.test.mjs scripts/database-recovery-migrations.test.mjs scripts/verify-local-stack-receipt.test.mjs
# C3: trusted commands
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=30000 test/relay-control-cli.test.ts
# C4: admission, replay and default-off regression
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=120000 test/relay-operator-stop.test.ts test/relay-messages.test.ts test/relay-admission-bounds.test.ts test/relay-disabled.test.ts
# C5: worker outcomes/current authority and account-mail independence
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/relay-operator-stop.test.ts test/relay-worker.test.ts test/relay-grants.test.ts test/account-mail.test.ts test/email-outbox.test.ts
# C6: upgrade driver/receipt tests
node --test scripts/schema-upgrade-fixture.test.mjs scripts/verify-schema-upgrade-receipt.test.mjs scripts/database-recovery-migrations.test.mjs
# C7: real populated upgrade/restore, after committing the candidate
node scripts/schema-upgrade-receipt.mjs /tmp/cloud-relay-stop-upgrade.json --relay-stop --old <release-35-full-sha> --new <candidate-full-sha>
node scripts/verify-schema-upgrade-receipt.mjs /tmp/cloud-relay-stop-upgrade.json
# Existing packaged lifecycle proof, using the already-authorized local package credential
node scripts/local-stack-proof.mjs /tmp/cloud-relay-stop-local-stack.json
node scripts/verify-local-stack-receipt.mjs /tmp/cloud-relay-stop-local-stack.json
```
