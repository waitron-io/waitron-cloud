# Bound a backup restore without taking down its worker

A restore allocates native buffers and creates many files. A JavaScript heap limit and a
per-file size limit leave both totals open. The backup worker now sends each downloaded
snapshot into its own disposable Docker container, so a failed restore can release its
resources without taking down the worker.

## Run the boundary locally

Build the image and enable the optional profile as described in
[local deployment](local-deployment.md#enable-integration-profiles-deliberately).
The builder archives one committed Waitron revision and installs its Linux dependencies.
Untracked files, local credentials and venue data never enter the build context. Supply a
trusted image; changing an image tag after worker startup does not change its pinned image ID.

For a worker outside Compose, set `CLOUD_VERIFIER_IMAGE` and a stable, unique
`CLOUD_VERIFIER_OWNER` for that worker slot. It needs the Docker CLI and access to the local
daemon. Missing configuration fails before claiming a backup job. Only the recovery key,
source node identity, module versions, capture time and encrypted snapshot travel through
stdin. Database, provider, stream and master keys stay with the trusted worker.

The container runs as uid 1000 with no capabilities, no network, no host mounts, no shared
memory segment and a read-only root filesystem. It retains the existing Node permission,
CPU, file, descriptor, heap and output limits. The loader needs worker threads, so Node's
permission model alone is not the security boundary. Docker also denies external network
and image writes when a test deliberately bypasses the Node permissions.

The default is 1024 MiB total memory, including scratch, with memory-plus-swap set to the
same value. The one writable scratch tmpfs is 256 MiB. Docker documents these controls in
[resource limits](https://docs.docker.com/engine/containers/resource_constraints/) and
[tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/). The input and restored copy
both count against scratch. The ceilings are independent: a tight memory setting may
fail before the scratch quota is full. The 512 MiB catalogue limit is an upload ceiling, not a promise
that a snapshot of that size fits this verifier configuration.

## Failure and restart

Memory exhaustion or a full scratch volume refuses verification with
`backup.verifier_resource`. A deadline is reported as `backup.verifier_timeout`, not as
proof of a memory boundary. The scratch diagnostic is advisory: child error text can also produce a resource code.
A completed restore refusal, including resource and deadline limits, remains a failed
verification. It means that this copy did not restore within the configured limits, not
necessarily that its bytes are corrupt. Archive output and error details are not returned
in diagnostics.

The process adapter recognises V8's fatal heap-exhaustion report as it arrives and
kills the child, then waits for its process and output pipes to close. Linux crash
collection can delay a fatal process exit even with core-file size set to zero, so
waiting for exit alone can turn a known resource refusal into a watchdog timeout.
The same output bound still applies, and private error text stays inside the parent.
This is an advisory stderr classification: a child that prints a matching fatal line
is stopped even if it would otherwise return valid JSON. The marker is not an
independent measurement of memory use.
You can exercise delayed exit and split diagnostic chunks with
`node --test packages/backups/test/verify-process-heap.test.ts`.
The detector scans new text with a bounded phrase suffix. Run
`node --test packages/backups/test/verify-process-scanning.test.ts` to exercise
one-byte delivery, line boundaries and the scan-work limit.

For a resource refusal, you can compare the container entry process and child process
IDs, the child exit or signal, and fixed heap, scratch and file-limit indicators.
The legacy container adapter also reports Docker state and Linux memory-event
counters before and after verification when its cgroup exposes them. Missing counters
remain unknown. The child indicators and exit 73 are advisory; they do not establish
that the kernel killed the container. The adapter itself sends SIGKILL when it detects
a fatal heap report. Scratch and file-limit indicators come from child text, so they
cannot independently prove exhaustion. Raw child text stays private. Run
`node --test packages/backups/test/*resource-diagnostics.test.ts` to check the report
through controlled child, entry and Docker boundaries without a Docker daemon.

A failed download, Docker connection or start, container cleanup, configuration, input
transfer or result protocol leaves the snapshot's last verification state unchanged.
The worker records `verification_unavailable` and retries the same snapshot. It does not
write a `backup_verifications` row or turn an uncertain copy into a failed-copy alert.
A new copy stays pending; an older verified fallback keeps its verdict and protection.
Custom restore adapters must use `backup.verifier_*` codes for infrastructure failures.
Only `backup.verifier_failed`, `backup.verifier_resource` and `backup.verifier_timeout`
within that namespace mean completed refusals; an unfamiliar code stays uncertain.
An ordinary restore exception still means a completed refusal under that interface.
Stage cleanup cannot replace a primary refusal or cancellation. When the restore succeeds
but its stage cleanup fails, the job retries as unavailable.

Retries keep the existing eight-attempt budget and exponential delay from 30 seconds to
15 minutes. An exhausted job appears as parked in operations status. Once you restore the
service, use `pnpm backup:worker --retry-failed` to retry parked jobs. Cancellation returns
the claim without spending an attempt. If PostgreSQL goes away before the result can be
committed, the worker cannot release its claim immediately; another pass can reclaim it
after the existing 120-second lease expires. The snapshot receives no invented verdict.
Apply migration 029 before starting this worker so the job table accepts the new code.

The adapter keeps `docker start -ai` attached while it starts the container.
Archive input waits until inspection reports that startup has completed. The runtime can install its OOM watcher
only after the process starts. Sending archive bytes during that interval lets a
fast restore exhaust memory before the watcher exists. In a local Docker 28.0.4
probe, delaying the runtime start return by two seconds reproduced a resource
refusal with exit 73 and `OOMKilled=false`. The same probe with start acknowledged
before archive input reports `OOMKilled=true`; scratch refusal and a later valid
restore also pass. All memory, scratch, network, mount and deadline checks remain.
The original Ubuntu failure lacks these timing details, so this probe establishes
an executable failure mechanism rather than its exact historical trigger.

Cancellation removes the container and waits for its local attach process to exit. A
30-second watchdog inside the container also ends work if the parent is killed. Startup and each new restore
reclaim only containers carrying its owner label whose 60-second ownership deadline has
expired. It leaves recent results alone while another pass reads them. Once ownership expires,
cleanup removes the container even if it is still running; a stalled pass cannot retain
resources indefinitely. If another pass removes a listed container before reclamation
inspects or removes it, the exact missing-container diagnostic for that ID is accepted.
If Docker reports that removal of that exact container is already in progress,
reclamation retries within one ten-second removal budget. It fails if removal does
not finish within that budget.
A missing container during active result inspection still fails verification as
unavailable, and other Docker errors still fail. Do not scale the Compose backup service without assigning
distinct worker owners. Use a different
owner value for each worker slot. An abandoned container retains its scratch until removal;
the next restore or startup after its deadline reclaims it. You can also remove that exact
owned container explicitly. Cleanup failure
is an infrastructure error, never successful verification. If Docker is unreachable during
cleanup, removal must wait for the daemon to recover and an owner-matching startup or
restore to reclaim the expired container. The adapter bounds each Docker command to ten
seconds; an unreachable host cannot promise immediate cleanup.

## Executed proof

Run the focused hostile fixtures and PostgreSQL worker test:

```sh
pnpm --dir packages/backups exec node --test test/container-verifier.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/container-worker.test.ts
TEST_CLOUD_SNAPSHOT_PROOF_IMAGE=<local-cloud-image-id> \
  TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE=<pinned-verifier-image-id> \
  node scripts/backup-verifier-proof.mjs /tmp/backup-verifier-proof.json
```

The current producer runs the target-bound scenario described in the
[test Cloud guide](test-cloud.md#backup-verifier-boundary). It saves incomplete
version 2 evidence and exits with status 1 while ordinary recovery lacks its
separate authority and the remaining same-run controls are unfinished. The older
two-venue assertions remain in `runLegacyBackupVerifierProof`; the historical
results below do not qualify the new contract.

The 2026-09-29 local run used Docker 29.3.0. Native `Buffer` allocations hit the 192 MiB
memory limit with Docker `OOMKilled=true`. Many 512 KiB files hit the 16 MiB total scratch
limit with `OOMKilled=false`; both returned resource refusal. A separate Docker-exec
probe measured the full scratch filesystem as 16,777,216 bytes total and zero bytes
available while the allocating child was still alive. The same parent subsequently
verified a valid snapshot. Input staging exhaustion, interrupted upload, cancellation,
worker kill/restart and simultaneous venue fixtures also ran. A PostgreSQL worker recorded
three failed verifications (memory, scratch and wrong identity), then verified valid work
without mixing the two venues.

D37's executable outage proof runs with:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test --test-timeout=120000 test/verification-infrastructure.test.ts test/worker.test.ts
```

The local proof stops and restarts its own PostgreSQL container after a successful restore
but before recording the result, then expires the lease in SQL and retries the same copy.
The initial run recovered in 1.38 seconds; it does not measure the normal 120-second lease
wait. A separate case points only the worker's Docker client at a missing socket, restores
its connection, and verifies the same snapshot. The other organisation's malformed
snapshot remains separate and gets a real failed result. The shared Docker daemon is never
stopped. A Docker CLI fault wrapper also refuses `start` on a real created container and
checks that it is removed. An external SIGKILL of a running container returns an
infrastructure error and removes that container. Injected fixed cleanup/configuration/input/output errors prove
retry budgets and preservation of a previously verified fallback; they do not simulate a
physical host crash. Existing container-death and expiry tests prove later reclamation.

The real-restore proof used Waitron `00496fcd182a5c2c9189cc3faf0f8f22d3baf8ac` and image
`sha256:f2ccb8b08b814f5130604984a89e198f3c91f64780320d5d219a8317ea987867` with 1024 MiB
memory and 256 MiB scratch. Two independently captured encrypted snapshots passed SQLite
integrity and the fiscal restore hook. Swapping venue keys/identity failed; a later valid
restore passed. No owned container remained. No restored primary was activated and no production
resource was used.

These receipts establish local resource enforcement and the tested restore path. They do
not establish kernel escape resistance, hostile native exploit containment, production
host configuration, fleet concurrency capacity or the memory needed by large venue archives.
The trusted orchestrator still has Docker authority. Keep production deployment and host
hardening as separate work.
