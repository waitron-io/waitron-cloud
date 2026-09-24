# Prove managed backups locally

Use this runner to pair two disposable Waitron servers, retain encrypted SQLite
snapshots and restore them through Waitron's own validation and module hooks.
It creates no AWS resources and requires no live customer credentials.

## Run the proof

Install both repositories with their frozen pnpm lockfiles. Use Node 26 with network permission support for the restore verifier (tested with
26.7.0), Docker, OpenSSL and network access for the pinned test binaries. Point to a
Waitron checkout that includes `apps/server/scripts/cloud-backup-fixture.ts`, export
that path as `WAITRON_CHECKOUT`, and build its dashboard before starting the servers:

```sh
pnpm --dir "$WAITRON_CHECKOUT" --filter @waitron/dashboard build
node scripts/test-backup-storage.mjs
WAITRON_CHECKOUT=/absolute/path/to/waitron \
  BACKUP_RECEIPT=/tmp/cloud-backup-receipt.json \
  node scripts/test-postgres.mjs exec node scripts/test-local-backups.mjs
```

For the real 15-minute storage-credential expiry check, run:

```sh
CHECK_STORAGE_EXPIRY=1 node scripts/test-backup-storage.mjs
```

The runners own their temporary databases, files, servers and containers and remove
those resources on exit. Downloaded, digest-checked binaries stay in the temporary
binary cache. SeaweedFS 4.47 listens on loopback with verified HTTPS; its temporary
OIDC issuer gives scoped credentials through its security-token service. macOS runs
Litestream in a disposable pinned Linux container with the private CA mounted,
without modifying your system trust settings. This needs Docker Desktop's
`host.docker.internal` bridge. Native Linux uses the pinned Linux binary.

## What the checks establish

- Capture credentials can write only their incoming object. They cannot read it,
  remove retained snapshots or cross a venue boundary. Restore credentials are read
  only. Stream credentials are restricted to one generation prefix. The provider
  refuses changed roles, expired identities and expired storage credentials.
- The provider requires the correct SSE-C key for stream objects. Snapshots use
  Waitron's encrypted archive format and independent immutable retained objects.
- Each real Waitron snapshot passes its compatibility checks, SQLite integrity check,
  migrations and module restore hooks, including the fiscal module. The fixture
  never starts the restored server or its workers. It checks that ordinary Node
  network connections are denied; this is a test guard, not a hardened sandbox for
  hostile code (the TypeScript loader requires worker, child-process and addon access).
- Actual source Cloud connection credentials and staff TLS keys stay out of the
  archive. A captured `backup.env` is discarded when restoring this managed test
  replacement, so it cannot resume an old destination. Customer-managed archive
  restore behavior is unchanged.
- Litestream 0.5.17 restores a committed change from each real venue database through
  encrypted, scoped storage. The runner removes both stream prefixes and checks that
  continuous restore now fails. An independently retained snapshot still restores.
- An owner can recover an older-key snapshot after rotation with both original servers
  stopped. A wrong recovery key leaves the replacement database absent. No recovery
  grant activates trading, changes routing, retires an installation or re-enrols a node.

The JSON receipt records exact repository heads, dirty flags, checks and stream
restore timings. A dirty receipt is useful during development; use clean heads for
release evidence. Timings measure the local fixture, not a production recovery target.

## Internal API and retained data

`@waitron-cloud/backups` is an internal local-integration package. Provisioning refuses
production venues. Owners can browse its snapshot catalogue in the account portal; capture uses the [authenticated installation adapter](authenticated-captures.md); recovery
remains an internal integration API.
The caller supplies a persistent 32-byte master key outside PostgreSQL; key versions
are encrypted and authenticated against their venue and version. Losing this master
key loses access to those backups. Rotation retains old versions; deletion is absent.

The catalogue separates upload completion from a trusted worker's verified restore
of the exact digest. Owner-authorised catalogue reads return capture times and a
currently verified snapshot default; continuous recovery remains unavailable. Status
contains no secret key values. Recovery targets prove possession of a fresh bound
Ed25519 key that has never been used by another recovery operation. Owner removal, account disabling, closure and expiry stop new access;
already-issued storage credentials remain usable until their 15-minute expiry.

