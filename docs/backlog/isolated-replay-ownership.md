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

## Qualification on 4 November 2026

The [recorded Linux controller job](https://github.com/waitron-io/waitron-cloud/actions/runs/41847362561/job/126639867921)
at Cloud commit `65b81252eeef3bb5ed3d825269acdd72b5edf7b1` passes all twelve
controller cases, with no failures, cancellations or skips. Ownership loss passes
in 3.2 seconds immediately after the worker-deadline case passes in 9.8 seconds.
The genuine copy-refusal case also passes and checks the diagnostic report without
exposing private values. The fixture, diagnostic helper, diagnostic tests,
controller, local execution helper, journal writer, conformance runner and Waitron
adapter match current main `2208befc414b6236bdbc8798082b433f7d0f01d4` byte for byte.
This is retained CI evidence, not a new Linux experiment.

You can check the reporter and journal rules without Docker:

```sh
node --test --test-timeout=30000 \
  scripts/cloud-cost/replay-ownership-diagnostics.test.mjs \
  scripts/cloud-cost/owned-journal.test.mjs
```

All 32 current native checks pass, including the deliberately missed ownership
assertion and preservation of the original failure when reporting fails. The
shared test box was busy before copying or testing, so no fresh Linux result is
claimed. The original failed log records `changed` as false after 32.1 seconds,
but cannot distinguish an earlier preparation refusal from a missed observer.
Keep the historical cause open and collect the diagnostic report on recurrence.
Ownership assertions, deadlines, cleanup rules and runtime code are unchanged.
