# Time D621 remote access with the real Waitron companion

Stop the active gateway machine in private Linux Kind. Verify staff and public
HTTPS through the same paired venue within 90 seconds. Use the Waitron tunnel
image built from `42e453075c48508a63252caeb86b4a78ff5e249b`. Its own traffic must
restore the tunnel. The existing Cloud peer remains the fixture control.

## Can this meet 90 seconds?

The [machine-stop diagnostic](../../gateway-reconnection-measurements.md#stop-a-gateway-machine-in-private-kind)
withdrew the old endpoint at 50.168 seconds. The two routes and a fresh
handshake missed 90 seconds. The remaining 39.832 seconds lack a reliable
breakdown because cancellation hid the last probe, which the branch now
preserves. Waitron's [isolated gateway restart](https://github.com/clintongormley/waitron/pull/3849)
recovered staff in 35 seconds. Taken sequentially, these measurements leave
4.832 seconds for everything else. The waits can overlap, so 90 seconds is
plausible and has little margin. Prove it before changing the outside listener.

1. In `scripts/kubernetes-check.mjs`, accept
   `TEST_CLOUD_INTEGRATION_WAITRON_TUNNEL_IMAGE` only for
   `--remote --stop-gateway-node`, as a local immutable image ID. In the Linux
   guest, build the unchanged `deploy/tunnel/Dockerfile` at the pinned Waitron
   revision before the test. Retain its ID and remove its run-owned tag after
   the existing test cleanup. Pass the optional image through
   `scripts/kubernetes-services.mjs` and `scripts/test-cloud-integration.mjs`.
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
   mounts and `NET_ADMIN`. Verify its public key, retain its container and
   interface through the stop, and send the fixture ping only in the control.
3. In `scripts/kubernetes-remote.mjs` and the existing HTTPS probes, record
   first observations of the new Lease holder, endpoint withdrawal, fresh
   handshake and each route's success. Keep one clock from the stop request.
   Preparation can renew a challenged cookie. Report a timed 403 without
   renewing it. Keep the machine identity, venue configuration, trusted
   certificates, response checks, restart and ownership checks.

Start with the failing image scope and dispatch cases in
`scripts/kubernetes-check.test.mjs` and `scripts/test-cloud-integration.test.mjs`.
Test companion inputs and absence of fixture traffic at their fixture
boundary. Extend `scripts/kubernetes-remote.test.mjs` so the opt-in run checks
both verified routes, the same companion and interface, a fresh handshake,
owned cleanup and end-to-end time at or below 90 seconds. Run it with
`TEST_KUBERNETES_REMOTE_MACHINE_LOSS=1 node --test scripts/kubernetes-remote.test.mjs`
and the three pinned image IDs.

Allow 1.5–2.5 hours for 35–60 runner lines, 60–95 fixture lines and 55–85 test
lines. Update the infrastructure guide, measurement and backlog with the
result. The outside listener, changed addresses and the full timed dry run
remain separate checks.
