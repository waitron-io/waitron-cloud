# Keep DNS available during the first Stockholm storage outage

With any one machine off, the remaining Stockholm store peers can resolve each
other and read a previously written encrypted object. The country-cell plan calls
for one-machine loss to leave four of the six storage drives available.
[Stockholm storage and credential checks](2026-10-22-cloud-country-cell.md#task-6-keep-genuine-s3-reads-and-writes-available-3555-calls)

The instrumented Linux storage check found both CoreDNS replicas, which answer
Kubernetes name lookups, on the stopped machine. MinIO
timed out resolving the three live remote drives, read only its local drive and
returned HTTP 503. Renewal in the traced runs saved its record in under 3 ms and
spent about 4 s waiting for peer reloads. Both renewals returned before the client
deadline. The earlier 10-second timeout remains unexplained. Run the unchanged live qualification on the repaired
setup.

- [ ] Add a case to `scripts/kubernetes-storage.test.mjs` called
  “the Stockholm installer spreads DNS before starting the store”. Drive
  `installStockholmStore` with the command boundary supplied by the caller.
  Check that it requires the `k8s-app=kube-dns` pods to run on separate
  `kubernetes.io/hostname` values and waits for the deployment rollout before
  store setup. Observe the missing placement step on current main.
- [ ] Extract `spreadCoreDns(kube, signal)` in `scripts/kubernetes-dns.mjs`
  from the database rehearsal's CoreDNS patch and bounded rollout wait. Call
  it from `scripts/kubernetes-storage.mjs` before installing MinIO and keep
  the existing database rehearsal call through the same function in
  `scripts/kubernetes-database.mjs`. The Kind and bounded Amazon routes call
  the same Stockholm store installer. The Amazon route gets a source and
  command check only. This slice runs entirely on disposable Linux.
- [ ] Run `node --test scripts/kubernetes-storage.test.mjs scripts/kubernetes-database.test.mjs scripts/amazon-run.test.mjs`.
  On disposable Linux, run the existing storage test with
  `TEST_KUBERNETES_STOCKHOLM_STORAGE=1`. Keep the encrypted read from both
  surviving machines, the new write, list and multipart checks. On a scratch
  copy of PR 4 with this change, run
  `TEST_KUBERNETES_STORAGE_IDENTITY=1 node --test scripts/kubernetes-storage-identity.test.mjs`.
  Keep the real expiry, the single renewal request and the encrypted read
  after rejoin. Remove the hard placement rule in a disposable control and
  verify the focused setup case fails.
- [ ] Update the existing D621 entry in `docs/backlog.md` with the result.
  Returned-drive repair, consecutive outages and paid qualification stay open.
  Leave MinIO, its deadlines, the credential policy and renewal checks as they
  are. Expect about 20–35 changed implementation lines and 25–45 test lines.
