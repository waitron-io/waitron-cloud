# D621 run 9, PR 7 first task — Measure loss of the gateway machine

You can rehearse a real stop of the active WireGuard gateway's machine in private
Linux Kind. Measure the time from the stop to verified staff and public HTTPS
and a fresh handshake on the same venue peer before building the
[stable outside listener](2026-10-22-cloud-country-cell.md#coverage-map-and-outside-p1-gates).

1. Pass the owned `stopNode` from `scripts/kubernetes-node-loss.mjs` through
   `scripts/kubernetes-services.mjs` to `scripts/kubernetes-remote.mjs`. In the
   existing `--remote` command, opt in to a controlled machine stop through
   `scripts/kubernetes-check.mjs`, `scripts/test-cloud-integration.mjs` and
   `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`. Reuse the
   paired venue, fixed relay, account node and gateway Service. Keep the account
   node up. If it holds the gateway Lease, use the existing election pause to
   move it. Before the timed stop, require healthy staff and public HTTPS and
   a handshake with the chosen gateway. Record that handshake's age.
2. Stop the exact recorded node. Use the Lease to identify the replacement.
   Record when the gateway Service's endpoint list marks the old pod unavailable.
   Measure both verified HTTPS responses, the new handshake and transfer bytes
   from the stop request. The machine-stop control uses fixture traffic. A miss
   at 90 seconds fails and retains the last observation. Verify that the node
   returns with its original identity and that the old gateway returns as a
   standby. Check cleanup by owned ID. Use the account forward for setup before
   the timed fault. The machine-stop result covers gateway routes, and faults
   involving account forwarding, database failover or publication stay with
   the later outside proof. Run election pause, certificate replacement and
   revocation through the existing opt-in test.
3. First fail the remote callback test in `scripts/kubernetes-node-loss.test.mjs`
   when it cannot stop a recorded node. Use `scripts/kubernetes-check.test.mjs`
   and `scripts/test-cloud-integration.test.mjs` for dispatch and scope. Run
   them and `scripts/kubernetes-remote.test.mjs`, including the existing relay
   recovery case. Run the new opt-in machine-stop case in private Linux with the
   same peer, DNS and listener. Record the measurement and its limits in
   `docs/gateway-reconnection-measurements.md` and `docs/backlog.md`.

Estimate 1.5–2 hours within PR 7's 10–13, with 110–170 implementation lines and
70–120 test lines. The total is 21–24 hours worked through PR 6, 10–13 for PR 7,
4–5 for PR 8 and 2–3 for the final timed dry run. The watcher cleared the resulting
37–45 hours on 19 November at 18:10.

The listener and changed-address check are PR 7's first usable checkpoint.
Replicated publication, validated private certificates, ingress and the full
outside receipt remain in PR 7. The final proof still requires all three machine
losses, Stockholm address refresh and idle-box recovery within 90 seconds with
actual Waitron behavior. Lane J owns that box change. The prior pause run took
21.841 seconds with fixture traffic. The idle handshake took about 142 seconds.
