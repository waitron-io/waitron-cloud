# Cost-stack replication interruption (D152)

[Cost run 40015106057, job 120625121669](https://github.com/waitron-io/waitron-cloud/actions/runs/40015106057/job/120625121669)
refused the Litestream storage-lifetime case at replication transport close with
`transfer-interrupted`, after 21 completed attempts and no remaining requests or
connections. Later PR377 reported `response-pipeline` during a `put`. Those final
counts do not identify the earlier failed I/O event. The transport retains the
first event category, known network code and operation category through cleanup.
Paths, headers, object names and unknown diagnostic fields stay private.

The earlier smoke change waited for active transfers before stopping
Litestream. A restore can see a committed object while the writer still awaits
its PUT reply; stopping at that point cancels the pending exchange. Two controlled
[Linux observations](https://github.com/waitron-io/waitron-cloud/actions/runs/40075195985)
delayed successful replies after the real storage commit and failed with
`active-close` at transport close. Both [fixed observations](https://github.com/waitron-io/waitron-cloud/actions/runs/40075626914)
pass with the same delay and unchanged assertions and deadlines. A native real-HTTP
probe also reproduces the historical `response-pipeline` / `put` diagnostic when
the client exits before its committed reply arrives. That reproduction proves a
possible cause; the old logs cannot establish the cause of every historical event.

A Docker-free regression runs the actual smoke and transport with a real HTTP
writer child. The current checks require a validated runtime stop before signalling, then
writer exit and passive transfer settlement before final restore. Invalid replies,
early exit and silent storage refuse within the same two-second stop budget.
Cleanup sends its signal only once; the force-stop limit remains unchanged. The native harness owns a separate process
group and collects it even when its outer deadline fires.
A separate pinned-Litestream case delays committed PUT replies and checks the
original restore, integrity, fiscal, request, byte, version-history and cleanup
invariants. Every earlier test assertion and deadline remains unchanged. Existing
interrupted-I/O checks still require accounting refusal. Local Docker-backed
qualification is unavailable until Docker returns; GitHub CI supplies the genuine
Linux checks. Reproduce any new diagnostic recurrence before changing transport,
accounting or cleanup behavior.

[PR394's cost run 40099523703, job 120888687281](https://github.com/waitron-io/waitron-cloud/actions/runs/40099523703/job/120888687281)
failed `genuinePinnedLitestreamDrainsCommittedPutRepliesBeforeShutdown` with
`response-pipeline` during a `list`, after 22 completed attempts. A native real-HTTP
probe reproduces that event when the client closes before upstream response
headers arrive. Node's `ERR_STREAM_UNABLE_TO_PIPE` is now retained as a closed
error category. Transfer-failure diagnostics also record whether the client was
closed, whether response headers had arrived, and the number of idle actions
started before request admission. That count distinguishes a request before
the smoke's stop action from one admitted after it; it does not
freeze the writer or establish the historical cause. Interrupted accounting
still refuses. Controlled cancellation with no idle action and inside immediate
or queued idle actions exercises the actual transport. Each case checks the
original refusal and privacy boundary. Upstream resets before and after headers
also check that the client and response state can be false.

[Run 41303338930, job 124838744224](https://github.com/waitron-io/waitron-cloud/actions/runs/41303338930/job/124838744224)
records another LIST refusal at `response-pipeline`, this time with
`ERR_STREAM_PREMATURE_CLOSE`. Both counters report equal body totals, but the
producer records interruption while the storage observer records success. You
can now inspect body counts, expected lengths, HTTP status and request/response
completion flags for this premature-close boundary as well as at
`response-aborted`. Other pipeline error categories keep their existing
diagnostic shape. These fields record
transport progress, not whether the native writer consumed the response.

Run `node --test scripts/cloud-cost/litestream-pipeline-diagnostics.test.mjs`
for real HTTP controls with and without a validated stop acknowledgement. Each
holds downstream response completion after the upstream's four bytes traverse
the counter, then closes the client socket. The upstream response is complete;
the downstream pipeline still refuses with the same error category and unequal
outcomes despite equal byte totals. These controls establish a possible ordering,
not the historical cause, the official writer's behavior or Linux stack
qualification. The interrupted session remains refused. The separate owner
decision about accepting this cancellation category remains open.

The four bounded Linux jobs in [run 40101340028](https://github.com/waitron-io/waitron-cloud/actions/runs/40101340028)
ran 27 genuine delayed-reply cases: 25 passed and two refused. Both refusals
record `ERR_STREAM_UNABLE_TO_PIPE`, `list`, a closed client, response headers,
and idle-action counts of one at admission and interruption. The final
diagnostic keeps the admission count; the interruption count was redundant.
This establishes late admission during the smoke's stop action for those two observations;
it does not identify which native goroutine issued the request or attribute
every historical failure. The temporary observation workflow is removed after
saving all four jobs and their exact checkouts.

A separate macOS counterexample uses the official Litestream 0.5.17 arm64
release, archive SHA-256
`e211f68ff7658d19f193f2914417afdf8f89a053ff8f263e5d6b3b1d3bbc7b08`.
A loopback relay holds the native writer's first metadata list before the
measuring transport admits it. The transport reports idle; its stop callback
releases that request and sends SIGTERM. After the native process exits with
code zero, the transport records `response-pipeline`, `list`,
`ERR_STREAM_UNABLE_TO_PIPE`, a closed client, response headers and admission
count one. The audit correctly refuses the interrupted exchange. Releasing
and completing the held request before stopping passes the paired control.
An initial upload without the relay delay also passes its stop control.

This experiment uses a generated SQLite database and a controlled storage
response. It does not run the Waitron workload, restore or Linux container,
and it does not establish the historical cause. It proves that a native
request issued before the callback can be admitted after it starts. You cannot
use the admission count to infer when the native process issued the request,
or treat an idle transport and exit code zero as a completed drain.

A separate probe uses the same native release's local control socket. With
its first metadata list held at the relay, `POST /stop` returns
HTTP 200, `status: stopped` and transaction ID zero before that reply finishes.
The request is still open when the confirmation arrives. Releasing and finishing
that reply before calling stop passes the paired ordering control. This initial
metadata probe does not run the sale/restore workload or prove what happens to
every later request. It rules out treating the runtime stop confirmation alone
as a complete request drain. Cleanup terminates the owned process after the
observation; cancellation during cleanup is not evidence of cancellation by stop.

A further native probe identifies the held initial list in the snapshot-retention
background task. After the stop reply, the private native stack contains
`Store.monitorCompactionLevel`, `Store.EnforceSnapshotRetention`,
`DB.EnforceSnapshotRetention` and AWS `ListObjectsV2`. Releasing that reply can
lead to another list while the database is stopped. This identifies the controlled
macOS task; it does not identify the historical Linux request. Waiting until just
one active stack frame disappears also fails to establish that all background
work has finished. Native stack dumps remain local diagnostic evidence.

The owner decided against a custom Litestream binary on 25 October. Keep the
official 0.5.17 release and its pins. The revised [after-stop accounting design](../superpowers/specs/2026-10-24-litestream-native-drain-design.md)
and [implementation plan](../superpowers/plans/2026-10-24-litestream-native-drain.md)
replace the unbuilt native extension with a small, separately counted shutdown
allowance. Its first implementation step adds the optional session ledger and
real HTTP boundary tests. The audit, first transport and independent storage
counter share attempt identities, preserve each counter's actual bytes, and
count at most three distinct affected attempts across admissions and settlements.
The exact post-acknowledgement list interruption can settle each storage reader's
pending token; its response stays incomplete and its billing unknown. The three
readers also retain one already-admitted upload completion when a real backend
success acknowledges its complete body and, for versioned storage, its exact
version. Both hops must precede acknowledgement. A lost client reply stays a
transport error in the counters; only storage history uses the commit witness.
Native HTTP tests preserve storage time bounds and refuse uncommitted, partial,
retried or second late uploads, missing versions and mismatched inventories.
An inventory mismatch invalidates the shared session. Ordinary callers stay strict.
The smoke now shares this ledger and records commit evidence from the actual
backend response. It validates the official Unix stop reply before signalling,
requires writer exit and passive idle within one two-second budget, then runs its
single final-restore loop. Restore uses a strict read-only view of the same
storage history. Failures record active counts and completed outcomes before
cleanup. Closed output preserves the two counters and labels any nonempty
allowance with the possible request-cost shortfall.

Native HTTP controls cover invalid acknowledgement, early exit, shared deadlines,
failed backend commits and post-stop missing sales. The official macOS 0.5.17
binary also restores both synthetic SQLite rows from final storage and verifies
unversioned inventories. That probe substitutes the venue and fiscal adapter;
it does not qualify the real fiscal workload. All six genuine smoke consumers now
check the separate ledger, preserve incomplete billing and display its cost caveat.
An official-binary held-list control retains a real interrupted response and the
two different byte observations. Its startup barrier requires an actual completed
upload before stop, while the controlled retention list stays held. The toy store
returns the uploads it acknowledges; the control also asserts the real upload
bytes. Deleting the startup barrier fails the native readiness assertion. The delayed-PUT probe exposed initial readiness
accepting storage visibility before the upload reply; the existing 40-poll loop
now also requires that initial transfer to settle before the second sale. Linux
qualification then exposed an idle gap during SDK retry backoff: a different
object was visible, but the injected failed upload had not retried. The same
40-poll readiness loop now also requires a successful backend acknowledgement
for that upload's first retry. The existing native retry assertion is retained;
a deterministic idle-backoff regression fails before this guard and passes with
it. The 1,500 ms delayed replies restore both synthetic rows with integrity intact.
No stop deadline, cap, official pin or pre-acknowledgement refusal is relaxed.
Native checks cover three/four-attempt boundaries with real HTTP requests; the
official held-list control observes one affected attempt and does not claim that
four official attempts occurred. Whole-branch review found no blocking defect;
the existing retry-output test also catches deletion of its guard when included
in the review matrix. A separate native child-process check now holds the stop
reply open in the parent while the writer exits. It requires the pending control
request to be cancelled before the next event-loop turn and refusal at the control
step, with the request fully received and no cleanup signal sent to the writer.
Removing the writer-exit race fails this check while the original early-exit
case still passes; restoring it passes. Native HTTP boundary checks now independently
replace the request and backend reply completeness observations with false after
full delivery. Both cases refuse certification despite matching bytes and a 200
reply. Removing either observation from the smoke's commit witness fails only its
new check; the five original commit tests still pass. These controlled observations
prove witness wiring, not actual truncated-stream handling. Separate native HTTP
controls now test the writer-running check at acknowledgement. A controlled close
notification is delivered in the complete, valid reply's end event, before the
smoke's response-end handler. The real allowance ledger must retain its pre-acknowledgement new-upload permission, and
the smoke must refuse before restore without signalling that already-closed writer.
The paired running-writer control accepts stop and completes its synthetic restore.
Removing only the response-end writer check fails the new closed-writer case while
all original shutdown checks still pass; restoring it passes both new cases.
These controls substitute the writer, venue and storage. They qualify this guard's
wiring, not operating-system exit timing or production shutdown.
A separate native HTTP case now closes the stand-in writer while one transport
reply remains pending. The smoke must wait for that reply before admitting final
restore; the completed-reply control starts restore without pending transfers.
Both cases retain all three upload attempts and exact request/response-byte
accounting. The held case observes entry into the real idle wait with one transfer
pending, so a fixed sleep cannot replace it. Each subprocess exits after fixture
cleanup with zero transport connections. Removing only the smoke's passive idle wait exposes early
restore in the new held-reply case. This qualifies forwarding order with a
controlled close notification, not actual writer-process exit or production timing.
A separate generated Node writer now owns the actual upload socket and exits after
valid stop acknowledgement. With one of four reply bytes received, the smoke refuses
at the idle step, starts no restore and publishes no measurement. Its paired
complete-reply control reconciles all three attempts and exact bytes before the
stand-in restore. Both checks collect the writer and transport connections.
Removing or not awaiting the passive idle wait exposes early restore in the held
case while the complete control passes. This qualifies generated-process exit
with real HTTP forwarding; official Litestream, production shutdown and historical
Linux timing remain unqualified.
Genuine Linux/SeaweedFS and PostgreSQL qualification run in current-head CI before
landing. Historical attribution remains open.

[PR428's cost run 40144823848, job 121023853072](https://github.com/waitron-io/waitron-cloud/actions/runs/40144823848/job/121023853072)
refuses during `stop`; cleanup records `active-close` after 21 completed attempts.
This is an unfinished-transfer refusal, not an excess-count check. Pending zero
is measured after destructive cleanup. The log does not establish which stop
outcome fired, or prove a native caller or historical cause. The earlier list
interruptions during the stop callback remain distinct evidence.

The after-stop allowance shipped in [PR #437](https://github.com/waitron-io/waitron-cloud/pull/437)
at `a6aff300882ca1d03fc2465654793025226f76af`. Its
[head CI](https://github.com/waitron-io/waitron-cloud/actions/runs/40160047703),
[head cost checks](https://github.com/waitron-io/waitron-cloud/actions/runs/40160047686),
[independent merge CI](https://github.com/waitron-io/waitron-cloud/actions/runs/40160687579)
and [merge cost checks](https://github.com/waitron-io/waitron-cloud/actions/runs/40160687574)
passed, including all six genuine smoke cases and the held-list control. Each
head/merge pair recorded 10,167 passing tests and the same 19 optional skips.
These runs qualify that delivery; they do not attribute every historical refusal.
A native HTTP control now truncates an actual successful upload reply after one
of its four declared bytes. The unchanged smoke handles the interruption at stop
and publishes no measurement. Its paired complete-reply control reports both
synthetic sales through its stand-in restore and reconciles all four response bytes at both hops. Removing
only backend-response error forwarding leaves the truncated case waiting until
its existing subprocess deadline, while the seven original commit checks and the
complete-reply control pass; restoring it passes all nine. Original assertion
bodies and runtime bytes are unchanged. The writer, venue, SDK administration and
SQLite reader remain substitutes, so official-binary and production truncated-stream
handling still need qualification.

A paired native HTTP check now sends one of four declared upload bytes, then
closes the writer's request after stop acknowledgement. The smoke records a
client-error refusal at the stop's idle step, publishes no measurement and never
invokes restore. The actual request at the writer-facing replication proxy is
incomplete; cleanup collects all transports and proxies before the subprocess
exits. The case catches broken request-error settlement and socket collection;
it does not prove that the idle wait blocks while a transfer is active. Its complete four-byte
control reconciles both counters and completes the stand-in restore. These checks
use the existing generated writer and substitute venue, SDK administration and
SQLite reader. They qualify actual HTTP truncation through the smoke; official
Litestream, production shutdown and historical attribution remain open. Every
original assertion and runtime file is unchanged.

A generic `active-close` still refuses measurement publication. Preserve the official pin,
three-attempt cap, ordinary accounting, restore and deadline checks in any repair;
local Docker qualification remains unavailable until 3 November.


### Broken-pipe shutdown investigation (D270)

The [main cost run 40216346521](https://github.com/waitron-io/waitron-cloud/actions/runs/40216346521/job/121238245625)
refused the original request-log smoke at the stop's idle step with `client-error`
and `EPIPE`, a broken pipe. All 25 attempts had left the transport, but one
accounting attempt remained unsettled. D268 changes the delayed-PUT fixture;
it does not cover this server-level socket error.

For a network error, the transport now records the failing socket's sole
forwarding operation, observed and expected body bytes, response-header state
and the idle-action count at admission. Its `forwardingTransfers` count covers
fully validated requests; `pending` also includes bodies still being checked.
Parser errors name no operation, pipelined requests remain ambiguous, and
completed requests supply no stale context. Native HTTP controls inject a
socket error while retaining real parsing, counters and refusal. A separate native
loopback probe reproduces actual `EPIPE` by closing the caller while a large list
reply starts. This demonstrates one mechanism; the historical official-binary
failure still needs a labelled recurrence before attribution. All 80 genuine
Linux request-log trials in [run 40218943112](https://github.com/waitron-io/waitron-cloud/actions/runs/40218943112) pass. All broken pipes
continue to refuse measurement. Preserve the existing after-stop signature,
three-attempt cap, official 0.5.17 pin, restore assertions and deadlines.


### Delayed PUT shutdown investigation (D268)

The delayed-PUT case failed on three of the 103 cost-workflow runs started on
25 October through the initial D268 audit. All three failures were on PRs;
40 main runs included four other failures. D266 changes tests and backlog only,
so it does not repair this runtime refusal. An [instrumented CI run](https://github.com/waitron-io/waitron-cloud/actions/runs/40210305167/job/121219914473) then reproduced
one failure in 80 trials: control acknowledged at 1,517 ms and the writer exited at
1,520 ms, but a complete PUT had started only 612 ms before the 2,001 ms cutoff.
Its injected 1,500 ms reply hold could not finish within that stop budget.

An older compacted upload can arrive after the final sale without containing it.
The delayed-reply fixture now captures the highest known LTX transaction from
requests admitted before that sale, including uploads whose replies remain pending.
It also requires a successful initial upload and a successful later-transaction upload,
admitted after the sale finishes. Unknown object names, invalid transaction ranges
and multipart part acknowledgements cannot release readiness. A multipart part
alone does not acknowledge a complete object.

The initial smoke barrier still requires its observed transfers to be idle.
Readiness waits for older post-sale uploads already admitted when the new upload's
backend response arrives. Their delayed replies must finish forwarding while the
new reply remains held; forwarding the new reply first cannot release readiness
later. An interrupted older reply instead refuses at the five-second readiness
limit. This orders the controlled replies without expanding the single prior-upload
settlement allowance. It cannot see transactions still inside the writer, predict
uploads arriving after readiness, or prove that all background requests have drained. Every successful PUT reply still
waits 1,500 ms, within the unchanged five-second readiness bound and shared
two-second stop budget. Accounting, restore and cleanup assertions remain.
Run `node --test scripts/cloud-cost/litestream-delayed-put-readiness.test.mjs`
for real HTTP ordering controls and the transaction-boundary refusals. The bounded
wait reports its own readiness phase on failure. A controlled Linux run with the
official binary holds an old compacted upload until after the final sale. Its
reply forwards before stop begins, the new transaction's reply forwards during
stop, and the unchanged genuine case passes with one late upload settlement and
both sales restored. This qualifies that ordering, not the historical timeout or
all native background requests.
Stop refusals also include control/exit timings and active transfer progress,
using operation names and byte counts without paths, credentials or invocation IDs.
The two-row restore and full accounting checks still decide whether a run passes.
This fixture sequencing correction does not attribute the separate historical list
interruptions or qualify production shutdown.

The [PR823 merge recurrence](https://github.com/waitron-io/waitron-cloud/actions/runs/41243190309/job/124661299921)
still reaches the two-second idle deadline with a complete PUT awaiting its held
reply. The writer exits after 1,516 ms, but that pending transfer is only 498 ms
old at the 2,002 ms refusal. Its level and relationship to the readiness upload
were not recorded. Eighteen earlier Linux passes and a later controlled held
compaction pass do not repair or identify this failure. The held-compaction
control shows that an upload prepared before the final sale can arrive afterward
and release readiness, but the final upload follows within 28 ms and passes.

On a stop refusal, you now get `delayedPutEvidence` alongside the existing
diagnostic. It retains at most sixteen PUT arrivals, their numeric upload levels
(or `other`), whether the final sale had finished at arrival, and which successful
response first released readiness. Arrival, backend-response and reply-forwarding
times are milliseconds relative to the start of stop, so negative times precede
stop. A backend-response time means headers arrived; it does not independently
prove a complete stored body. A missing forwarding time means the normal
forwarding code had not run; it does not establish that a reply was still pending.
The deliberate initial 503 is answered directly, before the backend callback,
so its record has neither a backend-response nor a forwarding time.
These records omit request paths,
transaction ranges, invocation IDs, credentials and body bytes. Truncation is
explicit, including whether the readiness upload was retained. The existing
failure record captures a copy before cleanup; successful stops emit no new
record. The transaction-aware readiness rule changes which upload can release
the barrier; every 1,500 ms reply hold, the two-second stop deadline and accounting
assertion stays. Use a new labelled recurrence before attributing the remaining
historical timeout or changing the shutdown rules.


### Stop exit diagnostics (D325)

[Main cost run 40443038771, job 121987717163](https://github.com/waitron-io/waitron-cloud/actions/runs/40443038771/job/121987717163)
refused the request-log smoke at the stop's exit step after 29 ms. It recorded
an interrupted PUT and 20 producer attempts against 19 observer attempts. The
record did not distinguish a failed child exit from an invalid request audit,
so the historical cause remains unknown.

Stop refusals now include the child's exit code, termination signal and invalid
flag, together with the request audit's first failed validation stage and both
request counts. Separate labels distinguish request parsing from after-stop
bookkeeping. A transport failure carries its request's admission number,
retry ordinal and phase in both the stop checkpoint and the printed close record. That number identifies a
request within one transport; it is not the SDK invocation ID. Request paths,
headers and raw SDK logs stay private. Known synthetic stop errors retain their
message and smoke-fixture stack frames; other errors keep their original thrown value internally
and publish a fixed category to avoid exposing transport metadata.

Native controls run the actual smoke and audit with substitute external workload,
storage and child-process boundaries. They distinguish failed exit, signal,
audit and combined refusals, preserve the first audit failure, and exercise a
successful control. Separate real HTTP retry and socket-error checks identify
the interrupted request and still refuse accounting. Diagnostic-write failures
retain the original stop rejection and finish cleanup. The stop budget, retry cap, restore and
measurement guards remain unchanged. Reproduce the next labelled recurrence,
or use genuine Docker qualification when Docker returns, before repairing the
underlying cause. Passing qualification does not explain the historical failure.
