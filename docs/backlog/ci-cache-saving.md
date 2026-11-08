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

The root checks, type checking, receipt suites, package matrix, relay-counter
diagnostic and venue-service proofs use the same separate restore and final save.
These are six job definitions, including the venue proof added after the earlier
five-consumer inventory. Their mandatory steps, permissions, matrices, artifacts,
assertions and eight-minute job limits remain unchanged. The relay diagnostic
still checks its baseline, four deliberate faults and restored PostgreSQL case.
The venue proof runs its current venue receipt and records runner capacity; the
retired pre-venue receipt no longer consumes a matrix job.

Each job selects the stable store before installation. A cache hit skips saving;
a miss can save only after successful mandatory work. A failed optional save stays
visible without changing a successful test result. The save runs last because
final runner cleanup collects action children; its one-minute step limit does not
promise immediate child termination. The eight-minute job limit still includes
setup, tests and cleanup, so a successful test suite alone cannot qualify a job
that exhausts that limit.

The repair landed in [PR767](https://github.com/waitron-io/waitron-cloud/pull/767)
and [PR920](https://github.com/waitron-io/waitron-cloud/pull/920).
Before interpreting a slow job, distinguish its two deadlines. The
[final-save control](https://github.com/waitron-io/waitron-cloud/actions/runs/41048548222)
prints `The action 'Save pnpm dependency cache' has timed out after 1 minutes.`
and still completes its mandatory-success job successfully. Its deliberate
exit-37 test fails and skips saving. Final runner cleanup collects the blocked
archive children; the step timeout alone does not promise immediate collection.
An overall timeout instead reports `The job has exceeded the maximum execution
time of 8m0s`, as in
[the portal failure](https://github.com/waitron-io/waitron-cloud/actions/runs/41232242922/job/124628742328).
That job is cancelled even when all its tests passed.

### Healthy-run timing sample, 6 November 2026

You can compare the phases below because the
[GitHub incident history](https://www.githubstatus.com/api/v2/incidents.json)
has no incident overlapping these seven runs. All 73 executing job logs were
read: checkout steps take at most four seconds, and no actual download reports
HTTP 5xx. Passing tests whose names contain simulated HTTP errors are excluded
from that download check. These are observations at the linked revisions,
not a before-and-after speed comparison or a guarantee about later runs.

The table covers 67 cache-consuming jobs and all ten job definitions. Each row
shows the slowest sampled allocation in that definition, with every duration
in seconds. Setup runs from job start through dependency installation; for the
UI build it stops before the first release test. Mandatory work includes tests,
remaining installation, builds and artifact uploads. Cleanup runs from the save
step's end through the recorded job completion, including runner bookkeeping.
Queued time is excluded. Each row's four phases add to its total.

| Definition and slowest sampled job | Jobs sampled | Setup | Mandatory work | Save | Cleanup | Total / limit | Cache path in that job |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| [Root, partition 6/8](https://github.com/waitron-io/waitron-cloud/actions/runs/42187779137/job/127792286156) | 8 | 17 | 322 | 0 | 5 | 344 / 480 | Hit; save skipped |
| [Type checking](https://github.com/waitron-io/waitron-cloud/actions/runs/42187779137/job/127792285929) | 1 | 15 | 7 | 0 | 2 | 24 / 480 | Hit; save skipped |
| [Receipts](https://github.com/waitron-io/waitron-cloud/actions/runs/42187779137/job/127792285907) | 1 | 14 | 256 | 0 | 3 | 273 / 480 | Hit; save skipped |
| [Packages, registration partition 1/6](https://github.com/waitron-io/waitron-cloud/actions/runs/42187779137/job/127792286632) | 29 | 16 | 427 | 0 | 2 | 445 / 480 | Hit; save skipped |
| [Cost, isolated replay partition 2/3](https://github.com/waitron-io/waitron-cloud/actions/runs/42185016066/job/127783282672) | 21 | 17 | 266 | 0 | 4 | 287 / 480 | Hit; save skipped |
| [Password diagnostic](https://github.com/waitron-io/waitron-cloud/actions/runs/42165036422/job/127719408738) | 1 | 16 | 45 | 0 | 3 | 64 / 360 | Hit; save skipped |
| [UI build](https://github.com/waitron-io/waitron-cloud/actions/runs/42185016191/job/127783185238) | 1 | 15 | 41 | 4 | 4 | 64 / 600 | Miss; save succeeds |
| [Browser diagnostic, one CPU](https://github.com/waitron-io/waitron-cloud/actions/runs/41842285595/job/126616705657) | 2 | 13 | 347 | 1 | 3 | 364 / 720 | Miss; save succeeds |
| [Relay-counter diagnostic](https://github.com/waitron-io/waitron-cloud/actions/runs/41842286340/job/126616709523) | 1 | 14 | 25 | 3 | 4 | 46 / 480 | Miss; save succeeds |
| [Venue proof, venue group](https://github.com/waitron-io/waitron-cloud/actions/runs/42185016065/job/127783301023) | 2 | 15 | 234 | 0 | 3 | 252 / 480 | Hit; save skipped |

Every sampled job finishes within its own limit. The registration allocation
has only 35 seconds left with saving skipped. That is less than the optional
save's 60-second allowance, so this sample cannot establish that the same work
plus a stalled save would finish in time. A successful cache hit does not
qualify that miss path. The UI observation covers the pinned source build and
publication dry run; the separate registry-publishing job is skipped.

### Historical upload transport cause (D507)

**Open.** The
[original cost job](https://github.com/waitron-io/waitron-cloud/actions/runs/41041958752/job/124016759662)
passes its conformance step, then repeats 262,144 of 29,037,789 uploaded bytes
across 301 progress records from 10:37:41 to 10:42:42 UTC on 30 October.
Its retained log ends with cancellation and supplies no transport failure
reason. The controlled archive-creation stall above proves the deadline and
cleanup behavior, not why this upload stopped. Do not assign a network,
GitHub or archive cause without new evidence. If it recurs, retain the complete
save log and runner diagnostics before cancellation; a later pass is not a fix.

### Cache-miss job budget qualification (D507)

**Open.** Retain healthy cache-miss timings for the root, type-check, receipt,
package, cost, password and venue definitions; their sampled saves are skipped.
Keep the observed UI, browser and relay misses and the deliberate-stall and
mandatory-failure controls above. Compare setup, mandatory work, save and final
cleanup with each job's existing limit, especially registration partition 1/6.
Any proposed limit, matrix or check change needs a separate owner decision.
These successful samples do not establish that every future job fits its cap.

All ten store-location steps preserve a failed pnpm lookup's exit status and
refuse an empty path before publishing cache inputs. Native shell controls run
the actual configured steps with failed, empty and successful lookups, including
paths containing spaces. Run `node --test scripts/ci-cache-location.test.mjs`.
The controls cover the six new cache consumers and the four earlier bounded-cache
workflows, with every existing mandatory step and publication gate preserved.

Keep two native harness observations separate from the cache transport cause.
During review, `ci-setup-pnpm.test.mjs` reports two descendant-test attempts
instead of three on both the candidate and its base. The unavailable-mirror
case in `ci-download.test.mjs` reports two commands instead of one in the wider
run. Later isolated checks pass without changing either source. Their causes
remain unknown; retain the original assertions and investigate these scheduling
observations under D530 before changing their limits.

## Portal shard job budget (D546 qualification)

Portal work uses six file partitions so each job has less mandatory work
before its final cleanup. The planner and independent summary policy require
all six; missing, duplicated or obsolete three-partition allocations refuse
qualification. Every portal assertion, the 120-second case deadline, the build
and the eight-minute job cap stay unchanged. A Node subprocess check exercises
every current filename plus one future filename and requires each to execute
exactly once, with nonempty partitions and no overlapping fixture bodies.

[PR805's initial qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/41212399965/job/124570013509)
passes all 2,463 portal shard 3 tests, then exhausts the overall job limit during
the setup-node cache upload. GitHub's annotation explicitly reports the eight-minute
limit. The test runner takes 420.6 seconds; the enclosing test step takes
434 seconds. The cache upload runs for about two seconds before cancellation,
so this log does not establish an upload stall.

Four recent successful runs of the same shard report test-runner durations of
306.3, 394.0, 337.3 and 324.3 seconds. At the initial investigation, none of
the previous cancelled runs among the latest eighty CI runs had the same
portal-shard job-limit annotation. The
initial qualification changes only Markdown, and all 17,223 tests pass across
its jobs. These observations establish a job-budget failure, not the cause of
the slower runtime or a recurring cache failure. The same job limit later
cancels D548 and
[PR816’s first merge run](https://github.com/waitron-io/waitron-cloud/actions/runs/41232242922/job/124628742328).
That run passes all 2,463 cases: setup takes 69 seconds, including 49 seconds
for Chromium; the test runner takes 408.865 seconds and its enclosing step
takes 422 seconds. The combined mandatory work exhausts the limit even when
all cases pass. The subsequent clean retry qualifies the unrelated image
acquisition change and does not repair this budget issue.

**Open.** Runtime variance and the historical cache-upload stall remain
unexplained. Compare setup, test and cleanup timings on each six-partition
candidate and its independent merge before claiming the five-minute job target.
The partition change reduces work per job; it does not guarantee that all
future jobs finish within the cap or attribute the original slowdown.
