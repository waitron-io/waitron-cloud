# Measure gateway replacement recovery

Preserving the gateway's WireGuard key and endpoint preserves its identity, but a
replacement process starts without the old encrypted tunnel session. Measure a fresh
HTTPS response through that replacement before treating gateway readiness as recovery.

Run the local comparison from a clean, committed Cloud checkout:

```sh
node scripts/gateway-reconnection-receipt.mjs /tmp/gateway-reconnection.json
node scripts/verify-gateway-reconnection-receipt.mjs /tmp/gateway-reconnection.json
node --test scripts/verify-gateway-reconnection-receipt.test.mjs
```

The first command builds a uniquely tagged local image from the existing WireGuard,
HAProxy and gateway/peer fixtures. It creates one isolated Docker network and a
synthetic HTTPS venue inside the peer container. It needs Docker and OpenSSL; it uses
no provider account, real venue, public DNS setup or customer email. The command
removes its containers, network, image tag and temporary keys before writing a
successful receipt.

Each candidate has its own control. Every trial starts with a fresh peer process,
waits until its last handshake is 30 seconds old, then replaces the gateway container
while preserving the gateway key, IP/port and signed route state. A handshake is the
exchange that establishes a new encrypted tunnel session. The process and configured
keys, routes, endpoint and 25-second keepalive stay the same at the peer during the
control and traffic candidate. The reset candidate removes and re-adds only that
configured gateway peer, preserving those values and the venue process.

The traffic candidate sends one peer-originated ping after gateway readiness. The
reset candidate first proves that the old peer entry is gone, restores its exact
configuration and sends the same ping. Keepalive can establish a new handshake
immediately after re-addition, so a zero-handshake check after re-addition would race
successful recovery. Both candidates still require a handshake newer than the
pre-replacement one at both ends.

Recovery time starts immediately before removal and ends at the first fresh HTTPS
200 with the venue's unique response body and unchanged trusted TLS certificate.
The runner observes a failed connection while the gateway is absent and again after
readiness. Requests use a one-second socket timeout and a 500 ms pause after failure;
`probeIntervalMs` records that pause. The 180-second experiment limit bounds a
failed run; it selects no launch recovery target.

## Read the result narrowly

The [version 1 receipt](receipts/gateway-reconnection-2026-10-13.json) records the clean
measurement revision, local image, Linux kernel, Docker version, handshake ages,
fresh handshake timestamps, HTTPS/certificate checks and empty cleanup.

| Pair | Action after readiness | Gateway ready | Fresh HTTPS recovery |
| --- | --- | ---: | ---: |
| traffic | No peer change | 0.979 s | 105.912 s |
| traffic | One peer-originated ping | 0.926 s | 19.189 s |
| reset | No peer change | 0.890 s | 105.845 s |
| reset | Remove/re-add peer, then ping | 0.928 s | 4.297 s |

Both ping commands timed out without a reply. They were candidate actions; only the
verified HTTPS response and new handshakes establish recovery. The receipt's
`peerUnchanged` field records whether the peer entry was deliberately reset; its
configuration and container identity are checked independently in every trial.

The verifier prints `gateway reconnection receipt verified` for this receipt. CI
runs its refusal checks and validates the published receipt; it does not run the
Docker timing experiment.

These are paired single observations on Docker Desktop with one synthetic venue,
fresh TCP/TLS connections and an explicitly invoked candidate. They do not measure
automatic outage detection, provider routing or DNS, key rotation, several venues,
existing connections or an appliance rollout. Matching handshake age does not fix
every WireGuard timer or establish the cause of a faster result. The older local
111-second result and the fresh-peer 14,967 ms milestone remain historical evidence.

## Idle venue limit in private Kind

On 19 November 2026, the D621 rehearsal paused renewal on the active gateway.
The standby was ready and the old WireGuard interface was gone after 17.3
seconds. The venue's previous handshake was about one second old when the
fault began. The same peer sent keepalives through the existing endpoint and
started a new handshake about 142 seconds after the pause. The capture of UDP
packet lengths and `wg show wg-cloud latest-handshakes` on both ends recorded
the new exchange and subsequent tunnel bytes.

The idle venue missed the 90-second handover deadline. An extra 60 seconds
of observation captured the new handshake. In a second run the fixture sent
a small packet from the venue through the same peer every five seconds. The
standby was ready and the old interface was gone after 16.9 seconds. The
same peer completed a new handshake at about 22 seconds, and verified staff
HTTPS returned. The public request with its pre-fault cookie returned HTTP
403 through the deadline.

A follow-up using the same periodic traffic completed the handover in 21.841
seconds. Staff HTTPS and the public request with the original cookie both
returned HTTP 200. The standby also issued a fresh challenge (200), accepted
its solution (204) and returned public HTTPS (200) with the new cookie. The
earlier 403 did not recur. Both traffic runs used packets supplied by the
fixture. Recovery of an idle box within 90 seconds remains open.

## Stop a gateway machine in private Kind

On 19 November 2026, a disposable Linux diagnostic stopped the second Kind
machine after verifying the two HTTPS routes and a handshake two seconds old.
The first machine hosted the account, the fixed relay backend and the
Kubernetes controller manager. Kubernetes withdrew the stopped gateway
endpoint after 50.168 seconds. The standby was on the first machine at the
end of the run. The venue fixture sent a packet every five seconds.

The combined staff HTTPS, public HTTPS and new handshake check missed the
90-second deadline. This run established endpoint withdrawal time. Recovery
through the fixed relay, the idle Waitron box and the outside listener with
changed machine addresses still need proof.

A signed run confirmed the stage that missed the deadline. During setup the
public cookie returned 403 after the gateway moved off the account machine.
A fresh challenge restored public HTTPS. During the actual machine stop,
the standby on the account machine gained the gateway and Kubernetes
withdrew the old endpoint after 49.163 seconds. A fresh handshake transferred
bytes and staff returned 200 with its expected certificate. The public route
again returned 403 with the existing cookie. The test ended at 90 seconds.
A separate Chromium check showed that an actual browser automatically
solves this challenge after the source IP changes.

A later signed Kind run used the [Waitron companion from #3849](https://github.com/clintongormley/waitron/pull/3849)
and its own traffic. Kubernetes withdrew the stopped endpoint at 46.019
seconds. The replacement exchanged tunnel bytes for the paired key, staff
HTTPS returned 200 at 51.942 seconds, and public HTTPS returned 403 at
51.947 seconds with the old cookie. A fresh challenge restored verified
public HTTPS at 52.185 seconds. Both response bodies and certificates
passed before the 90-second deadline.

The whole test failed after the stopped node rejoined. The former gateway
pod was running and unready, but its standby check could not show that
both the old interface and the readiness marker were absent. The three-minute
standby check expired. The disposable guest was confirmed absent after
cleanup. Run the [companion machine-stop check](aws-infrastructure.md#rehearse-a-gateway-handover-on-a-private-kind-cell)
to repeat both gates.

The existing Cloud fixture already preserves the key and endpoint, so this comparison
adds no Cloud runtime change. To use a peer candidate automatically, Waitron needs a
separately scoped appliance procedure: define the authenticated trigger, preserve
current tunnel authority and configuration, bound retries, and test repeated outages,
lost triggers, active connections and several venues with a joint Cloud receipt.
Choose and prove the launch recovery target in the selected deployment before making
an availability promise.
