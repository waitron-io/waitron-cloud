# D621 portable rehearsal ping check

The Stockholm rehearsal reached the outside paired venue and stopped as the
fixture checked `ping -V`, before the first measured machine stop. In the
x86 Cloud image rebuilt from the same commit and recipe, `/bin/ping` resolves to BusyBox. The version command
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
  fixture peer. At the Docker boundary, expect exactly `exec <peer> ping
  -n -I lo -c 1 -W 1 127.0.0.1` with the `remote-ping-tool` phase and
  accept the subsequent `wg-cloud` ping. Assert one stop callback after
  success. Return a phase-labelled error when the loopback ping fails
  and assert that error and zero stop callbacks. Run this file before
  changing the fixture and observe the old command fail the success case.
- In `deploy/test-cloud/test-fixtures/integration-paid-remote.mjs`, run one
  ping on the peer's loopback interface at the current `remote-ping-tool`
  check, using the same `-n -I … -c 1 -W 1` flags as the later traffic.
  This exercises the capability the fixture uses without depending on a
  particular ping implementation or an already-reachable gateway.
- Rerun `node --test deploy/test-cloud/test-fixtures/integration-waitron-tunnel.test.mjs`.
  Repeat the probe in the rebuilt x86 image with its peer sharing a
  second, network-disabled container's namespace, with the fixture's
  user, NET_ADMIN and 64 MiB limit. This verifies the tool and permissions.
  Use the hosted run for the WireGuard traffic and recovery evidence.
- Update D621 in `docs/backlog.md` with the failure, offline result and
  open qualification. In `docs/aws-infrastructure.md`, replace the
  iputils-specific instruction with the ping flags the fixture requires.
  Run `node --test scripts/ci-docs.test.mjs` and `git diff --check`.

Expect one fixture line replaced, 20–35 test lines added and brief guide
and backlog updates.
