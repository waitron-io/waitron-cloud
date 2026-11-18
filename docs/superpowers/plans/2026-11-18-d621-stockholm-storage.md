# D621 run 9, PR 3 — Storage that survives one machine loss

The bounded Stockholm setup gains the PostgreSQL operator, three database copies and an S3
test store on per-machine disk. The local Kind check proves encrypted reads, new writes and
multipart completion during each single-machine outage. The legacy journey still uses A's
network mount for configuration and image staging. PR 5 moves Cloud services onto the new
data layer. PR 7 and run 9 check the full journey through machine loss. [P1 storage requirements](2026-10-22-cloud-country-cell.md#task-6-keep-genuine-s3-reads-and-writes-available-3555-calls)

1. In `scripts/kubernetes-data.mjs`, reuse PR 2's digest-checked CloudNativePG 1.29.2 installer
   and PostgreSQL 18.4 cluster settings from `scripts/kubernetes-database.mjs`. Keep two operator
   replicas and three synchronously replicated database instances on distinct hosts. In the
   bounded launcher, install only the data setup after the three nodes are ready. Fetch the
   operator manifest into private scratch, verify its digest and use the existing image pins.
   Keep the legacy fixture and its migration path working.
2. In `deploy/kubernetes/bounded-amazon/bootstrap.sh` and `scripts/amazon-run.mjs`, prepare local
   directories outside `/var/local/d620-config`. Render retained local volumes tied to their
   hostnames, with delayed binding so the scheduler respects placement. Give PostgreSQL one
   volume per host and prebind each MinIO peer's claim to its assigned local volume. Use separate
   services and a `d621-data` namespace. Use the same resource renderer in Kind and Stockholm.
3. Build private MinIO `RELEASE.2025-09-07T16-13-09Z` in `deploy/kubernetes/minio/Dockerfile`
   with checksum-verified source and Go 1.24.2 inputs. Include its image in the launcher's verified
   transfer. Use six fixed peer names, two per host, and one six-volume erasure set with EC:3.
   Separate peer discovery from the readiness-filtered S3 Service. Use private-CA TLS with
   hostname verification, versioned buckets and a proof user scoped to its fixture bucket.
4. Add `--storage-loss` to `scripts/kubernetes-check.mjs` and the live check to
   `scripts/kubernetes-storage.mjs`. Reuse the owned Kind stop and rejoin from
   `scripts/kubernetes-node-loss.mjs`. Run one client outside the three nodes with the
   existing S3 SDK and customer-key encryption headers. For each stopped node verify prior
   bytes, list, new writes, wrong-key refusal and AES256 metadata. Start multipart before the
   stop, complete while it is down and verify the full bytes. Check the same volume IDs and
   wait for the store's repair status before the next leg. For the two-node control use verified Docker IDs and a
   direct TLS endpoint on the survivor, independent of Kubernetes API quorum. Require the
   store's write-quorum rejection, then restart both nodes and verify the rejected key is absent.

Start with failing cases in `scripts/kubernetes-data.test.mjs` for digest and volume placement,
and in `scripts/amazon-run.test.mjs` and `deploy/kubernetes/bounded-amazon/bootstrap.test.mjs`
for installation order, local paths and failure cleanup. Keep PR 2's database checks. Add
`scripts/kubernetes-storage.test.mjs` for the real fault assertions, register the new tests in
`package.json` and run the opt-in proof in the approved Linux guest. Update `docs/backlog.md`
and `docs/aws-infrastructure.md` with measured results. Temporary credentials, production-mode
services, cold restart and paid work stay with their assigned slices.

Estimate **420–600 implementation lines and 200–300 test lines**, including Stockholm PostgreSQL
setup. The upstream operator manifest stays out of the diff.
