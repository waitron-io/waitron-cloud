# Cost conformance fixture investigations

### Fixture archive download retries (D311)

[Cost run 40373727040](https://github.com/waitron-io/waitron-cloud/actions/runs/40373727040)
stopped two groups on HTTP 504 from the pinned SeaweedFS archive before any case
ran. Across six recent runs, 94 archive responses returned 200 and two returned
504, after 35 ms and 11 seconds. The upstream cause remains unknown.

Fixture downloads now try at most three times for HTTP 5xx or a reset connection,
with one- and two-second pauses inside the existing shared 120-second budget.
Each attempt starts with empty data and reports its number through
`conformance_archive`; transport failures also report the error code. Refused
response bodies are cancelled; only a complete
response matching the pinned SHA-256 is written for extraction. Digest failures,
other HTTP refusals and caller cancellation stop without another attempt.
Local HTTP checks cover recovery, exhausted attempts, both retry pauses, real TCP
reset and partial-body reset,
permanent refusals, checksum verification after a retry, cancellation and the
shared deadline. Docker-backed qualification runs in CI during the local outage;
these controls do not establish the cause of the historical upstream 504.

[D457's cost run](https://github.com/waitron-io/waitron-cloud/actions/runs/40811399202/job/123243127986)
received HTTP 200, then stayed at 10,237,952 bytes through 110 seconds before its
first attempt exhausted the shared 120-second budget. You now get another attempt
when no headers or body bytes arrive for 30 seconds. Each header response or body
chunk restarts that inactivity timer; the total budget still includes all
attempts and pauses. A stalled attempt reports `ArchiveInactivityError`, distinct
from the overall deadline's `TimeoutError`. Partial data is discarded before
retrying, and only the complete archive with its pinned checksum reaches extraction.

Run `node --test scripts/cloud-cost/conformance-archive-idle.test.mjs` for local
HTTP controls covering stalled headers, a stalled partial body, exhausted
attempts and progressing headers and bodies. Run all four
`conformance-archive*.test.mjs` files for cancellation and total-deadline coverage
while a request is active.
These reproduce the missing retry and its repair. The historical upstream
stall and repeated HTTP 500/504 responses still need attribution; this handling
does not repair a service that refuses all three attempts.

[Merge cost run 41139422264](https://github.com/waitron-io/waitron-cloud/actions/runs/41139422264/job/124349848462)
received HTTP 500 on all three pinned Litestream archive attempts, with zero
bytes, before any of that group's 12 cases ran. The trace cannot identify the
responding service; the underlying cause remains unknown. You now get fixed
labels for recognised GitHub response hosts and GitHub, Azure Blob or Varnish
server headers, plus format-checked GitHub and Azure request IDs. These describe
the response and do not prove which service caused the failure. Signed redirect
paths and queries, arbitrary headers and response bodies are excluded. Each
attempt clears the preceding response's identity, including when a later
connection fails before headers. Unreadable identity fields cannot interrupt the
download or replace its refusal.

Run `node --test scripts/cloud-cost/conformance-archive-correlation.test.mjs`
for real local HTTP refusal, recovery, connection-reset, redirect, malformed and
duplicate request IDs, accepted maximum IDs, unreadable fields and digest controls. The redirect control supplies a public
service URL over a local response; it does not contact GitHub. Inspect the next
labelled CI refusal before claiming an upstream repair. Pins, checksum checks,
three attempts, pauses, body cancellation and the shared budget remain unchanged.


### Conformance image acquisition during D135 qualification

[Cost run 39977546909, stack group 2/3](https://github.com/waitron-io/waitron-cloud/actions/runs/39977546909/job/120496895328)
on `cb333018c1dabeb3a19a1ba10e156a5423b70214` verified both pinned archives
and built its owned fixture image, then stopped before running a case.
`docker pull node:26.11.1-slim` failed after 15,139 ms while Docker Hub's token
endpoint did not return headers. Its trace names `image-acquisition`; both archive
traces end in checksum-verified completion. The image-acquisition command is
byte-identical to base `6c031499cdb19e038994c89a6725998b49ae608f`; the cause of
the registry timeout remains unknown.

The separate [image-acquisition repair](https://github.com/waitron-io/waitron-cloud/pull/328)
landed at `1174f28cd4e98aa18212d6afca89233d3f8fef43`. Its controlled command
checks cover the recorded transport refusal, bounded retries, terminal refusals
and owned cleanup within one shared budget. Both exact-head and independent
merge workflows passed all 214 conformance cases. This qualifies the handling;
the original registry timeout's network cause remains unknown. D135 retains the
archive diagnostics and requires fresh qualification on top of that repair.


[Merge cost run 41143129809](https://github.com/waitron-io/waitron-cloud/actions/runs/41143129809/job/124361956617)
verified both archives, then Docker Hub returned HTTP 502 while the fixture build
read the Node image metadata. The build previously stopped after one attempt;
the separate image-pull retry did not cover this earlier boundary.

You now get at most three build attempts for a Docker Hub metadata HTTP 5xx
response, with one- and two-second pauses inside the original five-minute build
budget. Each attempt uses the same owned tag and verified context and prints its
number and original failure. Authentication, missing manifests, rate limits,
unknown failures, build-step errors and interruption stop without another attempt.
Cleanup still removes only the owned tag and scratch directory.

Run `node --test scripts/cloud-cost/conformance-image-build.test.mjs` for native
controls of the recorded refusal, recovery, permanent errors, exhausted attempts,
shared deadline and cancellation. These replace network archives and Docker
commands at their external boundaries; they do not run a real image build.
Docker-backed qualification belongs to CI while local Docker is unavailable.
The registry's underlying HTTP 502 cause remains unknown.


### Litestream conformance transport-close refusal (D141)

[Merge cost run 39987879658, stack group 2/3](https://github.com/waitron-io/waitron-cloud/actions/runs/39987879658/job/120531832768)
failed the storage-lifetime case after 12.4 seconds with only
`Synthetic Litestream phase: transport-close`. The original error was discarded;
cleanup could replace it with another generic failure. The historical cause is
unknown. A later passing run does not explain that refusal.

Each replication, restore and cleanup transport or metering-proxy close now
reports its stage and started, fulfilled or rejected outcome. A rejected transport
also reports its first refusal category and remaining request/connection counts;
known network codes are retained. Error messages, paths, headers, object names,
credentials and unknown fields are excluded. The original rejection still fails
the close, and repeated cleanup reports the same refusal. Counters are sampled
after socket shutdown; they do not prove that a request was stuck. Controlled HTTP
tests cover invalid audit headers, malformed HTTP, refused connections, an
interrupted upstream response, an unfinished transfer and rejected lifetime or
byte accounting. The network cause is retained before a lifetime tracker refuses
the interrupted transfer. Reporting failures cannot prevent cleanup or replace
its outcome. The smoke script's main and cleanup wiring is exercised with external
workload dependencies replaced at module boundaries. All existing storage,
inventory and accounting checks and deadlines remain in place. Local Docker-backed
qualification is unavailable while Docker is down. Use GitHub CI for Linux
qualification; investigate a diagnostic recurrence before claiming or changing
the cause.

[PR556 cost run 40433930926](https://github.com/waitron-io/waitron-cloud/actions/runs/40433930926/job/121958110536)
fails the native stream-history case after all transport closes report success.
The last phase still says `restore-transport-close` while result assembly runs;
that label does not identify the failing operation. Result assembly now names
sales counting, replay verification and each audit, meter, after-stop and transport
snapshot separately. A result-step rejection prints its original name, message
and stack before cleanup, so a later cleanup refusal cannot erase that evidence.
Unreadable fields are omitted without losing readable ones; thrown primitive
values retain their type and text. These details are limited to synthetic replay results; close diagnostics keep
their existing redaction. Controlled failures exercise each result step through
the actual smoke script, with a successful result control. The Linux recurrence's
cause remains unknown; qualify the changed head in CI and investigate its next
labelled failure before claiming a repair.

[G474 merge cost run 40961277969](https://github.com/waitron-io/waitron-cloud/actions/runs/40961277969/job/123754465362)
refuses the delayed committed-PUT shutdown case at stop's idle step. Its first
event is an aborted upstream PUT response; the native writer exits successfully.
The report does not establish whether the reply body completed. You now get the
first event's transferred and expected body bytes, HTTP status, HTTP message
completion flags and forwarding completion flags in both the stop checkpoint and
the later close report. These values describe that event, before socket cleanup
can change the observations. Real local HTTP tests truncate one- and three-byte
replies declared as four bytes, for both 200 and 503 responses. Every interruption
still refuses the waiting idle action and accounting; malformed diagnostic values
and accessors cannot publish private content. An early-reply control also keeps
an incomplete upload's completion flags false. The smoke control checks both
printed reports through the actual fixture with external workload dependencies
substituted. A later response-error event can supplement the first record with a
known network error code; the progress fields still describe the original abort. Run
`node --test scripts/cloud-cost/litestream-response-progress.test.mjs` for these
controls. The genuine Linux cause remains unknown. Reproduce it with the pinned
writer and storage backend when Docker is available, or investigate the next CI
event carrying this evidence; do not infer a repair from a passing run.

[D513 merge cost run 41105691430](https://github.com/waitron-io/waitron-cloud/actions/runs/41105691430/job/124234895797)
refuses the body-byte comparison at `replication-meter-snapshot` after both
transport closes succeed. Its `Invalid cloud cost meter` message does not identify
the failed check. You now get the most recent snapshot refusal category, the first invalidation
boundary and the unfinished request count in the result diagnostic. The categories
distinguish invalidated state, unfinished requests, clock validation, storage
integration overflow, after-stop accounting, aggregation and aggregate attempt totals. Earlier
invalidation distinguishes attempt observation, object observation, attempt admission
and explicit invalidation. These are closed labels and counts; event fields, tokens
and arbitrary invalidation arguments are never copied into this diagnostic.

Run `node --test scripts/cloud-cost/meter-refusal-diagnostics.test.mjs
scripts/cloud-cost/litestream-result-diagnostics.test.mjs` for native controls,
including the actual smoke sequencing with the real meter and substituted external
workload boundaries. Reading the diagnosis cannot settle a request or advance
accounting. An unreadable diagnosis still permits the original result error to be
reported and cleanup to complete. Existing refusal checks, errors, accounting and
deadlines remain in place. The Linux trigger remains unknown; investigate a failure
carrying the new categories before claiming a repair. Genuine local qualification
with the pinned writer and backend remains blocked while Docker is down.

Return to the [backlog index](../backlog.md).
