# D621: remaining P1 checks on Amazon

**Draft, then Claude read, then PLAN FOR APPROVAL to watcher.**
Source assessment at `main:d79d05c3fb8e`; no runtime verification or build clearance.
Owner, watcher window 2026-11-12 02:11, to “go ahead with D621 (speed targets, losing the database machine, real services)?”: **“Go: Amazon directly”** (`~/waitron-campaign-g/questions.md:448–449`).
Watcher order: after D608’s open slice PR and venue recovery-suite flake. **D623 parked: “owner chose Amazon directly, 2026-11-12”.**
Watcher 01:03 accepts run 7; D618/D110 closed, run 8 confirmation is no build gate (`questions.md:435–437`; [D618:48–55](2026-11-09-d618-bounded-amazon-run.md)). Every D621 check remains open.

**Finish:** independently usable, short Amazon checks after scoped builds land; retain explicit blocks below.
Reuse D618’s three x86 Stockholm machines, genuine journey, diagnostics and scheduled deletion/90-minute expiry ([D618:28–30](2026-11-09-d618-bounded-amazon-run.md)).
Only owner-started interactive test-box sessions access Amazon.
Pointers mean `git show main:<path>` at that pin. Below, `K=deploy/kubernetes/`, `S=scripts/`; all slices are proposals.

**Inspected status:** P1 Tasks 3–12 remain unchecked; their proposed Flux/database/runtime files are absent (`git ls-tree -r --name-only main deploy/kubernetes`).
Planned is not implemented/tested.
Separate journeys surround C’s loss (`S/amazon-run.mjs:8–14`); clients are cleaned (`S/test-cloud-integration.mjs:748–774`).
Fresh post-fault timing cannot prove recovery.
A owns database/storage/gateway, temporary data volumes (`K/local-checks.yaml:17–32,182–208`; `S/kubernetes-check.mjs:98–99`), NFS/control plane (`K/bounded-amazon/bootstrap.sh:62–91`). No repository reconciler appears in that tree.
Test allowances/verifier remain (`K/local-checks.yaml:73,83,172,257–258`); package backup CLI imports test wiring (`packages/backups/src/worker-cli.ts:9,24–25`).

**Unchanged acceptance, [P1:34–45](2026-10-22-cloud-country-cell.md):** each node unavailable **900s**; sign-in/remote **90s**; capture/upload/catalogue/genuine restore **300s**; repository revision/drift repair **180s**.
Keep same signed-in client/venue, endpoint/key, venue process; preserve acknowledged accounts/sessions/pairings/keys/jobs/object bytes/digests/catalogue. Complete another backup while off; heal before another leg.
Monotonic time, 5s request deadlines, 1s sampling; session/remote every 5s, password login every 60s after recovery, one fresh email-assisted signup/leg.
Every scheduled probe succeeds after recovery; record retries/longest gaps.
Permit initial 0/15/30/45/60/75s attempts only within shared setup/retry budgets: 8 logins/IP/60s, 24/email/900s, 8 signup request/complete attempts/IP/900s. Budget exhaustion fails before injection; no limiter reset or invented IP.

**Ordered build/run slices.** Each targets at most three build hours; estimates **production; tests; support**, additions/removals.
Stop/re-cut if sizing fails; preserve behavioural assertions. Corresponding tests below are owning files, including new ones.

