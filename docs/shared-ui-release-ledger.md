# Keep a UI release reservation through failures

When a release build stops halfway through, you need to remember its version
and bytes before trying again. The release ledger records those decisions so
another run cannot allocate a new number to escape an unfinished upload.
It implements the reservation and recovery part of the
[approved private release plan](superpowers/plans/2026-11-05-public-ui-registry.md).
The publisher workflow does not use it yet.

Use `reserveRelease` from `scripts/release/ui-ledger.mjs` with an empty
`{schema: 1, events: []}` ledger, the selected Waitron source identity, SHA-512
hashes of the input inventory, preparation recipe and source-check evidence,
the complete registry version list and a UTC timestamp. The first reservation
receives `0.2.0` even when the source manifest remains `0.1.0`. An identical
source and evidence retry reuses that reservation. A changed identity refuses.
Only the existing `0.1.0` may precede the ledger. Any other registry version
needs an already recorded upload attempt. A number that appears while its
record is only reserved or prepared stops allocation and retries too.

Append a `prepared` event with the archive, manifest and both notice hashes.
Persist it before appending and persisting `uploading`. After registry
readback, append `published` with the same hashes, complete source identity,
private visibility and publication time. Each event names its reserved source
commit and release version. The readback time must be valid and no later than
the event recording it. These helpers validate the supplied records; they do
not fetch the registry or establish that a source CI run passed.

An `uploading` record is an uncertain result until you read the registry.
This slice provides no automatic retry of that upload. Matching readback can
finish it without another upload; missing or conflicting readback requires
investigation. An unfinished source blocks every later source. Published
records remain in the ledger even if a registry version disappears, so its
number is never allocated again. Later reservations receive `0.2.1`, `0.2.2`
and successive patch numbers.

## Prepare the reserved version

Your source can keep version `0.1.0` while the ledger reserves release `0.2.0`.
Pass the committed ledger snapshot to Cloud's preparation command:

```sh
node scripts/release/prepare-ui.mjs /path/to/clean-waitron /path/to/empty-output \
  --ledger /path/to/ledger/releases.json
```

The command validates the complete ledger and uses its last, unprepared
reservation. It requires the exact reserved source commit, source package name
and source version, then packs the built output as `waitron-io-ui-core-0.2.0.tgz`.
The staged manifest keeps the original version in `waitronSource`, checks both
built notices against the source copies and removes package build hooks.
The output directory must be empty at entry so a previous
artifact cannot be mistaken for this release. The command leaves the ledger
unchanged; record and persist the artifact identity separately before upload.

Prepared, uploading and published records refuse another build through this
entry point. Rebuilding an expired prepared artifact and proving identical
bytes remain integration work. A valid local ledger does not establish trusted
remote history, successful source CI or complete registry inventory. Supply
those checks in the later orchestration before publication. That integration
must also compute and compare the reserved input, recipe and source-check hashes;
this entry point validates their shape only. A clean Git status does not prove
the build output belongs to that commit: ignored or assume-unchanged files can
remain. Fresh source isolation, an ordered build and artifact verification remain
required before upload. Concurrent preparations must use distinct output
directories; the initial emptiness check does not lock the directory.

Without `--ledger`, the existing workflow still uses `ui-source.json` and its
September release number. The workflow does not use the reserved path yet.
The preparation command publishes nothing on either path.

## Record and recover the exact artifact

After building the reserved release, compute its fingerprints from the actual
archive rather than assembling a record by hand:

```sh
node scripts/release/record-ui-artifact.mjs /path/to/waitron \
  /path/to/output/waitron-io-ui-core-0.2.0.tgz \
  --ledger /path/to/ledger/releases.json --at 2026-11-06T08:00:00.000Z \
  > /path/to/next-ledger.json
```

The command prints the next ledger without changing the input ledger or archive.
Pass that result to `persistLedger` below before recording an upload. It accepts
only an active `reserved` or `prepared` release. On a prepared retry, it requires
the same archive, raw manifest and notice fingerprints and returns the unchanged
ledger. It never turns an uncertain upload back into a prepared release.

