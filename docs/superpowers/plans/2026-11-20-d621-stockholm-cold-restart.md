# D621 run 9 PR 10 | Cold restart in private Kind

This first part of the all-machine restart adds a disposable Kubernetes rehearsal. From
the host, you can see the cluster go down, then verify the same cluster and PostgreSQL data
return and accept a new write. Stockholm still needs the three later pull requests below.
The launcher on main runs its observer on A and stops only C (`scripts/amazon-run.mjs:259,274–296`).

## Build and verify

1. Add a `coldRestart` callback in `scripts/kubernetes-node-loss.mjs`. Reuse its owned
   three-node fixture and cleanup. Record container IDs, mounts, addresses, start times,
   node IDs, node heartbeat times and etcd member IDs before the fault. Verify all three
   containers before disabling their automatic restart and sending one kill command for
   all three. Confirm all three stopped and record the spread of their stop times. With
   the same balancer running on the same host port, require two fresh host API readiness
   probes to fail before starting any node. Reattach the original addresses using the
   existing network procedure, start the same IDs, and verify the addresses, mounts,
   fresh start times and heartbeats, and unchanged node and etcd identities.
2. Add `scripts/kubernetes-cold-restart.mjs` and dispatch it from
   `scripts/kubernetes-check.mjs --cold-restart`. Prepare the existing per-node database
   directories and use `installStockholmDatabase` in `scripts/kubernetes-data.mjs`.
   From the host, use the existing `kubectl exec` and `psql` pattern to commit and read
   a synthetic row on the current primary. After restart, find the current primary
   again, check the original database cluster UID, PostgreSQL system identifier and
   volume and claim UIDs, and require three ready copies. Read the old row before
   committing and reading a new one. Time the outage, restart and successful checks.
   Keep recovery bounded by the existing 180-second cluster and 240-second database
   windows. This measure supplies no service recovery target for Stockholm.
3. Write tests first in `scripts/kubernetes-node-loss.test.mjs` and
   `scripts/kubernetes-cold-restart.test.mjs`. Run both named files with `node --test`
   before and after. Check foreign nodes, full stop before start, stale readiness, and
   cancellation while the API is down. Register the new file in `package.json`’s
   `test:local-stack`. On disposable Linux, run
   `TEST_KUBERNETES_COLD_RESTART=1 node --test scripts/kubernetes-cold-restart.test.mjs`
   with a 30-minute test cap. Require the real outage, retained row, new write and verified
   cleanup. Document what the run measured in `docs/aws-infrastructure.md` and update
   the open work in `docs/backlog.md`.

## Four pull requests before run 9

| PR | Result | Implementation / test lines |
| --- | --- | ---: |
| 10 | Local all-node restart and PostgreSQL recovery, as above. | 150–220 / 100–160 |
| 11 | Full-service baseline with the venue, Git source and observer outside the cell. Reuse the private listener and limit rehearsal firewall access to the test host. | 320–450 / 180–260 |
| 12 | Three separate machine stops with the same clients, existing service deadlines, worker restart timings and receipt coverage. | 260–380 / 160–240 |
| 13 | Amazon all-machine restart with scoped start permission, exact instance and disk checks, refreshed addresses, boot and shared-mount checks, and the same clients verifying retained data and fresh capture and restore. | 330–470 / 240–340 |

Allow two to three working hours per PR to open it. The exact final tree still needs a
timed outside dry run that covers both checklists and leaves room for independent deletion.
The paid run follows those checks and billing reconciliation, with owner-applied setup.
