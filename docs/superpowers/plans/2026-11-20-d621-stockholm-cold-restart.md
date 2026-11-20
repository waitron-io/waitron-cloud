# D621 run 9 PR 10 | Cold restart in private Kind

After this slice, you can stop all three machines in the private Kubernetes rehearsal, see
the outage from its host, and check whether the same cluster serves its saved data and accepts
new writes after restart. This is the local part of the all-machine recovery in the 18 November
run 9 sizing and qualification plans.

The current Amazon launcher stops C and runs the observer on A
(`scripts/amazon-run.mjs:259,279–298`). The private services journey runs in Kind
(`scripts/kubernetes-check.mjs:112–138`). Run 9 still needs the full-service launcher and
clients outside the cell so they remain available while all three machines are down.

## Build and verify

1. In `scripts/kubernetes-node-loss.mjs`, reuse the three-node fixture, ownership checks,
   and cleanup. Record the node, Kubernetes and etcd identities. Stop only those three
   verified containers, with their automatic restart disabled. Confirm all three are
   stopped before starting any. Keep the host and its API balancer alive to confirm the
   outage. Start the same containers without recreating their storage. Wait for fresh
   node heartbeats and check the same Kubernetes and etcd identities.
2. Add `scripts/kubernetes-cold-restart.mjs` and dispatch it from
   `scripts/kubernetes-check.mjs --cold-restart`. Reuse the replicated PostgreSQL setup
   in `scripts/kubernetes-data.mjs` and the MinIO fixture and encrypted-object helpers
   in `scripts/kubernetes-storage-proof.mjs`. Commit a synthetic row and upload encrypted
   bytes before the stop. Keep their expected values and client credentials on the host.
   After restart, check the original database and store bindings, read both witnesses from
   their original services, and confirm a new committed row and encrypted upload by reading
   them back. Use the existing command and cleanup bounds. Record times for the confirmed
   outage, restart request, API recovery and successful data checks.
3. Write tests first in `scripts/kubernetes-node-loss.test.mjs`,
   `scripts/kubernetes-check.test.mjs`, and `scripts/kubernetes-cold-restart.test.mjs`.
   Run `node --test scripts/kubernetes-node-loss.test.mjs scripts/kubernetes-check.test.mjs
   scripts/kubernetes-cold-restart.test.mjs` before and after the change. Check stop order,
   ownership refusal, stale readiness, and cleanup on failure or cancellation. Add the new
   file to `package.json`’s `test:local-stack`. On disposable Linux run
   `TEST_KUBERNETES_COLD_RESTART=1 node --test scripts/kubernetes-cold-restart.test.mjs`
   for the outage and data checks. Update `docs/aws-infrastructure.md` and `docs/backlog.md`.

Estimate 260–360 implementation lines and 180–260 test lines. At 90 minutes, if the data
checks are still growing, ask the watcher whether to land the passing cluster and PostgreSQL
rehearsal first. Each slice has at most three working hours to open its PR.

## What remains for run 9

The outside full-service rehearsal must still reconnect the same venue and account, restore
the earlier backup and verify a fresh capture and restore. The Amazon launcher needs scoped
restart permission, exact instance and attached disk checks, refreshed addresses and the
private test-host firewall. The timed dry run must cover both checklists on the final tree
and leave room for independent deletion within the approved limit. The owner applies
the reviewed Amazon setup after the separate launch gates are met.
