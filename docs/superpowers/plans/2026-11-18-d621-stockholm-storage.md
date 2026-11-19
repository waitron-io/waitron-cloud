# D621 run 9, PR 3 — Storage that survives one machine loss

PR 3a prepares per-machine disks and installs the replicated database in the bounded
Stockholm setup. PR 3b adds the test S3 store and an opt-in Kind check for encrypted
reads, writes and multipart completion through the first machine outage.
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

## PR 3b — Rehearse the first S3 outage

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
that part, complete and compare bytes. After rejoin, the [first-outage repair check](2026-11-18-d621-stockholm-store-repair.md)
verifies both objects on both returned disks. The Cloud services task in the
country-cell plan tracks repair and multipart through consecutive outages.

Start with the placement checks and name the live fault cases in
`scripts/kubernetes-storage.test.mjs`. Check the launcher store install order and
failure in `scripts/amazon-run.test.mjs`. Add focused files to `package.json`, run the
opt-in proof in an approved Linux guest, and record peak memory, disk and timings.
Estimate 290–420 implementation and 130–200 test lines. Split the Stockholm
store install off if the slice exceeds one and a half times its estimate. Remove
`two_node_loss_refuses_writes` from P1 Task 6 in this slice. Update the backlog and AWS
guide after each slice. PRs 4, 5, 7 and 8 still own temporary credentials, Cloud cutover,
the 15-minute full-service fault legs and cold restart. Paid work stays behind its gates.

## Limits found in the Linux rehearsal

On 18 November, two runs of the unpublished repair candidates used
`TEST_KUBERNETES_STOCKHOLM_STORAGE=1 node --test scripts/kubernetes-storage.test.mjs`
in disposable three-machine Kind clusters and failed at different points:

- In the first repair attempt, both serving peers reported six online drives
  once the machine returned. The repair check found a missing object shard on
  a returned disk. The local
  `repair-reconnect-capture-01.log` records the drive counts at lines 95–98 and
  the failed disk check at line 647.
- In a separate run, both serving peers reported four of six drives online
  during the first outage. The read of an object written before the outage
  received HTTP 503 `SlowDownRead`. The run stopped before the machine returned
  or the check requested repair. The local `repair-peer-refresh-live-01.log`
  records the drive counts at line 83 and the read refusal at lines 423–445.

Each run passed six focused checks and failed the live case. The 19 November
Linux trace found both Kubernetes DNS replicas on the stopped machine. MinIO
could read its local drive and timed out looking up three surviving remote
drives. The [DNS placement repair](2026-11-19-stockholm-storage-dns-placement.md)
moves the replicas onto separate machines before workloads start. The Linux
rehearsal passed both survivors' encrypted reads, writes, listing and multipart
within the existing 90-second outage window. Two forced DNS-host-loss runs
returned HTTP 503 `SlowDownWrite` during multipart. In the second, Kubernetes
still listed the stopped DNS host as ready (`post-land-dns-host-loss-live.log`,
lines 75–86 and 438–476). Two subsequent controls passed all four checks. One
kept the stale entry. In the other, both surviving machines routed DNS only to
the surviving replica. The cause of the earlier multipart refusals remains open.
A shorter peer refresh also discards idle addresses sooner. If multipart fails
again, check whether a reconnect needed a fresh lookup while DNS was unavailable.

Two scoped grant renewals reached Cloud's ten-second deadline while a machine
was down. In the second run, MinIO finished reloading the grant on its peers
just after the client gave up (`renewal-timing-live.log`, lines 110–122 and
516–530). An earlier traced renewal passed in 18 ms. The later per-peer trace
passed in 9.786 seconds and read the encrypted snapshot after all six peers
returned. The two stopped peers returned errors within four microseconds. Two
peers on surviving machines completed in 9.407 and 9.777 seconds. Kubernetes
listed the stopped DNS host as ready throughout the request. The cause of the
slow reload remains open.

Keep MinIO grant timing enabled in the identity rehearsal. For the run 9 Linux
rehearsal, Lane G keeps the per-peer and DNS sampling enabled using
`combined.patch` and `combined-command.sh` in
`receipts/d621-multipart-dns-control/`. The test keeps the original expiry,
deadline, single request and post-rejoin read. Report a third timeout or
multipart refusal to the watcher with its trace. The same receipt directory
holds `combined-live-01.log` (lines 77–104 and 155–209) and
`survivor-only-03.log` (lines 75–110). Earlier DNS rehearsal logs are in
`receipts/storage-read-during-outage/`. The second renewal timeout is in
`receipts/d621-run9-storage-access/` within the lane.

The [returned-drive rehearsal](2026-11-18-d621-stockholm-store-repair.md)
refreshes peer addresses every second and asks MinIO to repair the bucket once
after the first machine returns. The Linux Kind recheck used the parked
candidate `a2a254dbdf` with the DNS placement changes, tree
`1abca994e6edb191f06b91f7d5b91c1d096ef557`. Both outage objects reached
both returned disks, including both multipart parts. Both byte checks passed through the returned machine. The repair leg
took 18.746 seconds and the run passed all seven checks
(`receipts/storage-read-during-outage/post-land-returned-drive-live-02.log` in
Lane G, lines 86–109). Repair and multipart through consecutive outages and
real Stockholm machine loss remain open.
