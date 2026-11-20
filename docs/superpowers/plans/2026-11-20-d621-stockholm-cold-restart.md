# D621 run 9 PR 10 | Cold restart in private Kind

You can stop all three nodes of a disposable Kubernetes cluster from its host, see the outage,
then verify the same cluster and PostgreSQL data return and accept a new write. This rehearses
the cluster and database before Stockholm. On main, the Amazon launcher runs its observer
on machine A and stops only C (`scripts/amazon-run.mjs:259,274–296`).

## Build and verify

1. Add a `coldRestart` callback in `scripts/kubernetes-node-loss.mjs` using its owned
   fixture and cleanup. Record container IDs, mounts, addresses, start times, node IDs
   and etcd member IDs. Verify all three containers, disable their automatic restart
   and kill them with one command. Confirm all are stopped. With the same balancer on
   the same host port, require two fresh host API readiness probes to fail. Reattach
   the original addresses and start all three exact IDs with one command. Verify mounts,
   addresses and new start times, heartbeats newer than the container stops, and original
   node and etcd identities. Allow the existing 180 seconds from the start request.
2. In `scripts/kubernetes-cold-restart.mjs`, reuse the `bootstrap.sh database-storage`
   step from `scripts/kubernetes-services.mjs:31–35` and pass node names to
   `installStockholmDatabase`. Put a synthetic marker beside `pgdata` on each node and
   verify it after restart. Keep the SQL witness reusable with just Kubernetes commands
   and node names, so PR 13 can use it. In `d621-data`, use `kubectl exec` and `psql`
   as `postgres` to create a probe table and commit a row on the current primary.
   Once the cluster returns, allow up to 240 seconds to find three ready copies,
   compare the original PostgreSQL system identifier and volume and claim UIDs, read
   the old row on the current primary, then write and read a new one. Log recovery
   times. A new primary is valid.
3. Write tests first in `scripts/kubernetes-node-loss.test.mjs` and
   `scripts/kubernetes-cold-restart.test.mjs`. Run both named files with `node --test`
   before and after. Check foreign nodes, full stop before start, stale readiness and
   cancellation with the API down. Register the new file in `package.json`’s
   `test:local-stack`. On disposable Linux with access to GitHub and its image
   registry, run `TEST_KUBERNETES_COLD_RESTART=1 node --test scripts/kubernetes-cold-restart.test.mjs`
   with a 30-minute test cap. Require the real outage, retained row, new write and verified
   cleanup. Update `docs/aws-infrastructure.md` and `docs/backlog.md`.

## Four pull requests before run 9

| PR | Result | Implementation / test lines |
| --- | --- | ---: |
| 10 | Local all-node restart and PostgreSQL recovery, as above. | 150–220 / 100–160 |
| 11 | Full-service baseline with the venue, Git source and observer outside the cell. Reuse the private listener and limit rehearsal firewall access to the test host. | 320–450 / 180–260 |
| 12 | Three separate machine stops with the same clients, existing service deadlines, worker restart timings and receipt coverage. | 260–380 / 160–240 |
| 13 | Amazon all-machine restart with exact instance and disk checks, refreshed addresses, boot and shared-mount checks, and the same clients verifying retained data and fresh capture and restore. | 330–470 / 240–340 |

Allow two to three working hours per PR before CI and landing checks. The timed dry run on
the final tree must cover the P1 outside rehearsal and run 9 launch checklists, including
independent deletion. Before launch, the owner applies the reviewed firewall and scoped
restart permission separately and reconciles spending.
