# Time D621 remote access with the real Waitron companion

Stop the active gateway machine in private Linux Kind. Recover verified staff
and public HTTPS within 90 seconds on the same paired venue, with the Waitron
tunnel image from `42e453075c48508a63252caeb86b4a78ff5e249b` supplying its own
traffic. The watcher requested this plan in Lane G’s 19:54 note.

In the [signed Kind control](../../gateway-reconnection-measurements.md#stop-a-gateway-machine-in-private-kind),
Kubernetes withdrew the old endpoint at 49.163 seconds, consistent with its
[50-second machine health grace period](https://v1-34.docs.kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/#options).
Cloud runs Kubernetes on its own three machines in run 9 and controls that setting.
The new gateway completed a handshake, transferred bytes, and served verified
staff HTTPS within 90 seconds. The public check missed because a source address
change invalidated its cookie. The first handshake and route times are unknown.
[Waitron sends a packet](https://github.com/clintongormley/waitron/blob/42e453075c48508a63252caeb86b4a78ff5e249b/deploy/tunnel/peer.sh#L88-L99)
on activation and about every 20 seconds. Its isolated
[restart test](https://github.com/clintongormley/waitron/pull/3849) recovered
staff in 35 seconds. Both routes look reachable within 90 seconds in Kind.

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
   relative to the stop. In both timed cases, log each staff and public attempt
   with elapsed seconds before the assertions, including the previous cookie's
   403. Run the existing challenge client on that 403 inside the same clock.
   Verify both response bodies and certificates.

Start with failing scope tests in `scripts/test-cloud-integration.test.mjs`.
The companion fixture test covers the inputs, mounts and absence of a ping.
The fake Kubernetes test checks the handshake time and that a failed challenge
after a 403 still fails within the clock. The live Kind test measures timing.
Use `TEST_KUBERNETES_REMOTE_MACHINE_LOSS=1 node --test scripts/kubernetes-remote.test.mjs`.
With a companion image this runs only the companion case. Without the image it
runs the fixture case. Go directly to the companion run. Require both routes,
a fresh handshake, the same peer and interface, node rejoin, standby status
and owned cleanup. Save the result in the infrastructure guide, measurements
and backlog. The watcher cleared these changes on 19 November at 20:17.

Allow 1.5–2.5 hours within PR 7’s 10–13 for 25–45 runner lines, 60–95 fixture
lines and 55–85 test lines. The outside listener, changed addresses and full
dry run stay open.
