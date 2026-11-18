# Find why the translation disconnect test fails on CI

Use the failure to identify the broken check and the PostgreSQL connections it
selected. Reproduce the cause before changing worker or fixture behaviour.
The Lane G watcher queued TRANSLATION-DISCONNECT-ROOT on 18 November 2026 at
13:32: “Its first step keeps the inner assertion and the backend's facts on a
failing run.” Codex wrote this plan. Claude reviewed the first draft. The watcher
cleared the build at 14:20 on 18 November with the split below.

## What the two runs show

[Main job 128479291385](https://github.com/waitron-io/waitron-cloud/actions/runs/42395447647/job/128479291385)
records 684 passes and one failure. The log names
`assert.ok(killed.rows.every(row=>row.killed))` at line 192. At least one
PostgreSQL connection did not report successful termination.

[PR #1299 job 134794387767, attempt 1](https://github.com/waitron-io/waitron-cloud/actions/runs/44302084131/job/134794387767)
records 1,852 passes, one failure and 30 skips. The outer
`translation-disconnect-binding.test.mjs:40` check received only the inner
case's opening line, an assertion error code and a failed-suite refusal.
Its exact inner assertion and any shared cause remain unknown.

## First pull request: keep the evidence

1. Extend the nested-runner case in
   `scripts/translation-disconnect-diagnostics.test.mjs` to force the earlier
   assertion failure and show that its diagnostic is missing. Use the existing
   helper. Keep its bounded-data and private-output checks.
2. In `packages/translation/test/worker-cli.test.ts`, widen the existing error
   capture to cover the two termination assertions. Keep a fixed check name,
   the iteration, and up to four process IDs with their termination results.
   Include the worker's current exit code, signal and fixed messages. When
   output falls outside the filter, report "output withheld" in its place.
   Accept the new record through the parser in
   `scripts/test-cloud-free-services.mjs` and check both emission and parsing
   in the diagnostics test. Leave the venue-proof receipt wrapper alone. In
   `deploy/test-cloud/translation-disconnect-binding.test.mjs`, retain the
   nested report on every failure check. Keep the existing binding assertions.
3. Keep the main job link and add the PR job to `docs/backlog/translation.md`.
   Update the diagnostic pointer in `docs/backlog.md`.
4. Use the binding test's own driver to run an early scratch-only control with
   a pause between stop calls. Include the resulting evidence in the first PR.

## Second pull request: repair the reproduced cause

The watcher cleared the fixture change at 14:19 on 18 November. Wait for
two idle connections to exercise pool shutdown, then select and terminate one
idle connection in the same PostgreSQL statement. Require one successful
termination, keep the exact worker exit check and check that no worker
connections remain. The binding test requires one selected connection.
The watcher cleared one cleanup label and the existing ten-second read helper
on 18 November at 14:44 to account for PostgreSQL finishing after worker exit.
Keep the existing stop behavior and exit deadline.

In the scratch Linux run, record which connections were idle and still present
before the signal, when the worker began closing and which connections were
gone by the next signal. Test whether the first termination starts shutdown
before PostgreSQL can signal the other selected connections. Keep this
detailed timing in the scratch run. A real PostgreSQL control must force
the observed ordering and fail at the original check before a repair.
Change the fixture or worker only where that evidence points. Bring any
change to an existing assertion to the watcher with its failing control.
Keep the exact exit check and its deadline. The cleanup read uses the
cleared wait. Never repeat the stop or the exit check. Write a
deviation to the watcher if the demonstrated repair needs to loosen the
termination check. If the cause stays open, take the retained evidence to
the watcher.

Run `node --test scripts/translation-disconnect-diagnostics.test.mjs`.
Use `node scripts/test-postgres.mjs exec` for the binding file and the exact
named case in `worker-cli.test.ts`. The diagnostics file owns encoding and
redaction. The binding file owns delivery from the real worker. GitHub runs the
selected suites. Expect 25–60 lines in the reporter and 60–110 in tests and test
support, plus any worker fix the evidence calls for. The finish line is a
retained failure, a reproduced cause and a passing regression for its repair.
