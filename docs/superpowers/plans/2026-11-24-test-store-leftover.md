# Stop stray test stores and bind admin to loopback

Lane G’s TEST-STORE-LEFTOVER item asks for one PR. A native test store must
stop when its fixture dies. Its admin gRPC port must listen on loopback.

The readiness probe’s real 55-second deadline sent SIGTERM during a
controlled stall. The native store survived with parent PID 1. The
historical stall remains unexplained. The test box reached 4.47’s admin
port on the Mac’s LAN address. On 4.49, loopback worked and the test box
got connection refused. `receipts/test-store-leftover/` holds both runs.

Local Compose and LAN test Cloud publish only S3 on host loopback. The
Amazon override publishes no storage port. In an isolated Linux bridge,
a peer container reached the 4.47 admin listener. Under 4.49, both admin
listeners accepted loopback, refused the peer and left S3 reachable.
Proposed scope is the native fixture. The shared image needs its own
decision and persistent-volume qualification. [SeaweedFS 4.49 release](https://github.com/seaweedfs/seaweedfs/releases/tag/4.49)

1. In `scripts/ci-backup-storage-readiness-diagnostics.test.mjs`, use real
   SIGTERM and SIGKILL against a fixture with a live native child. First
   observe the leaked listener and process. Cover death during launch
   and confirm a separate owned process remains alive. Require the
   fixture’s root and claims to go away.
   In `scripts/backup-storage-fixture.mjs`, start a detached Node helper
   before calling the existing native spawn. Put the helper in
   `scripts/backup-storage-child.mjs`. On IPC disconnect it locates the
   native process by its exact executable and data path in that unique
   fixture root. Account for a child still entering the executable
   during the handoff. Check identity before signalling it, use the
   existing five-second grace and collect evidence of exit before removing
   its root and claims. Reuse `releaseStorageControlClaims`. On normal
   stop, the fixture still collects the native child. The helper exits
   after that. Keep native spawn errors, retry and SIGHUP behaviour.
   Run the readiness, spawn-refusal, port-ownership and authority checks.

2. In `deploy/test-cloud/storage-admin-ports.test.mjs`, identify the
   implicit admin gRPC listener from the test’s own native PID. Prove
   loopback accepts TCP and the non-loopback address refuses it. First
   see the refusal check fail on 4.47. Move the fixture and
   `scripts/fixtures/storage-tar-seed.mjs` to checksum-pinned 4.49.
   Before accepting the pin, run the existing admin-port, exhaustion
   and handoff tests. Preserve their assertions. Update live pin checks,
   receipt labels and reader ownership as needed. Keep verification of
   saved 4.47 receipts working.

Allow about 100 lines of fixture code and pin changes and 150 lines of
tests and pin-check adjustments. Update the storage readiness backlog
and native guide. Use synthetic data and disposable resources. Leave
the reported PID 93523 and the existing test Cloud alone.
