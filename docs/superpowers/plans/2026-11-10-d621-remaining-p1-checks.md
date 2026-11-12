# D621: first continuous C-loss check on Amazon

**Plan only; no build or provider access.** Source assessment at `d79d05c3fb8e`. Owner 12 November 02:11: “Go: Amazon directly”; watcher 04:46 cleared this smaller rewrite after Claude challenged the draft. This revised plan/build awaits clearance. D618/D110 are closed on accepted run 7; every D621 criterion stays open.

**Finish:** a reviewed first-cut plan and owner-session brief. After its build/CI land, you can observe the same signed-in clients throughout C’s loss. That first result does not complete D621’s original speed, database-host-loss or real-service checks.

**Reuse:** D618’s three x86 Stockholm machines, 90-minute scheduled deletion, genuine venue/capture/restore and SSH. Separate journeys close their clients (`scripts/amazon-run.mjs:8–14`; `scripts/test-cloud-integration.mjs:748–774`). C hosts the manifest worker; A owns database/storage/gateway/control plane/configuration (`scripts/kubernetes-check.mjs:98–99`; `deploy/kubernetes/local-checks.yaml:17–32`; `deploy/kubernetes/bounded-amazon/bootstrap.sh:62–91`). C observations cannot qualify A-loss.

## One usable build, then one short run

| Files | Change and test owner | Estimated additions/removals |
| --- | --- | --- |
| `scripts/amazon-run.mjs`, `scripts/kubernetes-check.mjs`, `scripts/test-cloud-integration.mjs`; new `scripts/p1-observer.mjs` | Retain one venue and its existing clients until the fault leg finishes. Reuse current capture/restore and probe operations. The observer runs beside those clients on A; the owner-started launcher on the test box performs the existing C stop sequence. | Production +220/−15 |
| Existing corresponding `*.test.mjs`, `scripts/kubernetes-worker-loss.test.mjs`; new `scripts/p1-observer.test.mjs` | Observer tests own probe cadence, shared rate budgets, deadlines and refusal of late results. Adapter tests own readiness before stopping C, confirmed stop, continuous observation before cleanup, cancellation and deletion. Real PostgreSQL owns transaction behavior; the Amazon run owns actual process/network timing and genuine restores. | Tests +260/−0; support 0/0 |
| `docs/backlog.md`, `docs/aws-infrastructure.md`, this page | Describe the command actually built, its result and the original criteria still open. | Documentation +20/−10 |

Target one PR within three build hours. Preserve every existing authority, restore, cleanup and proof assertion. Start with observed failing behavior tests; CI owns package suites. Size growth beyond the lane's limit goes to the watcher before more code. No verifier move, component-only paid run, new deployment service, migration or virtual-machine rehearsal belongs in this cut.

**Clock and fault boundary:** use the observer's monotonic clock on A for request/deadline/result times. It emits a fixed ready signal over the existing SSH stream only after baseline success; the test-box launcher stops C and returns a fixed stopped signal after EC2 confirmation. Time conservatively from that fault request, including transport, stop and existing out-of-service-taint delay. Count only probes started after confirmed stop; never subtract clocks from different processes. Hold C off at least 900 seconds after confirmation and through the second backup. Adapter tests own ordering and failed stop. Report operator-assisted recovery.

**Measurements:** retain [P1's acceptance](2026-10-22-cloud-country-cell.md#acceptance-and-boundaries): 90-second sign-in/remote, 300-second capture/upload/catalogue/genuine restore, 180-second repository revision/drift repair and 900 seconds off. This cut records C's sign-in/remote/backup observations and marks reconciliation unavailable; it cannot pass a missing criterion. Preserve the same cookies, endpoint/key, venue process and all acknowledged state. Complete another backup while C stays off. Keep P1’s 5-second deadlines, 1-second sampling, 5-second session/remote and 60-second post-recovery login cadence, one signup, and successful scheduled probes after recovery. Record retries/longest gaps.

Share P1's rolling setup/retry budgets: at most 8 logins/IP/60 seconds, 24/email/900 seconds and 8 signup request/complete attempts/IP/900 seconds. Initial attempts at 0/15/30/45/60/75 seconds stay inside those budgets. Exhausted allowance refuses injection; never reset a limiter or invent an IP to obtain a pass.

**Failure ownership:** the observer and adapters stream existing bounded stage/exit/command/verifier diagnostics while the machines are available. The launcher retains teardown in its existing failure/cancellation path, including if diagnostics fail. Use no wrapper that keeps a failed stack alive. Preserve the scheduled deletion independently of the observing process. Translation/AI and real mail stay off; all venue/account data is synthetic.

## Original D621 work still open

- **Each original node, including today's database host A:** lose the database, storage, configuration, gateway and control plane together without losing any acknowledged data; keep the original same-client 90/300-second checks and 900-second hold. Moving only PostgreSQL to B and stopping B does not finish this. Size the redundant control-plane, database, storage, custody and ingress cut before its build.
- **Repository repair:** a real deployed reconciler must apply a changed repository revision and repair deliberate deployment drift within 180 seconds while a node is off. No reconciler runs today. Size this separately before building it.
- **Real services:** production-mode account, backup/capture/temporary credentials/encrypted storage, actual certificate/routes, worker inventory and isolated genuine restore remain unqualified. Test flags or a verifier-file rename cannot qualify them. Production email to a private sink needs its real transport boundary settled without sending customer mail. Size each coherent service cut before its build.
- Before the affected cuts, settle assisted versus automatic fault recovery and workload tolerations, database-operator placement and election, offline image bundles and pinned fetched versus vendored manifests (count generated lines), and failure-diagnostic ownership through teardown. This first cut retains today's assisted C recovery and gives its observer/launcher the diagnostic responsibilities above.

## Brief for the owner-started session

After watcher plan clearance, a separately authorised build, current-head CI and the recovery-fixture repair land, select clean exact Cloud/Waitron revisions and your private `D618_CONFIG`. Today's `node scripts/amazon-run.mjs start|stop` runs only D618's separate journeys; it cannot run this proposed observer yet. Use the command documented by the landed build.

Check current prices, spend, account, roles, quota and deletion prerequisites through the [owner guide](../../aws-infrastructure.md#one-owner-started-amazon-experiment). Authorise any quantity/duration change separately. Run one fresh three-machine C-observer check within 90 minutes. Keep private operation/fault logs, revisions, results and deletion evidence; report failed/missing criteria. Confirm deletion before another run. Lanes never access Amazon. Production and wider failure qualification stay open.
