# D621 run 9, PR 6 — Rehearse remote access

On private Linux Kind, use one paired synthetic venue to reach staff and public HTTPS
through a real WireGuard tunnel. One of three gateway candidates serves both paths.
Keep production-mode Cloud and both test-plan flags at zero. This implements the
focused part of [P1 Tasks 8 and 9](2026-10-22-cloud-country-cell.md#task-8-publish-real-routes-and-authorized-certificates-durably-4565-calls).

1. **Connect the box.** Add `scripts/kubernetes-remote.mjs` and dispatch `--remote` from
   `scripts/kubernetes-check.mjs`. Reuse the [services rehearsal](2026-11-19-d621-stockholm-cloud-services.md)
   database, signup, pairing and shared Waitron pin. Through its private inspection Job,
   provision the paired installation with `RemoteAccessStore` in existing mode.
   Enable `CLOUD_STAFF_CERTIFICATES=1`. Adapt the probe portion of
   `deploy/test-cloud/test-fixtures/integration-paid-remote{,-client,-account}.mjs`
   and its call in `scripts/test-cloud-integration.mjs` for this origin and the pinned
   release's supported signed proof. Keep the old fixture's paid-plan checks where they
   are. Use the native CSR and install helpers. Both venue private keys stay on the box.
2. **Publish routes.** Add `deploy/kubernetes/{remote-worker,artifacts,artifact-sync}.mjs`.
   Run the existing `RemoteConfigurationReconciler` with its database claims and staff
   certificate exchange. Reuse the local Pebble/DNS fixture in `scripts/remote-fixtures.mjs`
   for validated `.test` certificates. Stage the public TLS material before publishing
   a complete generation. Use the replicated store's conditional write and the database's
   manifest sequence to refuse stale publication. Verify signature, cell and expiry
   before installing each candidate's files together. Retain its accepted sequence
   across restart. Scope signing and CA keys to the worker and gateway keys to
   candidates. Recover after renewal failure using the still-valid generation.
3. **Close the old tunnel before opening another.** Add
   `deploy/kubernetes/{gateway-supervisor.mjs,remote.yaml}` with one Kubernetes Lease,
   three spread candidates, and one active target for TCP 30443 and UDP 31820. Keep
   P1's 15 s Lease, 5 s renewal deadline and 2 s retry. An independent watchdog
   withdraws readiness, stops the gateway and its proxy children, and deletes
   `wg-cloud` at the monotonic deadline. A late response cannot reopen it. Use the
   landed gateway with P1's minimum capabilities. Keep account traffic on PR 5's
   loopback-trusted path. The gateway preserves staff TLS passthrough and the public
   gate's existing checks.
4. **Run focused checks.** First fail the matching `artifacts.test.mjs`,
   `artifact-sync.test.mjs`, `gateway-supervisor.test.mjs` and
   `scripts/kubernetes-remote.test.mjs` cases. The publication checks own ordering,
   expiry, invalid signatures and certificate replacement with unchanged routes.
   The gateway checks own stopped supervisor, delayed renewal and tunnel closure.
   In the disposable Linux guest, run
   `TEST_KUBERNETES_REMOTE=1 node --test scripts/kubernetes-remote.test.mjs`.
   Require verified staff TLS and permitted public traffic to the same native venue,
   existing path and certificate refusals, fresh handshake and peer bytes on both
   paths, tunnel closure on Lease loss and owned cleanup. Register the focused checks
   in CI and update the D621 backlog and rehearsal guide.

Carry P1 Task 9a's ingress trust checks and the stable outside TCP/UDP listener with
Stockholm address refresh into the outside rehearsal. The watcher's 19 November
12:12 note permits omitting PR 6's separate whole-cell drill after focused checks
pass. The final outside run still exercises loss of the elected gateway and changed
machine addresses with unchanged endpoint, venue process and keys. Keep the complete
[P1 acceptance table](2026-10-22-cloud-country-cell.md#acceptance-and-boundaries),
PR 5's deferred service checks and PR 8's cold restart. Provider work and spending
remain outside this slice.

Estimate 900–1,200 implementation and 450–650 test lines. Publication, watchdog
fencing and fixture adaptation exceed the original 370–500 and 230–330 estimates.
The watcher must clear that increase and the proposed ingress and address split.
