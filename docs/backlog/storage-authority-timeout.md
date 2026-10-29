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
in `error.storageStartup.readiness`. These fixed labels and counters let you
identify which request failed without copying credentials or request contents.
The controlled creation and ownership-check refusals keep the original SDK error,
all 120 attempts, request deadlines and owned-child cleanup. The tests also check
that cleanup preserves unrelated files and the verified archive. The historical
abort and later Linux internal error still need a labelled recurrence and a
reproduction; this diagnostic change does not establish either cause.

Keep the label and original error at the next genuine Linux recurrence, then
reproduce and repair that operation's cause. A passing controlled abort or native
run does not close the historical timeout. Local Docker and PostgreSQL checks
remain unavailable until 3 November; full qualification uses GitHub CI. D152's
separate native-writer drain decision remains open.

