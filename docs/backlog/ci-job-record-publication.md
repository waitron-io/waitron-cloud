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
polling every two seconds. An API read starts with a ten-second budget. A timed-out
read doubles the next budget, capped by the remaining total allowance; a successful
read resets it to ten seconds. This lets a slow healthy response finish instead of
repeatedly stopping it at ten seconds. Other lookup
errors fail immediately. A timed-out API process is forcibly stopped so ignoring
a termination request cannot extend its allowance. Each partition's step
evidence is reported once. Exhaustion names the pending jobs and last timeout;
the summary job retains its two-minute limit. Run
`node --test scripts/ci-summary.test.mjs scripts/ci-cli.test.mjs` to check the
command and refusal paths. Landing still requires every actual job record final.

When that wait expires, you also see `last observed unmet step evidence` for
each unresolved planned job. Fixed labels identify invalid current run identity,
job status or result, a different run, attempt or source commit, missing steps,
unsuccessful setup or final cleanup, and invalid step names, completion, results
or number order. For example, `[run attempt]` means that the last record could
not supply step evidence for the current attempt. The diagnostic uses the last
successful read, including when a later read times out; it cannot explain changes
GitHub has not published. It excludes arbitrary step names and API field values.
These explanations preserve the acceptance checks and overall time limits.

## Slow job lookups (D573)

The former fixed ten-second read limit rejects a controlled eleven-second response
on every attempt, even when that response contains all required successful jobs.
The regression checks reproduce that refusal, then accept the same evidence in
23 seconds with the growing read budget. A real child-process probe takes 23.1
seconds, kills the first timed-out process and accepts the second response.
Persistent timeouts still exhaust the original minute; a recovered read containing
a failed shard still fails. Every original summary assertion remains.

Each timed-out lookup now reports its attempt, elapsed time, requested budget and
remaining total time. Earlier CI logs record only the final timeout and last
lookup error, so individual historical request durations and retry spacing cannot
be recovered from them. The controlled timing tests establish the local budget
defect; they do not establish GitHub's service-side cause or guarantee recovery
during an outage. Keep historical failed runs and landing's final-job requirement.

Eight runs on 2026-10-22 include five failed summaries naming 32.8–41.6 KB
package logs; successful root jobs had roughly 371 KB logs. This does not
support log size as the cause. Run `39828383029` still had account HTTP shard
2/3 unfinished after its final step and a timed-out API read, despite successful
dependency results. The exact service-side cause remains unproved; the gate
now uses the independent final evidence rather than assuming a larger wait
will repair that record. Earlier failed runs remain failed.

