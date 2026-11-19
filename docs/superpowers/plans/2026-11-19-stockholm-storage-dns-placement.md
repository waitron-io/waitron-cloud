# Keep DNS available during the first Stockholm storage outage

With one machine off, the remaining Stockholm store peers need to resolve each
other and read a previously written encrypted object. The instrumented Linux
rehearsal found both CoreDNS replicas, which answer Kubernetes name lookups, on
the stopped machine. MinIO timed out resolving the three live remote drives,
read only its local drive and returned HTTP 503. Both traced renewals saved
their records in under 3 ms and spent about 4 s waiting for peer reloads. They
returned before the client deadline. The earlier 10-second timeout remains
unexplained. [Country-cell storage and credential checks](2026-10-22-cloud-country-cell.md#task-6-keep-genuine-s3-reads-and-writes-available-3555-calls)

- [x] Post the one-hour findings and wait for watcher clearance before building.
- [x] Use the existing Linux encrypted read during the outage as the failing
  behaviour. In `scripts/kubernetes-node-loss.test.mjs`, add a focused case
  called “the three-machine rehearsal waits for DNS across machines before
  starting workloads”. Verify that cluster setup requires the
  `k8s-app=kube-dns` pods on separate `kubernetes.io/hostname` values and waits
  for their rollout before handing off to the workload. Add patch and rollout
  handling to the existing command fixture. Observe the missing
  setup step on current main. Verify the case fails on removal of the hard
  placement rule. Extend the existing boot order assertions in
  `scripts/amazon-run.test.mjs` to cover the same placement and wait.
- [x] Move the existing `separateByHost(matchLabels)` and the CoreDNS deployment
  patch and bounded rollout wait into `scripts/kubernetes-placement.mjs` as
  `separateByHost(matchLabels)` and `spreadCoreDns(kube)`. Keep the
  PostgreSQL operator's existing use of `separateByHost`. Replace the database
  rehearsal's DNS-only step with one cluster-level call in
  `scripts/kubernetes-node-loss.mjs` after all nodes are Ready. Call it in
  `scripts/amazon-run.mjs` after the proxy rollout, before starting data setup.
  Let the existing SSH wrapper take the rollout command's 125-second bound. Keep this
  slice on disposable Linux and simulated Amazon commands.
- [ ] Run `node --test scripts/kubernetes-node-loss.test.mjs scripts/kubernetes-storage.test.mjs scripts/kubernetes-database.test.mjs scripts/amazon-run.test.mjs`.
  Run the existing `TEST_KUBERNETES_STOCKHOLM_STORAGE=1` file on Linux. Keep
  both survivors' reads, the new write, list and multipart checks. Record DNS
  placement, which DNS endpoints Kubernetes still marks ready, and the first
  read's timing in a scratch control that stops a DNS host. Both reads must
  pass within the existing deadlines. Bring any failure back to the watcher.
  On a scratch copy of `53e976888c65cd1ace23d487e942687df2f4236f` with the
  repair, run the existing `TEST_KUBERNETES_STORAGE_IDENTITY=1` file with
  real expiry, the single renewal request and the read after rejoin. The
  watcher asked to keep those checks in the 03:20 lane G decision.
- [x] Update the existing D621 entry in `docs/backlog.md` with the result.
  Returned-drive repair, consecutive outages and paid qualification stay
  open. Leave MinIO, its deadlines and the credential policy as they are.
  Expect about 25–45 changed implementation lines and 30–50 test lines.