| Slice/result | Exact files, reuse and test responsibility | +/− estimates |
| --- | --- | --- |
| 1. R1: continuous C-loss timing | `S/{amazon-run,kubernetes-check,test-cloud-integration}.mjs` and corresponding `*.test.mjs`; new `S/p1-observer{,.test}.mjs`. Keep fixtures off the faulted host. Observe retained cookies/clients/capture helpers before restart/withdrawal/cleanup; time from fault injection, separately confirming 900s stopped. Observer tests own cadence/budgets/deadlines/late-success refusal; adapters own stop-confirmation/900s/cleanup. | 220/15; 260/0; 0/0 |
| 2. R2: C-off revision/drift | New `K/gitops/{controllers,source,canary}.yaml`, `S/kubernetes-git{,.test}.mjs`; edit slice-1 scripts/tests. Use P1 Task 4’s Flux/private Git mirror design on A; controllers reschedule from C to B with P1’s 10s unreachable tolerations. Manage one Cloud Deployment; tests own bad revision/last-good retention. Run observes changed revision AND repaired replicas without host apply after bootstrap. | 150/0; 180/0; 160/0 |
| 3. R3: database-on-B baseline | New `K/database{.yaml,.test.mjs}`; edit `K/local-checks.yaml`, `S/kubernetes-check{,.test}.mjs`. Separate PostgreSQL onto B/node-local persistent storage; remove loopback alias, retain Service/schema checks. Real database fixture owns migration/reconnect; genuine journey owns compatibility. No failover claim. | 70/15; 120/0; 100/15 |
| 4. R4: database component survival | Extend `K/database{.yaml,.test.mjs}`, `S/amazon-run{,.test}.mjs` image bundle. Use P1 Task 5’s CloudNativePG design: three node-separated copies, required synchronous acknowledgement, quorum promotion, separate credentials. Real database tests own acknowledgement barrier, primary loss, old-primary write refusal/rejoin. Stop verified primary B. Component result only. | 50/0; 220/0; 180/20 |
| 5. R5: genuine database-host recovery | Edit slice-1 scripts/tests. Verify B primary; observer/venue stay on A, verifier on surviving C. Reuse observer/capture/restore; journey owns preserved acknowledged state, new writes and 90/300s bounds during 900s loss. A/control plane/NFS stay alive. | 120/15; 180/0; 0/0 |
| 6. Production verifier boundary | Move `deploy/test-cloud/{backup-verifier-runtime,verifier-controller}.mjs` to `deploy/backup-verifier/`, retaining compatibility exports; extract shared `atomicPrivateFile` into `deploy/backup-verifier/private-file.mjs`, re-exporting its old interface. Update `deploy/test-cloud/{storage-authority.mjs,verifier-controller.test.mjs}`, `packages/backups/src/worker-cli.ts`; new `deploy/backup-verifier/runtime.test.mjs`. Keep bound-container-verifier assertions. Tests own real child refusal/reclaim/cleanup; no new controller. | 160/140; 100/0; 10/0 |
| 7. R6: production account sign-in | New `K/runtime{,.test}.mjs`, `S/p1-production{,.test}.mjs`; edit `K/local-checks.yaml`, `S/kubernetes-check{,.test}.mjs`. Actual account CLI, production environment, test flags/local metrics off, stable custody/synthetic password corpus; reuse `deploy/local-stack/runtime.mjs:11–23`. Startup tests own missing corpus/key/schema refusal; direct HTTPS signup/sign-in avoids the test-plan setter (`deploy/test-cloud/test-fixtures/integration-account.mjs:30–38`), preserving existing journey checks. | 180/0; 150/0; 50/10 |

TDD later: units own schedules/commands; real PostgreSQL owns transactions/replication; Amazon owns timing/durability. CI owns package suites. Mocks cannot prove recovery.
Support above means manifests; each build also updates `docs/{backlog,aws-infrastructure}.md` (+15/−10).
This author changes only this page; production/tests/support now **0/0/0**.

**Remaining blocks (source-only sizing assumption):** production-mode backup/remote exceed one medium slice; slices 6/7 qualify only verifier boundary/account sign-in.
Re-cut P1 Tasks 6a/7/8/10 before further builds: capture authority/temporary credentials/encrypted storage, package backup CLI/isolated daemon, actual certificate issuance/routes, production mail delivery to private sink, worker inventory. Flags alone cannot qualify them (`packages/backups/src/capture-config.ts:8–20`; `packages/remote-access/src/reconciler-cli.ts:14–39`; P1:182–234).
A/NFS/control-plane loss and original each-node acceptance stay blocked on separately sized redundant control plane/custody/artifacts/storage/gateway/ingress (P1 Tasks 3–9).
No whole-cell redundancy build here; no VM rehearsal, new provider service, framework, target, migration or fiscal change.

**Owner-started-session brief:** after watcher clearance, required scoped builds/CI and recovery-flake repair land, select clean exact Cloud/Waitron revisions/private D618 configuration.
Check current prices/spend/account/roles/quota/deletion prerequisites through [owner guide](../../aws-infrastructure.md#one-owner-started-amazon-experiment); separately authorise quantity/duration changes. No historical price quote or lane provider access.
Run R1 through R6 as dependencies land: one selected check/fresh stack, three machines/90-minute expiry; extended `node scripts/amazon-run.mjs start` selection documented by each build. Never squeeze legs past expiry.

Keep private monotonic operation/fault logs, digests, stopped-machine evidence, pod/events and bounded command/verifier diagnostics. Publish no credentials/account IDs.
Delete immediately on failure/cancellation; confirm scheduled deletion on success and owned-resource absence before another run. Report exact revisions/leg/times, every failed/missing bound and cleanup result.

Fresh post-fault journeys prove functionality only. Production backup/remote and A-loss runs await scoped builds; leave unrun/failed D621 criteria open. No production qualification follows; no partition, permanent-disk-loss, availability-zone or regional proof.
