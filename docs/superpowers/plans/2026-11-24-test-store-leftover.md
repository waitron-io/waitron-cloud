# Stop stray test stores and bind admin to loopback

Lane G’s TEST-STORE-LEFTOVER item follows the owner’s 24 November 20:55 note.
A native test store must stop when its fixture dies. Only that machine may
connect to the store’s admin gRPC port.

The controlled 55-second readiness deadline sent SIGTERM to the fixture.
SeaweedFS kept running with parent PID 1. The injected stall proves how the
process was left behind. The historical slowdown remains unexplained.
The test box reached a separate 4.47 store on the Mac’s LAN address. On 4.49
the loopback connection worked and the test box got connection refused.
Local Compose and LAN test Cloud publish only S3 on host loopback. The
Amazon override publishes no storage port. With 4.47, the admin listener
still binds inside those container networks. Lane receipts are under
`receipts/test-store-leftover/`.
[SeaweedFS 4.47 listener](https://github.com/seaweedfs/seaweedfs/blob/4.47/weed/command/mini.go#L895-L900)

1. Add two cases to `scripts/ci-backup-storage-readiness-diagnostics.test.mjs`.
   Once the store accepts TCP, kill the fixture with SIGTERM or SIGKILL and
   require its native process and listener to disappear. First see both fail.
   In `scripts/backup-storage-fixture.mjs`, launch
   `scripts/backup-storage-child.mjs` in a separate process group to own the
   store. It detects fixture death when their dedicated pipe closes. It
   sends SIGTERM, escalates after the existing five seconds and collects the
   child. Reuse `releaseStorageControlClaims` for claims belonging to that
   root. Normal shutdown waits for collection. Preserve native launch
   errors, exit status, logs, the one port-collision retry and SIGHUP reload.
   Rerun the spawn-refusal, admin handoff, port ownership and storage
   authority tests. Keep their existing assertions.

2. Add a real listener check to `deploy/test-cloud/storage-admin-ports.test.mjs`.
   Require loopback to accept TCP and the non-loopback address to refuse it.
   Watch 4.47 fail first. Move the native fixture and shared image to the
   checksum-pinned 4.49 release if the watcher clears the image change.
   The 4.48 listener follows the global bind address, which is wildcard in
   containers. Update `scripts/fixtures/storage-tar-seed.mjs`, `compose.yaml`,
   `deploy/local-stack/Dockerfile`, the matching `scripts/amazon-run.mjs` build
   input and the live pin checks. Preserve verification of historical
   receipts. In disposable Compose, check the admin ports from loopback and
   from a peer container. Use working peer S3 as the control.
   [SeaweedFS 4.49 listener](https://github.com/seaweedfs/seaweedfs/blob/4.49/weed/command/mini.go#L984-L1018)
   [Release checksums](https://github.com/seaweedfs/seaweedfs/releases/tag/4.49)

Allow 100–150 lines of fixture code and configuration and 150–250 lines of
tests and test adjustments. Update the storage readiness entry in
`docs/backlog.md`. Keep the work to synthetic data and disposable resources.
The existing test Cloud and the owner’s reported PID are outside the run.
