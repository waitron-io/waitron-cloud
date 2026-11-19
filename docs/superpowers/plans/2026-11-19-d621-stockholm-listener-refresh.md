# Rehearse a stable private gateway listener and address refresh

Keep one paired venue on the same TCP and UDP listener while its path to
the gateway changes. This is PR 7’s first usable checkpoint in the
watcher’s 19 November 18:10 note. Use the existing Kind gateway and the
paired venue in the [companion plan](2026-11-19-d621-stockholm-waitron-companion.md).

1. Extend `deploy/kubernetes/remote-relay.mjs` for an opt-in private
   listener. It passes HTTPS through unchanged on TCP 30443 and relays
   WireGuard on UDP 51820. It sends both to the same reachable node path
   on existing Service ports 30443 and 31820. Try the next configured path
   when a bounded TCP check of the gateway Service fails. Keep one path for
   UDP until that selection changes. The Service and gateway Lease still
   decide which gateway serves. Preserve the existing UDP-only invocation.
2. In `scripts/kubernetes-remote.mjs`, start the listener outside the Kind
   nodes on their owned private network, with no host port published.
   Give it the three inspected node addresses in a private mounted
   directory. Reload that list on SIGHUP, keeping the same process and
   listening sockets. Use one owned forwarding container as a replaceable
   first path so the address test can change a real Docker address without
   changing a Kind node’s identity or internal network.
3. Add one opt-in case in `scripts/kubernetes-remote.test.mjs`. Route the
   paired companion and its staff and public HTTPS through the listener
   using the existing fixture in `integration-paid-remote.mjs`. Verify the
   routes and tunnel counters before the fault. Stop the preferred
   forwarding container and verify both routes through a surviving path.
   Hold the old address, start its replacement at a different inspected
   address and configure only that test path. Show that the old address
   gives no usable TCP or UDP path, then reload the new address on the
   same listener. Require trusted staff and public HTTPS, a handshake
   with increasing tunnel bytes, the same venue endpoint, key and tunnel
   interface, and exact owned cleanup. If the public cookie returns 403,
   keep that response and reuse the existing challenge.

Start by extending the socket tests in `scripts/kubernetes-remote.test.mjs`.
They check TCP passthrough, UDP reply delivery, fallback and a changed
destination on the same listener. The live Kind case checks the paired
journey. `deploy/kubernetes/gateway-supervisor.test.mjs` still owns gateway
election and fencing. Run the two named files locally, then use
`TEST_KUBERNETES_REMOTE_ENDPOINT=1 node --test scripts/kubernetes-remote.test.mjs`
in disposable Linux with the three image pins from the companion check.
Record the outcome in the infrastructure guide, measurements and backlog.

Allow 2–3 hours, 140–200 rehearsal lines and 110–170 test lines. The local
fault is a stopped network path. Stockholm address discovery, losing
each machine from the outside host, replicated publication, shared ingress
and the timed dry run remain separate work. The bounded Amazon mesh and
provider configuration are outside this slice.
