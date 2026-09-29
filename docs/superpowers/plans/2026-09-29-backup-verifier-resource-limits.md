# D32 implementation plan

Implement inline under the autonomous campaign authorisation.

1. Add Docker-backed restore adapter and entrypoint tests first. Preserve RestoreVerifier(source, keys, point, signal); add createContainerWaitronVerifier(options) returning that type. Configuration owns image, owner, memoryMiB and scratchMiB; no caller-supplied Docker flags. Test native memory, aggregate files, private stdin, cancellation and failure then success using real Docker.
2. Implement framed streaming, fixed Docker policy, bounded diagnostics, inspect-before-remove and stale owned-container cleanup. The entrypoint invokes the existing createWaitronVerifier. Prove the tests red before implementation and green after; delete memory/scratch guards in a disposable copy to show tests catch their removal.
3. Build an image from tracked Waitron sources only and installed Linux dependencies. Require the image in worker-cli and wire the optional Compose profile plus runtime settings. Exercise the real worker and two venues against PostgreSQL, including subsequent valid work after failure. Preserve existing assertions.
4. Execute actual Waitron snapshot restore in the container; retain limits/failure/cleanup receipts. Update verifier/deployment docs and backlog with measured scope. Run focused tests and types; finish-branch with one Claude run-it review, push and exact-head CI. Hold main.lock through land-branch and cleanup, then record exact-merge CI.

Review focus: stdin upload failure racing container exit; OOM kills only the restore child; scratch exhaustion during input staging; worker death leaves a container; same owner live work must survive restart cleanup. Each belongs in the adapter behavioral tests.
