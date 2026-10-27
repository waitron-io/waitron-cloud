# CI job record publication

GitHub can report a successful package group
before its jobs list shows every partition as completed. The summary requires
every planned job exactly once and every required dependency group successful.
An `in_progress` record with no result can also prove its partition through
completed steps: successful setup and final `Complete job`, ordered unique
step numbers, and only successful or skipped intervening steps. This evidence
must name the current run, attempt and source commit. Earlier attempts can
supply completed successful records, but cannot supply unfinished step evidence.
Final failed, cancelled, timed-out, skipped or unknown jobs still fail.

Steps alone cannot prove success: the runner publishes its final step before
[uploads and job-result submission](https://github.com/actions/runner/blob/4c989f2f108bb6798e07ea5935bc8bc4aab7de2f/src/Runner.Worker/JobRunner.cs#L290).
Final successful dependency results cover failures after the steps finish.
Missing or duplicate partitions and unexpected executed jobs still fail.
Without sufficient evidence, the summary waits within its original 60 seconds,
polling every two seconds. Each API read has a ten-second limit, capped by
remaining time; timed-out reads retry inside that same allowance. Other lookup
errors fail immediately. A timed-out API process is forcibly stopped so ignoring
a termination request cannot extend its allowance. Each partition's step
evidence is reported once. Exhaustion names the pending jobs and last timeout;
the summary job retains its two-minute limit. Run
`node --test scripts/ci-summary.test.mjs scripts/ci-cli.test.mjs` to check the
command and refusal paths. Landing still requires every actual job record final.

Eight runs on 2026-10-22 include five failed summaries naming 32.8–41.6 KB
package logs; successful root jobs had roughly 371 KB logs. This does not
support log size as the cause. Run `39828383029` still had account HTTP shard
2/3 unfinished after its final step and a timed-out API read, despite successful
dependency results. The exact service-side cause remains unproved; the gate
now uses the independent final evidence rather than assuming a larger wait
will repair that record. Earlier failed runs remain failed.

