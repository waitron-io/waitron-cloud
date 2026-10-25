# D152: official-Litestream after-stop accounting implementation plan

Status: revised 25 October 2026. This documentation milestone requires fresh plan review and landing before runtime implementation. **Custom binary, Go extension and custom build pipeline: REJECTED by the owner on 25 October.** Keep official **0.5.17** pins.

> Execute later inline, using `superpowers:executing-plans` and the TDD skill before writing implementation or tests. The driver handles campaign/backlog edits, review and landing. Keep runtime work in a later implementation branch.

**Goal:** Count a capped set of storage attempts after a validated runtime stop separately, preserve incomplete evidence honestly, and prove final recovery.

**Architecture:** Pass one optional session ledger through the existing audit, HTTP counters and lifetime readers. Keep ordinary phases and strict callers intact. The smoke owns official Unix `/stop` control, process exit, final restore and the aggregate cost caveat.

**Stack:** Node.js real HTTP/Unix sockets, existing SDK observers, official Litestream 0.5.17; Linux/SeaweedFS in CI.

**Spec:** [After-stop accounting contract](../specs/2026-10-24-litestream-native-drain-design.md). Receipt paths and causal limits live there.

## Constraints and review focus

- Fixed cap **3 distinct affected SDK attempts per replication session**, at most one qualifying PUT completion. Two controlled list admissions plus one underway upload are the design basis, not a historical maximum. One attempt is counted once across hops; a fourth fails.
- Require validated HTTP 200/`stopped`/owned path/safe-integer TXID, body ≤1,024 bytes and no extra keys. No tolerance before acknowledgement; never use the old idle callback as the boundary.
- One absolute **2,000 ms** stop budget covers control, SIGTERM, observed child close and passive idle; retain every other deadline, official pin, retry and cleanup guard in the spec. No retries or quiet period for stop control.
- Preserve all attempts/outcomes/observed bytes; do not manufacture reconciliation, cost precision or commit evidence. Keep phases immutable across active I/O and strict mode exact.
- Review/test the dangerous cases: held-before-admission versus late-response lists (Task 1); retry/layer cap evasion (Task 1); commit versus mere body completion (Task 2); early exit/malformed ack/silent backend (Task 3); final restore and incomplete-cost output (Tasks 3–4).

## Discovered consumers and intended paths

Paths below are relative to `scripts/cloud-cost/` unless stated otherwise. Re-run discovery on the implementation head before editing; do not infer consumers from filenames.

| Paths | Intended treatment |
| --- | --- |
| `litestream.mjs`; `litestream.test.mjs`, `litestream-transport.test.mjs`, `litestream-interruption.test.mjs`, `litestream-close-diagnostics.test.mjs` | Add optional shared ledger, timed request facts and narrow classification; retain strict audit/transport controls. |
| `meter.mjs`; `meter.test.mjs`, `storage-meter.test.mjs` | Preserve independent attempt recording even for accepted incomplete lists; truthful discrepancies/unknown billing. No new phase or default tolerance. |
| `storage-lifetimes.mjs`, `stream-versions.mjs`; `litestream-lifetimes.test.mjs`, `stream-histories.test.mjs`, `stream-versions.test.mjs` | Narrow optional read settlement and explicit acknowledged PUT commit evidence; verify final storage and bounds. |
| `fixtures/litestream-smoke.mjs`; `litestream-shutdown.test.mjs`, `litestream-smoke-diagnostics.test.mjs` | Own ledger/control, absolute stop deadline, final restore loop and validated output caveat; update real-child and diagnostic harnesses. |
| `fixtures/stack-conformance.test.mjs` | All six smoke-output consumers at current lines 242–523; preserve sale/fiscal/cleanup checks, update only intentional accounting expectations and delayed-reply harness. Add genuine cap/invalid-work controls here. |
| `stream-measurement.mjs`, `replay-stream.mjs`, `stream-admission.mjs`, `private-replay.mjs`, `local-receipt.mjs`, `schema.mjs`, `joined-evidence.mjs`, `projection.mjs`, `render.mjs` | Traced separate strict measurement/admission/report route; no opt-in or schema relaxation. Run focused regression checks if shared shapes change. |
| `fixtures/stream-history-smoke.mjs`, `fixtures/stream-versions-smoke.mjs`, `fixtures/native-batch-smoke.mjs`, `fixtures/native-unversioned-batch-smoke.mjs`, `fixtures/ambiguous-multipart-smoke.mjs`, `fixtures/native-multipart-smoke.mjs`, `fixtures/native-versioned-multipart-smoke.mjs` | Other transport/snapshot consumers remain strict; retain outcomes, mutation validation and privacy. |
| `native-multipart.test.mjs`, `native-unversioned-batches.test.mjs`; the history/version tests above | Direct transport consumers; run adjacent strict-mode controls when changing transport/lifetime gates. |
| `conformance.mjs`, `conformance-prepare.mjs`; `conformance.test.mjs`, `conformance-prepare.test.mjs` | Existing stack discovery/preparation already supplies official binary and resources. Verify added cases execute; no custom artifact or pipeline. |

