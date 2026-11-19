# Time D621 remote access with the real Waitron companion

Stop the active gateway machine in private Linux Kind. Recover verified staff
and public HTTPS within 90 seconds on the same paired venue, with the Waitron
tunnel image from `42e453075c48508a63252caeb86b4a78ff5e249b` supplying its own
traffic. The watcher requested this plan in Lane G’s 19:54 note.

The [signed Kind control](../../gateway-reconnection-measurements.md#stop-a-gateway-machine-in-private-kind)
withdrew the old endpoint at 49.163 seconds. A fresh handshake transferred
bytes and staff returned 200 with its expected certificate. The public route
returned 403 with its existing cookie at the deadline. The first handshake
and route times remain unknown. The [50-second Kubernetes grace period](https://v1-34.docs.kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/#options)
is consistent with endpoint withdrawal. Less than 41 seconds remained.
[Waitron sends a packet](https://github.com/clintongormley/waitron/blob/42e453075c48508a63252caeb86b4a78ff5e249b/deploy/tunnel/peer.sh#L88-L99)
on activation and about every 20 seconds. Its isolated
[restart test](https://github.com/clintongormley/waitron/pull/3849) recovered
staff in 35 seconds. The joint target still needs proof in Kind and outside.

1. In the disposable Linux guest, build the unchanged Waitron tunnel Dockerfile
   from the pinned revision and remove its run-owned tag after cleanup.
   Read its `sha256:` ID from `TEST_CLOUD_INTEGRATION_WAITRON_TUNNEL_IMAGE` in
   `scripts/test-cloud-integration.mjs` for private machine loss, before venue
   creation. Add `host.docker.internal:127.0.0.1` only to that venue. The companion
   shares its [network and hosts file](https://github.com/moby/moby/blob/v26.1.5/daemon/container_operations_unix.go#L452-L455).
2. In `deploy/test-cloud/test-fixtures/integration-paid-remote-client.mjs`,
   reuse pairing, the saved key and staff TLS. Bind the adapter to loopback
   port 8443 only for the companion. Stage `private-key` and `peer.json`
   in separate private directories. The settings use the paired `address`,
   `gatewayPublicKey` and the current relay `gatewayIp:51820` as `endpoint`.
   In `integration-paid-remote.mjs`, start the unmodified companion with those
   mounts and `NET_ADMIN` in place of the Cloud peer and its ping loop. Wait
   for configuration and compare the public key, container and interface across
   the stop.
3. In `scripts/kubernetes-remote.mjs`, record the WireGuard handshake timestamp
   relative to the stop and log both HTTPS results before asserting. If the
   watcher clears the timed public challenge, record the old cookie’s 403 and
   run the existing challenge client inside the 90-second clock. Verify both
   bodies and certificates. The existing fixture case keeps its cookie check.

Start with failing scope tests in `scripts/test-cloud-integration.test.mjs`
and check inputs, mounts and absence of the ping in
`deploy/test-cloud/test-fixtures/integration-waitron-tunnel.test.mjs`.
Use `TEST_KUBERNETES_REMOTE_MACHINE_LOSS=1 node --test scripts/kubernetes-remote.test.mjs`.
The companion image selects its case alone. Without it the fixture case
runs. Require both routes, a fresh handshake, the same peer and interface,
node rejoin, standby status and owned cleanup. Save the result in the
infrastructure guide, measurements and backlog.

Allow 1.5–2.5 hours within PR 7’s 10–13 for 25–45 runner lines, 60–95 fixture
lines and 55–85 test lines. The outside listener, changed addresses and full
dry run stay open.
