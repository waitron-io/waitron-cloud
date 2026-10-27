# Isolated replay ownership fixture refusal (D294)

The ownership-changing hook was not observed in [cost run 40265731418,
job 121387722438](https://github.com/waitron-io/waitron-cloud/actions/runs/40265731418/job/121387722438).
Failure diagnostics now distinguish recorded worker admission from an unrun
hook and retain the last fixed preparation stage, elapsed time and cancellation
state. Private resource IDs, paths and tokens stay out of the report. A native
control preserves the original missed-ownership assertion; the genuine copy
refusal exercises the reporter in CI. Ownership assertions, deadlines and cleanup
rules remain unchanged. The historical failing operation and its repair remain
open: collect an instrumented recurrence before changing the ownership check.
