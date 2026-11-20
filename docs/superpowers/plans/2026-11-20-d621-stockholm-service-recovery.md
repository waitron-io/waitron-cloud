# D621 run 9, PR 9 — Keep name lookups and the account process working through machine loss

In disposable Linux Kind, both survivors resolve names and open new PostgreSQL
connections while Kubernetes still lists the stopped machine’s DNS replica as
ready. While the database primary’s machine is stopped, the account process
stays live and serves a database-backed request once a standby takes over.

1. In `scripts/kubernetes-placement.mjs`, extend `spreadCoreDns` to three
   replicas with the existing hard separation by machine. Allow one unavailable
   and no extra pod during rollout. Pass the expected machine names from
   `scripts/kubernetes-node-loss.mjs` and `scripts/amazon-run.mjs`. After rollout,
   set the DNS Service’s `trafficDistribution` to `PreferSameNode` and wait for a
   ready endpoint with its own machine’s routing hint on each expected machine.
   Kubernetes 1.34.3 enables this preference by default. Each survivor uses its
   local replica during the stop. If a DNS pod is unavailable on a live machine,
   its workloads can use ready replicas elsewhere. Add failing replica, routing
   hint and setup-order checks in `scripts/kubernetes-node-loss.test.mjs`.
   Update the mocked launcher in `scripts/amazon-run.test.mjs`.
2. In `scripts/kubernetes-remote.mjs` and
   `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`, remove the DNS
   withdrawal wait and the database-connection-timeout retry. In the existing
   stop, probe before the idle-job check. Use one exec each in the surviving
   `cloud-services` account container and `remote-worker` container, in parallel.
   Give ten independent OS lookups per container two seconds each inside a
   ten-second probe window. Include a unique missing Service name and make
   a fresh verified TLS database connection from each container. Record the
   timings and unchanged primary. Require the dead replica to still be advertised
   as ready before and after the probes.
   Keep the single renewal and revocation submissions, signed publication
   assertions and deadlines. Extend `scripts/kubernetes-remote.test.mjs`.
3. Add a PostgreSQL regression in `packages/account-http/test/server.test.ts`.
   Terminate the uniquely tagged CLI child’s idle connection and require the
   diagnostic, fresh readiness 200 from the same child and clean SIGTERM exit.
   In `packages/account-http/src/server-cli.ts`, log the discarded connection
   without exiting. Add an 11-second client query timeout alongside the
   existing 10-second PostgreSQL statement timeout. A silent query and its
   queued rollback can take about 22 seconds before the pool discards the
   connection. Test both timeouts by dropping database responses over an
   established connection. Keep schema validation and ordinary request failure handling.
4. In `scripts/kubernetes-database.mjs` and its test, reuse the surviving client
   machine for the account CLI with the existing schema-consumer wrapper,
   synthetic settings and verified TLS. Start sampling before the kill and
   identify its warm, tagged connection on the old primary. Sample liveness and
   readiness alongside the stop checks using the portal Host header and at most
   one readiness request per second. Require a bounded database failure or
   connection-loss diagnostic, then readiness 200 within the original 90 seconds
   from the same pod and container with no restart and one listening event.
   Remove the SQL proof’s DNS-failure retry. Keep the acknowledged commit,
   promoted write and old-primary refusal checks.

Run the named focused tests, the account regression through `scripts/test-postgres.mjs`,
and `pnpm typecheck`. In disposable Linux run the existing opt-in publication,
database, storage and gateway-machine-stop tests with candidate images.
Record times and remaining checks in `docs/aws-infrastructure.md` and `docs/backlog.md`.
Estimate 180–250 implementation lines and 145–210 test lines. If the DNS
steps need more than about 90 minutes to prove, land them first and put account
recovery before cold restart. Stockholm fault qualification, paid runs and
Test Cloud’s separate Compose account worker stay outside this slice. The
email, remote publication and backup worker exit paths remain as they are.
Measure their Kubernetes restart times in D621’s full-service machine-loss check.
