# CI dependency-cache saving

## Dependency-cache save stalls (D507)

Cost conformance, the password diagnostic, the shared UI build and the browser
reconnect diagnostic use a stable pnpm store path across runners, restore it
separately and limit optional cache saves to
one minute after successful mandatory steps. A save timeout stays visible without changing the test
result. Keep saving last so the runner promptly cleans up its child processes. The
password diagnostic retains its password snapshot, deliberate-fault and artifact checks.
The UI build keeps its source-lockfile cache key, package checks, publication dry run
and artifacts; actual publishing still requires its separate manual invocation.
The reconnect diagnostic preserves both CPU groups, first-refusal sampling,
deliberate-fault controls and diagnostic artifacts.

**Open.** Attribute the historical upload stall; the controlled archive-creation stall
proves the save deadline, not that transport cause. The other five setup-node cache
consumers retain their existing behaviour and need separate qualification before changing.

## Portal shard job budget (D546 qualification)

**Open.** Keep the portal shard's mandatory work and final cleanup within the
existing eight-minute job budget, without weakening its assertions or test
deadlines. Lane H's D530 investigation owns the follow-up.

[PR805's initial qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/41212399965/job/124570013509)
passes all 2,463 portal shard 3 tests, then exhausts the overall job limit during
the setup-node cache upload. GitHub's annotation explicitly reports the eight-minute
limit. The test runner takes 420.6 seconds; the enclosing test step takes
434 seconds. The cache upload runs for about two seconds before cancellation,
so this log does not establish an upload stall.

Four recent successful runs of the same shard report test-runner durations of
306.3, 394.0, 337.3 and 324.3 seconds. None of the previous cancelled runs among
the latest eighty CI runs has the same portal-shard job-limit annotation. The
initial qualification changes only Markdown, and all 17,223 tests pass across
its jobs. These observations establish a job-budget failure, not the cause of
the slower runtime or a recurring cache failure. Capture phase timings and
qualify a smaller work partition or separately bounded optional cleanup; retain
the job limit, test deadlines and every original assertion. A later green run
qualifies unrelated documentation and does not repair this budget issue.
