# D621: first continuous C-loss check on Amazon

**Plan only; no build or provider access.** Source assessment at `d79d05c3fb8e`. Owner 12 November 02:11: “Go: Amazon directly”; watcher 04:46 cleared this smaller rewrite after Claude challenged the draft. This revised plan/build awaits clearance. D618/D110 are closed on accepted run 7; every D621 criterion stays open. Both decisions are recorded in `~/waitron-campaign-g/questions.md` under 02:11 and 04:46. Next: PLAN FOR APPROVAL to the watcher.

**Finish:** a reviewed first-cut plan and owner-session brief. After its build/CI land, you can observe the same signed-in clients throughout C’s loss. That first result does not complete D621’s original speed, database-host-loss or real-service checks.

**Reuse:** D618’s three x86 Stockholm machines, 90-minute scheduled deletion, genuine venue/capture/restore and SSH. Separate journeys close their clients (`scripts/amazon-run.mjs:8–14`; `scripts/test-cloud-integration.mjs:748–774`). C hosts the manifest worker; A owns database/storage/gateway/control plane/configuration (`scripts/kubernetes-check.mjs:98–99`; `deploy/kubernetes/local-checks.yaml:17–32`; `deploy/kubernetes/bounded-amazon/bootstrap.sh:62–91`). C observations cannot qualify A-loss; this cut proves the observer and manifest-worker replacement baseline.

## One usable build, then one short run

| Files | Change and test owner | Estimated additions/removals |
| --- | --- | --- |
| `scripts/amazon-run.mjs`, `scripts/kubernetes-check.mjs`, `scripts/test-cloud-integration.mjs`, `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`; new `scripts/p1-observer.mjs` | Retain one venue and its existing clients until the fault leg finishes. Reuse current capture/restore and probe operations. The observer runs beside those clients on A; the owner-started launcher on the test box performs the existing C stop sequence. | Production +280/−25 |
| Existing corresponding `*.test.mjs`, `scripts/kubernetes-worker-loss.test.mjs`, `scripts/test-cloud-paid-remote.test.mjs`; new `scripts/p1-observer.test.mjs` | Observer tests own probe cadence, shared rate budgets, deadlines and refusal of late results. Adapter tests own readiness before stopping C, confirmed stop, continuous observation before cleanup, cancellation and deletion. Real PostgreSQL owns transaction behavior; the Amazon run owns actual process/network timing and genuine restores. | Tests +300/−0; support 0/0 |
| `docs/backlog.md`, `docs/aws-infrastructure.md`, this page | Describe the command actually built, its result and the original criteria still open. | Documentation +20/−10 |

Target one PR within three build hours. Preserve every existing authority, restore, cleanup and proof assertion. Start with observed failing behavior tests; CI owns package suites. Size growth beyond the lane's limit goes to the watcher before more code. No verifier move, component-only paid run, new deployment service, migration or virtual-machine rehearsal belongs in this cut.

**Transport and clock:** replace the observer SSH call’s `execFile` with bounded `spawn` pipes, kept open for three fixed signals: ready, stopped, replacement-ready. Stream bounded diagnostics while A exists. Keep other modes’ transport unchanged. Before the leg, retain clients and pause the paid-remote fixture before its worker restart/downgrade; run those existing assertions after the leg. On A’s monotonic clock, start conservatively at ready/fault-request, including transport/stop/taint delay. Only probes started after stopped can satisfy recovery. Allow C/B during movement; require B after replacement-ready. Never subtract different processes’ clocks. The launcher uses D618’s graceful EC2 stop and host taint; abrupt loss remains open. Adapter tests own signals, timeout, placement and deferred withdrawal.

**Measurements:** keep [P1’s acceptance](2026-10-22-cloud-country-cell.md#acceptance-and-boundaries): 90-second sign-in/remote, 300-second capture/upload/catalogue/genuine restore, 180-second revision/drift repair and 900 seconds off. Record C’s observations and mark reconciliation unavailable. Preserve clients, venue and acknowledged state. Keep 5-second deadlines, 1-second sampling, 5-second session/remote and 60-second post-recovery login cadence, one Mailpit-assisted signup, and successful probes after recovery. Anchor longest gaps at the last pre-fault success. Measure 900 seconds from receiving stopped; finish another backup, then check C remains stopped.

Keep shared setup/retry budgets: 8 logins/IP/60 seconds, 24/email/900 seconds, 8 signup attempts/IP/900 seconds. Initial attempts at 0/15/30/45/60/75 seconds stay inside them. Exhaustion refuses injection; never reset limits or invent an IP.

**Expiry:** the observer mode’s SSH call gets 3,600 seconds: up to 1,200 for baseline, 2,100 for the leg and 300 for diagnostics. Require that whole budget remaining before starting; at ready require 2,400 seconds remaining. Missing stopped uses the existing 300-second AWS-command bound. Reject insufficient time before faulting; preserve the independent 90-minute deletion. Record stop/rollout durations separately. Test insufficient time and withheld signals. These limits apply only to the new observer mode.

**Failure ownership:** the observer and adapters stream existing bounded stage/exit/command/verifier diagnostics while the machines are available. The launcher retains teardown in its existing failure/cancellation path, including if diagnostics fail. Use no wrapper that keeps a failed stack alive. Preserve the scheduled deletion independently of the observing process. Translation/AI and real mail stay off; all venue/account data is synthetic.

## Original D621 work still open

- **Abrupt loss of each original node, including today's database host A:** lose the database, storage, configuration, gateway and control plane together without losing any acknowledged data; keep the original same-client 90/300-second checks and 900-second hold. Moving only PostgreSQL to B and stopping B does not finish this. Size the redundant control-plane, database, storage, custody and ingress cut before its build.
- **Repository repair:** a real deployed reconciler must apply a changed repository revision and repair deliberate deployment drift within 180 seconds while a node is off. No reconciler runs today. Size this separately before building it.
- **Real services:** production-mode account, backup/capture/temporary credentials/encrypted storage, actual certificate/routes, worker inventory and isolated genuine restore remain unqualified. Test flags or a verifier-file rename cannot qualify them. Production email to a private sink needs its real transport boundary settled without sending customer mail. Size each coherent service cut before its build.
- Before the affected cuts, settle assisted versus automatic fault recovery and workload tolerations, database-operator placement and election, offline image bundles and pinned fetched versus vendored manifests (count generated lines), and failure-diagnostic ownership through teardown. This first cut retains today's assisted C recovery and gives its observer/launcher the diagnostic responsibilities above.

## Brief for the owner-started session

After separate build authority, landed build/CI and the flake repair, select exact Cloud/Waitron revisions and private `D618_CONFIG`. Today’s `node scripts/amazon-run.mjs start|stop` cannot run this observer. Use the landed build’s command.

Check prices, spend, authority, quota and deletion prerequisites in the [owner guide](../../aws-infrastructure.md#one-owner-started-amazon-experiment). Authorise resource/duration changes separately. Run one fresh C-observer check; retain private logs/revisions/results, report missing/failed criteria, confirm deletion. Lanes never access Amazon. Production and wider failure qualification stay open.