The recorder validates the reserved release/source mapping, private GitHub
publishing metadata, script-free manifest and presence of every built export.
Both notices must match the reserved commit's regular Git blobs. Working-copy
edits, inherited Git redirection and local replacement refs cannot supply those
bytes. Tar receives a frozen in-memory copy and a restricted environment; it
reads members to standard output without extracting files. Links, duplicate
members and paths outside the package refuse. Archives are limited to 16 MiB
compressed and 32 MiB expanded, with bounded tar commands.

You can also call `recordReleaseArtifact` from `scripts/release/ui-artifact.mjs`
with the ledger, archive buffer and `{notices, at}`. Supply both notice buffers
from verified immutable source evidence. This check fingerprints the provided
artifact; it does not prove that its compiled files came from that source.
Fresh source builds, the reserved input/recipe/source-check hashes, trusted source
CI and complete registry evidence remain mandatory before upload. A recovered
archive must already exist; rebuilding an expired one remains orchestration work.

## Persist one transition at a time

Use `readLedger(checkout)` to read a local committed snapshot, then
`persistLedger(checkout, snapshot, next)` from
`scripts/release/ui-ledger-git.mjs` in a dedicated clean checkout of the
`ui-release-ledger` branch. Its only tracked file is regular `releases.json`.
Initialising that branch and choosing its repository identity belong to the
later workflow integration; this slice creates no remote automation branch.

Persistence checks the local snapshot and exact remote head before changing
the file. It accepts one additional event and preserves every earlier event.
The normal `git commit -s` and push hooks run. An exact Git lease, a push that
succeeds only while the remote still names the expected commit, rejects a
competing update. A local directory lock excludes a second writer using the
same checkout. Inherited `GIT_*` environment variables cannot redirect these
commands to another checkout; configure author identity and registry-independent
Git authentication in the dedicated checkout instead.

A failed hook or push stops the operation. Inspect the staged file or retained
signed local commit and reconcile it with the remote. The helper does not reset
the checkout, retry a push or discard another run's work. A local snapshot can
include a rejected commit, so it is not authoritative remote evidence for a
release monitor. Read-only monitoring still needs its own verified remote read.
After a successful
push it reads back the exact remote head before returning the new snapshot.

Git commands ignore global and system configuration as well as inherited
`GIT_*` variables; configure identity and authentication locally in the dedicated
checkout. Commits must retain their committer's sign-off after hooks finish.
Ignored files also make the checkout dirty. The default Git command limit is
30 seconds. You may shorten the commit and push limit with
`{commandTimeoutMs: 5000}` as the fourth persistence argument. On timeout, the
helper terminates only that command's own process group before releasing its
lock. A signal failure retains the lock. A hook that dirties the lock preserves
both the command error and the cleanup error rather than hiding the first.

A forcibly killed caller can leave a lock and a still-finishing local Git
command. Do not reclaim that checkout automatically. Leave its evidence intact
and investigate the recorded attempt; any replacement checkout must start from
verified remote history. This helper does not recover abandoned local locks.

Run the state and real-Git checks without credentials or containers:

```sh
node --test scripts/release/ui-ledger.test.mjs scripts/release/ui-ledger-git.test.mjs \
  scripts/release/prepare-ui.test.mjs scripts/release/ui-manifest.test.mjs
```

Before publication, the remaining adapters must select trusted exact-main CI,
trace the complete build inputs, enumerate registry versions, connect artifact
recording to persistence and verify registry responses. Keep source builds separate from the
job holding package-write credentials. The existing release workflow and
September source pin are unchanged; this library does not qualify or authorise
a dispatch of that workflow for `0.2.0`.

The source adapter must recheck registry versions immediately before recording
an upload attempt. A complete empty inventory is different from a failed
lookup; this library cannot establish which one the adapter supplied. Replay
retains all published events without cloning the growing history at each step.
Git command output still has a 16 MiB limit; a larger-history storage format
remains future work.
