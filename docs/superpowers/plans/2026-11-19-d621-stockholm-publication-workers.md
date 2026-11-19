# D621 run 9, PR 8 — Keep remote publication working when a machine stops

In private Kind, stop the machine that published a paired venue’s public certificate.
A second worker starts with an empty cache, reuses the same certificate and signing
request, then publishes the owner’s revocation as a newer signed route manifest while
the first machine is down.

1. In `deploy/kubernetes/remote-worker.mjs`, write the installation ID and signing
   request beside the venue’s certificate in the scoped `remote-routes` Secret. Keep
   the gateway’s certificate map and manifest as they are. Read the copy only for the
   matching installation. A missing request or different installation means there is
   no reusable copy. API errors and Kubernetes version conflicts fail the attempt,
   leaving the existing database job retry to reread current state. In
   `deploy/test-cloud/remote-runtime.mjs`, use the Secret alone for the Kubernetes
   public copy and keep the file adapter for test Cloud. Reuse the current signed
   sequence and certificate authorization checks. Staff keys stay at the venue.
2. In `scripts/kubernetes-remote.mjs`, replace the bare Pod with a two-replica
   Deployment. Require different machines and exclude the account node in the
   scheduler. Reuse the worker image, identity mounts and per-pod scratch. Start
   the handover rehearsal with one worker. Use the existing five-second venue
   fixture traffic during handover so the check can reach publication. Have the
   first worker publish the baseline and same-route replacement before scaling to two. The fixture forgets only the saved request using a version-checked
   Secret write, leaving the served certificate in place. Pin the remote inspection
   job to the account node in `deploy/kubernetes/services.mjs` and its caller,
   `scripts/kubernetes-services.mjs`. Read worker diagnostics by pod label.
3. In `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs` and
   `integration-paid-remote-account.mjs`, assert that both workers are ready on distinct machines away from the account. Check that the fixture’s route and certificate
   jobs are idle and not due. Stop the first worker’s machine with the existing helper.
   Make the certificate job due and require a fresh completion with unchanged certificate
   and request fingerprints. Submit owner revocation and verify the Secret’s signature,
   higher route sequence and removal of the venue through the Kubernetes API while the
   machine is down. Check all gateway projections, peer removal and HTTPS refusals after
   rejoin. This measures new work submitted during the stop under the existing deadlines.

Start with failing tests in `deploy/kubernetes/remote-worker.test.mjs` for the fresh
copy, refusal to reuse a different installation’s request and a racing HTTP 409
that leaves the winner intact. Check inspection placement in
`deploy/kubernetes/services.test.mjs` and run `deploy/test-cloud/remote-runtime.test.mjs`
with PostgreSQL, including a fake Secret that proves reuse without a local copy. Extend `TEST_KUBERNETES_REMOTE=1 node --test scripts/kubernetes-remote.test.mjs`
in disposable Linux to prove the actual stop, reuse and fresh withdrawal. Record the
results in `docs/aws-infrastructure.md` and update `docs/backlog.md`.

Estimate 150–220 implementation lines and 85–135 test lines. Replicated S3 delivery,
validated private issuance, shared ingress and Stockholm fault results stay open.
