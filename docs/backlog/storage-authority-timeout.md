# Storage-authority request timeout evidence (D212)

The provisioning check in [run 40120697007](https://github.com/waitron-io/waitron-cloud/actions/runs/40120697007)
aborted after 14.7 seconds without naming its operation. Its log cannot establish
whether setup, provisioning, writing or reading timed out. The unchanged native
macOS authority suite passes all four cases; the historical Linux cause remains
unknown.

The delayed-reload test now prints a fixed operation label when startup, authority
opening, bucket creation, provisioning, identity reload, writing or reading fails.
The labels contain no credentials, venue identifiers, storage locations or error
values. Reporting preserves the original rejection, including when output fails.
Four controlled SDK aborts run the real test against the native store and prove
that bucket creation, provisioning, writing and reading keep their own labels.
The original assertions, both identity checks, cleanup and every deadline remain
unchanged; the authority source is untouched.

In merge run 40936657408 for PR742, receipts job123669048795 reports
`storage_authority_operation=startup` and an S3 `InternalError` after33.5seconds
in the same delayed-provisioning case. The refusal precedes authority opening;
the exact SDK request and relationship to the historical abort remain unknown.
The native delayed-provisioning case passes, so this does not reproduce the Linux
refusal. Preserve the full log before repairing the underlying cause.

Run `node --test scripts/ci-backup-storage-readiness-diagnostics.test.mjs` to check
startup request attribution. A readiness failure now retains the last request
(`create-bucket` or `head-bucket`), its attempt number and separate request counts
in `error.storageStartup.readiness`. When all attempts fail, it also prints one
`storage_readiness_failure=` line because test reporters can omit custom error
fields. A failed output sink still preserves the original refusal. These fixed
labels and counters let you
identify which request failed without copying credentials or request contents.
The controlled creation and ownership-check refusals keep the original SDK error,
all 120 attempts, request deadlines and owned-child cleanup. The tests also check
that cleanup preserves unrelated files and the verified archive. The historical
abort and later Linux internal error still need a labelled recurrence and a
reproduction; this diagnostic change does not establish either cause.

The readiness-count failure in [D525 CI](https://github.com/waitron-io/waitron-cloud/actions/runs/41155039593/job/124399925547)
is reproduced natively (D526). A controlled S3 port collision consumes five
creation and ownership checks before its child exits. The one permitted restart
then consumes 120 of each. The test adds both clients' requests and fails at
125, while the final diagnostic correctly reports 120. A no-collision control
passes at 120; another collision control totals 130 from ten plus 120. Both
children stop and the final refusal preserves the original SDK error.

The owner-approved correction checks each client's budget and diagnostics,
requires exactly 120 requests on the final client, and checks every child's
cleanup. The same three refusal modes run with and without a forced native S3
port collision. The controlled collision holds the first request until that child
exits, so its single request stays separate from the final client's 120 requests.
Every original assertion, request deadline and retry limit remains.

A throwing retry logger previously replaced the storage error and prevented the
permitted restart. The collision control reproduces that failure. The fixture now
contains a failure to print the retry notice, just as it contains a failure to
print the final readiness evidence. Both attempts stop, and the final refusal
preserves the original SDK error. This fixes the reproduced logger failure and
counting mismatch; it does not explain the historical provisioning timeout or
internal error.

## Linux reproduction check (D530)

The owner's Linux test box runs all four unchanged authority cases at Cloud
`8de195e8b34a9c154df74a13420037652bcfd9ad` without failures or skips. The
following command checks writer withdrawal, durable state loss, delayed identity
publication and concurrent provisioning:

```sh
~/waitron-campaign-shared/test-box-run.sh H <checkout> \
  node --test deploy/test-cloud/storage-authority.test.mjs
```

The delayed-publication case takes 5.01 seconds; the file takes 22.02 seconds.
Its test and operation-label helper match the later failing revision
`f1a627a75d0c5557d2d8b0f28e7229c1c209f56d` byte for byte. The authority module,
startup fixture and dependency lock differ, so this result alone cannot explain
that revision's startup failure.

An isolated checkout of that exact historical revision, installed with its own
frozen dependency lock, also passes all four cases without failures or skips on
the same Linux box. Its delayed-publication case takes 4.96 seconds and the file
takes 22.22 seconds. The copied test, authority, startup fixture, operation-label
helper and lockfile match that revision's hashes. This rules out neither
scheduling pressure nor a startup race: the original CI job's concurrent files
and resource conditions have not been recreated. Neither passing run is a fix.

The earlier 14.72-second abort has no operation label; keep it separate from the
later 33.53-second startup internal error.

Keep the label and original error at the next genuine Linux recurrence, then
reproduce and repair that operation's cause. A passing controlled abort or native
run does not close the historical timeout. Docker and PostgreSQL reproduction can
run on the owner's test box while the Mac's Docker is off; full qualification
uses GitHub CI. D152's separate native-writer drain decision remains open.

