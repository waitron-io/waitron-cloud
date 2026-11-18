# D621 run 9, PR 2 — Local node loss and PostgreSQL

This follows the [three-member control-plane setup](2026-11-18-d621-stockholm-control-plane.md)
and [P1 Task 5](2026-10-22-cloud-country-cell.md#task-5-replicate-the-country-database-and-order-migrations-4065-calls).
The Stockholm fixture still mounts storage from A. PR 3 installs the PostgreSQL operator and
provisions per-node volumes on Stockholm. Real machine loss and cold restart are later slices.

## PR 2a — Check three Kubernetes control planes in Kind

Run \`node scripts/kubernetes-check.mjs --node-loss\` to stop each control plane in turn and
check that the other nodes accept API writes and schedule new work. Add the loop in
\`scripts/kubernetes-node-loss.mjs\`. Reuse the pinned Kind node image and its preloaded pause
image. Give Kind an owned fixed-subnet Docker network, a loopback balancer and a private
kubeconfig. Make all three nodes schedulable. Keep the existing check targets.

Record the Docker container and network IDs, Kubernetes node UIDs and etcd member IDs.
Disable automatic restart on the selected container before SIGKILL. Confirm it stays stopped
through an API ConfigMap write and read and a fresh pod scheduled away from that node. Reconnect
it at its original IP before starting it, then check the original members and their health.
Allow 90 seconds for failover and 180 seconds for rejoin. Keep failure diagnostics and remove
only owned resources. Leave cached images in place.

Start with failing command checks in \`scripts/kubernetes-node-loss.test.mjs\` and add that file
to the local-stack suite in \`package.json\`. Command tests cover ownership refusals and cleanup.
The live run covers scheduling and rejoin. Measure memory during the live run on the approved
rented CI server, with at least 10 GiB RAM and 30 GiB free disk. Update the backlog and AWS guide
with the scope verified. Estimate 200–290 implementation lines and 100–160 test lines.

## PR 2b — Check PostgreSQL loss in the same cluster

Add \`--database-loss\` and \`scripts/kubernetes-database.mjs\`. Pin and digest-check the downloaded
CloudNativePG 1.29.2 manifest and PostgreSQL 18.4 images. Patch the operator to two replicas on
separate nodes with a digest-pinned image. Place three instances on distinct hosts with separate
Kind local-path claims. Use synchronous commit, any one standby, required durability and
failover quorum. Use the existing Cloud image with a release-digest migration Job and
\`schema-consumer.mjs\` for the probe. Give the Job the database-owner Secret and keep remote
superuser access disabled. Use a separate Secret and a CloudNativePG-managed \`pg_read_all_data\`
role for the probe. Verify TLS hostnames. Start the probe before the Job finishes and have it
retry. Place the database test client on a node that survives both faults. Show that the
consumer can read only after migration success. The existing wrapper tests
own the digest refusal.

Pause both WAL receivers and show the commit waits. Raise only \`wal_sender_timeout\` to 30s
while pausing, then restore it. For the sync-off control require the pending check to fail, then
restore sync and wait for FailoverQuorum to report both standbys. Resume one receiver, stop the
primary after acknowledgment, and resume the remaining receiver once the node is down. Verify
the row and a new committed write through the write Service. After restart, sample that Service
until the former primary is confirmed a replica. Pause its replay and use \`host=cloud-db-rw\`
with \`hostaddr\` set to its pod IP, \`sslmode=verify-full\`, and the writer role. Require a direct
INSERT to fail with SQLSTATE \`25006\`. Verify the same claim, lag, catch-up, and a successful
write through a separate standby loss. The real run owns Job ordering and fault results.

Reuse the owned stop and rejoin in `scripts/kubernetes-node-loss.mjs`. Add focused checks
in `scripts/kubernetes-node-loss.test.mjs` and `scripts/kubernetes-database.test.mjs`, and run them
through `package.json` in CI. Run the real check in the approved rented Linux guest with at
least 10 GiB RAM and 30 GiB free disk. Update the backlog and AWS guide with the verified
scope. Estimate 440–600 implementation lines and 90–150 test lines.