Daily points expire after 30 days, monthly points after 12 calendar months. Cleanup
protects active recovery references and the latest successfully verified snapshot,
even if a later recheck fails. If no snapshot has verified yet, it preserves the newest
snapshot without calling it verified. It retries interrupted object deletion and removes
the incoming copy after publication; a failed removal is retried by publication. Recovery
start and cleanup close expired operations, including those whose owner is disabled.
Verification releases the venue lock during the restore and rechecks the point before
recording the result. A master-key error leaves archive verification status unchanged. Subscription
cancellation and explicit deletion policy are not implemented. Object reads/writes
are bounded to 512 MiB in memory; production-sized archives need streaming I/O and
bounded worker concurrency. Callers own and close their object clients.

## Still required for the complete milestone

Waitron's SQLite slice-2 sealed state, stream supervisor and cold-restore activation
contract remain prerequisites for a complete continuous **server** restore. Restoring
SQLite alone does not recover all required files or prove permission to trade.
Recheck those landed interfaces before wiring the production adapter. Planned
replacement still needs final-write/quiescence evidence, fresh installation enrolment,
retirement of the old credentials and explicit Waitron activation. Recording a
`planned` mode or an owner's confirmation does not establish those conditions.

The installation-authenticated capture/renewal adapter and Waitron client are implemented.
Next, add scheduled capture with durable local archive spooling and customer recovery screens. The local worker now schedules verification, retention
and abandoned-upload cleanup; the customer catalogue is paginated. Define cancellation/deletion,
operator master-key backup and rotation, and production verifier isolation. Run the
same provider tests against AWS Spain before any deployment; this local result does
not establish AWS or Google behavior. Continuous backup during gateway replacement
and a complete continuous replacement remain unproved.

## Run background maintenance locally

Apply migrations through `012_backup_jobs.sql`. Configure `DATABASE_URL`, a persistent
64-hex-character `CLOUD_BACKUP_MASTER_KEY`, and `WAITRON_CHECKOUT` pointing to your
installed Waitron checkout. Storage uses `CLOUD_BACKUP_ENDPOINT` (verified HTTPS),
`CLOUD_BACKUP_REGION`, `CLOUD_BACKUP_ACCESS_KEY` and `CLOUD_BACKUP_SECRET_KEY`.
Set `CLOUD_BACKUP_SESSION_TOKEN` when needed and `CLOUD_BACKUP_CA_FILE` for a private
local CA. The worker refuses catalogue endpoints or regions that differ from these
operator settings before sending storage credentials.

```sh
pnpm backup:worker --once
pnpm backup:worker
pnpm backup:status
pnpm backup:worker --retry-failed
```

Status and manual retry require only database access. Retry resets at most 100 failed
jobs per command. Continuous mode processes one job at a time; `--once` schedules
bounded work and attempts one job. The queue reports pending, running, failed and
completed counts, due work (including expired leases), attempts across runs and the
oldest due time. Inspect `backup_jobs.last_error` for fixed diagnostic codes.

Only configured test venues are eligible. Verification runs immediately for new
snapshots and weekly after success; retention and upload cleanup run every minute.
Failures retry after 30 seconds, doubling up to 15 minutes, for eight attempts.
A random claim and 120-second lease fence database mutations so a late verifier cannot
replace a newer result. Crashes leave work reclaimable after lease expiry. Deletes
can repeat after interrupted work; retained snapshot protection still applies.

Unpublished capture requests expire after 24 hours. Cleanup waits a further 16 minutes
for issued upload authority to expire, records a tombstone, then deletes incoming and
orphan snapshot objects. Published points keep their snapshot; only incoming data is
removed. Tombstones prevent capture-ID reuse, while exact committed publish retries
remain valid. Future authenticated grant issuers must enforce that same capture deadline.

Each verification imports Waitron's actual validation and restore hooks in a separate
process, checks archive identity and capture time, and restores SQLite into a fresh
private temporary directory. Keys travel through stdin, application secrets are not
inherited, Node networking is denied and writes are limited to that directory. The
child has a 512 MiB heap setting, a 30-second deadline and bounded output. Cancellation
kills its process group; temporary restore files are removed afterward. The worker
refuses runtimes without Node network permission support. Status and queue tests also
run on the project's ordinary Node runtime.

These are trusted local-code controls. Native allocations, addons and child-process
capabilities mean the heap setting is not a total memory limit or a hostile-code
sandbox. Production needs container network/filesystem isolation and total CPU, memory
and disk limits before this verifier can handle customer archives.
