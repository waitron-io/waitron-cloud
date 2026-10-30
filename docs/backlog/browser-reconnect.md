# Browser reconnect cancellation investigation

The real pinned dashboard can cancel a request while reloading. The byte-counting
relay treats a reset on that connection as a failed measurement and closes every
other connection. The browser then times out waiting for the dashboard. Increasing
that wait or retrying the job would hide the failure rather than explain it.

[PR #739](https://github.com/waitron-io/waitron-cloud/pull/739) retains the Linux
experiment and strengthens readiness at the identified late-read boundary. The
relay, accounting, cache, isolation and cleanup checks retain their original rules.

## What the Linux traces establish

The experiment uses the pinned Waitron runtime, its built dashboard, generated venue
and genuine gateway. It changes only the diagnostic job's copies. Each job stops
sampling at its first refusal, then runs the six deliberate-fault controls. It never
retries a failed sample to obtain green.

The compact trace in
[run 40920925400](https://github.com/waitron-io/waitron-cloud/actions/runs/40920925400/job/123613601338)
first captured a browser-facing reset during reconnect. The relay then closed three
other connections. The later takings timeout was a consequence of that shutdown.
That trace alone did not identify the cancelled request.

The changed experiment adds Chrome's request-to-socket links. It exports fixed route
categories, numeric socket identifiers and loopback ports, and error numbers. Raw
URLs, query strings, headers and browser log contents stay inside the temporary
runner and disappear with it. Buffering the relay observations until process exit
avoids file writes from its socket callbacks. Even these observations can affect
scheduling; successful samples do not establish a repair or a failure rate.

Both independent jobs in
[run 40922185069](https://github.com/waitron-io/waitron-cloud/actions/runs/40922185069)
then captured a cancellation on the socket that reset:

- The ordinary job's thirteenth sample maps the reset connection to a live-stream
  request. Chrome records its cancellation immediately before closing that socket.
- The single-CPU job's ninth sample maps the reset connection to an API request
  around reload. Its cancellation also precedes socket closure. This is a different
  request category; waiting only for an EventSource response does not address it.

All six deliberate-fault controls pass in each job. These observations identify
request cancellation and relay-wide shutdown in these recurrences. They do not
establish that every historical reconnect refusal has the same cause, or identify
which application action cancelled the API request.

## Remaining cancellation attribution

Keep live-stream cancellation and API cancellation distinguishable when you
investigate the earlier socket resets. The later drain trace below establishes a
separate late-read sequence with no relay error; it does not attribute those resets.

Do not exempt resets, drop interrupted traffic, finish streams before reload,
lengthen deadlines or add retries to qualify the journey. Local socket counters
that happen to agree do not prove that Chromium consumed the response. The earlier
native cancellation probe retained a real 65,536-byte disagreement, so accepting
all cancellations would discard required evidence.

Before changing the success conditions, write down how every cancelled request and
encrypted byte remains covered and obtain the approval required by the campaign's
changed-test-check rule. No accounting change or owner decision is implied by the
current diagnostics.

The application diagnostic adds application-side stream creation, opening and explicit
closure, fetch signal cancellation, and navigation markers. It also records which
requests remain when each drain starts and returns. Fixed categories and numeric
identifiers distinguish an application abort from reload without publishing URLs,
query strings or abort reasons. You must compare these observations with Chrome's
socket mapping before attributing either recurrence to a specific action.

A native Chromium probe observes explicit stream closure, a real cancelled fetch
and the reload marker. Its console does not retain the old document's `pagehide`
event, so absence of that event cannot establish absence of navigation. The Linux
experiment still samples each group only until its first refusal and retains all
six original fault controls. No repair or changed success condition is implied.

## The identified late-read boundary

The request-identity experiment in
[run 40926773548](https://github.com/waitron-io/waitron-cloud/actions/runs/40926773548)
captures a distinct request-drain failure in ordinary sample 12 and single-CPU
sample 5. In both, the drain returns while the old page's stream is still opening.
That stream then opens during reload and starts four old-page fetches, identified
as requests 19–22. They remain outstanding at the next drain, which refuses at its
existing three-second deadline. The relay reports no error. All six original fault
controls pass in each group. This sequence explains the outstanding reads in these
instrumented recurrences; it does not attribute the earlier socket resets.

A separate controlled probe of the original browser module also reproduces a
request starting while response sizes settle, followed by reload without a fresh
request check. Rechecking the request set and establishing stream readiness are
separate obligations. Waiting only for response headers has not been proved to
cover the application's later stream-open callback.

## Readiness at the boundary

The owner approved stronger readiness and the three affected diagnostic fixtures
on 30 October. Before you reload, the measurement now waits until every live
stream has received headers and delivered its open event. A page evaluation runs
after the whole open-event task, including the application's listeners that start
follow-up reads. An already open stream stays open. An automatically reconnecting
stream must open again; a stream closed by the application no longer blocks.

Response-size collection participates in the same drain loop as outstanding reads.
If another request starts while sizes settle, the loop waits for it too. The
original three-second deadline still refuses unfinished streams, reads and size
collection. A timer races the page evaluation against the remaining allowance,
so a blocked page refuses at three seconds even if it never replies. No failure
is retried, no socket reset is accepted and no byte is removed from accounting.

Run `node --test scripts/cloud-cost/browser-readiness.test.mjs` for controlled
headers, open callbacks, late reads, closure and deadline boundaries. The three
`pending-before`, `late-before` and `aborted-before` fixtures now supply an
established pre-reload stream and explicitly retain its response observation.
Their reconnect-phase lifecycle, privacy and count checks remain.

The native Chromium probe retained with the campaign uses a real TLS meter,
delayed stream data and a delayed follow-up read. It reaches reload only after
the read finishes, with the stream still open. The pinned Linux workflow compares
ordinary and single-CPU scheduling and retains all six original fault controls.
These checks address the identified late-read family. Earlier socket-reset
recurrences still need a matching trace before you attribute them to this repair.

Readiness currently covers the top-level dashboard. Navigation during a drain
refuses with the current phase rather than hiding an execution-context failure.
Whether the genuine dashboard ever navigates during this boundary, or opens a
live stream in a child frame, remains unverified; retain a matching trace before
extending this measurement to such a page.

## Qualification exposed a separate client reset

The repaired head `3a082da3` passes all 50 normal CI jobs, including the genuine
browser journey and all six fault controls. The changed attribution experiment
[run 40988995366](https://github.com/waitron-io/waitron-cloud/actions/runs/40988995366)
passes 24 ordinary samples, but its single-CPU group stops at sample 4 with
`socket-client-reset`. Both groups retain all six passing fault controls. This
head is red overall and is not a qualified repair of that reset family.

In the refusal, the live stream opens before the drain. Its follow-up reads finish
before the drain returns, which leaves only that established stream. Chrome then
reuses socket 159 for a new API request, source 198, cancels it around navigation
and resets the connection. The new page's session reads fail after the relay
correctly shuts down. These observations do not identify the API endpoint or
which document started the cancelled request.

The protocol diagnostic observes Chrome's document identities, numeric source
locations and fixed route categories. It also reads the existing application
markers directly from Chrome's protocol to retain their document context during
teardown, alongside the page-level console forwarding. Raw URLs, function names, source text and abort
reasons remain private. A native Chromium control distinguishes a fetch started
by an old page's unload handler from the new document; that control does not
attribute the genuine failure. No further measurement or accounting rule changes
are implied by this observation stage.

## A connecting stream is cancelled before any drain

The protocol experiment at `593bbb92`,
[run 40990548906](https://github.com/waitron-io/waitron-cloud/actions/runs/40990548906),
passes 24 ordinary samples. Its single-CPU group passes 21 samples and then refuses
in sample 22, before any drain or reload. Both groups pass all six fault controls;
all 18 helper checks pass.

The application explicitly closes its first live stream while it is still
connecting, then creates its replacement. Chrome cancels the live request with
source 104 on socket 30, which maps to the relay's reset connection 2. Every
protocol request belongs to the first document. This distinguishes an initial
application cancellation from the earlier API cancellation around reload. The
later dashboard timeout follows the relay's required shutdown.

Reading the exact pinned `LiveConnection` and `LiveData` modules identifies the
interest-change path that replaces a connecting stream. A native Chromium control
running those actual modules reproduces that closure. With an unfinished 32 MiB
stream, the replacement case refuses the real TLS meter with `socket-client-pipe`,
while the unchanged-interest control stays clear before browser shutdown. The
smaller native cases close the connecting stream without a relay refusal. This
is not an exact reproduction of Linux's small-stream reset or a proof that every
cancellation has the same cause.

The next consumer investigation should compare initial interest settlement and
connecting-stream replacement in Waitron, preserving the real browser behavior
and every Cloud accounting guard. Cloud's lane must not edit Waitron or silently
delay, suppress or rewrite the pinned application's requests. Retain both Linux
traces and make the relevant controlled comparison before choosing a repair.

## Separate storage qualification refusal

The same head's standard workflow
[run 40990548896, receipts job](https://github.com/waitron-io/waitron-cloud/actions/runs/40990548896/job/123851705352)
also fails `two S3 gRPC bind refusals stop after the permitted retry and retain both competing listeners`.
The expected native-child message is replaced by the direct error
`listen EADDRINUSE: address already in use 127.0.0.1:40719`. Preserve that
behavioral check and investigate the competing-listener setup and handoff in
`deploy/test-cloud/storage-s3-grpc.test.mjs`; the exact failure stage is unproved.
`git diff --exit-code f32fac4a HEAD -- deploy/test-cloud scripts/backup-storage-fixture.mjs`
confirms this branch changes neither that test nor the storage fixture. This
separate failure also prevents landing and must not be rerun unchanged to green.

## Requalification after the consumer and fixture repairs

Waitron's [A1222 repair](https://github.com/clintongormley/waitron/pull/2269)
keeps one live stream per page load while initial interests settle. Cloud's
[D499 delivery](https://github.com/waitron-io/waitron-cloud/pull/760) pins that
browser, supplies its supported generated authority and runtime assets, mounts
its real theme and disk-stop routes, and selects the account menu's explicit
trigger. It also repairs the storage identity-port handoff. D499's exact-head and
independent merge runs pass the complete browser journey and all six fault controls.

The preserved readiness branch now includes those landed repairs. Its own changed
head must pass both ordinary CI and the bounded Linux observation groups before
you call it qualified. Retain the earlier cancellation traces; these deliveries
do not prove that every historical socket reset has the same cause. The native
readiness checks still cover headers, open callbacks, follow-up reads, response
sizes, established streams and the original deadline.

The rebased head `97147228` passes ordinary CI and cost conformance. Its separate
[Linux observation](https://github.com/waitron-io/waitron-cloud/actions/runs/41023281681)
passes 24 ordinary samples, then refuses single-CPU sample 8 with an API socket
reset. All six fault controls pass in both groups. Only an established stream
remains when the pre-reload drain returns. Chrome records six further requests
during navigation before the new page's script requests appear in the protocol
trace. The cancelled API request belongs to this gap. Do not assign it to the
old or new page using later requests or matching route counts alone.

The diagnostic copy now distinguishes theme, disk-stop and alerts requests in
Chrome's socket log. It also retains numeric request flags and Chrome's fixed
frame categories. These describe how Chrome starts a request without exporting
its URL, headers or initiating origin. Protocol completion and cancellation
events use the existing numeric request and document identities and Chrome's
monotonic clock, which counts elapsed time independently of the wall clock.
Run `node --test scripts/cloud-cost/diagnostics/navigation-evidence.test.mjs`
for these boundaries. A generated native Chromium/TLS probe links an explicitly
cancelled read to its old document and distinguishes the new document. This
qualifies the observations, not the unresolved Linux reset.

The changed [Linux run](https://github.com/waitron-io/waitron-cloud/actions/runs/41028304505)
at `de49ceab` refuses ordinary sample 21 and single-CPU sample 4. All twelve fault
controls pass. The single-CPU socket mapping identifies a cancelled alerts read
at ticks 148697–148733; the new page's first script request is at 148728 and its
first fetch at 148829. The cancelled request has no matching protocol request
record. The ordinary reset maps to a different, still unspecified route. Neither
run proves the cancelled request's initiating document or callback.

A generated native Chromium/TLS probe using the actual pinned Waitron
`LiveConnection` separately reproduces an old page starting an alerts read after
navigation begins. The replacement page has no script. The old stream's error
callback starts that read. Removing only its refresh call in memory prevents
the late read in 24 trials; calling the existing stop method before unload does
too. Restoring the original source reproduces the read again. These controls
identify the cause in the native reproduction. Applying it to the Linux reset
remains an inference.

Waitron owns the document lifecycle and the
[error refresh](https://github.com/clintongormley/waitron/blob/e8cfd38ed07bf546f14ad15334e54ee997114c75/packages/dashboard-kit/src/live-connection.ts#L94).
Its follow-up must prevent unloading pages from starting new live-data reads
while preserving refresh after real interruptions, session boundaries, cancelled
navigation and supported history restoration. The two experimental controls are
not a complete production repair. Keep this Cloud branch parked until the
consumer investigation and repair can be qualified. All Cloud accounting,
cache, isolation and deadline rules remain; neither red job is retried unchanged.
