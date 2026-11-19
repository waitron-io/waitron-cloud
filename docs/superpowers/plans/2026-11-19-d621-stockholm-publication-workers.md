# D621 run 9, PR 8 — Keep remote publication working when a machine stops

In private Kind, stop the machine that first published a paired venue’s public
certificate. A second worker on a different machine starts with an empty cache, reuses
that certificate and its signing request, then publishes the owner’s revocation as a
newer signed route manifest while the first machine is down.

1. In `deploy/kubernetes/remote-worker.mjs`, save the installation ID and signing
   request beside the existing venue certificate in the scoped `remote-routes` Secret.
   Read them together for that installation. Keep the gateway’s certificate map and
   manifest fields. `deploy/test-cloud/remote-runtime.mjs` uses the shared copy in
   Kubernetes and keeps the file adapter for test Cloud. Use Kubernetes’ existing
   version check on the whole Secret. A failed read or write fails the job attempt
   so the existing SQL retry can reread current state. Keep the signed sequence and
   certificate authorization checks. Staff keys stay at the venue.
2. In `scripts/kubernetes-remote.mjs`, use a two-replica Deployment with the existing
   worker image, identity mounts, TLS database connection and per-pod scratch directory.
   Reuse the gateway’s required separation by host. In the existing handover rehearsal,
   start one worker away from the account machine for baseline publication, then scale to
   two. Keep its certificate replacement check by forgetting only the saved request in
   the fixture, which leaves the served certificate until its replacement. Update worker
   diagnostics in `scripts/kubernetes-services.mjs` to use the pod label and keep the remote
   inspection job next to the account pod so the test can inspect work during the stop.
3. In `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs` and
   `integration-paid-remote-account.mjs`, prove the second pod has no cached copy and
   stop the first publisher’s machine with the owned Kind helper. Make the existing
   certificate job due and require a fresh completion with the same certificate and
   request fingerprints. Submit the existing owner revocation and read the higher
   signed sequence without the venue before the machine rejoins. Keep the existing
   projected-route, peer and HTTPS refusal checks after rejoin. This exercises work
   submitted during the stop, with the existing claim deadlines.

Start with failing tests in `deploy/kubernetes/remote-worker.test.mjs` for reading the
same copy with a fresh adapter and losing a racing Secret update without replacing the
winner. Run `deploy/test-cloud/remote-runtime.test.mjs` with PostgreSQL for the file
adapter. Extend `TEST_KUBERNETES_REMOTE=1 node --test scripts/kubernetes-remote.test.mjs`
in disposable Linux for the actual machine stop, unchanged identity and fresh
withdrawal. Record results in `docs/aws-infrastructure.md` and update `docs/backlog.md`.

Estimate 140–200 implementation lines and 75–125 test lines. Replicated S3 delivery,
validated private issuance, shared ingress and Stockholm fault results stay open.
