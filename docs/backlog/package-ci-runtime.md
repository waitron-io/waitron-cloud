# Package CI runtime (D576)

Registration file allocation can put much more work in one job than another.
On the Linux test box, the unchanged five-partition layout at
`59cabe75407684fb9bdb72442afe921f20a8700f` passes 354 cases in partition 1 in
352.332 seconds and 305 cases in partition 4 in 185.491 seconds. The first is
1.90 times slower. These runs do not reproduce the historical cancellation.

The planner and final CI check now require six registration partitions.
Each partition keeps Node's dynamic `test/*.test.ts` discovery and the existing
30-second test deadline. The eight-minute job limit stays unchanged. Portable
checks run every current filename and a future filename exactly once through
Node, reject each missing partition and reject the old five-partition allocation.
Account HTTP and the other package allocations stay unchanged.

## Linux qualification

The six-partition trial uses the same registration tree, PostgreSQL launcher
and lockfile. Its first three partitions pass 199, 344 and 345 cases in
133.415, 228.054 and 214.297 seconds of test-runner time. Including the database
and mail fixture wrapper, they take 139.343, 233.864 and 221.602 seconds.
The remaining three partitions are still being measured. These partial results
are not full qualification or a claim that the runtime target is met.

From a complete-history checkout, run each partition with the original deadline:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=30000 --test-shard=1/6 'test/*.test.ts'
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

The [recorded account HTTP event](https://github.com/waitron-io/waitron-cloud/actions/runs/41859910075/job/126686634772)
is separate: runner setup takes about 402 seconds,
then image inspection reaches its 120-second limit before any package test runs.
Six registration partitions do not repair that event. Capture the slow operation
and runner timings if either historical failure recurs. Current-head CI and the
merge's own CI remain required before claiming a qualified landing.
