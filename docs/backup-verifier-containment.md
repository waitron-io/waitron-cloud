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
Both resource and ordinary failures remain failed verifications. Archive output and error
details are not returned in diagnostics.
The database worker keeps its existing bounded retry and cancellation rules.

Cancellation removes the container and waits for its local attach process to exit. A
30-second watchdog inside the container also ends work if the parent is killed. Startup and each new restore
reclaim only containers carrying its owner label whose 60-second ownership deadline has
expired. It leaves recent results alone while another pass reads them. Once ownership expires,
cleanup removes the container even if it is still running; a stalled pass cannot retain
resources indefinitely. Do not scale the Compose backup service without assigning
distinct worker owners. Use a different
owner value for each worker slot. An abandoned container retains its scratch until removal;
the next restore or startup after its deadline reclaims it. You can also remove that exact
owned container explicitly. Cleanup failure
is an error, never successful verification. This is not a daemon-outage recovery guarantee. Docker failures are ordinary verification
errors under the current catalogue interface, so an infrastructure outage can mark a
healthy snapshot failed. Separating infrastructure health from archive validity remains
follow-up work.

## Executed proof

Run the focused hostile fixtures and PostgreSQL worker test:

```sh
pnpm --dir packages/backups exec node --test test/container-verifier.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/container-worker.test.ts
WAITRON_CHECKOUT=/absolute/path/to/waitron \
  CLOUD_VERIFIER_IMAGE=waitron-backup-verifier:local \
  node scripts/backup-verifier-proof.mjs /tmp/backup-verifier-proof.json
```

The 2026-09-29 local run used Docker 29.3.0. Native `Buffer` allocations hit the 192 MiB
memory limit with Docker `OOMKilled=true`. Many 512 KiB files hit the 16 MiB total scratch
limit with `OOMKilled=false`; both returned resource refusal. A separate Docker-exec
probe measured the full scratch filesystem as 16,777,216 bytes total and zero bytes
available while the allocating child was still alive. The same parent subsequently
verified a valid snapshot. Input staging exhaustion, interrupted upload, cancellation,
worker kill/restart and simultaneous venue fixtures also ran. A PostgreSQL worker recorded
three failed verifications (memory, scratch and wrong identity), then verified valid work
without mixing the two venues.

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
