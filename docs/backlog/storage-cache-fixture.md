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

Run `node --test scripts/ci-backup-storage-options.test.mjs` to check token-duration
formats before temporary allocation or archive download. These configuration
controls do not qualify real token issuance or expiry; keep those checks separate
from store startup and concurrent valid-cache publication.

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

Run `node --test --test-concurrency=1 --test-timeout=30000 scripts/ci-backup-storage-download.test.mjs`
for isolated cold-cache controls, including a genuinely truncated local HTTP response. Failed
startup removes its private directory and publishes no archive; a complete
archive with the wrong digest remains refused. The fixture still makes exactly one download attempt; archive pins,
cache publication and permission checks are unchanged. These controls qualify
reporting, not the historical Linux failure.

On 1 November, the authorised Linux test box passes all five download controls
and all four unchanged `service-runtime.test.mjs` checks. The first plan journey
starts with a private empty archive cache, downloads the pinned Linux archive
and passes in 9.37 seconds; the complete runtime file takes 24.15 seconds. The
archive matches the existing SHA-256 pin, and no private storage directory remains
after the run. You can repeat that selection with an empty private temporary
directory and:

```sh
TMPDIR=/path/to/private-empty-directory node scripts/test-postgres.mjs exec \
  node --test deploy/test-cloud/service-runtime.test.mjs
```

At that measured revision, the runtime and original test match historical head
`d58cbe85efad8795e65dceb0048aaefc5bf3d0d2` byte-for-byte. The storage fixture has
later diagnostics and port/readiness repairs, so this run does not recreate the
complete historical environment. The successful download also does not establish
which HTTP protocol the public release server used.

A separate native macOS probe confirms the diagnostic with a real local TLS
HTTP/2 response: it advertises 4,096 bytes but sends an 18-byte body. One request
fails with `UND_ERR_RES_CONTENT_LENGTH_MISMATCH`; the fixture names the public
archive request, status 200 and phase `body`, then removes its private directory.
That controlled response reports HTTP/2 error 1; the historical response reports
error 2. This proves that the existing diagnostic can identify this kind of archive
failure, not that the old failure came from the archive server.

