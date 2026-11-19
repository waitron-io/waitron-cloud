# D621 run 9, PR 5 — Cloud services in production mode

In private Linux Kind, sign up, sign in, pair one synthetic box, and capture and verify
its backup on three PostgreSQL copies and six MinIO peers. Reuse the native client,
verifier and data installers. This is the healthy-cell journey from
[P1 Tasks 2, 7 and 10](2026-10-22-cloud-country-cell.md).

1. **Bind the dependencies.** Add `deploy/kubernetes/services.mjs` and
   `scripts/kubernetes-services.mjs`. Dispatch `kubernetes-check.mjs --services` via a
   services hook in `kubernetes-node-loss.mjs`. Reuse the TLS migration Job,
   issuer-before-store setup, and bucket policy from `scripts/kubernetes-{data,database,storage,storage-identity}.mjs`.
   Run workloads and Jobs in `d621-data` with `cloud-db-app` and `cloud-db-ca`.
   Verify the primary's TLS name. Mount only the public store certificate. All callers
   use the same reachable URL, `https://<owned-kind-node-ip>:30900`, with `us-east-1` and
   `cloud-storage-rehearsal`. Store admin keys stay in setup. Account and worker get
   separate bucket-scoped credentials for their own operations. Box grants keep the
   existing per-object policy.
2. **Run one of each role.** Use `schema-consumer.mjs` to start the account, email,
   usage, monitor, probe and backup package commands. Read operations status through
   the existing read-only query. Set `NODE_ENV=production`,
   `CLOUD_TEST_SERVICE_PLANS=0`, `CLOUD_VENUE_SERVICE_LEVELS=0` and
   `CLOUD_REQUIRE_ENROLLMENT=false`. Supply the synthetic password corpus.
   Adapt `deploy/test-cloud/proxy.cfg` to terminate TLS at the account pod on 3443
   with its private CA and `cloud.example.test:3000` origin. Use host port 3000
   on the selected node and map the box's hostname there. Trust loopback only.
3. **Capture signup mail.** Start `packages/registration/src/email-worker-cli.ts`
   with `CLOUD_MAIL_TRANSPORT=smtp` and `NODE_EXTRA_CA_CERTS`. Use implicit TLS,
   SMTP authentication and a `.test` recipient allowlist. Pass inbox credentials to
   the fixture through private input for authenticated retrieval on a loopback forward.
   Keep relay and forwarding off. [Pinned Mailpit flags](https://github.com/axllent/mailpit/blob/v1.31.1/cmd/root.go#L111-L130)
4. **Capture and restore.** Add a services-only branch in `scripts/test-cloud-integration.mjs`
   and parameterise the native fixtures' origin and storage trust. Use real email
   action proof and account and box pairing calls. Skip the test plan setter. A one-shot
   Job with the TLS database binding provisions the paired installation in existing
   mode, sets the digest-bound policy, and runs binding, snapshot and admission reads
   for the fixture. Adapt `createKubernetesVerifier` to one dedicated daemon with
   `LOCAL_STACK_CONFIG_DIR=/run/backup-verifier` and `CLOUD_VERIFIER_OWNER=waitron-cloud-test-backup`.
   Load the image before starting the production backup CLI. Poll the selected point's
   admitted result and require a clean worker exit. The restore child receives no
   network, Cloud mounts, keys or host socket. Reuse the existing disk verifier
   with a private 1 GiB ext4 scratch filesystem scoped to the Kind verifier Pod
   and removed after cluster cleanup. Keep its 1 GiB memory limit and verify the
   archive digest. The Lane G watcher cleared the scratch change on 19 November at 13:15.

Add the failing cases, then rerun after implementation with
`node --test deploy/kubernetes/services.test.mjs scripts/{kubernetes-services,kubernetes-check,test-cloud-integration}.test.mjs`.
Check production settings, startup order and exact dependency bindings. On owned Linux run
`TEST_KUBERNETES_SERVICES=1 node --test scripts/kubernetes-services.test.mjs`. Require SMTP
refusals, signup, sign-in, real capture, matching admitted restore, altered archive bytes
refused without a successful verification verdict, and cleanup. Bind the native box and
verifier image to the shared test pin `deploy/backup-verifier/amazon-test-target.json`
as cleared by the watcher on 19 November at 11:25. Verify the image's full target against
that pin before use. Register the unit cases in CI and update the D621
backlog and rehearsal guide.

Estimate 570–720 implementation and 220–320 test lines. PR 6 owns remote routes. The
outside rehearsal owns Stockholm and Flux wiring, a stable endpoint across node loss,
replicas, durable mail, and consecutive-outage repair and multipart. PR 8 owns cold restart.
