# Time D621 remote access with the real Waitron companion

Stop the active gateway machine in private Linux Kind. Verify staff and public
HTTPS through the same paired venue within 90 seconds. Use the Waitron tunnel
image built from `42e453075c48508a63252caeb86b4a78ff5e249b`. Its own traffic must
restore the tunnel. The existing Cloud peer remains the fixture control.

## Can this meet 90 seconds?

The [Kind control](../../gateway-reconnection-measurements.md#stop-a-gateway-machine-in-private-kind)
removed the old endpoint in 49.163 seconds on the signed run. The new peer
handshake and transfer checks passed. Staff returned 200 with its expected
certificate. The public route reached the standby, but the existing cookie
returned 403 at the deadline. The exact time of the first handshake and route
responses remains unknown.

Less than 41 seconds remained for recovery after endpoint withdrawal.
[Waitron's companion](https://github.com/clintongormley/waitron/blob/42e453075c48508a63252caeb86b4a78ff5e249b/deploy/tunnel/peer.sh#L88-L99)
sends traffic on activation and about every 20 seconds. Its isolated
[restart test](https://github.com/clintongormley/waitron/pull/3849) recovered
staff in 35 seconds. The joint result is open. Measure within the original
90 seconds before changing the outside listener.

1. Build the unchanged Waitron tunnel Dockerfile at the pinned revision
   outside the runner in the disposable Linux guest. Pass its local
   `sha256:` image ID as `TEST_CLOUD_INTEGRATION_WAITRON_TUNNEL_IMAGE`.
   Read it once in `scripts/test-cloud-integration.mjs` for the private
   machine-stop mode, before creating the venue. Remove the run-owned tag
   after test cleanup.
2. Reuse the paid venue, key, certificate and TLS adapter. In
   `scripts/test-cloud-integration.mjs`, add the fixture alias
   `host.docker.internal:127.0.0.1` when creating that venue. The companion
   shares its network namespace and the same [Docker hosts file](https://github.com/moby/moby/blob/v26.1.5/daemon/container_operations_unix.go#L452-L455).
   In `integration-paid-remote-client.mjs`
   under `deploy/test-cloud/test-fixtures/`, bind the adapter on loopback
   port 8443. Store the saved key and `peer.json` in separate private volume
   directories. The settings file holds `address`, `endpoint` and
   `gatewayPublicKey`. In
   `integration-paid-remote.mjs`, start the unmodified companion with those
   mounts and `NET_ADMIN` before probing the routes. Use it in place of the
   Cloud peer for this case, without a fixture ping. Verify its public key
   and the same container and interface before and after the stop.
3. Keep the stop clock and endpoint withdrawal check. In
   `scripts/kubernetes-remote.mjs` and the route probes, log the first fresh
   handshake and each route result, with elapsed time from stop. In the new
   companion case, record the old public cookie status. If the actual browser
   challenge page returns 403, use the existing challenge client to continue
   within the same clock. Require verified content and certificates on both
   routes. Keep the current fixture control and its original timed cookie check.

Start with a failing image-scope case in
`scripts/test-cloud-integration.test.mjs`. Add `integration-waitron-tunnel.test.mjs`
beside the fixture to check the settings, mounts and absence of the fixture
ping. Add the companion case to `scripts/kubernetes-remote.test.mjs` so the
opt-in run checks both routes, the same peer and interface, a new handshake,
original node rejoin, standby status, cleanup and recovery within 90 seconds. Run it with
`TEST_KUBERNETES_REMOTE_MACHINE_LOSS=1 node --test scripts/kubernetes-remote.test.mjs`
and the three pinned image IDs.

Allow 1.5–2.5 hours within PR 7’s cleared 10–13 for 25–45 runner lines,
60–95 fixture lines and 55–85 test lines. Update the infrastructure guide, measurement and backlog with the
result. The outside listener, changed addresses and the full timed dry run
remain separate checks.
