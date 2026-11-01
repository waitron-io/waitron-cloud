# Snapshot catalogue guard runtime (D530)

The catalogue guard wrapper ran fourteen checks in sequence. Each check starts
three fresh Node processes: a passing baseline, a failing omitted guard and a
passing restoration. Repeated CI runs exceeded its three-minute limit even
though the final check finished shortly afterward.

The latest occurrence is [run 41345125493](https://github.com/waitron-io/waitron-cloud/actions/runs/41345125493),
job 124963278985. Thirteen guard markers precede the 180,004.6 ms timeout;
the fourteenth arrives about 310 ms later. Earlier occurrences include
run 41209487824 and D462 head `3c897dc9`. A later passing run does not repair
that timeout.

## Two independent batches

The wrapper now divides the existing cases between two disposable checkouts.
Each batch changes only its own catalogue file and keeps its baseline, omission
and restoration in sequence. Both batches settle before cleanup, including when
one fails. A final check requires every original guard name exactly once, so a
missing or repeated batch refuses qualification. If both batches fail, their
errors remain visible. A native control forces both setup failures before any
database work and requires both errors in the test report. Every original assertion, mutation target, expected failure, child
process limit and the 180-second wrapper limit remains.

On the authorised Linux test box, the unchanged serial wrapper took 140.95
seconds; a comparison with Node's compilation cache took 133.59 seconds. The
cache is not enabled by this change. Two batches without that cache took 77.14
seconds. Each run detected all fourteen independent omissions without skips.
These are isolated wrapper measurements, not guarantees about a busy CI runner.
The historical failing branch also had an additional unlanded migration; its
catalogue implementation, behavioural tests and guard wrapper match the main
branch used for these comparisons.

To run the complete wrapper against disposable PostgreSQL:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/venue-service-catalogue-guards.test.ts
```

Keep checking the complete package job on the exact PR head. More migrations,
other fixture work and runner variability can still consume the remaining
margin; investigate a new timeout rather than increasing limits or removing
checks. Production catalogue behaviour is unchanged.
