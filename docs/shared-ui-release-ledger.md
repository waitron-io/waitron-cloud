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
Only the existing `0.1.0` may precede the ledger; any other registry version
without its own reservation stops allocation.

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

## Persist one transition at a time

Use `readLedger(checkout)` and `persistLedger(checkout, snapshot, next)` from
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
the checkout, retry a push or discard another run's work. After a successful
push it reads back the exact remote head before returning the new snapshot.

Run the state and real-Git checks without credentials or containers:

```sh
node --test scripts/release/ui-ledger.test.mjs scripts/release/ui-ledger-git.test.mjs
```

Before publication, the remaining adapters must select trusted exact-main CI,
trace the complete build inputs, enumerate registry versions and verify actual
artifact bytes and registry responses. Keep source builds separate from the
job holding package-write credentials. The existing release workflow and
September source pin are unchanged; this library does not qualify or authorise
a dispatch of that workflow for `0.2.0`.
