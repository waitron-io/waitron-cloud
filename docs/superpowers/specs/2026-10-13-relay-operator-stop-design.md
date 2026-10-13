# Durable relay operator stop

Status: reviewed implementation design; implementation and runtime proofs are pending. Read the
[plan](../plans/2026-10-13-relay-operator-stop.md) alongside this design.

## Purpose and inspected boundaries

You need to stop new relay mail across running API and worker instances without
restarting them. Stop preserves queued content and truthful delivery outcomes;
resume lets eligible queued work proceed. Cloud account recovery and alerts remain
independent. Cloud owns this mechanism under [documentation ownership](../../documentation-ownership.md),
the [relay contract](../../transactional-email-relay-contract.md) and
[backlog](../../backlog.md#free-services-for-open-source-waitron).

Source inspection at `e6fc1e22f9395a1c87909a0064fd93f3611caa66`, not runtime verification:

- `packages/registration/src/relay-messages.ts:25-85` serializes message identity,
  reserves current authority/allowance, checks shared bounds, then inserts encrypted
  content. Status, cancel and exact submit retry reuse `RelayGrantStore.reserve`.
- `packages/registration/src/relay-worker.ts:54-141` separates claim, handoff and
  settlement transactions. Handoff commits `sending` before SMTP; expired sending
  leases become `uncertain`. Claims currently last 60 seconds, with capacity four.
- `packages/account-http/src/relay-messages.ts:18` already maps `relay_disabled` to
  HTTP 403. Normal startup omits relay routes, and an unconfigured worker does no work.
- `src/migrate.ts` in registration lists 35 migrations. `deploy/local-stack/runtime.mjs`
  checks full names/digests; `scripts/database-recovery-migrations.mjs` follows the
  release count. Existing schema receipts retain separate 26-to-27 and 34-to-35 proofs.

## Durable state and trusted command

Add forward-only `036_relay_operator_stop.sql`. Create `relay_control` with
`singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton)` and
`stopped boolean NOT NULL DEFAULT false`; insert its single row as not stopped.
The table belongs to the current Cloud schema and has no customer identifiers,
secrets, content, timestamps or policy settings. Do not rewrite landed migrations.
Migration retries skip applied SQL, so they cannot reset a persisted stop.

Default not-stopped preserves usable, explicitly configured local-proof instances.
It does not enable routes, workers, grants, production delivery or new network
permissions. Stop and resume change only this row. They do not revoke grants,
cancel messages, clear payloads, refund counts or change account mail.

Add `RelayControl(pool)` in registration with `lock(client): Promise<RelayControlStatus>`,
`status()`, `stop()` and `resume()`, where `RelayControlStatus = {stopped: boolean}`.
`lock` requires an open transaction using the existing savepoint check and reads
the row `FOR SHARE`. Missing state fails with `RelayMessageError('relay_unavailable')`;
an autocommit caller fails with existing `RelayError('transaction_required')`.
Never infer running from a missing row or repair it during an operator command.
`stop`/`resume` select `FOR UPDATE`, update idempotently and return only after commit.
No state is cached between transactions.

Expose only the trusted local `pnpm --silent relay:control --stop|--resume|--status` CLI, through
root/package scripts and `packages/registration/src/relay-control-cli.ts`.
It uses the operator's existing `DATABASE_URL`, validates the exact release ledger
and SQL digests before acting, and has bounded database/transaction timeouts.
It neither migrates nor starts a worker. The Node CLI emits one JSON line; machine-readable pnpm invocations and any nested pnpm forwarding use `--silent`. Success output is exactly
`{"stopped":true}` or `{"stopped":false}`, after the operation succeeds. Failure
exits 1 without success output and prints only
`Relay control failed; check configuration, database and migrations`.
Existing database access is the trust boundary; add no HTTP route, machine action,
portal control, role, provider or free-form reason field. Status describes only
the durable stop flag, not readiness or whether relay configuration exists.

## Admission and permitted operations

For submit, acquire the shared control row lock at transaction entry, before the
message advisory lock. After reading the message under its existing identity lock,
if stopped and no row exists, throw existing `RelayError('relay_disabled')` before
calling `reserve` or bounds. Return `403 {"error":"relay_disabled"}` with no new
reservation, bound counter/window, payload or byte spend. Existing source and
authenticated-installation ingress counters still apply.

An existing row follows the complete current replay path even while stopped:
current authority, keyed binding, payload/configuration and deadline checks remain.
Exact replay returns 200 with current state and no new spend; changed bodies keep
409, and revoked/foreign authority remains refused. Status and cancel retain their
existing path without consulting control. Cancel and observed expiry may still
clear queued payloads. Do not add the stop check to `RelayGrantStore.reserve`:
status, cancel and worker replay depend on its current-authority checks.

## Claims, handoff and real outcomes

At claim transaction entry, take the shared control lock before the schema-scoped
capacity lock. Continue reaping one expired `sending` lease as `uncertain`, even
when stopped. Only after that recovery step, return no queued claim when stopped.
Leave ready, delayed and expired queued work unchanged. A stopped idle pass returns
false; a pass that reaps sending returns true. Queued expiry remains available via
status/cancel and resumes through normal worker processing after resume.

At handoff transaction entry, independently take the shared control lock before
the message lock. If stopped, take the message identity lock and row lock, then
clear only `claim_id`/`lease_until` on the matching still-queued claim. Return no
content. Preserve state, payload, attempts, availability, status revision, counters
and reservation. Never clear a newer/stolen claim or touch sending/terminal work.
No authority reservation or decryption is needed merely to release that claim.
Other abandoned queued leases remain bounded by the existing 60-second expiry.
When running, retain every authority, suppression, ownership and deadline check.

Settlement never reads the stop flag. Accepted, refused, retryable and uncertain
results use the existing outcomes and fencing. A confirmed temporary refusal may
return to delayed queued state while stopped; it cannot be claimed again until
resume. Reaping and settlement keep ciphertext-byte accounting intact.

## Lock order and the commit boundary

`FOR SHARE` permits multiple readers but prevents stop/resume's `FOR UPDATE` from
committing until those readers finish. All three gated transactions acquire this
row first and hold it through commit/rollback; no path acquires it later.

| Transaction | Lock order after BEGIN |
| --- | --- |
| Submit | Control SHARE; message identity; account/credentials, membership, venue, installation, grant; account allowance/policy; bounds; message mutation; byte tally last |
| Status/cancel | Existing message/authority/bounds order, with no control lock |
| Claim/reaping | Control SHARE; worker capacity; selected message row; byte tally last if reaping |
| Running handoff | Control SHARE; message identity; existing authority/allowance/policy; suppression; message row; byte tally last if clearing |
| Stopped handoff | Control SHARE; message identity; matching queued row; claim-only update |
| Settlement | Sending row with existing claim fence; byte tally last if clearing; no control lock |
| Stop/resume | Control UPDATE only; no message, authority, capacity, suppression or tally locks |

This prefixes existing orders and avoids a stop transaction waiting for queue locks
while holding control. Do not upgrade a shared control lock to an exclusive one.
Stop can wait behind a transaction already holding SHARE; acknowledge stop only
after its commit. A timeout or failed commit is not an acknowledgement.

After acknowledged stop, no new admission, queued claim or sending transition can
commit until resume. Transactions that committed first remain valid. In particular,
a worker that already committed `sending` may call SMTP after you see stop succeed,
even if it had not opened the SMTP connection yet. Stop cannot recall that message.
It records the real result, or existing conservative uncertainty after a crash or
expired lease. Hold no transaction, database client lease or control/message lock
across SMTP. Do not add a post-commit stop check that strands sending as cancelled.

## Upgrade, recovery and required proof

Stop consumers for schema upgrades using the existing deployment lifecycle. A
populated 35-to-36 upgrade preserves ciphertext, claims, reservations, byte counts,
account/factor state and all 35 ledger entries/digests, adding only control and 036.
Interrupted migration leaves neither table nor ledger entry; concurrent/repeated
migration succeeds without resetting a subsequently stopped row.

A backup taken after stop includes stopped state; a separate restored database
must still be stopped after migration and process restart. A backup from release
35 has no stop flag and initializes not-stopped when upgraded. A backup taken before
a later stop cannot recover that later change: stop the restored database before
starting an explicitly configured relay if you need it paused. Normal startup stays
off in every case. Recovery keys remain external, and the upgraded source stays intact.

Prove behavior with real PostgreSQL, two API processes, two worker processes,
process restart and loopback SMTP. Observe `pg_stat_activity` lock waits and blocker
PIDs before releasing barriers; polling has a deadline and fails if the expected
wait never appears. Elapsed sleeps do not establish ordering. Use test-only query/IPC
barriers after actual claim COMMIT to separate claim from handoff, with no production
hooks. Check both sides of admission, claim and sending races; prove stop returns
while SMTP is held and later settlement/reaping stays truthful. Delete each guard
and lock in a disposable copy and require its owning behavior assertion to fail;
restore it and rerun. CI owns the broad suites. This work selects no production
provider, budgets, retention, key custody or Waitron caller behavior.
