# D621 run 9, PR 5 — Cloud services in production mode

In private Linux Kind, complete Cloud signup and sign-in, pair a synthetic box, and
capture and verify its backup on three PostgreSQL copies and six MinIO peers. Reuse
the native clients and verifier from the existing Kubernetes journey and the data
installers from the earlier PRs. This slice covers the healthy-cell journey from
[P1 Tasks 2, 7 and 10](2026-10-22-cloud-country-cell.md).

1. **Bind the dependencies.** Add `scripts/kubernetes-services.mjs` and
   `deploy/kubernetes/services.mjs`. Add `--services` in `scripts/kubernetes-check.mjs`
   using the owned three-node runner. Reuse `scripts/kubernetes-{data,database,storage,storage-identity}.mjs`
   for the TLS migration Job, issuer-before-store setup, custody and bucket policy.
   Run `schema-consumer.mjs` before the regular service commands. Use the verified
   `cloud-db-rw.d621-data` service and the owned `cloud-db-app` test database credential.
   Setup alone uses store admin keys. Create separate bucket-scoped account and worker
   credentials for the object operations each performs. Box grants keep the existing
   narrower policy. Use `us-east-1` and the store's TLS service name in the backup
   location. Bind the native client's private connection to that same name and port.
2. **Run one of each existing role.** Use the account, email, usage, monitor, probe and
   backup commands and collect operations status using the existing read-only package
   query. Set `NODE_ENV=production`, `CLOUD_TEST_SERVICE_PLANS=0` and
   `CLOUD_VENUE_SERVICE_LEVELS=0`. Mount a synthetic password corpus. Reuse the sidecar
   HTTPS proxy with a private CA and `cloud.example.test` certificate. The account
   trusts only loopback and keeps the existing cookie, CSRF and rate-limit checks.
   Leave required factor enrolment off so the regular email action proof is available.
3. **Use the existing email worker and Mailpit.** Set `CLOUD_MAIL_TRANSPORT=smtp`
   with `NODE_EXTRA_CA_CERTS`. Use implicit TLS, SMTP authentication and a
   `.test` recipient allowlist. Keep inbox access authenticated and private, with
   forwarding and relay off. [Pinned Mailpit flags](https://github.com/axllent/mailpit/blob/v1.31.1/cmd/root.go#L111-L130)
4. **Use a real capture.** Add a services-only path in `scripts/test-cloud-integration.mjs`
   and parameterise the origin and storage address in its native fixtures. Complete
   the regular email action proof and both pairing approvals. A one-shot synthetic
   Job uses the same TLS database binding to provision that installation with
   `BackupCatalogue.provision` and set the pinned verification policy. Adapt
   `createKubernetesVerifier` to use one dedicated daemon, schema-gated backup CLI and
   its own database, key, object and state mounts. Load the pinned image before
   starting the worker. Poll the selected point's admitted result, then stop the
   worker cleanly and require successful exit. Confirm that the child restores
   the matching capture and has no network, Cloud mounts, keys or host socket.

Run `node --test deploy/kubernetes/services.test.mjs scripts/{kubernetes-services,kubernetes-check,test-cloud-integration}.test.mjs`
before and after the change. Check production settings, migration order and exact
TLS bindings. On owned Linux run `TEST_KUBERNETES_SERVICES=1 node --test scripts/kubernetes-services.test.mjs`.
Require unauthenticated and out-of-scope mail refusal, signup, sign-in, real capture,
matching admitted restore, corrupt input refusal and cleanup. Use the Waitron
revision in `deploy/backup-verifier/target.json` and verify its built image binding.
Register the tests in the CI local-stack suite and update the D621 backlog and guide.

Estimate 490–640 implementation and 200–300 test lines. This slice uses a direct
installer on Kind. PR 6 owns remote routes. The later outside rehearsal owns
Stockholm launcher and Flux wiring, replica and persistent-mail checks, and
consecutive-outage repair and multipart. PR 8 owns cold restart.
