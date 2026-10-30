# Verifier build qualification

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
is unchanged. Real container qualification runs in CI while local Docker remains
unavailable until 3 November. A native refusal control for a Docker-positive OOM report with a non-73 exit remains open in `packages/backups/test/container-resource-diagnostics.test.ts`; the review's omitted-flag experiment survives the current native suite.