The driver updates `docs/backlog.md` separately. No other runtime path is authorized by this documentation milestone.

## Task 0: reconcile before building

- [ ] Driver: record whether the approximately 12.9-second stop refusal is active-close/still-busy, timeout/exit, or a count check. Compare the bounded D223 lines and D211/D226 JSON receipts with the current smoke's `whenIdle` race. Preserve the first failure before cleanup; zero pending after cleanup is not idle evidence.
- [ ] If still-busy is the refusal, driver adds the required questions section and narrow equivalent proposal before building. Keep attribution unknown unless reproduced. This plan allows only a known list's post-ack client-response interruption and actually committed prior PUT completion; it does not forgive generic active-close or a silent backend. An unresolved additional decision blocks dependent implementation, not this docs revision.
- [ ] Driver obtains fresh-context review, resolves findings and lands only the revised docs first. After that gate, implement inline. Do not re-request the already-granted accounting permission.
- [ ] Re-run `rg -n 'createLitestreamRequestAudit|createLitestreamTransport|requestsReconciled|producerAttempts|observerAttempts|litestream-smoke' scripts .github package.json`; trace snapshot/request rows through the paths above and follow any new consumers. Read `package.json`, CI workflow and conformance selectors before choosing commands.

## Task 1: establish attempt boundaries and the separate ledger

**Files:** `litestream.mjs`, `meter.mjs` and their audit/transport/interruption/meter tests above.
**Interface:** export `createLitestreamAfterStop({clock})` from `litestream.mjs`; return a session object passed as optional `afterStop` to `createLitestreamRequestAudit`, `createLitestreamTransport` and `createMeter`. No caller-supplied cap override. Ordinary signatures/results remain compatible.
**Ledger inputs:** `acknowledgeStop` validates the bounded reply; `issue`, `admit` and `settle` accept private invocation+ordinal, operation, hop and the applicable outcome/byte/commit evidence, with monotonic event order. `snapshot()` returns only the aggregate contract in the spec. Validate closed event shapes; classify by admission time, never log arrival or response finish.

- [ ] RED: add real HTTP holds in existing transport/audit tests for a pre-issued list released to storage after ack, a pre-admitted successful late response, two chained lists, duplicate identities, unknown pairing, retry ordinals and cross-hop counting. Require cap=3 success and fourth-attempt failure, including an incomplete response with nonzero observed bytes retained. Reject new retries after ack; ordinals never reset.
- [ ] Run `node --test scripts/cloud-cost/litestream.test.mjs scripts/cloud-cost/litestream-transport.test.mjs scripts/cloud-cost/litestream-interruption.test.mjs scripts/cloud-cost/meter.test.mjs`; save the expected behavioral failures before implementing.
- [ ] Add the minimal ledger and immutable request phase/admission facts. Independent proxy admission supplies the storage boundary. Preserve all-attempt snapshots; `afterStop` is a separate labelled subset, never added twice. Record counter settlement even when lifetime completion refuses.
- [ ] GREEN: rerun that command. In further RED/GREEN cycles, prove ordinary-mode phase-change and interrupted-I/O assertions remain strict; cover cap+1, duplicate-hop, missing-identity, pre-ack interruption, the spec's exact post-ack list-interruption signature, upstream-error and timeout. Each non-list/new PUT/GET/HEAD/delete/bulk-delete/multipart variant after ack fails before forwarding.

## Task 2: preserve storage evidence without inventing completion

**Files:** `storage-lifetimes.mjs`, `stream-versions.mjs`, `litestream.mjs`, and their lifetime/history/version tests above.
**Interface:** add optional `afterStop` to `openLitestreamLifetimes`, `openLitestreamHistories`, `openLitestreamVersionHistories`. Correlate their `begin(...)` completion with the same attempt. Accept only the ledger's specific list settlement or a private backend commit witness; keep existing callers strict.

- [ ] RED: use deterministic HTTP boundaries to show a post-ack interrupted list retains pending-token settlement and actual bytes without altering objects. Its pre-ack twin and unknown errors still poison the session. Assert incomplete request evidence never becomes measured billing or false body equality.
- [ ] RED: distinguish an admitted PUT with complete request and actual storage success/version acknowledgement from body-only, uncommitted, partial, fresh and retried uploads. Only the same pre-ack admitted attempt may finish under the cap, at most once. Lost client reply keeps `transport-error`; unknown version/commit fails.
- [ ] Run `node --test scripts/cloud-cost/litestream-lifetimes.test.mjs scripts/cloud-cost/stream-histories.test.mjs scripts/cloud-cost/stream-versions.test.mjs` to expected RED; minimally implement, then rerun GREEN. Keep inventory equality, every version, retained-history bounds and ordinary interruption assertions.
- [ ] Run adjacent `node --test scripts/cloud-cost/native-multipart.test.mjs scripts/cloud-cost/native-unversioned-batches.test.mjs scripts/cloud-cost/storage-meter.test.mjs`; inspect unchanged strict snapshot consumers before changing any field meaning. Never skip lifetime validation wholesale for after-stop work.

