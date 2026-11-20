# D621 run 9, PR 9 — Keep name lookups and the account process working through machine loss

In disposable Linux Kind, repeat #1333’s publication-worker stop without waiting
for DNS endpoint withdrawal. While Kubernetes still marks the stopped DNS
replica ready, both survivors resolve the database Service name and open a fresh
verified TLS connection to the unchanged primary. In the database-loss rehearsal,
the same account process stays live during promotion and serves a database-backed
request before the old primary’s machine rejoins.

1. Extend `spreadCoreDns` in `scripts/kubernetes-placement.mjs`, used by Kind
   and the Stockholm launcher, to run three replicas with its existing hard
   separation by machine. Allow one unavailable with no extra pod during rollout
   so replacement can fit. Confirm a ready DNS endpoint on each of the three
   expected machines before setting the DNS Service’s `internalTrafficPolicy` to
   `Local`. This keeps traffic on the caller’s machine, even while the stopped
   machine’s endpoint is advertised. A machine can lose DNS until its own DNS
   pod recovers. Add failing placement, missing-endpoint and setup-order checks in
   `scripts/kubernetes-node-loss.test.mjs` and update the mocked launcher in
   `scripts/amazon-run.test.mjs`.
2. In `scripts/kubernetes-remote.mjs` and
   `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`, drop the DNS
   withdrawal waiter. At the start of the existing stop, measure fresh lookups
   and connections in parallel from the surviving account and worker pods,
   with a ten-second limit inside the existing 90-second stop window. Record
   DNS endpoint and primary samples around the probes. Require the dead replica
   to be advertised across the probes so a late probe cannot qualify. Keep the
   single renewal and revocation submissions, the signed publication checks and
   their deadlines. Extend `scripts/kubernetes-remote.test.mjs` to check the
   new result.
3. In `packages/account-http/test/server.test.ts`, terminate the CLI child’s
   uniquely tagged idle PostgreSQL connection. Require the same child to log
   the fixed diagnostic, answer a fresh `/api/health/ready` with 200 and exit
   cleanly on SIGTERM. Then change the idle-pool error handler in
   `packages/account-http/src/server-cli.ts` to log and keep serving. The pool
   has already discarded the failed client. Startup still checks the schema.
   In-flight requests retain their normal failure handling.
4. Extend the existing primary-stop leg in `scripts/kubernetes-database.mjs`
   and its test. After migration, start the account CLI with synthetic settings
   and verified database TLS on the surviving client’s machine. Warm its pool.
   Sample `/api/health/live` across the stop and measure recovery of
   `/api/health/ready` before rejoin, within the existing stop budget. Require
   the same pod and container with no restart. Readiness can briefly return 503
   during promotion. Keep the database commit and old-primary refusal checks.

Run the named focused tests, the account regression through `scripts/test-postgres.mjs`,
and `pnpm typecheck`. In disposable Linux with the candidate image IDs, run
`TEST_KUBERNETES_REMOTE=1 node --test scripts/kubernetes-remote.test.mjs` and
`TEST_KUBERNETES_DATABASE_LOSS=1 node --test scripts/kubernetes-database.test.mjs`.
Record the measured results in `docs/aws-infrastructure.md` and `docs/backlog.md`.

Estimate 150–220 implementation lines and 120–180 test lines. Cold restart stays
in PR 10. Stockholm fault qualification and paid runs remain separate.
