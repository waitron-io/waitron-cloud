# D621 portable rehearsal ping check

The Stockholm rehearsal reached the outside paired venue and stopped as the
fixture checked `ping -V`, before the first measured machine stop. In the
exact x86 Cloud image, `/bin/ping` resolves to BusyBox. The version command
exits 1 with “unrecognized option: V”. A single ping to loopback with the
same flags used by the fixture succeeded with networking disabled.

The finish line is a measured rehearsal that can begin its stop sequence
when the fixture peer can send a ping using the required flags. Keep the
change inside the existing fixture. The Waitron companion keeps using its
own traffic. The measured gateway pings, restart and storage checks stay
in place. A paid rerun is a separate evidence step under the standing
D621 limits.

- In `deploy/test-cloud/test-fixtures/integration-waitron-tunnel.test.mjs`,
  extend the existing peer tests. Exercise `measureWithVenuePeer` with a
  fixture peer and a Docker boundary that refuses `ping -V`. Assert that
  the stop callback runs once after a successful loopback ping. Check that
  a failed loopback ping still refuses the stop. Run this file first and
  observe the old version command block the successful case.
- In `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`, run one
  ping on the peer's loopback interface at the current `remote-ping-tool`
  check, using the same `-n -I … -c 1 -W 1` flags as the later traffic.
  This exercises the capability the fixture uses without depending on a
  particular ping implementation or an already-reachable gateway.
- Rerun `node --test deploy/test-cloud/test-fixtures/integration-waitron-tunnel.test.mjs`.
  Repeat the exact probe in the x86 Cloud image with networking disabled.
  Update the D621 entry in `docs/backlog.md` with the hosted failure,
  offline result and still-open qualification. No new dependency or image
  change is needed.

Expected diff: about 1 fixture line replaced, 20–35 test lines added and
a short backlog update.
