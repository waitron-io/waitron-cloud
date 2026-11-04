# Verifier build qualification

## Bound verifier fixture build timeout (D312)

The original CI failure remains unexplained. Its first bound-verifier case failed
after 125 seconds, but the cancelled job retained no build progress or error.
Other catalogue cases in that job also took eight to twelve times as long as
successful comparisons. Registry, image-pull, cache and runner contention causes
remain unproved. The diagnostics and cleanup delivered in
[PR539](https://github.com/waitron-io/waitron-cloud/pull/539) do not establish the cause.

On 4 November 2026, the current fixture on the shared Linux test box built in
945 ms with cached layers and 1,865 ms with `--no-cache`. Both runs retained plain
build progress and completed within the unchanged 120-second command limit.
The latter rebuilds fixture layers; it still uses the box's available Node base
image and does not test downloading that image onto an empty host. Both unique
image tags were removed and their absence checked. These runs do not reproduce
the historical runner or identify its cause.

Run `node --test --test-name-pattern='bound container returns exact child provenance only after confirmed cleanup' packages/backups/test/bound-container-verifier.test.ts`
on the test box to exercise image setup and the first real container case.
That command passed one case in 21.9 seconds. For separate build progress, use
`docker build --progress=plain --iidfile <private-file> -t <unique-tag> -f packages/backups/test/container-fixture/Bound.Dockerfile .`
under the same 120-second limit; remove only your tag and private files afterward.

Run `node --test packages/backups/test/bound-fixture-failure.test.ts` for the five
native diagnostic controls. They exercise the real suite hooks with Docker
replaced, including a timed-out child and hung cleanup. Build failures print
their command, elapsed time, failure reason and the last 8 KiB of output before
the test summary. Failed-build cleanup attempts only its unique tag, with a
one-second limit, and always removes temporary files.

Inspect the next recurrence's immediate build report before changing the fixture.
Keep the original verifier assertions, 120-second build limit, 150-second setup
limit and CI job limit. A passing reproduction or CI run does not close this item.

## Verifier source isolation from local edits (D445)

Your verifier build must use the pinned committed source even when its checkout
contains local edits or private files. Run
`node --test scripts/ci-verifier-source-isolation.test.mjs` to check staged and
unstaged tracked edits, ignored credentials, untracked venue data and a locally
replaced release generator. Native temporary Git fixtures capture the build
context through a command stub, preserve local inputs and remove private build
directories. These checks do not run Docker or build an image. Keep real image
qualification in CI and leave the historical image-build timeout investigation open.

## Verifier build refusal and cleanup controls (D443)

A refused build must leave no private build directory or successful image result.
Run `node --test scripts/ci-verifier-build-refusals.test.mjs` to check missing
build inputs, invalid or unavailable source commits, release-generation failure
and a refused build command. A successful command is the control. Each case
uses a private temporary Git repository and directory; the command stub records
the build boundary without contacting Docker or building an image. The checks
also verify the pinned revision reaches the release stamp and image label.

These native controls qualify refusal and cleanup paths. They do not explain
the earlier CI image-build timeout or establish that an image builds successfully.
Keep the real image and PostgreSQL qualification in CI while local Docker is
unavailable; the existing source pins, build limits and runtime rules remain.

## Container verifier memory-refusal observation (D335)

The memory-exhaustion check accepts Docker's positive OOM report or, when the
entry survives, requires a distinct child killed by SIGKILL and a fresh increase
in the container's cgroup `oom_kill` counter. Exit 73, SIGKILL, memory pressure,
old counts and missing or malformed evidence alone do not pass. Native controls
exercise both witnesses and reject those alternatives; deleting each guard makes
its control fail. The existing resource refusal, limits, isolation, cleanup and
later-snapshot checks remain.

Instrumented Linux CI observed entry PID 1 surviving a child kill and the cgroup
counter increasing from zero to one. Docker's flag was true there and false in
the saved D480 failure despite the same kill evidence. The flag-only test was the
wrong requirement; the Docker event-reporting difference remains unexplained.
The [kernel's cgroup documentation](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
defines `oom_kill` as killed processes in the cgroup. Resource reports still omit
raw child text and cannot turn a successful exit into a refusal. Production code
is unchanged.

Run `node --test packages/backups/test/container-resource-diagnostics.test.ts`
to check that Docker's positive out-of-memory report with exit 137 or 1 and no
entry report still produces `backup.verifier_resource`, retains the exit and Docker
flag, omits private child text and removes the container created for that check.
Removing the Docker flag from the resource-refusal condition makes these controls
fail; the original eight cases still pass without that guard. The second flagged
exit also rejects an incorrect exit-137 restriction. Recording both created and
removed names makes cleanup of another container fail. These checks preserve the
original cases' expected values. They do not explain the historical Docker
reporting difference. Use the authorised Linux test box for real container
reproduction; current-head CI owns package qualification.

The sibling `bound-container-verifier.ts` still needs isolated native qualification
of its Docker memory flag. The review's omission experiment was inconclusive
because the broader command also had Docker-dependent failures. Do not treat that
observation as a real-container or current-head CI result.
