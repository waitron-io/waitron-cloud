# D621 run 9, PR 2 — PostgreSQL copies and ordered startup

One opt-in local check proves an acknowledged PostgreSQL write survives primary loss with three copies and that the schema gates a real consumer.
It includes [PR 1’s fixed-address Kind check](2026-11-18-d621-stockholm-control-plane.md) and [P1 Task 5](2026-10-22-cloud-country-cell.md#task-5-replicate-the-country-database-and-order-migrations-4065-calls).
The Stockholm fixture still needs A’s network mount (`deploy/kubernetes/bounded-amazon/bootstrap.sh:104–120`). Stockholm volume provisioning, real services, machine-loss qualification and cold restart stay with later slices.

Add `--database-loss` to `scripts/kubernetes-check.mjs`. The same run checks Kubernetes and PostgreSQL while preserving the existing fixture’s entry points.
Use `scripts/kubernetes-node-loss.mjs` for the shared loop and `scripts/kubernetes-database.mjs` for database setup and checks.
Put `{artifacts.json,cluster.yaml,migrate.yaml,probe.mjs}` in `deploy/kubernetes/database/`. Use the existing `deploy/local-stack/Dockerfile` Cloud image for the Job and probe.
Add `scripts/kubernetes-node-loss.test.mjs` to `package.json`’s local-stack list and extend `scripts/kubernetes-check.test.mjs`. Update the backlog and AWS guide with measured scope.

1. Use an owned fixed-subnet network via Kind’s child-process environment, the existing node image digest, three schedulable control planes, the loopback balancer and a private kubeconfig.
   Record container, node, etcd member, network and balancer IDs. On each leg, stop the exact node container with SIGKILL and verify it stays stopped.
   Through the API, create and read a ConfigMap and schedule a fresh pod with a preloaded image and affinity that excludes the stopped node.
   Disconnect the stopped container, reconnect it with its original IP, then start it. Verify its IP and the health and identity of all three original etcd members.
   Check owned IDs before changes and cleanup. Use bounded commands, a 90 s failover check and a 180 s rejoin check. Retain diagnostics on failure. Preserve pre-existing images.
2. Pin the CloudNativePG 1.29.2 manifest and PostgreSQL 18.4 images by digest. Use two operator replicas on separate nodes and three PostgreSQL instances on distinct hosts.
   Use Kind’s local-path `standard` class with a separate volume claim per instance. Check the former primary retains the same claim and data.
   Require `synchronous_commit=on` and `postgresql.synchronous={method:any,number:1,dataDurability:required,failoverQuorum:true}`.
   Before primary loss, pause the two WAL receiver processes in the owned pods for less than their timeout. Check the commit waits on synchronous replication and neither receiver has reached the recorded write position.
   Resume one receiver and kill the primary as soon as the commit returns. Once the node is confirmed down, resume the second receiver before waiting for promotion.
   While the node stays down, require the old row and a fresh committed write through `cloud-db-rw:5432`. Keep the client on a survivor.
   On return, check the write Service excludes the former primary. Pause its replay and require a direct INSERT with the writer role to fail with SQLSTATE `25006`.
   Verify it is a replica and behind a new write on the primary. Resume replay and require catch-up. Prove writes through a separate standby loss in the same loop.
3. Once the database and probe role are ready, run the unchanged `packages/registration/src/migrate-cli.ts` in a release-digest-named Job. Keep remote superuser access disabled.
   Give the Job the operator’s database-owner Secret. Generate a separate Secret for the managed probe role. The Job grants it SELECT only on the ledger and probe table.
   Mount the cluster CA, verify hostnames on TLS connections and run the probe from `/app` through `deploy/local-stack/schema-consumer.mjs`.
   Test that an unfinished or failed Job starts no consumer, and that a real probe reads a migrated table after Job success. Corrupt one digest and show the wrapper refuses to start it.
4. Observe RED, then GREEN with `node --test scripts/kubernetes-node-loss.test.mjs scripts/kubernetes-check.test.mjs`. These command tests cover ownership, Job order, stop, rejoin and cleanup.
   Run `node scripts/kubernetes-check.mjs --database-loss` for real SQL, new Kubernetes workloads and three recoveries. In the same owned cluster, disable sync for a control and require the pending-commit check to fail, then restore it before the fault legs.
   Use the approved runner after checking capacity. Use the existing 10 GiB memory and 30 GiB disk minimum as an initial floor and record headroom for the extra control planes and database pods.

Use main’s tools. The parked country-cell branch’s tools, release helpers and Kind lifecycle stay outside this slice. All inputs are synthetic and all workloads are local.
Estimate 400–560 implementation and 200–320 test lines. Count authored fixtures separately from fetched files. Return for scope review above 840 implementation or 480 test lines.
