# D621 run 9, PR 2 — PostgreSQL copies and ordered startup

One opt-in local check proves that three database copies preserve an acknowledged write across primary loss and that migrations gate a real consumer.
Carry the fixed-address Kind stop/rejoin remainder from [PR 1](2026-11-18-d621-stockholm-control-plane.md); its evidence was synthetic commands only.
Follow [P1 Task 5](2026-10-22-cloud-country-cell.md#task-5-replicate-the-country-database-and-order-migrations-4065-calls), plus Tasks 1 and 3.
The existing Stockholm fixture still depends on A’s network mount (`deploy/kubernetes/bounded-amazon/bootstrap.sh:70–74`). PR 7 and run 9 own Stockholm machine loss.
Add a `--database-loss` dispatch in `scripts/kubernetes-check.mjs` and preserve the existing fixture’s entry points.
Create `scripts/kubernetes-node-loss.mjs` for one bounded stop/check/rejoin loop and `scripts/kubernetes-database.mjs` for database setup and probes.
Create `deploy/kubernetes/database/{artifacts.json,cluster.yaml,migrate.yaml,probe.mjs}`; use the current Cloud image for Job and probe.
Add `scripts/kubernetes-{node-loss,database}.test.mjs` to `package.json`’s local-stack list and extend `scripts/kubernetes-check.test.mjs`.
Update `docs/backlog.md` and `docs/aws-infrastructure.md` with the local command, measured outcome and remaining work.

1. Start with failing ownership, survivor scheduling, original-IP rejoin, cancellation and cleanup tests in the node-loss test file.
   Use an owned fixed-subnet network, refusing overlap, three schedulable Kind control planes, loopback balancer and private kubeconfig.
   Keep the exact Kind node image digest in `scripts/kubernetes-check.mjs:174`; record network, container, node UID and etcd member identities.
   Stop each exact node ID with SIGKILL. While it is stopped, write and read a ConfigMap through the API and start a fresh pod on a survivor.
   Reconnect the same container at its original IP; require the original three etcd members healthy before the next leg.
   Share this loop with database hooks for before-stop, while-off and return checks; do not build a second cluster harness.
2. Pin CloudNativePG 1.29.2 and PostgreSQL 18.4 from P1; verify public manifest checksums and platform image digests before use.
   Keep fetched manifests in owned scratch; run two elected operator replicas on different nodes and three database instances with required hostname separation.
   Give each database instance its own node-local volume claim. Keep the original primary’s claim and mounted data through the stop.
   Require `synchronous_commit=on` and `postgresql.synchronous={method:any,number:1,dataDurability:required,failoverQuorum:true}`.
   Block both standbys' WAL (write-ahead-log) receipt at a recorded position; a separate commit must stay pending. Pausing replay alone is insufficient.
   Release one standby, then kill the primary immediately after acknowledgement, without waiting for the other standby to catch up.
   Require the acknowledged row on the promoted primary and a new committed write through the TLS read/write Service `cloud-db-rw:5432` while the node remains off.
   Return the old storage fenced from clients; after operator rewind, hold replay and directly prove recovery mode and SQL write refusal before readmission.
   Commit on the new primary while replay is held; prove the old copy is behind, release replay and require catch-up before another fault.
   Include a separate standby-node loss with successful synchronous writes; cover every original control-plane node in the shared loop.
3. Run unchanged `packages/registration/src/migrate-cli.ts` in a release-digest-named Job after database readiness; no new migration SQL.
   Reuse `packages/registration/src/migrate.ts:14`'s transaction lock and `deploy/local-stack/runtime.mjs:11`'s exact names/digests check.
   Use operator-generated disposable Secrets with migration authority for the Job and only read grants for the consumer probe.
   Wait for Job success, then run `deploy/local-stack/schema-consumer.mjs` around the probe, which reads a real migrated table.
   Real PostgreSQL tests hold the migration lock, race duplicate starts and require one complete ledger; no probe runs before completion.
   Failed migration, missing/unknown names or changed digests must block the consumer; test these in disposable databases, preserving existing assertions.
4. RED: `node --test scripts/kubernetes-node-loss.test.mjs scripts/kubernetes-check.test.mjs`; observe the named new failures.
   RED: `node scripts/test-postgres.mjs exec node --test scripts/kubernetes-database.test.mjs`; then minimal implementation and both commands GREEN.
   Run the opt-in command via the lane’s approved container runner after checking capacity. Ask the watcher if it needs more than the test box allows.
   Require real writes, recovery and owned cleanup. Disable synchronous replication in a disposable copy and require the barrier test to fail. CI owns full suites.
Use main’s current tools and image. The parked country-cell branch’s tools, release helpers and Kind lifecycle are outside this slice.
Later slices own real services, Stockholm loss and cold restart. This work uses local resources and synthetic data only.
Estimate 420–600 implementation and 260–400 test lines. The carried Kind check accounts for 160–220 implementation and 100–160 test lines.
Count authored fixtures and report fetched upstream bytes separately. Return for scope review above 900 implementation or 600 test lines (1.5×).
