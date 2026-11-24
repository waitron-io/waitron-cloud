# Registration CI runtime

## Allocate work by elapsed file time

The seven registration jobs share files using elapsed-time weights in
[`ci-registration-durations.json`](../../scripts/ci-registration-durations.json).
The runner puts the longest remaining file into the job with the least assigned
work. Filename order and then job number settle ties. New files use the mean of
the weighted files still present; removed files affect neither discovery nor that
mean. Discovery owns the file list, so every current test still runs once.

The weights are allocation estimates (one Debian measurement plus a one-time hosted calibration),
not predicted job durations; a fresh measurement replaces them. The watcher cleared seven jobs on
15 November at 10:06 with the same weights and packing, after six-job samples reached 307 seconds.
That qualified one observation and enforces nothing on later runs. The remaining run-to-run spread
is unexplained.

To refresh the table, time each explicit file from process start until exit,
including imports, fixtures and cleanup. Keep the same Node arguments as the
runner; record available CPUs and the number of concurrent invocations. Retain
complete Git history for release tests and prepare their pinned dependencies.
Use only passing files with complete case counts, write sorted basename keys
and elapsed milliseconds, then run the portable allocation checks:

```sh
node --test scripts/ci-registration-shards.test.mjs scripts/ci-package-allocation.test.mjs
```

The case reporter prints `# File duration:` JSON comments for each Node file
summary; their `packages/registration/test/` basenames can key a future table, but they
omit module loading. File workers
also overlap and share runner resources, so their durations depend on contention
and their sum is not job wall time. Every complete hosted job must still pass
within 300 seconds.

Calibrate any alternate reporter first with a known module-level delay and a
known test delay. Node 26.13.0's per-file summary omitted the module delay in the
local control: it reported 508 milliseconds for 750 milliseconds of deliberate
delays, while process elapsed time exceeded 750 milliseconds.

Aim for about four minutes per registration job and require every exact-head
job within 300 seconds before qualifying an allocation. Read each job's elapsed
time and complete case count. The eight-minute job cap stays unchanged; timing
predictions do not qualify a pull request or its merge.

## What remains unexplained

The [original registration job](https://github.com/waitron-io/waitron-cloud/actions/runs/41825684230/job/126588741665)
kept passing reminder cases every 11 to 15 seconds
before its eight-minute cancellation. Current Linux controls do not reproduce
that slowdown. A memory-backed database control takes 47.124 seconds versus
48.600 seconds for the unchanged narrow control, so it does not justify changing
the launcher. SQL measurements put the time in schema removal and migrations;
1,008 migration-file reads take only 0.169 seconds. Nested measurements overlap.
Keep the database launcher, migration behavior, assertions and deadlines intact.

The run-it review observed both the original and new Node commands still running
after 42 seconds when a test retained a live timer. The 30-second test deadline
does not establish process termination in that case; the existing eight-minute
job cap remains the outer limit. Measured allocation does not change that behavior.

The [recorded account HTTP event](https://github.com/waitron-io/waitron-cloud/actions/runs/41859910075/job/126686634772)
is separate: runner setup takes about 402 seconds,
then image inspection reaches its 120-second limit before any package test runs.
Six registration partitions do not repair that event. Capture the slow operation
and runner timings if either historical failure recurs. Current-head CI and the
merge's own CI remain required before claiming a qualified landing.

## Other fixture causes still unknown

Keep the reproduced mechanisms separate from the historical runs, which did not
capture the timing or state needed to attribute their failures:

- Relay capacity's exact host delay; the worker fixture still holds all four SMTP
  deliveries until competing claims finish.
- The local usage-privacy false alarm's identifier, and pairing membership/session
  expiry scheduling; retain the owned-identifier and actual-blocker evidence.
- Portal's first authenticator sign-in response and consumed periods, HTTP and
  registration replay periods, registration enrolment activation, server startup
  timing and one-second relay admission window timestamps.
- Local PostgreSQL `53200` capacity under unsplit schema migration work, and the
  exact handles behind the relay-control and relay-operator-stop process holds.
  The two-file command and failed-setup cleanup do not identify those handles.
- The passive audit-read fixture does not cover delayed activity updates or
  absolute session-expiry changes; its clock-default repair did not add that coverage.

On recurrence, retain the named case, response, verifier/consumed periods,
observed database blocker or open-handle evidence before changing a fixture.
Other pairing expiry fixtures' generic lock waits do not prove membership-lock
waits. Do not change authority, privacy, replay, rollback or deadline assertions.
