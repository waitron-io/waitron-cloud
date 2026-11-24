# Cost conformance setup timeout (D131)

Setup commands now report their phase, timing and outcome, source fetches have two bounded
attempts, and installs report bounded progress. Every cause below is unexplained. Keep the pins,
lockfile, integrity checks, the 300-second setup limit and process-group cleanup; get evidence
from the affected Linux transfer before proposing a repair. Fresh container qualification is open.

## Source installation stops at 669 of 670 packages

- 669 of 670 packages: D400 job `122675571593` and D409 job `122754483156`.
- An unfinished `@napi-rs/canvas-linux-x64-gnu@1.0.10` body (run 40677826792, job 122780751423).
  pnpm's request timeout does not bound a stalled body, so the outer limit stays.
- `cpu-features@0.0.10` still in its install stage with every package imported (run 40941888772,
  job 123687227986). Script milestones now show node-gyp's last recognised step; an HTTP 200
  milestone means headers arrived, not a complete body.
- A `source-fetch` that reached 300 seconds (D480, run 40885808434) and D458's connection refusal.
- The original unlabelled timeout (PR #318, run 39959775169).

The pinned source has no install scripts in sub-packages; extend the observer before relying on
them in a later source revision.

## Healthy source-fetch fixture records a retry

[PR #953's standard run](https://github.com/waitron-io/waitron-cloud/actions/runs/42007512040/job/127179355072)
recorded two fetches where `conformance-source-fetch.test.mjs:137` requires one. #957 reproduced
this with a 500 ms scheduling delay and fixed the fixture clock; the job did not measure its own
delay. Capture the attempt
diagnostics and generated helper state on a recurrence before changing the fixture. Lane H's
CI-failure investigation is the proposed owner, pending watcher assignment.
