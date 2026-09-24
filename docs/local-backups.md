# Prove managed backups locally

Use this runner to pair two disposable Waitron servers, retain encrypted SQLite
snapshots and restore them through Waitron's own validation and module hooks.
It creates no AWS resources and requires no live customer credentials.

## Run the proof

Install both repositories with their frozen pnpm lockfiles. You need Node 24 or
newer, Docker, OpenSSL and network access for the pinned test binaries. Point to a
Waitron checkout that includes `apps/server/scripts/cloud-backup-fixture.ts`:

```sh
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
production venues. It has no public HTTP routes or customer backup screens yet.
The caller supplies a persistent 32-byte master key outside PostgreSQL; key versions
are encrypted and authenticated against their venue and version. Losing this master
key loses access to those backups. Rotation retains old versions; deletion is absent.

The catalogue separates upload completion from a trusted worker's verified restore
of the exact digest. Owner-authorised catalogue reads return capture times and a
currently verified snapshot default; continuous recovery remains unavailable. Status
contains no secret key values. Recovery targets prove possession of a fresh bound
Ed25519 key. Owner removal, account disabling, closure and expiry stop new access;
already-issued storage credentials remain usable until their 15-minute expiry.

Daily points expire after 30 days, monthly points after 12 calendar months. Cleanup
protects active recovery references and the latest successfully verified snapshot,
even if a later recheck fails. It retries interrupted object deletion. An expired
recovery operation still protects its point until an owner closes it. Subscription
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

Next, add the installation-authenticated capture/renewal adapter, scheduled capture
and verification workers, customer selection/status/recovery screens, and interrupted
operation recovery. Bound catalogue pagination and verification resource use; clean up
unused incoming uploads and expired capture requests. Define cancellation/deletion,
operator master-key backup and rotation, and production verifier isolation. Run the
same provider tests against AWS Spain before any deployment; this local result does
not establish AWS or Google behavior. Continuous backup during gateway replacement
and a complete continuous replacement remain unproved.
