# CI PostgreSQL image pull

D104's documentation-only [run 39733028534](https://github.com/waitron-io/waitron-cloud/actions/runs/39733028534/job/119672295764)
failed before account HTTP shard 3 started its tests: Docker's request to
`auth.docker.io` timed out while pulling `postgres:18-alpine`. The recorded failure
is in the container-start path of `scripts/test-postgres.mjs`, before the owned
container is marked running.
This is separate from the reset-mail capture failure below. No runtime, test,
fixture, workflow or dependency change accompanied the incident, and the external
registry failure's cause remains unproved.

The test launcher now acquires both images before creating either container. It
uses cached images without registry access. For a missing image, it retries a
recognised connection failure with at most three attempts within each image's
120-second acquisition budget, including inspection and retry waits. A pull
killed at that deadline has no time left for another attempt. Access refusals and
other terminal errors stop immediately; a failed daemon inspection does not
become an image pull. Container starts disable implicit pulling and are never
retried. Package commands, assertions, readiness deadlines and owned cleanup retain
their existing behaviour. Run `node --test scripts/ci-test-postgres.test.mjs` for
the controlled launcher checks, including timeout termination, retry exhaustion,
Mailpit acquisition, command exit status and cleanup. These checks qualify local
failure handling; they do not prove Docker Hub availability or explain its outage.

The launcher also retries the exact `502 Bad Gateway` image response recorded
before any remote-conformance case in [D162's cost run
40039426881](https://github.com/waitron-io/waitron-cloud/actions/runs/40039426881/job/120707064606).
Both pinned images use the same existing three-attempt, 120-second acquisition
limits. Controlled launcher checks cover recovery, exhausted gateway responses
and immediate refusal of HTTP 401, 403, 404 and 429. Container creation, image
pins, cancellation and cleanup are unchanged. This handles the observed response;
the cause of Docker Hub's outage remains unknown. Real Docker qualification
continues in CI while local Docker is unavailable.

The controlled checks also cover both deadline boundaries around retry waits,
a pull client that ignores graceful termination, and every recognised connection
response. Deliberate faults must make the matching checks fail. An early injected
`ETIMEDOUT` separately qualifies retry classification; a real launcher timeout
still exhausts the unchanged per-image budget. Cancellation checks cover SIGINT
and SIGTERM during successful and hanging synchronous pulls and at a retry wait.
They check the exit status, prevent the package command from starting and require
cleanup of every created container. Cancellation during a synchronous pull is deferred
until that call returns, so containers can still be created before cleanup.
A pull killed at its deadline exits with the acquisition error, rather than the
cancellation status, before creating any container.
These fake-client checks leave one question open: whether stopping the client
also stops Docker's own registry transfer. Qualify that with a real daemon and a
controlled registry when local Docker is available; do not infer it from client
termination.

