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

## Linux reproduction on 1 November 2026

The original failure occurred after the worker-deadline test. Running the ownership
case alone on the shared Linux test box at Cloud commit
[`b95f10b4`](https://github.com/waitron-io/waitron-cloud/commit/b95f10b401ee3784a7e1f6d24fc9504b38b90ce4)
passes one case in 6.1 seconds. Running the controller group in its original order
passes all twelve cases. Its ownership case takes 5.1 seconds, after the deadline
case passes in 10.5 seconds. Neither run reproduces the historical 32.1-second refusal.

You can repeat the two selections through the campaign's `test-box-run.sh` helper:

```sh
node scripts/cloud-cost/conformance.mjs \
  --only isolated-replay-conformance.test.mjs \
  --pattern '^isolatedControllerNeverClaimsCleanupAfterLosingItsOwnership$'
node scripts/cloud-cost/conformance.mjs \
  --only isolated-replay-conformance.test.mjs --pattern '^isolatedController'
```

The controller, local execution helper and journal writer are byte-identical to
historical CI head `be79758475aba5863db676d17d913fb97aaaec0c`, checked with
`git diff --exit-code be79758475aba5863db676d17d913fb97aaaec0c b95f10b401ee3784a7e1f6d24fc9504b38b90ce4 -- scripts/cloud-cost/isolated-replay.mjs scripts/cloud-cost/local.mjs scripts/cloud-cost/owned-journal.mjs`.
The current fixture includes later failure reporting; these runs do not qualify
the complete historical environment or establish a repair.

Keep D294 open. On a new failure, read `ownership-start-refusal` before changing
the test: `workerStarted` distinguishes a recorded worker from earlier preparation,
and `lastPreparation` identifies the last recorded preparation step. If the worker
was recorded but `changed` is false, investigate the ownership-changing observer.
If the worker was not recorded, reproduce the earlier preparation refusal first.
These are diagnostic directions, not attribution of the historical failure.
