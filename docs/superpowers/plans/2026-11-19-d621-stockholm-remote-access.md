# D621 run 9, PR 6 — Rehearse remote access

In private Linux Kind, a paired synthetic venue serves staff and public HTTPS through
one elected WireGuard gateway. A standby takes over on the same endpoint and key.
Keep production mode and both test-plan flags at zero.

1. **Connect the box.** Dispatch `--remote` through `scripts/kubernetes-{check,node-loss,services}.mjs`
   into `scripts/kubernetes-remote.mjs`. Reuse [PR 5's](2026-11-19-d621-stockholm-cloud-services.md)
   TLS database, signup, pairing and pinned Waitron image. The private inspection Job
   provisions only this paired installation with `RemoteAccessStore` in existing mode.
   Enable `CLOUD_STAFF_CERTIFICATES=1`. In `scripts/test-cloud-integration.mjs` and
   `deploy/test-cloud/test-fixtures/integration-paid-remote{,-client,-account}.mjs`,
   reuse the route probes and Waitron CSR and certificate install helpers. Use the actual
   origin, current signed proof and confirmed cell endpoint. The fixture TLS adapter
   forwards to the running venue. Keep both box private keys there and keep the old
   paid-plan checks in their current mode.
2. **Publish the rehearsal routes.** Run one `openTestRemoteRuntime` reconciler in
   existing mode with its private CA and `.r.waitron.local` names. Use the committed
   cell and database manifest sequence. In `deploy/kubernetes/remote-worker.mjs`,
   update one precreated Kubernetes Secret with a version check. Publish the signed
   manifest, public-site TLS key and chain as one mounted generation. Pin one mount
   generation when reading it. Scope the worker to that Secret and mount it read-only
   on the candidates. The existing gateway verifies authority and keeps its accepted
   state on per-candidate storage. Keep the CA and signing keys on the worker.
3. **Hand over the tunnel.** Add `deploy/kubernetes/{gateway-supervisor.mjs,remote.yaml}`
   with three spread candidates and one Lease. Keep the 15 s expiry, 5 s renewal
   deadline and 2 s retry. An independent watchdog in the gateway container withdraws
   readiness, stops the child process group and deletes `wg-cloud` at the monotonic
   deadline. Late replies cannot reopen it. A private fixture forwards the stored fixed
   IPv4 endpoint's UDP 51820 to NodePort 31820, and HTTPS to TCP 30443. Both reach the
   active candidate. Preserve the account pod's loopback trust and staff TLS passthrough.
   Leave shared ingress and the public gate's per-source qualification to PR 7.
4. **Prove the route and handover.** Start with failing cases in
   `deploy/kubernetes/{remote-worker,gateway-supervisor}.test.mjs` for stale publication,
   late renewal and a stopped supervisor. Check dispatch and scope in
   `scripts/{kubernetes-check,test-cloud-integration}.test.mjs`. Run these files and
   `scripts/kubernetes-remote.test.mjs` after implementation. Run the latter again
   with `TEST_KUBERNETES_REMOTE=1` in the disposable Linux guest. Require verified staff
   TLS and allowed public traffic, unknown-name, wrong-certificate and private-path
   refusals, and new handshake and transfer bytes after a standby takes over. Check
   the old interface is gone, certificate replacement with unchanged routes, native
   venue continuity, and route withdrawal from every candidate after account revocation.
   Require recovery within 90 s with the same peer configuration. Record any miss.
   Register tests in CI and update the D621 backlog and rehearsal guide.

Estimate 500–700 implementation and 230–330 test lines. The watcher needs to clear
this fixture scope and PR 7's build: replicated artifact publication, validated
private `.test` issuance, P1 Task 9a ingress trust and the stable outside listener and
address refresh. The 19 November 12:12 note permits omitting a separate whole-cell
drill after focused checks pass. The final outside run exercises actual gateway loss
and changed addresses beside every gate in the
[P1 checklist](2026-10-22-cloud-country-cell.md#acceptance-and-boundaries), plus PR 5's
deferred service checks and PR 8's cold restart. This slice runs on private Linux.
