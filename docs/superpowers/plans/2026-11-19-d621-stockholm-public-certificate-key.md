# Keep a venue's public certificate key through worker replacement

A paired venue's next public HTTPS certificate uses the same private key
after the Cloud worker loses its temporary files. Keep the current private
issuer and certificate delivery for this first slice of
[Task 8](2026-10-22-cloud-country-cell.md#task-8-publish-real-routes-and-authorized-certificates-durably-4565-calls).
This gives the later S3 slice a way to store certificate chains without
storing their private keys. The signed route and certificate delivery
continue through the existing Secret in this slice.

1. In `packages/remote-access/src/reconciler.ts`, let the artifact
   adapter obtain a public key and certificate request for the current
   installation and hostname. Reuse the call that generates them at
   line 324 when there is no stored pair. Keep the existing path for
   other runtimes. Run the current certificate and publication
   authorization for that request at the same points as today.
2. In `deploy/kubernetes/remote-worker.mjs`, store that pair by
   installation and hostname in one cell-scoped Kubernetes Secret. Use
   the existing API client's resource-version update. A conflict fails
   this claim so the existing retry reads the stored pair. Have
   `deploy/test-cloud/remote-runtime.mjs` pass this optional adapter to
   the reconciler. In `deploy/kubernetes/remote.yaml`, give only the
   worker the existing named get/update permissions for this Secret and
   leave the venue's staff key exchange as it is.
3. First test in `deploy/kubernetes/remote-worker.test.mjs` that a fresh
   adapter over the same Secret returns the first key and request. In
   `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`, extend
   the existing loss of the worker's cached certificate copy to require
   a new certificate with the same public key. Read the TLS public key
   fingerprint from the verified HTTPS response. Keep the replacement,
   certificate checks and revocation assertions. Run the named worker
   test and the existing `TEST_KUBERNETES_REMOTE=1 node --test
   scripts/kubernetes-remote.test.mjs` rehearsal with the private images.
   Record the result in `docs/backlog.md` and the measurements guide.

Allow 1–2 hours, about 55–95 implementation lines and 40–70 test lines.
The next publication slice can put signed routes and certificate chains
straight into replicated MinIO and have candidates read from it. That
slice owns conditional writes, a reader on each candidate and the second
worker. Validated private issuance remains separate.
