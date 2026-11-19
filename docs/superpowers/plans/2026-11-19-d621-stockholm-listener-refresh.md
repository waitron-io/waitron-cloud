# Rehearse a stable private gateway listener and address change

Keep one paired venue on the same TCP and UDP listener through a real
Kind gateway machine stop. This is PR 7’s first usable checkpoint in the
watcher’s 19 November 18:10 note. Use the existing gateway and the
[companion rehearsal](2026-11-19-d621-stockholm-waitron-companion.md).

1. Extend the existing `deploy/kubernetes/remote-relay.mjs` container.
   Keep it outside the Kind nodes on their private network and give it
   the three owned node names. Pass HTTPS through on TCP 30443 and
   WireGuard on UDP 51820 to the Service’s TCP 30443 and UDP 31820.
   Use the same node path for both. Resolve its current address when
   choosing a path, so the relay can follow a changed address. A bounded
   TCP connection check tests whether the node can forward to the Service.
   Test real UDP replies separately. If every path fails, retry on the
   next check. Switch to a fresh upstream UDP socket only when the path
   changes. Keep the one-venue limit and the UDP-only invocation.
2. In `scripts/kubernetes-remote.mjs`, point HTTPS and the Waitron
   companion at that existing relay address. Use the existing timed
   machine-stop test and require the same listener and venue endpoint,
   peer key and interface, a fresh handshake, both verified HTTPS routes
   and owned cleanup. Log the node path used before and after the stop.
   The Service and gateway Lease still decide which gateway serves.
3. First extend the socket checks in `scripts/kubernetes-remote.test.mjs`.
   Keep one TCP and UDP client destination and prove both get replies
   after a failed path and after one backend name resolves to a different
   loopback address. Use socket servers for both addresses so a missed
   DNS refresh returns the old server’s distinct reply or times out.
   The Kind run checks the actual paired venue through the machine stop.
   `deploy/kubernetes/gateway-supervisor.test.mjs` still owns fencing.

Run both named files locally, then
`TEST_KUBERNETES_REMOTE_MACHINE_LOSS=1 node --test scripts/kubernetes-remote.test.mjs`
in disposable Linux with the three image pins from the companion check.
Record the endpoint observations in the infrastructure guide, measurements
and backlog.

Allow 2–3 hours, 90–140 rehearsal lines and 75–125 test lines. The socket
case proves a changed address at the listener. Real Stockholm address
discovery, the three outside legs, replicated publication and the timed
dry run remain open. This slice serves the existing gateway NodePorts.
Task 9a’s later account ingress and PROXYv2 decision stay with that work.
