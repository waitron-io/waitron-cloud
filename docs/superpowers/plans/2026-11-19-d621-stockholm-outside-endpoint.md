# D621 run 9, PR 7 first task — Measure loss of the gateway machine

You can rehearse a real stop of the active WireGuard gateway's machine in private
Linux Kind. This task measures the time from the stop to working staff and public
HTTPS and a new handshake on the same venue peer. It precedes the outside listener
build in [P1](2026-10-22-cloud-country-cell.md#coverage-map-and-outside-p1-gates).

1. **Use the existing fault and route checks.** Pass the owned `stopNode` helper
   from `scripts/kubernetes-node-loss.mjs` through `scripts/kubernetes-services.mjs`
   to the remote fixture in `scripts/kubernetes-remote.mjs`. Reuse the fixed test
   listener on the account node and the existing gateway Service. Before timing,
   arrange for a gateway on one of the other two nodes to hold the Lease. Use the
   existing election controls to move it off the account node if required. Keep
   the account node running and verify the chosen gateway and running venue before
   stopping the exact recorded node.
2. **Observe the machine loss.** Run the fault in an opt-in path in
   `scripts/kubernetes-check.mjs` and
   `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`, through the
   binding check in `scripts/test-cloud-integration.mjs`. Reuse the paired venue,
   staff certificate and public challenge checks. Record stop confirmation, when
   the Service stops routing to the dead gateway, the new Lease holder, both HTTPS
   statuses and the new handshake and transfer bytes. Measure from the stop request
   and include time the old gateway still appears ready. Record a miss at 90 seconds
   as a failure. Keep any traffic supplied by the fixture explicit in the result.
   After recovery verify the same stopped machine rejoins and the owned state is
   removed. Run the existing election-pause, certificate replacement and revocation
   checks through their current mode.
3. **Check the right thing at each layer.** First fail the remote callback check in
   `scripts/kubernetes-node-loss.test.mjs` when it cannot stop a recorded node.
   Use `scripts/kubernetes-check.test.mjs` and `scripts/test-cloud-integration.test.mjs`
   for dispatch and scope. Run those files and `scripts/kubernetes-remote.test.mjs`.
   Its opt-in Linux check uses the real peer and requires the stop, a different
   gateway, successful HTTPS and a new handshake within the deadline. Keep the
   existing loopback relay refusal/recovery test. Record local evidence and its
   limits in the rehearsal guide and the D621 entry in `docs/backlog.md`.

Estimate 1–1.5 working hours for this task within PR 7's 10–13, with 21–24 worked
through PR 6 and 37–45 estimated in total against 44 accepted. Allow 110–170
implementation lines and 70–120 test lines. Start with this task on the PR 7
branch and use its result to choose the outside listener's failover behavior.
Keep the actual three machine losses, Stockholm address refresh, replicated
publication, validated private certificates, ingress and exact final receipt
in the remaining work. The [previous private measurement](../../gateway-reconnection-measurements.md)
passed in 21.841 seconds with fixture traffic. The idle box took about 142 seconds
to handshake. The final unassisted 90-second gate still requires actual Waitron
behavior, with the box change owned by Waitron.
