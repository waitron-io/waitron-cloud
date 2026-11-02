# Backup CI job budget (D563)

You can finish every backup assertion and still lose the job during cleanup.
[Run 41492546716, backup partition 2](https://github.com/waitron-io/waitron-cloud/actions/runs/41492546716/job/125439174573)
passes all 569 tests with no failures, cancellations or skips, then exceeds the
eight-minute job limit. Its test runner reports 464.65 seconds. The preceding
[main job](https://github.com/waitron-io/waitron-cloud/actions/runs/41487943678/job/125423279685)
takes 466 seconds for the whole job; two earlier main jobs take 334 and 316 seconds.

The two-job allocation puts the capture, catalogue and stream guard files in
the same job. Their cases take 220.26, 120.65 and 164.91 seconds in the cancelled
run. They overlap, so adding those durations does not give the job's elapsed
time. All three also pass on the preceding main revision. The cancelled
branch changes no backup files; its additional migration and runner contention
remain possible contributors, without a measured attribution.

Backup tests now use three partitions, with capture separated from catalogue
and stream. The planner and independent summary require all three jobs. Node's
own file discovery runs every current filename and an added future filename
exactly once in a controlled check. That check also catches concentrating all
three expensive files in one job. Existing behavioral assertions, file selectors,
test limits and the eight-minute job cap remain unchanged.

Run `node --test scripts/ci-backup-partition.test.mjs` to check allocation and
summary refusals. The generated bodies qualify discovery only. Actual package
CI must establish runtime, complete case counts and cleanup on the candidate
and its merge. This allocation does not identify the source of the historical
between-run slowdown or fix any backup product behavior.
