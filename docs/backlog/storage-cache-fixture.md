# Parallel storage-cache fixture failure on main

Main [run 39943355021](https://github.com/waitron-io/waitron-cloud/actions/runs/39943355021)
rejected one of two fixtures in `deploy/test-cloud/storage-cache.test.mjs`.
The test now prints each rejected error and its socket diagnostics before stopping
the successful fixture. The read-only archive and two-success checks are unchanged.
The original rejection had no error detail, so its exact cause remains unknown.

A separate native Linux investigation reproduced a readiness failure in
[run 39945355111](https://github.com/waitron-io/waitron-cloud/actions/runs/39945355111).
With sixteen concurrent fixtures, a bucket creation can succeed after the caller
stops waiting for its reply. Every subsequent creation then returns
`BucketAlreadyOwnedByYou`, and the old readiness loop eventually refuses a working
store. Socket evidence identifies each store as the owner of all seven allocated
ports; this reproduced failure is not an observed port collision.

The fixture now checks that the owned readiness bucket is accessible before
accepting that response. Other errors still retry within the existing limits;
a failed accessibility check still blocks startup. A deterministic real-store test
discards a successful creation reply and verifies recovery, and a second test
checks refusal when access fails. Existing assertions and deadlines remain intact.
All sixteen focused native cache/startup cases pass, along with the four
adjacent storage-authority cases. Local Docker and PostgreSQL checks
stay unavailable until 3 November; qualification uses GitHub CI.

The next Linux qualification at readiness-only head `59e1749` exposed a second
failure: SeaweedFS refused its assigned filer port after Node released the
reservation. No listener was present when the later socket snapshot ran; the
competing socket's owner remains unknown. The fixture now retries that explicit
child port-allocation refusal once with a fresh directory and seven new
reservations, after cleaning up its failed child. It prints the first failure's
evidence, stops after a second collision, and never stops a competing listener.
The same handoff can fail after SeaweedFS's initial port check; Linux combined
[run 39946986371](https://github.com/waitron-io/waitron-cloud/actions/runs/39946986371)
records a volume listener's bind refusal. Both observed forms qualify only when
the reported port belongs to the fixture's seven-port allocation. An unrelated
child exit or an unallocated port does not qualify. Deterministic child tests
prove recovery, both refusal forms and the two-attempt limit. The existing first-failure diagnostic
test explicitly disables retries while retaining all its assertions.

The combined repair passes all nine independent dense Linux samples in
[run 39947812288](https://github.com/waitron-io/waitron-cloud/actions/runs/39947812288):
126 checks across three runners, including sixteen simultaneous fixtures per
sample. The temporary stress workflow and case are removed after qualification;
the deterministic regressions remain. A 479-second Claude run-it review identified
three low-severity gaps, now covered: thrown values without a message preserve
their identity, a port-shaped upstream error does not impersonate a child exit,
and a controlled cleanup barrier must finish before the retry creates its next
directory. Ten deliberate guard faults were caught
in a disposable checkout and the original files restored before the final checks.

A later rejection in [run 40106355179](https://github.com/waitron-io/waitron-cloud/actions/runs/40106355179)
identifies an unreserved S3 gRPC listener: HTTP port 35547 derives port 45547,
which is absent from the seven-port allocation. SeaweedFS 4.47 derives a separate internal service port
when no explicit S3 gRPC port is supplied. The fixture now reserves an eighth
port and supplies `-s3.port.grpc`, so its existing allocation diagnostics and
single retry also cover that listener. Deterministic child tests reproduce the
observed S3 bind-refusal message after a real occupied-socket error, then check
recovery, refusal after two failures, and disabled retries. Competing listeners
remain open. The complete-allocation and diagnostic-count checks now require
eight ports; their other assertions and all deadlines remain unchanged.

Qualification: all nine dense Linux samples in
[run 40110095865](https://github.com/waitron-io/waitron-cloud/actions/runs/40110095865)
start and stop sixteen concurrent stores, then pass the cache and S3 collision
checks. The temporary stress workflow is removed after that run. Three deliberate
allocation faults fail the new tests; restored controls pass. The collision probe
waits for its competing listener before binding, including a controlled delayed
listener. The unchanged bounded retry still refuses unknown ports and other exits.

The run-it review also observes two unreserved admin listeners per native store,
even with `-admin.ui=false`. Sixteen concurrent native stores succeed using their
fallback allocation. An admin bind refusal and its effect on startup remain
unproved. Follow-up: reproduce that failure and qualify explicit admin-port
reservations if needed; do not widen the S3 repair's retry to unknown ports.

Remaining: retain the diagnostics to attribute any recurrence of the original
read-only-cache rejection. Do not treat this demonstrated readiness repair as
proof of that historical failure's cause.

## Existing storage-cache refusal qualification (D442)

An invalid existing archive must fail before extraction or download, so a fixture
cannot silently replace evidence of cache corruption. Run
`node --test scripts/ci-backup-storage-cache.test.mjs` for isolated native checks
of corrupt and empty archives, cache read errors and a blocked cache directory.
Each failed startup preserves its cache input and removes its private directory.
These checks leave the historical cache/startup causes open; real store startup
and concurrent valid-cache publication remain separate qualification gates.

## Storage archive download failure reporting (D441)

A Test Cloud plan-enforcement check failed in run40775240637, job123122878210,
with an interrupted HTTP/2 response (`UND_ERR_RES_CONTENT_LENGTH_MISMATCH`).
The retained stack does not identify the request, so its cause remains unknown.
The SeaweedFS fixture now labels archive download failures by phase: awaiting
headers, refusing an HTTP status or reading the body. Its error includes the
public release URL and available status, and retains the original error as its
cause. The diagnostic does not copy the signed redirect URL.

Run `node --test scripts/ci-backup-storage-download.test.mjs` for isolated
cold-cache controls, including a genuinely truncated local HTTP response. Failed
startup removes its private directory and publishes no archive; a complete
archive with the wrong digest remains refused. The fixture still makes exactly one download attempt; archive pins,
cache publication and permission checks are unchanged. These controls qualify
reporting, not the historical Linux failure. Capture an instrumented recurrence
before changing transport or startup behavior; the full PostgreSQL and storage
journey still belongs to CI while local Docker is unavailable.

## Identity-port allocation race (D499)

[Run 40990548896](https://github.com/waitron-io/waitron-cloud/actions/runs/40990548896),
job 123851705352, failed the two-collision S3 test with a direct Node
`EADDRINUSE` on port 40719. Its assertion replaced the original stack, so the
historical failing bind cannot be identified from that log.

A deterministic native regression claims the identity probe's port immediately
after the probe closes. The unchanged S3 refusal assertion then fails with the
same direct socket-error shape, before either child starts. The identity server
now binds on port zero, letting the OS choose a port while keeping its socket
open. Discovery, the provider's issuer and key URL, and issued tokens all use
that bound port. This removes the demonstrated handoff race; it does not prove
which bind failed in the historical Linux run.

Run `node --test deploy/test-cloud/storage-s3-grpc.test.mjs` to check the claimed
probe-port regression, both-child exhaustion, disabled retries and successful
recovery. The original S3 assertions and one-retry limit remain unchanged. An
unexpected startup failure now prints its original stack before the assertion
checks it. The issuer and reservation refusal fixtures inject failures at the
actual bind and the first, fourth and eighth reservations, preserving their
original error-identity, cleanup and competing-listener assertions.

The separate D458 port-probe error-handler change becomes unnecessary because
this repair removes that probe. Its parked branch is preserved until delivery
is verified. Local native checks need no containers; PostgreSQL and full Linux
qualification remain CI gates while Docker is unavailable.
