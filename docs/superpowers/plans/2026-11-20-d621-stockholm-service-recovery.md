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
   stop, use fresh processes on both survivors for ten independent service
   lookups each, including an uncached missing Service name, and a new verified
   TLS database connection per survivor. Give the probes ten seconds within the
   existing 90-second stop. Record per-machine timing, the unchanged primary,
   and the dead replica still advertised before and after the probes.
   Keep the single renewal and revocation submissions, signed publication
   assertions and deadlines. Extend `scripts/kubernetes-remote.test.mjs`.
3. Add a PostgreSQL regression in `packages/account-http/test/server.test.ts`.
   Terminate the uniquely tagged CLI child’s idle connection and require the
   diagnostic, fresh readiness 200 from the same child and clean SIGTERM exit.
   In `packages/account-http/src/server-cli.ts`, log the discarded connection
   without exiting. Add an 11-second client query timeout alongside the
   existing 10-second PostgreSQL statement timeout so a silent connection also
   lets go. Keep startup schema validation and ordinary request failure
   handling. Test Cloud’s separate Compose worker stays outside this slice.
4. In `scripts/kubernetes-database.mjs` and its test, reuse the surviving client
   machine for one minimal account CLI with synthetic settings and verified TLS.
   Warm the connection to the old primary just before the kill. Sample liveness
   and readiness concurrently with the existing stop checks, recording a bounded
   failed database request or connection-loss diagnostic and the readiness 200
   after promotion. Require the same pod and container with no restart and one
   listening event. Remove the SQL proof’s DNS-failure retry. Keep acknowledged
   commit, promoted write, and old-primary refusal checks.

Run the named focused tests, the account regression through `scripts/test-postgres.mjs`,
and `pnpm typecheck`. In disposable Linux run the existing opt-in publication,
database, storage and gateway-machine-stop tests with candidate images.
Record times and remaining checks in `docs/aws-infrastructure.md` and `docs/backlog.md`.
Estimate 180–250 implementation lines and 145–210 test lines. Cold restart is
PR 10. Stockholm fault qualification and paid runs remain separate.
