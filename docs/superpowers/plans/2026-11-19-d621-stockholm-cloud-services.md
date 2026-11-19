# D621 run 9, PR 5 — Cloud services in production mode

On a private three-machine rehearsal, sign up and sign in through the regular Cloud account
service, pair a synthetic box, and capture and verify its backup through replicated PostgreSQL
and MinIO. Use production settings with test service plans off. The existing Kubernetes
journey uses test plans and sidecar data services. Reuse its native clients and verifier for
this part of [P1 Tasks 2, 7 and 10](2026-10-22-cloud-country-cell.md).

1. **Install once.** Add `scripts/kubernetes-services.mjs` and `deploy/kubernetes/services.mjs`.
   Share the installer between `scripts/kubernetes-check.mjs --services` on three owned Kind
   control-plane nodes and bounded startup in `scripts/amazon-run.mjs`. Reuse the Stockholm
   database, TLS migration Job, schema consumer gate, MinIO installation, issuer custody and
   bucket policy from `scripts/kubernetes-{data,database,storage,storage-identity}.mjs`.
   Connect to the verified primary service and configure the issuer before store startup.
   Restrict application storage credentials and box grants to the rehearsal bucket and their
   respective operations. Keep store administration credentials in setup.
2. **Run existing roles.** Spread two replicas of account, email, usage, monitor and probe.
   Reuse the operations collector and the package commands. Set `NODE_ENV=production` and
   `CLOUD_TEST_SERVICE_PLANS=0`. Supply only each role's keys and an account password corpus.
   Keep HTTPS, exact trusted proxy addresses, session, CSRF and rate limits. Disable demo,
   translation and local metrics. Use a private `cloud.example.test` origin because the
   existing SMTP client refuses `.local`.
3. **Send signup mail through the existing worker.** Configure the pinned Mailpit image for
   implicit TLS, SMTP authentication and `.test` recipients only. Trust its private CA using
   `NODE_EXTRA_CA_CERTS`. Retrieve the inbox over an authenticated private connection and keep
   mail, tokens and credentials out of receipts. Use Mailpit's capture configuration, with
   relay and forwarding off. [Mailpit v1.31.1 flags](https://github.com/axllent/mailpit/blob/v1.31.1/cmd/root.go#L111-L130)
4. **Prove the journey.** Add a services-only path to `scripts/test-cloud-integration.mjs` and
   reuse its native fixtures under `deploy/test-cloud/test-fixtures/`. Keep the regular email
   action proof, pairing approvals and machine authentication. A one-shot synthetic fixture
   provisions the paired installation via `BackupCatalogue.provision` in existing mode.
   Reuse `createKubernetesVerifier` with its own Docker daemon and the production backup CLI.
   Bind the real capture and restore to the image revision in `deploy/backup-verifier/target.json`.
   Check its compatibility before building the image. The child receives no network, keys,
   host socket or Cloud mounts.

Run the new negative cases first, then the same cases after implementation with
`node --test deploy/kubernetes/services.test.mjs scripts/{kubernetes-services,kubernetes-check,test-cloud-integration,amazon-run}.test.mjs`.
Check migrations before consumers, missing corpus, dependency bindings, denied SMTP and
absence of fallback to test plans. The launcher test uses simulated commands. In owned Linux,
run `TEST_KUBERNETES_SERVICES=1 node --test scripts/kubernetes-services.test.mjs` with the
pinned images. Require authenticated signup and sign-in, a real capture, matching admitted
restore, refusal of corrupt input and cleanup. Register focused tests in the CI local-stack
suite, run `pnpm typecheck`, and update the D621 backlog and rehearsal guide.

Estimate 440–590 implementation and 200–300 test lines. PR 6 owns remote routes. PR 7 owns
outside machine-loss evidence, durable mail during outages and the remaining storage checks.
PR 8 owns cold restart. This slice uses synthetic data and the private rehearsal only.
