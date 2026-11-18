# D621 run 9, PR 3 — Storage that survives one machine loss

PR 3a prepares per-machine disks and installs the replicated database in the bounded
Stockholm setup. PR 3b adds the test S3 store and an opt-in Kind check for encrypted
reads, writes, multipart completion and repair through the first machine outage.
[P1 database and storage requirements](2026-10-22-cloud-country-cell.md#task-5-replicate-the-country-database-and-order-migrations-4065-calls)

## PR 3a — Install PostgreSQL on Stockholm's local disks

In `scripts/kubernetes-database.mjs`, share the digest-checked CloudNativePG 1.29.2
installer and PostgreSQL 18.4 cluster settings with `scripts/kubernetes-data.mjs`.
Keep Kind's storage class and probe roles for PR 2. After all three Stockholm nodes
are ready, run data setup on A with the bound kubeconfig. Fetch and verify the upstream
manifest in private scratch there. Pull the existing image digests from GHCR.
In `deploy/kubernetes/bounded-amazon/bootstrap.sh`, prepare owned directories on each
node's disk. Render a retained local volume per exact hostname with delayed binding
and database-user permissions. Use the `d621-data` namespace, the operator-generated database-owner
Secret and remote superuser access disabled. Wait for two operator replicas and three
ready database copies on separate hosts. The legacy journey and migration stay
on its own store and A's network mount for now. PR 5 connects its migration
and Cloud services to the database in `d621-data`.

Start with failing placement and readiness checks in `scripts/kubernetes-data.test.mjs`
and failure and order checks in `scripts/amazon-run.test.mjs` and `deploy/kubernetes/bounded-amazon/bootstrap.test.mjs`.
Start the database on owned Kind using the Stockholm bootstrap phase and data
installer. Check that three copies are ready, one per node, each writing to its
own volume. Keep PR 2's database checks.
Estimate 130–210 implementation and 75–120 test lines.

## PR 3b — Rehearse S3 loss and repair

Propose pinning [MinIO's October security release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
for the private test store and update both P1 plan pin lines in PR 3b. Verify source commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`
and build with pinned Go 1.24.8 and `GOTOOLCHAIN=local` in
`deploy/kubernetes/images/store/Dockerfile`. Reuse the launcher's verified image transfer
and install the same rendered store in Kind and the bounded Stockholm setup. Prebind
two claims per host to six fixed peers in a
parallel-start StatefulSet, one EC:3 erasure set. Set directory permissions for the
store user. Separate peer discovery from the ready-only S3 Service. Wait for all six peers. The check's client creates its versioned fixture bucket
with disposable credentials. The bootstrap Job belongs to PR 5.

Add `--storage-loss` to `scripts/kubernetes-check.mjs` and the check in
`scripts/kubernetes-storage.mjs`. Use PR 2's owned Kind stop and rejoin. Run one host
client using the backups package's `BackupObjects` to write and read encrypted files
and raw S3 for listings and the multipart missing-part case. Use a private NodePort that routes only to peers
on the contacted host and matching TLS names. Within the 90-second outage, check old bytes, list,
new encrypted writes, AES256 metadata and wrong-key refusal. Start multipart before
the stop. During it, reject completion that references a missing part, then upload
that part, complete and compare bytes. Once all six peers return, read each outage write once to queue repair.
Within 180 seconds, verify both objects on both volumes of the returned
machine, then read the original bytes through that machine. PR 5 covers a
pending multipart upload and repair across consecutive outages before run 9,
as required in the country-cell plan's Cloud services task.

Start with the placement checks and name the live fault cases in
`scripts/kubernetes-storage.test.mjs`. Check the launcher store install order and
failure in `scripts/amazon-run.test.mjs`. Add focused files to `package.json`, run the
opt-in proof in an approved Linux guest, and record peak memory, disk and timings.
Estimate 290–420 implementation and 130–200 test lines. Split the Stockholm
store install off if the slice exceeds one and a half times its estimate. Remove
`two_node_loss_refuses_writes` from P1 Task 6 in this slice. Update the backlog and AWS
guide after each slice. PRs 4, 5, 7 and 8 still own temporary credentials, Cloud cutover,
the 15-minute full-service fault legs and cold restart. Paid work stays behind its gates.