[PR794's root shard](https://github.com/waitron-io/waitron-cloud/actions/runs/41182674171/job/124483174725)
fails the three storage TLS cases in their shared setup: fetching the pinned
SeaweedFS 4.47 archive raises `fetch failed` before their assertions. The transport
cause is absent from the test output. The unchanged TLS tests pass three cases
locally, and a later archive GET on the authorised Linux test box returns HTTP
200; neither control explains or repairs the CI failure. D530's investigation
must capture the cold-download cause while preserving the original TLS checks,
checksums and cleanup assertions.

On 4 November, all five native download controls pass again with no failure,
cancellation or skip. The fixture and download test match both current main and
[PR849's qualified revision](https://github.com/waitron-io/waitron-cloud/commit/9d1935aabc278116f62fc2852569cde3aee7eaf3)
byte-for-byte. The runtime has since gained venue-level permissions, so the retained
Linux run does not qualify today's runtime. The original runtime test is unchanged.

[PR849's head run](https://github.com/waitron-io/waitron-cloud/actions/runs/41297220239)
and its [merge run](https://github.com/waitron-io/waitron-cloud/actions/runs/41297937307)
each completed all 30 jobs, with 17,344 passing tests, 19 optional skips and no
failures or cancellations. That qualifies the earlier baseline, including the
recorded Linux reproduction. It does not qualify this documentation branch or
explain the historical failure.

Keep the historical cause open. At a new instrumented recurrence, inspect the
named request and phase before changing transport, startup behavior or the single
download attempt. Use the shared Linux test box if you need a fresh Linux run;
do not repeat the passing cold-cache baseline without a new failure to investigate.

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

Identity-server errors after startup still need separate qualification.

Run `node --test deploy/test-cloud/storage-s3-grpc.test.mjs` to check the claimed
probe-port regression, both-child exhaustion, disabled retries and successful
recovery. The original S3 assertions and one-retry limit remain unchanged. An
unexpected startup failure prints its original error and stack before the
assertion checks it. When a Node socket stack omits the calling bind, look for
`storage_listener_failure`: it identifies the identity listener or the numbered
storage bind attempt before the original failure propagates. A claim already held
by another process consumes a candidate selection without performing a bind. Run
`node --test scripts/ci-backup-storage-issuer-bind.test.mjs scripts/ci-backup-storage-reservation-refusals.test.mjs`
to check real identity-listener collisions, controlled nonretryable reservation
refusals, stage markers and preserved cleanup even when diagnostic output throws. The marker contains only fixed labels and a reservation
attempt number; it excludes configuration and keys. The historical failing bind remains
unidentified. The issuer and reservation refusal fixtures inject failures at the
actual bind and the first, fourth and eighth reservations, preserving their
original error-identity, cleanup and competing-listener assertions.

The [D548 merge run](https://github.com/waitron-io/waitron-cloud/actions/runs/41221742864/job/124597610947)
reports reservation three where the fourth actual bind was refused. Controlled
skipped-claim cases reproduce this mismatch on macOS and Linux. The diagnostic
counts actual bind attempts. With claim-before-bind allocation, a skipped claim
performs no bind and does not advance that diagnostic number.
The four added cases retain the existing error, cleanup, cache and competing-listener
checks, including a diagnostic sink that throws. The original CI peer or stale
claim was not observed, so its identity remains unknown. The separate portal job
budget failure in that run remains under [D530 investigation](ci-cache-saving.md#portal-shard-job-budget-d546-qualification).

The separate D458 port-probe error-handler change becomes unnecessary because
this repair removes that probe. Its separate runtime change is unnecessary;
the parked branch remains preserved. Local native refusal checks need no containers.
Use the shared Linux test box for PostgreSQL or Linux checks; current-head and
merge CI remain separate qualification gates.

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
check a controlled nonretryable socket refusal at the first, fourth and eighth
storage-port bind. A genuine occupied candidate is retried within the allocation
bound instead. Failed startup returns the original nonretryable socket error, releases earlier reservations
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
port ownership across the socket-to-child handoff. Each fixture claims a numeric
candidate before binding it, then holds that filesystem claim until its child
stops. Other cooperating fixtures, including separate processes with different
temporary directories, skip existing claims without opening a socket on those
ports. If another program already occupies an unclaimed candidate, the fixture
releases its own claim and tries another candidate within the same 256-selection
bound. Other bind errors retain their original object and stop allocation. A paused native child makes the gap reproducible.
The checks retain usable storage, release after stop and bounded refusal after
256 claimed candidates without starting another child. Existing restart limits,
readiness budgets and error assertions remain.

Run `node --test scripts/ci-backup-storage-claim-before-bind.test.mjs` to check
that a peer awaiting a real existing-claim refusal never binds the first child's
filer port. The first native child starts while that refusal remains held; both
fixtures retain usable storage without restarting. Separate controls occupy a
real candidate socket, check recovery and 256-candidate exhaustion, and retain
the competing listener. Run `node --test deploy/test-cloud/storage-startup.test.mjs`
to check that all eight accepted sockets remain held together before native
startup. Run `node --test scripts/ci-backup-storage-reservation-refusals.test.mjs`
to check that bind diagnostics count actual binds, excluding skipped claims.
The refusal fixture lets the operating system select its earlier successful
listener ports, so an unrelated occupied random candidate cannot consume a bind
and invalidate the expected successful-listener count. Two controls select a
real competing socket before the eighth refusal, with working and throwing
diagnostic sinks. They first reproduce the recorded six-versus-seven failure,
then pass with all original diagnostic, cleanup and deadline assertions intact.
The selected refusal still comes from a real occupied socket. The runtime
allocator and its separate occupied-candidate recovery checks are unchanged;
the historical competing socket on run41422295053 remains unidentified.

Run `node --test scripts/ci-backup-storage-claim-cleanup.test.mjs` to check
missing or replaced claims and an unlink refusal. Cleanup checks link targets,
leaves replacement claims in place and finishes closing owned resources before
reporting an unlink failure. Startup retains its original error. The shared
directory must be a real directory owned by your user with no access for other
users; a permissive directory, symlink or different owner is refused.

Numeric candidates keep odd server ports, matching the
[Linux listener preference with its usual temporary-port range](https://code.googlesource.com/linux/torvalds/linux/+/586b5dfb51b962c1b6c06495715e4c4f76a7fc5a/net/ipv4/inet_connection_sock.c).
The new port-selection control injects an even random draw and observes the
real reservation attempts. This preserves the usual split from outgoing
connections; it does not close the socket-to-child gap or measure its failure
frequency. Different kernel port ranges and competing outgoing traffic still
need a controlled Linux comparison.

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


## Native storage admin fallback exhaustion (D506)

The admin test listeners could take another fixture's service port during the
handoff from reservation socket to native child. Run
`node --test scripts/ci-storage-admin-handoff.test.mjs` to pause a native child
with its S3 port still claimed, then execute each admin case with its original
assertions in a separate process. Selecting that port for the old admin listener
or its 101-port range reproduces an S3 startup refusal. The 101 admin-gRPC owners
stay below 32768. The fallback cases select
owners below 22668, leaving room for HTTP's derived gRPC port 10000 higher and
the next 100 fallback choices. This keeps these controlled listeners outside
the service allocator's 32768–60999 range. An occupied admin candidate retries
within 20 selections. The original admin assertions, all 101
competing listeners, single-child checks and deadlines remain.

These controls identify their deliberately selected competing listener.
They do not identify historical CI listeners or explain every native startup
failure. In particular,
[merge 9b7c540a's local-stack job](https://github.com/waitron-io/waitron-cloud/actions/runs/41850829904/job/126652888279)
refuses S3 port 52135 in `storage-admin-ports.test.mjs`; its snapshot names
Node PID 5625 without identifying its fixture. The same job cancels the
held-bucket case in `storage-admin-progress-integration.test.mjs` at its unchanged
120-second limit. Neither a shared cause nor the stalled operation is established.
The separate historical admin failures and qualification limits follow.


Run `node --test deploy/test-cloud/storage-admin-exhaustion.test.mjs` to check
usable S3 storage when all 101 admin gRPC choices are occupied, preservation of
every competing listener, cleanup and later clean startup. The native fallback
warning does not imply S3 startup refusal. Admin-worker functionality, an actual
admin bind refusal and bind races involving other programs remain open.

[PR790 qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/41172266544/job/124452925371)
failed before these checks when SeaweedFS refused its allocated master port.
The listener snapshot names a `weed` process; its fixture owner remains
unknown. This case deliberately disables the fixture's handoff retry to prove
that admin exhaustion does not restart storage. The unchanged Linux control
passes, which does not explain or fix that historical collision.

[PR793's unrelated documentation qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/41182496471/job/124482642911)
also reaches a later handoff refusal in the existing forced-collision readiness
test. Its restarted native store cannot bind the allocated S3 gRPC port; the
listener snapshot names another `weed` PID without identifying its fixture.
The expected original SDK error is therefore replaced by the genuine startup
refusal. The unchanged forced-collision
case passes all three modes on the authorised Linux test box, including the
throwing reporter; that control does not explain or repair the CI collision.

[PR795's email shutdown qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/41187136562/job/124496295046)
repeats this failure in the same forced-collision `reporter-throws` subcase.
The restarted store cannot bind S3 gRPC port 46747; its listener snapshot names
`weed` PID 7112, with fixture ownership still unknown. The original SDK-error
assertion fails. Both storage source and test match the branch's base exactly.
Lane H's D530 investigation owns this recurrence; keep the single restart and
every assertion. A later clean qualification does not repair this collision.

A controlled current-main reproduction exposes a peer binding an already claimed
filer port before its claim attempt returns `EEXIST`. The native owner then
refuses that port. Candidates are now claimed before binding; existing claims
cause no bind, occupied unclaimed candidates retry within 256 selections, and
other bind errors retain their original object. New native handoff and occupied
socket controls cover that order and cleanup. All eight reservations, the single
native restart, readiness and authority checks, and deadlines remain. This
repairs the demonstrated reservation intrusion; it does not identify historical
Node or weed owners, prevent unrelated programs racing the later handoff, or
qualify the separate native admin fallback.

The same case later reaches its unchanged 90-second deadline in
[PR870's first merge run](https://github.com/waitron-io/waitron-cloud/actions/runs/41387374274/job/125091183776).
The unchanged isolated Linux control passes; it does not identify the stalled
operation or reproduce CI concurrency. The case now prints fixed operation names
and monotonic elapsed times at entry, every five seconds while waiting and on
settlement. Each operation permits sixteen waiting reports, marks the last one
`waiting-limit` and releases its diagnostic timer. Reporter failures preserve the
original result or refusal. Controlled held-bucket checks exercise the installed
case and verify owned-child and scratch cleanup. Private cancellation controls
also collect the captured native child and scratch, including cancellation before
the native child is spawned. Cancellation also releases cooperative port claims
whose targets exactly match roots created by that control. Private-directory
controls preserve other targets and ordinary files. After-spawn cancellation
qualifies release of eight claims; before-spawn cancellation verifies that no
claims were allocated. Concurrent private-directory releases preserve other
claims while tolerating claims the other release already removed. Claims without that ownership evidence
remain untouched. All original assertions and the
90-second limit remain. Use the last `storage_admin_progress` record to separate
reservation, exhausted or recovered startup, bucket creation, owner verification
and cleanup. Startup still combines download, configuration, port selection and
readiness; the trace cannot distinguish those internal steps. A blocked event
loop can delay reports. The historical timeout and port owner remain unexplained.

Three Linux waves of four concurrent unchanged exhaustion cases pass on
2 November at Cloud `601cf19f`. Each case retains all 101 competing listeners,
both storage lifetimes, every original assertion and the 90-second limit. An
independent controller records all 24 native children and verifies their exit,
scratch removal and release of claims naming those exact scratch roots. All
reported operations finish. This tests concurrent native stores, but does not
recreate the original GitHub runner or explain its timeout or earlier port
collision. Do not repeat this passing probe without a new hypothesis or a fresh
operation trace; use that trace to select the next reproduction.

See [the cooperative port claims and cleanup limits](#cooperative-native-storage-port-ownership).


The HTTP regression pauses a service child, selects an occupied HTTP owner
whose derived gRPC port would equal that service port, and waits for the derived
listener before resuming the service. The original higher owner range first
produces a native S3 bind refusal. The corrected range leaves room for the
10000-port offset as well as all 100 fallback choices. The controls observe
actual admin bind attempts, probe an unsafe interval at its upper edge, and
require the occupied candidate to reach a bind; reverting to an old spelling or
widening a range cannot pass through a lucky draw. The new wrapper allows
120 seconds around the original 90-second case; the original 90- and 120-second
limits remain unchanged.

Default native admin listeners remain a separate open collision path. Two
concurrent ordinary stores, without these test overrides, can have extra admin
listeners outside their eight service-port claims even with `-admin.ui=false`.
The local observation and the review identify such listeners, including an odd
port in the service range, but do not demonstrate a default-admin takeover or
identify a historical owner. The existing port-handoff investigation must also
cover those defaults and other ephemeral test listeners before claiming all
fixtures cooperate. These controlled admin tests do not qualify that broader
protocol or native admin-worker functionality.