## Task 3: control shutdown and prove recovery from final storage

**Files:** `fixtures/litestream-smoke.mjs`, `litestream-shutdown.test.mjs`, `litestream-smoke-diagnostics.test.mjs`, `litestream-close-diagnostics.test.mjs`.
**Interfaces:** smoke owns `afterStop`, private Unix socket and one absolute stop deadline. The fault proxy's real backend-response callback supplies the independently acknowledged commit witness, correlated to the SDK attempt and version headers; an elapsed delay is not a witness. Existing `stop` cleanup stays idempotent and owned.

- [ ] RED: extend the real-child HTTP harness with actual socket `/stop` responses and deterministic holds. Assert ack before SIGTERM, close observed, then settlement; reject missing/invalid/extra-key/oversized/wrong-path/`already_stopped` ack and child exit before ack. Test pre-ack failure cannot be retrospectively accepted, and silent backend/remaining active work refuses within the original 2,000 ms budget and 3,000 ms harness.
- [ ] Run `node --test scripts/cloud-cost/litestream-shutdown.test.mjs scripts/cloud-cost/litestream-smoke-diagnostics.test.mjs scripts/cloud-cost/litestream-close-diagnostics.test.mjs` to expected RED; minimally wire official control, ledger, private commit witness and first-failure diagnostics; rerun GREEN. Do not relabel old idle-callback traffic as after stop.
- [ ] RED then GREEN in the same harness: move final restore after stop/exit/settlement, with one total 12-attempt loop and existing 1,000 ms waits. Assert all two sales, integrity and fiscal results; a cut-off upload causing missing data must fail even if a pre-stop copy was good. Keep total test limits and all cleanup/privacy guards.
- [ ] Add closed validation for the smoke's aggregate `afterStop` output and `costAccuracy` caveat from the spec. Tests require actual attempts, outcomes and both observed byte counts to survive accepted incomplete metadata; discrepancies stay unknown. Empty ledger preserves exact expectations. Reject unknown fields and private canaries in exported data/diagnostics.

## Task 4: qualify the official binary and finish through the driver

**Files:** `fixtures/stack-conformance.test.mjs`; preparation/discovery tests only if discovered wiring requires a change. Reuse existing files instead of inventing an unprepared conformance target.

- [ ] RED: add genuine official-binary cases with deterministic list and PUT holds, cap/cap+1 and final post-exit restore. Keep the 1,500 ms delayed successful PUT replies and verify the fixture's injection anchors still exercise them. Update all six smoke consumers to inspect the ledger/caveat, include it in their displayed diagnostics, and preserve full reconciliation only where proved. Retain injected 503/retry, sale/fiscal, inventories, lifetime bounds, administration, isolation, privacy and owned cleanup assertions.
- [ ] In the driver's native environment, use the saved checksum-verified official 0.5.17 executable for real HTTP controls. Adapt the saved probe ordering without running receipt-overwriting probes. Record digest, actual ack/admission/commit order, cap usage and owned process collection. A fake child tests orchestration, not the official binary; native success is not Linux qualification.
- [ ] Verify discovery with `node scripts/cloud-cost/conformance.mjs --list` and `--matrix`; run `node --test scripts/cloud-cost/conformance.test.mjs scripts/cloud-cost/conformance-prepare.test.mjs` if selectors/preparation change. On Linux CI run the existing `pnpm test:cloud-cost:conformance --only stack-conformance.test.mjs`; inspect execution counts and all jobs. No local Docker/PostgreSQL attempt before 3 November, no deployment/provider work, no changed pins or custom artifacts.
- [ ] Re-read the strict route through stream measurement, replay admission, local receipt, schema, joined evidence, projection and render. If a shared shape changed, run its discovered focused `.test.mjs` files. Do not feed smoke's incomplete result into their measured schema or weaken their refusals. Keep the caveat in every displayed smoke summary.
- [ ] Delete cap, acknowledgement, operation/admission, commit, pre-ack refusal, phase, privacy and final-restore guards individually in disposable owned copies; intended assertions must fail, then restored controls pass. Review every changed assertion against the spec. Driver lists each intentional accounting expectation change in PR “Changed test checks” and a questions FYI; unrelated/security/isolation/recovery-authority checks stay intact.
- [ ] Driver obtains one Claude whole-branch run-it review after initial rebase; triage its report, run normal hooks and verify every exact-head CI job. Preserve approval across later rebases with focused checks. Land under H11, qualify every exact-merge job under H12, and report precise remaining errors/counters instead of a broad repair claim. Every later commit uses `git commit -s`; never bypass hooks.

For this docs-only milestone, run `node --test scripts/ci-docs.test.mjs`, check links/allowed paths/line counts, and run `git diff --check`. Complete the driver's fresh review and docs-only landing before executing runtime tasks. No runtime repair is claimed.
