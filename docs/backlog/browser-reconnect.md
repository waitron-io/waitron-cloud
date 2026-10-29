# Browser reconnect cancellation investigation

The real pinned dashboard can cancel a request while reloading. The byte-counting
relay treats a reset on that connection as a failed measurement and closes every
other connection. The browser then times out waiting for the dashboard. Increasing
that wait or retrying the job would hide the failure rather than explain it.

Draft [PR #739](https://github.com/waitron-io/waitron-cloud/pull/739) retains the
Linux experiment. It has not repaired the journey or qualified a production change.
The original relay, browser checks, accounting rules and deadlines are unchanged.

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

## What remains open

Reproduce the mapped cancellation in a controlled comparison, identify its
application or navigation trigger, and prove a repair that preserves complete
accounting. Keep live-stream cancellation and API cancellation distinguishable.
Check the drain boundary as a hypothesis: requests can start while response sizes
are being collected. Reading that code is not proof that it caused either trace.

Do not exempt resets, drop interrupted traffic, finish streams before reload,
lengthen deadlines or add retries to qualify the journey. Local socket counters
that happen to agree do not prove that Chromium consumed the response. The earlier
native cancellation probe retained a real 65,536-byte disagreement, so accepting
all cancellations would discard required evidence.

Before changing the success conditions, write down how every cancelled request and
encrypted byte remains covered and obtain the approval required by the campaign's
changed-test-check rule. No accounting change or owner decision is implied by the
current diagnostics. The branch remains a draft investigation.
