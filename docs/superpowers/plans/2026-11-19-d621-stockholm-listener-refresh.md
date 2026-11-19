# Rehearse a stable private gateway listener and address change

Keep one paired venue on the same TCP and UDP listener through a real
Kind gateway machine stop. This is PR 7's first checkpoint in the
watcher's 19 November 18:10 note. The watcher cleared the plan after
Claude's read and one reread, with the changes in the 21:08 note.

1. Extend the existing `deploy/kubernetes/remote-relay.mjs` container.
   Keep it outside the Kind nodes on their private network and give it
   all three owned node names, with the account node first. Pass HTTPS
   through on TCP 30443 and WireGuard on UDP 51820 to the Service's TCP
   30443 and UDP 31820 on the same chosen node. Look up all three names
   on each check with callback-based `dns.lookup`. Follow a changed
   address when it passes the TCP check. Switch nodes after three failed
   checks in a row, and keep forwarding to the last address if all paths
   fail. Reopen the upstream UDP socket on a route change. Keep the
   one-venue limit and use one invocation.
2. In `scripts/kubernetes-remote.mjs`, send HTTPS to the relay address
   the companion already uses. The timed Kind machine-stop case checks
   the same relay, venue endpoint, peer key and interface, a fresh
   handshake, both verified HTTPS routes and owned cleanup. The account
   node remains up in this case. The Service and gateway Lease still
   decide which gateway serves.
3. Extend the socket test in `scripts/kubernetes-remote.test.mjs`. Preload
   callback DNS answers and map their addresses to socket servers on
   `127.0.0.1` on distinct ports. Keep the old backend live when its name
   changes address, then fail the selected path so the client gets replies
   from another node on both unchanged listener ports. Only the socket
   test checks path selection and address changes. The watchdog test owns
   clearing the old readiness marker before the first Lease grant, under
   the watcher's 21:07 clearance.

Run the remote and supervisor test files locally, then
`TEST_KUBERNETES_REMOTE_MACHINE_LOSS=1 node --test scripts/kubernetes-remote.test.mjs`
in the approved disposable Linux guest with the three image pins from
the companion check. Record timings and standby evidence in the existing
infrastructure guide, measurements and backlog.

Allow 2–3 hours, 90–140 rehearsal lines and 75–125 test lines. Real
Stockholm address discovery, the three outside legs, replicated publication
and the timed dry run remain open. Task 9a owns the later account ingress
and PROXYv2 decision.
