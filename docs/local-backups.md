# Prove managed backups locally

Use this runner to pair two disposable Waitron servers, stream their live SQLite
databases, retain encrypted snapshots and restore both sources through Waitron's own
recovery code.
It creates no AWS resources and requires no live customer credentials.

## Run the proof

Install both repositories with their frozen pnpm lockfiles. Use Node 26 with network permission support for the restore verifier (tested with
26.7.0), Docker, OpenSSL and network access for the pinned test binaries. Point to a
Waitron checkout that includes `apps/server/scripts/cloud-backup-fixture.ts`,
`apps/server/scripts/cloud-capture-client-fixture.ts` and
`apps/server/scripts/cloud-recovery-client-fixture.ts` with replacement commands. Export that path as
`WAITRON_CHECKOUT`, and build both portals before starting the servers:

```sh
pnpm portal:build
pnpm --dir "$WAITRON_CHECKOUT" --filter @waitron/dashboard build
node scripts/test-backup-storage.mjs > /tmp/cloud-storage-contracts.json
WAITRON_CHECKOUT=/absolute/path/to/waitron \
  BACKUP_RECEIPT=/tmp/cloud-backup-receipt.json \
  node scripts/test-postgres.mjs exec node scripts/test-local-backups.mjs
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
  only. Each static local stream writer and reader is restricted to one venue prefix.
  Crossed reads, writes and listings fail, and a reader cannot write. The provider
  refuses changed roles and expired identities. The storage-contract runner also issues
  a real 12-second credential, waits for its expiry and proves that the provider refuses
  another write. It rotates a separate venue-scoped writer through the live provider
  configuration, proves that the replacement works and proves that the old key stops working.
- SeaweedFS 4.47 accepts one writer in an eight-request create-only race and one writer
  in an eight-request compare-and-swap replacement race. A stale entity tag receives
  HTTP 412. With bucket versioning enabled, the three accepted writes remain as three
  distinct versions, while refused writes add no version. These are provider-contract
  checks. Cloud's retained-snapshot adapter uses create-only objects and does not expose
  an unused replacement method.
- The provider requires the correct SSE-C key for stream objects. Snapshots use
  Waitron's encrypted archive format and independent immutable retained objects.
- Cloud downloads provider objects into mode-0600 private stages while computing
  SHA-256 and enforcing the declared length, 30-second deadline and existing
  512 MiB ceiling. Publication uploads that same immutable stage and reopens it
  from byte zero for a bounded retry; verification pipelines it into the isolated
  verifier's scratch directory. A 32 MiB SeaweedFS fixture on an Apple M5 Pro
  observed 5,975,936 bytes of peak ArrayBuffer growth and 26,968,064 bytes of RSS
  growth on 2026-09-26. These are local measurements, not provider or capacity
  promises; each run prints its current receipt. An upload stream that fails after its
  first chunk now aborts the provider request without crashing the Cloud process, and
  the provider holds no partial object.
- The independent verifier passes each real Waitron snapshot through compatibility
  checks, SQLite integrity checks, migrations and module restore hooks, including
  the fiscal module. That fixture
  never starts the restored server or its workers. It checks that ordinary Node
  network connections, subprocesses, host-file reads and writes outside the private
  restore directory are denied. The TypeScript loader retains worker-thread access;
  the fixture therefore proves the boundaries used for trusted Waitron code, not a
  hostile-code sandbox.
- Actual source Cloud connection credentials and staff TLS keys stay out of the
  archive. A captured `backup.env` is discarded when restoring this managed test
  replacement, so it cannot resume an old destination. Customer-managed archive
  restore behavior is unchanged.
- After stopping the source servers, a disposable process runs Waitron's production
  snapshot worker, exits after upload and resumes from the same encrypted file in a
  fresh process. No new archive is created; the published monthly snapshot restores
  independently, and another restart before the next due time stays idle.
- Litestream 0.5.17 streams a committed change from each real venue database through
  encrypted, scoped storage. Cloud reads and verifies each signed Waitron pointer, then
  records its pointer time as the recoverable time. After both source servers stop, the
  runner approves one exact generation and feeds its recovery kit to Waitron's
  `restore --from-bucket` command. It interrupts the first attempt, checks that no target
  database remains, retries, and compares a deterministic database head with the source.
- The runner deletes the other venue's continuous prefix without changing its neighbour.
  Explicit snapshot fallback then restores that venue through Waitron's archive worker.
- An owner can recover an older-key snapshot after rotation with both original servers
  stopped. A wrong recovery key leaves the replacement database absent. No recovery
  grant activates trading, changes routing, retires an installation or re-enrols a node.

- The guided path uses owner HTTP approval and the production Waitron replacement
  client in fresh processes. It resumes the same request after restart, reconciles
  a lost approval reply, downloads the bound object, stages it and runs the actual
  cold-restore entry point. Venue contents, source identity and module hooks are
  checked. Cloud stays pending through staging and changes only after the local
  restore has succeeded and the replacement sends its completion report.

- After the restored test server requests reconnection, the original Cloud owner
  confirms the displayed old installation. Fresh client processes import one durable
  registration, renew a lease and publish a snapshot that restores independently.
  The venue, retained history, hostnames and tunnel address stay the same; installation
  and tunnel keys change. The old installation cannot obtain new capture credentials,
  and the other venue's route is unchanged. Closing the recovery download does not
  undo a completed replacement.

The replacement check exports the new gateway manifest; it does not install a
WireGuard interface or staff HTTPS certificate on the appliance. Use the existing
[operator remote-access procedure](local-remote-access.md) for that local setup.
Cloud registration does not change Waitron's trading or fiscal activation rules.
Production replacement and planned final-write handover remain separate work. The local
proof restores continuous data but deliberately records `activation: not-performed`.

The JSON receipt records exact repository heads, dirty flags, checks and stream
restore timings. A dirty receipt is useful during development; use clean heads for
release evidence. Its checks now require the real Waitron restore and verifier-process
isolation phases; removing that evidence makes the receipt invalid. Timings measure the
local fixture, not a production recovery target.

## Internal API and retained data

`@waitron-cloud/backups` is an internal local-integration package. Provisioning refuses
production venues. Owners can browse its snapshot catalogue and authorise a replacement
through the account portal. Capture uses the [authenticated installation adapter](authenticated-captures.md).
The guided recovery path below remains limited to local test venues.
The caller supplies a persistent 32-byte master key outside PostgreSQL; key versions
are encrypted and authenticated against their venue and version. Losing this master
key loses access to those backups. Rotation retains old versions; deletion is absent.
Use the read-only [managed-key check and recovery drill](managed-key-operations.md)
before restarting workers from a restored Cloud database or considering key retirement.

The catalogue separates upload completion from a trusted worker's verified restore
of the exact digest. Owner-authorised catalogue reads return snapshot capture times and
signed continuous recovery evidence. The portal recommends a fresh continuous source
and keeps verified snapshots as an explicit fallback. Status
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
cancellation and explicit deletion policy are not implemented. Cloud's retained-snapshot
publication, conditional-conflict comparison, verification and local recovery proof stream
through bounded private stages. The end-to-end archive ceiling remains 512 MiB because
Waitron archive assembly and restore clients have not yet been proved beyond it. Production
still needs deployment-sized transfer/concurrency evidence and live-provider validation.
Callers own and close their object clients.

## Recover a test venue without copying keys

Start with **Restore from Waitron Cloud** on the replacement server's setup screen.
Open its Cloud link, sign in as an owner and enter the eight-digit code shown on the
replacement. The link identifies the request; it deliberately excludes the code.
Choose your organisation and venue. A fresh continuous copy is selected initially
because it normally loses fewer changes. You can instead choose a verified snapshot
when you need an archive point or the continuous source is missing. Check the displayed
recoverable or capture time before accepting the loss of later changes. Confirm that
the old server and any surviving server with newer data are stopped or permanently
unavailable.

After you authorise the source, return to the replacement. Refresh its status, check
the approved recovery time, then confirm the local restore. A snapshot downloads one
encrypted object and passes it through Waitron's archive validation. A continuous
restore receives one frozen recovery kit and follows Waitron's signed live pointer.
Neither browser receives a recovery key or storage credentials. The account page's
authorised status means download permission. It does not mean that restore has
completed or trading is enabled.

An unapproved request lasts fifteen minutes and permits five incorrect codes. An
approved operation lasts one hour and stays bound to its original snapshot or
continuous generation and its replacement key. If an approval reply is lost, the page checks the saved request
instead of creating another operation. If you reload the page, reopen the link from
the replacement and enter its code again.

You can close recovery access from the account page. Closing it, losing owner access,
or disabling the account stops new downloads. Storage credentials already issued
can remain valid for up to fifteen minutes, and data already downloaded cannot be
recalled. A replacement rechecks its approval after download before staging the restore.

The [recovery contract](superpowers/specs/2026-09-24-customer-recovery-design.md)
describes the signed machine requests. Cloud approval never fences the old server,
changes routing or enrols the replacement. Complete the replacement's local checks
before trading. Production activation and planned handover still depend on the Waitron
contract described below.

## Still required for the complete milestone

The local runner now exercises Waitron's stream supervisor, signed pointer, sealed
recovery kit and cold database restore. It does not activate the target or prove that a
planned source stopped at a final write. Production replacement still needs
final-write and quiescence evidence, fresh installation enrolment, retirement of the
old credentials and explicit Waitron activation. Recording a `planned` mode or an
owner's confirmation does not establish those conditions.

The installation-authenticated capture/renewal adapter and Waitron client are implemented.
Scheduled capture with durable local archive spooling is implemented for test installations.
Customer recovery now has a matching-code account flow for verified test snapshots.
The local worker schedules verification, retention
and abandoned-upload cleanup; the customer catalogue is paginated. Define cancellation/deletion,
production master-key custody and rewrapping, and deployment container/VM resource quotas for the
isolated verifier. The local managed-key drill now proves backup of the external key can reopen
every retained
version after restart; it does not choose a vault provider or add an in-place rewrap. Run the
same provider tests against the selected Spain-region store before any deployment;
this local result does not establish AWS or Google behavior. Production still needs
dynamic writer and reader credential delivery and revocation, plus the same scoped
rotation, expiry, versioning, interruption and conditional-write checks against each
selected provider; measured continuous retention;
monitoring and scheduling; and the planned final-write handover. Continuous backup
during gateway replacement and target activation remain unproved.

## Run background maintenance locally

Apply migrations through `018_managed_continuous_recovery.sql`. Configure `DATABASE_URL`, a persistent
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
private temporary directory. Keys travel through stdin and application secrets are not
inherited. The fixed Node policy reads only the installed Waitron checkout, its verifier
entry point and the private restore directory; it writes only that directory and grants
no network, subprocess or native-addon permission. The TypeScript loader keeps its
worker-thread permission.

The child has a 512 MiB V8 heap ceiling, at most 25 seconds of CPU time, a 30-second wall deadline,
a 512 MiB per-file limit, at most 128 open files and 64 KiB total output. Cancellation
kills its process group and waits for close before the private directory is removed.
Malformed archives produce a fixed failure code, resource ceilings produce a distinct
resource code, oversized objects are refused at the 512 MiB catalogue/storage boundary,
and a worker restart retries the durable job without trusting the old result. Focused
process tests exercise the fixed permission and resource policy with real children; the
database suite covers object-size refusal, while the two-venue runner exercises the loader
policy around Waitron's real restore hooks.

These controls isolate trusted local Waitron code from the Cloud worker. They are not a
hostile-code sandbox: the required loader worker can invalidate Node's permission model,
native allocations are outside the V8 heap limit, and the per-file limit is not a total
scratch-volume quota. Before deployment, run this process inside the selected container
or virtual-machine boundary with a total memory limit and a quota-limited scratch volume.

## Reconnect after a test snapshot restore

After Waitron starts from the verified managed restore, sign in as a local manager
and request Cloud reconnection from Cloud settings. Keep the original recovery
request open in your Cloud account. Confirm that the displayed old installation has
been taken out of service, then confirm replacement. Return to Waitron and check the
result. If a reply is lost, check again; the same request imports the same registration.

The proposal contains public installation and tunnel keys, the restored venue and
source node identifiers, and the original recovery deadline. Both the restore key
and the fresh installation key sign it. Owner confirmation replaces Cloud authority
in one database transaction, rotates the key used for new snapshots and retains old
keys for historical snapshots. Ordinary pairing still refuses a second current
installation, including when the current installation has been revoked.

Prepare/status use `/api/replacement/prepare` and `/api/replacement/status`. Owner
confirmation uses `/api/account/recovery/replace`; the existing recovery inspect
response includes the proposal and completed result. These routes remain limited
to verified test snapshots. An expired or closed recovery cannot start a replacement,
but an exact completed result remains retrievable while its installation is active.
