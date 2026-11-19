# D621 run 9, PR 7 first checkpoint — Keep the outside endpoint stable

In private Linux Kind, you can reach the existing fenced gateway from one TCP and UDP
endpoint outside the cluster, stop its serving node, and keep the listener address and
ports when a backend address changes. This is the first proposed checkpoint for the
[P1 gateway and fault checks](2026-10-22-cloud-country-cell.md#coverage-map-and-outside-p1-gates).

1. **Prove the listener first.** Add loopback TCP and UDP cases in
   `deploy/kubernetes/remote-relay.test.mjs`. A backend disappears, then the same
   recorded backend is presented at a new address. Require new TCP connections and
   UDP replies through the existing listener, with one upstream UDP destination at a
   time and no replies from the superseded socket after the switch. Watch the cases
   fail before extending `deploy/kubernetes/remote-relay.mjs`. Reuse the existing
   private UDP socket and add TCP passthrough. Use bounded TCP reachability checks on
   the same gateway Service and accept an address refresh only for recorded backends.
2. **Use the real gateway.** In `scripts/kubernetes-remote.mjs` direct the HTTPS
   probes and WireGuard peer to the same stable listener. Reuse `remote.yaml`'s
   TCP/UDP NodePorts and the existing Lease, which lets only one gateway serve.
   Bind only inside the owned rehearsal network. Pass the ownership-checked
   `stopNode` from `scripts/kubernetes-node-loss.mjs` and run the fault on the
   active candidate away from the pinned account pod. Require that its recorded
   container stays stopped while a different candidate serves. Keep the same venue,
   DNS, key and listener through the fault. Reuse the signed-route, HTTPS and
   WireGuard handshake/transfer checks. Keep the existing election-pause,
   certificate replacement and revocation checks. Confirm cleanup by owned ID.
3. **Run the focused checks.** Start with the new failure in
   `scripts/kubernetes-remote.test.mjs` for the missing multi-node listener path,
   then run it, `scripts/kubernetes-node-loss.test.mjs` and the relay loopback tests.
   Run the remote opt-in case with `TEST_KUBERNETES_REMOTE=1` in the disposable
   Linux guest. Record the actual stop, both HTTPS responses and tunnel recovery
   times, identifying any diagnostic venue traffic in the result. Register the
   relay test beside the existing local-stack checks in `package.json` and update
   the rehearsal guide and the D621 entry in `docs/backlog.md`.

Estimate 230–360 implementation lines and 180–270 test lines. The address-change
check uses loopback so the Kind cluster keeps the addresses its API and database
depend on. Later PR 7 work supplies exact-instance Stockholm refresh, replicated
publication, validated private `.test` issuance, trusted ingress and the full outside
receipt. The final timed rehearsal still requires all three machine losses,
changed addresses and idle-box recovery within 90 seconds using actual Waitron
box behavior. The [private measurements](../../gateway-reconnection-measurements.md)
record 21.841 seconds with fixture traffic and about 142 seconds for the idle
handshake. Waitron owns the box work. This plan covers private fixtures only.
