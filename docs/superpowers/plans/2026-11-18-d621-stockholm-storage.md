# D621 run 9, PR 3 — Storage that survives one machine loss

PR 3a prepares per-machine disks and installs the replicated database in the bounded
Stockholm setup. PR 3b adds the test S3 store and an opt-in Kind check for encrypted
reads, writes, multipart completion and repair through a machine outage.
[P1 database and storage requirements](2026-10-22-cloud-country-cell.md#task-5-replicate-the-country-database-and-order-migrations-4065-calls)

## PR 3a — Install PostgreSQL on Stockholm's local disks

In `scripts/kubernetes-database.mjs`, share the digest-checked CloudNativePG 1.29.2
installer and PostgreSQL 18.4 cluster settings with `scripts/kubernetes-data.mjs`.
Keep Kind's storage class and probe roles for PR 2. After all three Stockholm nodes
are ready, run data setup on A with the bound kubeconfig. Fetch and verify the upstream
manifest in private scratch there. Pull the existing image digests from GHCR.
In `deploy/kubernetes/bounded-amazon/bootstrap.sh`, prepare owned directories on each
node's disk. Render a retained local volume per exact hostname with delayed binding
and database-user permissions. Use `d621-data`, the operator-generated database-owner
Secret and remote superuser access disabled. Wait for two operator replicas and three
synchronous database copies on separate hosts. The legacy journey and migration stay
on its own store and A's network mount for now.

Start with failing placement and readiness checks in `scripts/kubernetes-data.test.mjs`
and failure and order checks in `scripts/amazon-run.test.mjs` and `deploy/kubernetes/bounded-amazon/bootstrap.test.mjs`.
Keep PR 2's database checks. Estimate 130–210 implementation and 75–120 test lines.

## PR 3b — Rehearse S3 loss and repair

Propose pinning [MinIO's October security release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
for the private test store. Build its verified commit with pinned Go 1.24.8 in
`deploy/kubernetes/images/store/Dockerfile`. Reuse the launcher's verified image transfer
and the local-volume renderer. Prebind two claims per host to six fixed peers in a
parallel-start StatefulSet, one EC:3 erasure set. Set directory permissions for the
store user. Separate peer discovery from the ready-only S3 Service. Wait for all six
peers and use a bootstrap Job to create a versioned fixture bucket with disposable credentials.

Add `--storage-loss` to `scripts/kubernetes-check.mjs` and the check in
`scripts/kubernetes-storage.mjs`. Use PR 2's owned Kind stop and rejoin. Run one host
client using the backups package's S3 SDK, a private NodePort reachable via the
survivors and matching TLS names. Within each 90-second leg, check old bytes, list,
new encrypted writes, AES256 metadata and wrong-key refusal. Start multipart before
the stop. During it, reject a completion with a missing part, then upload that part,
complete and compare bytes. Check the original volumes after rejoin. Within 180 seconds
of rejoin start the next leg and reread every earlier outage write with a different
node down, so the read needs repaired shards. Repeat the first stop for the last writes.
For the write-quorum control, isolate only the store traffic on a second node while
one node is stopped. Keep the Kubernetes API available and require HTTP 503
`SlowDownWrite` with retries off. Restore and confirm the failed write has no version.

Start with the placement checks and name the live fault cases in
`scripts/kubernetes-storage.test.mjs`. Add focused files to `package.json`, run the
opt-in proof in an approved Linux guest, and record peak memory, disk and timings.
Estimate 290–420 implementation and 130–200 test lines. Update the backlog and AWS
guide after each slice. PRs 4, 5, 7 and 8 still own temporary credentials, Cloud cutover,
the 15-minute full-service fault legs and cold restart. Paid work stays behind its gates.
