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
unchanged; the authority and storage fixture source are untouched.

Keep the label and original error at the next genuine Linux recurrence, then
reproduce and repair that operation's cause. A passing controlled abort or native
run does not close the historical timeout. Local Docker and PostgreSQL checks
remain unavailable until 3 November; full qualification uses GitHub CI. D152's
separate native-writer drain decision remains open.

