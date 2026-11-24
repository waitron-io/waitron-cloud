# Stop stray test stores and bind admin to loopback

Lane G’s TEST-STORE-LEFTOVER item asks for one PR. A native test store must
stop when its fixture dies, including after SIGKILL. Its admin gRPC port
must listen on loopback. The watcher confirmed the fixture-only scope
at 22:10 on 24 November.

The real 55-second probe timeout left a native child alive in a controlled
stall. This establishes the failure mechanism. The historical slowdown
remains unexplained. The test box reached 4.47 over the LAN and got
connection refused on 4.48. See the lane’s `receipts/test-store-leftover/`.

Compose and the test Cloud publish no host port for the admin listener.
A peer in an isolated Linux bridge reached it on 4.47. The image stays
on 4.47. The watcher cleared 4.48 for the native fixture at 22:35. The 4.49 comparison
failed the existing port ownership deadline.
[SeaweedFS 4.48 release](https://github.com/seaweedfs/seaweedfs/releases/tag/4.48)

1. In `scripts/ci-backup-storage-child-lifecycle.test.mjs`, first
   see a live native process and socket survive fixture SIGKILL. Test
   SIGTERM, a paused launch, removal of its root and port claims, and
   preservation of a separate owned process.
   In `scripts/backup-storage-fixture.mjs`, fork
   `scripts/backup-storage-child.mjs` before releasing reserved ports.
   Keep the native spawn in the fixture. Detach the helper, give it
   ignored standard streams and an IPC channel, clear inherited Node
   options, unreference the process and channel, and handle launch errors.
   Normal stop cleans up and sends “done”. On unexpected disconnect,
   including one before the helper connected, revoke the owned executable
   path and check through the launch handoff for the exact executable and
   data arguments. Signal only that identity. Keep the five-second
   shutdown grace and require exit before removing the root and its
   claims with `releaseStorageControlClaims`. A failed inspection is an
   error. Keep native spawn error identity, retry and SIGHUP behaviour.
   Rerun the spawn-refusal, port-ownership and storage authority checks.

2. In `deploy/test-cloud/storage-admin-ports.test.mjs`, use the fixture’s
   native PID to find the implicit listener. First see 4.47 accept a
   non-loopback connection. Require loopback success and non-loopback
   refusal, with a visible skip where there is no non-loopback IPv4.
   Pin the native fixture and `scripts/fixtures/storage-tar-seed.mjs`
   to 4.48 with verified checksums. Run the port, exhaustion and handoff
   checks before accepting the pin. Preserve their assertions.
   Update live pin checks, receipt writers and reader ownership.
   Verify saved 4.47 and new 4.48 receipts and refuse other versions.

Allow about 110 lines of fixture code and pin changes and 150 lines
of tests and pin-check adjustments. Update the storage readiness backlog
and native guide. Give the guide at most two sentences about Compose.
Use synthetic data and disposable resources. Leave PID 93523 alone.
