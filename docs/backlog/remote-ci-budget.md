# Remote-access CI budget

Use 240 seconds as the target for each of the four remote-access jobs. Measure
from the job's `started_at` to `completed_at`, including checkout, dependency
setup and tests. Queue time is separate because changing the test allocation
cannot shorten GitHub's queue.

Before measuring, define an over-target result as the job name, exact commit,
run and attempt, elapsed seconds, excess above 240, and slowest steps. Check
GitHub's incident history for Actions, Git Operations, API Requests and Webhooks
during the entire run. Refuse performance evidence with an overlapping incident,
an HTTP 5xx download failure, or a checkout taking about ten seconds or more.
Expected HTTP errors inside passing application tests are not download failures.

## Baseline

[Main run 42206799763](https://github.com/waitron-io/waitron-cloud/actions/runs/42206799763),
attempt 1, checks commit `0ad60454248a862d3a02a6740f44d00f19f8dfd5`.
Its four remote jobs pass every selected test:

| Job | Whole job | Test step |
| --- | ---: | ---: |
| 1/4 | 113 s | 97 s |
| 2/4 | 263 s | 245 s |
| 3/4 | 181 s | 164 s |
| 4/4 | 92 s | 75 s |

The second job exceeds the target by 23 seconds. Its nine-omission venue guard
takes 93.337 seconds. The fourth job has room for that file, so the explicit
remote runner assigns it there. All other files keep Node's sorted round-robin
allocation, including newly discovered tests. The runner keeps the 30-second
default and each test's existing explicit deadline. An invalid or empty
partition fails before Node can discover unrelated tests.

The saved official incident history has no relevant incident overlapping this
run; the latest prior relevant incident resolved at 00:20:49 UTC on 6 November
2026. The slowest checkout is four seconds. The complete saved logs show no
HTTP 5xx download failure. These qualifications apply to this baseline only.

## Remaining qualification

Measure all four jobs on the candidate's exact current head, using the same
health checks and whole-job definition. Record each job's link, run attempt,
checkout and test count in the pull request. Keep this entry open if any job
exceeds 240 seconds or the run cannot qualify. A timing estimate from the moved
test is not an observed improvement.

The guard wrapper's separate intermittent timeout investigation stays with
D530. Moving its file does not repair that cause. D463's collector and billing
work are separate from this allocation and measurement.
