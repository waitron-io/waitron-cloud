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

The native fixture keeps SeaweedFS's automatic admin-port selection, even with
`-admin.ui=false`. Run
`node --test deploy/test-cloud/storage-admin-ports.test.mjs` to check occupied
HTTP, gRPC and both admin ports using private saved settings and the real pinned
binary. Each fallback leaves S3 usable without restarting the fixture. An explicit
occupied HTTP flag instead refuses startup; that unreserved port must not trigger
the service-port retry. Both paths remove their private directories and owned
children while preserving competing listeners. This distinction follows
[SeaweedFS's port selection](https://github.com/seaweedfs/seaweedfs/blob/4.47/weed/command/mini.go).
The separate gRPC fallback-exhaustion check also leaves S3 usable. HTTP fallback
exhaustion and a collision after availability checking remain unproved.
Reproduce either before changing reservations or widening retries.

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

A deterministic native regression recreates the original zero-argument TCP
probe and claims its port immediately after it closes. The unchanged S3 refusal assertion then fails with the
same direct socket-error shape, before either child starts. The identity server
now binds on port zero, letting the OS choose a port while keeping its socket
open. Discovery, the provider's issuer and key URL, and issued tokens all use
that bound port. This removes the demonstrated handoff race; it does not prove
which bind failed in the historical Linux run.

Run `node --test deploy/test-cloud/storage-s3-grpc.test.mjs` to check the claimed
probe-port regression, both-child exhaustion, disabled retries and successful
recovery. The original S3 assertions and one-retry limit remain unchanged. An
unexpected startup failure prints its original error and stack before the
assertion checks it. When a Node socket stack omits the calling bind, look for
`storage_listener_failure`: it identifies the identity listener or the numbered
storage bind attempt before the original failure propagates. A claim already held
by another process consumes an attempt even though its port is not accepted. Run
`node --test scripts/ci-backup-storage-issuer-bind.test.mjs scripts/ci-backup-storage-reservation-refusals.test.mjs`
to check real occupied sockets, stage markers and preserved cleanup even when
diagnostic output throws. The marker contains only fixed labels and a reservation
attempt number; it excludes configuration and keys. The historical failing bind remains
unidentified. The issuer and reservation refusal fixtures inject failures at the
actual bind and the first, fourth and eighth reservations, preserving their
original error-identity, cleanup and competing-listener assertions.

The [D548 merge run](https://github.com/waitron-io/waitron-cloud/actions/runs/41221742864/job/124597610947)
reports reservation three where the fourth actual bind was refused. Controlled
skipped-claim cases reproduce this mismatch on macOS and Linux. The diagnostic
now counts every bind attempt, including ports skipped after a claim collision.
The four added cases retain the existing error, cleanup, cache and competing-listener
checks, including a diagnostic sink that throws. The original CI peer or stale
claim was not observed, so its identity remains unknown. The separate portal job
budget failure in that run remains under [D530 investigation](ci-cache-saving.md#portal-shard-job-budget-d546-qualification).

The separate D458 port-probe error-handler change becomes unnecessary because
this repair removes that probe. Its separate runtime change is unnecessary;
the parked branch remains preserved. Local native checks need no containers; PostgreSQL and full Linux
qualification remain CI gates while Docker is unavailable.

The three malformed-certificate, malformed-key and mismatched-key cases require
zero TCP probes: TLS construction refuses the material before any child-port
reservation. The owner approved that count change; every TLS/key error, cleanup,
cache and competing-listener assertion remains unchanged.

## Concurrent storage archive publication (D450)

Run `node --test scripts/ci-backup-storage-concurrent-publication.test.mjs` to
check two native publishers and a cache reader in both completion orders. Partial
bytes stay outside the final path, readers see complete pinned bytes and cleanup
preserves the other publisher. Real extraction and concurrent store startup remain
separate gates; see [the open investigation](storage-cache-fixture.md).

## Concurrent storage extraction and failed-startup cleanup (D454)

Run `node --test scripts/ci-backup-storage-concurrent-extraction.test.mjs` to
check two fixtures extracting the same read-only archive into separate roots.
Certificate-read refusals finish in both orders; each cleanup must preserve the
other extracted tree, shared archive and unrelated files. Real store startup and
historical failure causes remain open; see [the investigation](storage-cache-fixture.md).

## Storage archive publication refusals (D449)

Run `node --test scripts/ci-backup-storage-publication.test.mjs` to check partial
writes, failed renames and preservation of a competing complete archive using
real checksum-verified bytes. Temporary publication files and failed startup roots
must be removed. Real extraction, store startup and concurrent successful publication
keep their separate qualification gates; historical failure causes remain open.

## Storage fixture filesystem refusals (D448)

Run `node --test scripts/ci-backup-storage-filesystem.test.mjs` to check native
allocation and cache permission or I/O refusals, preserved error identity and owned
cleanup. Real store startup and concurrent valid-cache publication remain separate
gates; see [the open storage investigation](storage-cache-fixture.md).

## Storage archive extraction command refusals (D453)

Run `node --test scripts/ci-backup-storage-tar-refusals.test.mjs` to check
real extraction failures in warm and cold private caches, plus unavailable tar.
Failed extraction preserves the command error and complete cached archive, removes
its private root and stops before certificate setup or listeners. Real store startup
and historical causes remain open; see [the investigation](storage-cache-fixture.md).

## Storage partial port-reservation refusals (D464)

Run `node --test scripts/ci-backup-storage-reservation-refusals.test.mjs` to
check occupied sockets at the first, fourth and eighth storage-port reservation.
Failed startup returns the original socket error, releases earlier reservations
and the identity server, and removes its extracted files and private key.
The complete cache and a competing listener remain usable. Real store startup
and historical failure causes retain their separate gates; see
[the storage investigation](storage-cache-fixture.md).

## Storage extraction and certificate setup refusals (D452)

Run `node --test scripts/ci-backup-storage-extraction.test.mjs` to check real
pinned archive extraction with warm and cold private caches, followed by failed
certificate generation or reading. Failed setup removes its extracted root and
preserves the verified archive and unrelated files. Store startup, concurrent
extraction and the historical failure causes retain their separate gates; see
[the storage investigation](storage-cache-fixture.md).

## Storage TLS material refusals (D455)

Run `node --test scripts/ci-backup-storage-tls-refusals.test.mjs` to check malformed
certificates, malformed private keys and mismatched pairs with real HTTPS construction.
Failed startup preserves the TLS error, removes its extracted files and private key,
and leaves cached input and a competing listener intact. Real store startup and
historical failure causes remain open; see [the investigation](storage-cache-fixture.md).

## Current browser and identity-port qualification (D499)

D499 reproduces the direct `EADDRINUSE` that can interrupt the S3 collision test
before either child starts: another listener takes the identity probe's released
port. Direct HTTPS allocation removes that race without adding retries. The S3
refusal assertions remain intact, and unexpected failures now retain their
original error and stack. Pre-child bind refusals now print their listener stage even when a Node stack
omits it; the historical CI bind remains unproved. Run `node --test deploy/test-cloud/storage-s3-grpc.test.mjs`
for the deterministic handoff regression and bound-identity configuration checks.
The three TLS-refusal modes require zero TCP probes after the owner-approved
count change; their TLS error, cleanup and competing-listener checks remain.

Browser qualification fetches Waitron `e8cfd38ed07bf546f14ad15334e54ee997114c75`,
which defers the first live stream until the dashboard screen can register its
subscriptions (Waitron PR #2269). Replay fixtures keep their original commit and
recorded measurements. Native checks cover separate pins and cleanup of combined
preparations. The generated browser backend includes the invoice font beside its
bundle and requests Waitron's supported preproduction allocation. Waitron generates
the signed evidence and checks operation authority; its fiscal implementation,
guards and expected results are unchanged. A native SQLite check starts that actual
bundle, verifies its committed generated allocation and exercises graceful shutdown
through the current management API. The combined-preparation check also verifies
that the runtime font reaches the browser fixture manifest. The sign-out journey
opens the account menu's explicit trigger: the current menu also contains hidden
theme buttons, so choosing its first descendant button times out. Native Chromium
reproduces that ordering with the pinned components and opens the menu with the
explicit trigger. The native backend path check also covers a `/tmp` parent,
which otherwise rewrites its own newly inserted input path on Linux. Signed-in
native requests reproduce missing theme and disk-stop routes as HTTP 404. The
fixture now mounts the pinned real handlers and includes the UI-core package
metadata and theme tokens beside its runtime. Browser-only exports and assets
leave historical replay inputs unchanged. The native check requires both routes
to return HTTP 200 after real sign-in; browser accounting checks stay intact. Run
`pnpm test:cloud-cost:conformance --only remote-browser-conformance.test.mjs`
for the native startup check and all seven browser journeys. The historical Linux
bind failure and original reconnect cause remain unproved.

## Cooperative native storage port ownership

Run `node --test scripts/ci-backup-storage-port-ownership.test.mjs` to check
port ownership across the socket-to-child handoff. Each fixture holds atomic
filesystem claims until its child stops. Other cooperating fixtures, including
separate processes with different temporary directories, skip those ports
while selecting their own batch. A paused native child makes the gap reproducible.
The checks retain usable storage, release after stop and bounded refusal after
256 claimed candidates without starting another child. Existing restart limits,
readiness budgets and error assertions remain.

Run `node --test scripts/ci-backup-storage-claim-cleanup.test.mjs` to check
missing or replaced claims and an unlink refusal. Cleanup checks link targets,
leaves replacement claims in place and finishes closing owned resources before
reporting an unlink failure. Startup retains its original error. The shared
directory must be a real directory owned by your user with no access for other
users; a permissive directory, symlink or different owner is refused.

The Linux investigation captured two live fixtures requesting the same port
before either exited. This identifies an allocation race; it does not identify
the historical competing processes. Claims prevent that reuse between these
fixtures. Other programs, native fallback choices and outgoing connections can
still compete for a port; those causes remain open. A killed driver can leave
claims under `/tmp/waitron-cloud-storage-ports-<uid>`; later fixtures skip them
rather than remove another process's state. Cleanup removes only claims this
fixture created.

## Separate-process storage extraction and failed-startup cleanup (D457)

Run `node --test scripts/ci-backup-storage-process-extraction.test.mjs` to
check two independent Node processes extracting one read-only archive. Each
certificate-read refusal removes its own root while preserving the other
process's executable, certificates and shared cache, in both completion orders.
The probes pause before listeners and store startup. An unexpected refusal retry
is caught by the existing 30-second test deadline; prompt refusal is unproved.
See [the storage qualification boundaries](storage-cache-fixture.md#concurrent-storage-extraction-and-failed-startup-cleanup-d454).
