# Package CI runtime (D576)

Registration file allocation can put much more work in one job than another.
On the Linux test box, the unchanged five-partition layout at
`59cabe75407684fb9bdb72442afe921f20a8700f` passes 354 cases in partition 1 in
352.332 seconds and 305 cases in partition 4 in 185.491 seconds. The first is
1.90 times slower. These runs do not reproduce the historical cancellation.

The planner and final CI check now require six registration partitions.
Each partition discovers current `.test.ts` filenames in the test directory and
gives Node an explicit file list with the existing 30-second test deadline.
The eight-minute job limit stays unchanged. Portable
checks run every current filename and a future filename exactly once through
Node, reject each missing partition and reject the old five-partition allocation.
Account HTTP and the other package allocations stay unchanged.

## Linux qualification

The count-only six-partition control uses the same registration tree, PostgreSQL
launcher and lockfile. All 1,684 cases pass without failures, cancellations or
skips. The observer records every one of the 139 test files exactly once.

| Partition | Cases | Test runner seconds | Whole wrapper seconds |
| --- | ---: | ---: | ---: |
| 1 | 199 | 133.415 | 139.343 |
| 2 | 344 | 228.054 | 233.864 |
| 3 | 345 | 214.297 | 221.602 |
| 4 | 264 | 174.554 | 180.899 |
| 5 | 347 | 287.421 | 293.499 |
| 6 | 185 | 239.193 | 245.136 |

The slowest wrapper takes 293.499 seconds, so adding a partition alone does not
meet the four-minute target. Earlier six-partition layouts also failed to
establish a runtime saving; their historical observations remain in the
[CI execution budget](../backlog.md). More partitions alone are not qualification.

The runner now moves `monitoring.test.ts` and
`venue-service-legacy-schema-guards.test.ts` to partition 1, and
`support-grants.test.ts` to partition 2. Other files keep the sorted round-robin
assignment. The balanced Linux trial at
`936ebc8a9dbe6fc74e66c1edc1c5b75809ad738a` uses the same package source, lockfile
and PostgreSQL launcher as the control. All 1,684 cases pass without failures,
cancellations or skips, and all 139 test files run exactly once.

| Partition | Cases | Test runner seconds | Whole wrapper seconds |
| --- | ---: | ---: | ---: |
| 1 | 243 | 213.796 | 220.289 |
| 2 | 361 | 228.112 | 234.678 |
| 3 | 345 | 216.644 | 223.401 |
| 4 | 264 | 173.768 | 179.526 |
| 5 | 287 | 225.737 | 231.272 |
| 6 | 184 | 177.336 | 183.745 |

The slowest wrapper falls from 293.499 to 234.678 seconds, a 20.0 percent
reduction. Every group finishes within four minutes. These groups run one after
another on the Linux test box; this does not establish concurrent hosted-job
timing or explain the historical cancellation. The earlier scheduling model's
approximately 230-second prediction was an estimate; the measured slowest test
runner takes 228.112 seconds.

The portable runner checks preserve all-file discovery, reject invalid and empty
partitions, forward test failures and keep the same Node test-process identity.
They exclude non-test files and nested fixtures, compare every unmoved file with
Node's original partition, and execute both file and directory symlink commands.

Aim for about four minutes per registration job, and require each exact-head job
to finish within 300 seconds. The workflow's eight-minute cap stays unchanged.
Use complete case counts and observed job wall times; rounded-minute budgets no
longer gate this work. Current-head CI and the merge's own CI are still required.

From a complete-history checkout, run each partition with the original deadline:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node ../../scripts/ci-run-registration-shard.mjs 1
```

Run partitions 2 through 6 too. The campaign's Linux box wrapper supplies the
container-capable host. Its snapshot must include the pinned historical Git
objects before the release-upgrade tests run.

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
job cap remains the outer limit. This branch does not change that behavior.

The [recorded account HTTP event](https://github.com/waitron-io/waitron-cloud/actions/runs/41859910075/job/126686634772)
is separate: runner setup takes about 402 seconds,
then image inspection reaches its 120-second limit before any package test runs.
Six registration partitions do not repair that event. Capture the slow operation
and runner timings if either historical failure recurs. Current-head CI and the
merge's own CI remain required before claiming a qualified landing.
