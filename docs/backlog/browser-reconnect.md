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
collection, including a readiness reply received after that deadline. No failure
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
