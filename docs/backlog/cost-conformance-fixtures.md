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

On 4 November, one bounded check runs the four `conformance-archive*.test.mjs`
files on the Mac: all 56 cases pass without failures, cancellations or skips.
Calling `downloadConformanceArchive` directly with the current Linux x64 pins
then downloads Litestream 0.5.17 (13,540,484 bytes) and SeaweedFS 4.47
(45,801,355 bytes). Both return HTTP 200 on their first attempt and pass the
pinned SHA-256 check. The diagnostics label each response as GitHub release
assets served by Azure Blob. This identifies these successful responses only.
Both temporary archives are removed after the check.

The test-box helper returns 75 because another lane holds the box. No Linux or
Docker preparation runs in this attempt. The downloader, pins, three-attempt
limit, pauses, inactivity timer, total budget, cancellation and checksum checks
are unchanged. These successful downloads do not establish why the historical
500/504 responses or stalled body occurred; inspect a labelled refusal before
claiming an upstream repair.


### Header-progress fixture scheduling (D530)

[D462's receipts job](https://github.com/waitron-io/waitron-cloud/actions/runs/41306500809/job/124848167543)
retried the header-progress control after 169 ms without headers. The fixture
shortens inactivity to 150 ms but starts its 100 ms header delay only after the
server receives the request. Connection and process scheduling can consume the
remaining margin. Adding an 80 ms connection delay reproduces the same two-request
failure locally; it does not establish the historical runner's scheduling delay.

Run `node --test scripts/cloud-cost/conformance-archive-idle.test.mjs` to check
the repair. The header-progress cases now advance a controlled clock by 100 ms
before headers and another 100 ms after the downloader observes them. The real
HTTP response still has both 100 ms delays. The shortened 150 ms inactivity and
1,200 ms total clocks advance independently of process scheduling; the outer
five-second test limit stays real. All original assertions remain, with added
checks for no retry after a delayed connection and an inactivity refusal exactly
at 150 ms followed by a checksum-verified retry. Removing the header reset or
timer cancellation fails the controls, as does preventing clock expiry.

The delayed-connection variant guards this fixture against a return to scheduling
dependence. It adds no independent downloader guarantee. The controlled cases do
not advance to the 1,200 ms total deadline; the `shared-deadline` case
below checks that refusal with controlled time. The separate archive-retry
shared-deadline case keeps its wall clock. Exhausted attempts and body stalls
also use controlled time; the remaining scenarios retain their wall clocks.
Production download timeouts, retry limits and accounting are unchanged.
The separate prematurely closed Litestream LIST response remains under
investigation.


### Exhausted archive attempts and connection scheduling (D530)

[D462's later receipts job](https://github.com/waitron-io/waitron-cloud/actions/runs/41311315472/job/124862280267)
records three stalled client attempts but only two server requests. Each attempt
starts its shortened 150 ms inactivity clock before connecting. A connection
that takes longer can expire before the server receives it, so counting requests
no longer proves that all three attempts ran. Adding a 200 ms first-connection
delay reproduces the same two-versus-three refusal. The historical connection
and scheduling delays were not measured.

Run `node --test --test-name-pattern=always-stalled
scripts/cloud-cost/conformance-archive-idle.test.mjs` to check both ordinary and
delayed connections. The server now advances the controlled clock by 150 ms only
after receiving each stalled request. You still exercise real HTTP, three admitted
requests, the downloader's inactivity refusal and exhausted retries, and the
absence of an archive. Every original assertion remains. The 150 ms inactivity,
1,200 ms total and real five-second outer limits are unchanged. Removing clock
control or request admission fails the delayed-connection or outer-limit control.

This fixture separates connection scheduling from simulated download time. It
does not measure the production network or qualify expiry before a request reaches
the server. It also no longer runs three successive stalls on a wall clock;
no claim of identical time-dependent coverage is made. The separate archive-retry
shared-deadline journey and the idle suite’s cancellation case keep their wall
clocks. Production downloads and accounting are unchanged. The LIST shutdown
and bound-container verifier cleanup failures still need their own investigations.


### Body-stall and total-deadline scheduling (D530)

[D102's merge receipts job](https://github.com/waitron-io/waitron-cloud/actions/runs/41375579216/job/125055342971)
records zero partial-body bytes instead of 23, and one stalled request instead
of two before the shared deadline. The fixtures use a 150 ms inactivity limit
and, for the latter case, a 240 ms total budget. A controlled 200 ms connection
delay reproduces both assertions: before the first connection for body-stall,
and before the second connection for shared-deadline. The historical connection
and callback scheduling were not measured.

Run `node --test scripts/cloud-cost/conformance-archive-idle.test.mjs` to check
the ordinary and delayed variants. The body-stall control waits for the real
downloader's report of 23 consumed bytes before advancing inactivity by 150 ms.
Only that control reports progress every 10 ms so it can observe consumed bytes;
the downloader itself is unchanged. The deadline control advances 150 ms after
the first request reaches the server and the remaining 90 ms after the second.
Both attempts share one deadline. HTTP, retry pauses, connection delays and the
outer five-second limit still use real time.

Every original assertion and shortened limit remains, including partial-byte
accounting, two requests, checksum-verified recovery, no failed archive and the
`TimeoutError` refusal. The separate `conformance-archive-retry.test.mjs`
shared-deadline journey still tests wall-clock expiry across an HTTP refusal,
backoff and the next request. These controls separate simulated timeout boundaries
from connection scheduling; they do not measure the production network or prove
expiry before server admission. Production timeouts, attempts, backoff, integrity
checks and cancellation are unchanged. Upstream archive failures and the separate
LIST shutdown cause remain open. If the consumed-byte report, diagnostic cadence
or timeout signal is missing, these controls fail at their real five-second
outer limit; that failure does not identify which signal is missing.


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
The registry's underlying HTTP 502 cause remains unknown.

A bounded qualification attempt on 2026-11-04 ran
`node --test scripts/cloud-cost/conformance-image-acquisition.test.mjs
scripts/cloud-cost/conformance-image-build.test.mjs`: all 39 native controls
passed without failures or skips. These controls replace external Docker commands
and cannot establish current registry availability. The test-box helper refused
real preparation with exit 75 because lane G held the box; no image was built or
pulled by that attempt. Fresh Docker-backed qualification and attribution of both
historical registry failures remain open. Keep the existing attempt counts,
shared budgets, cancellation, integrity checks and owned cleanup unchanged.


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
inventory and accounting checks and deadlines remain in place. While Mac Docker
is off, use the authorised Linux test box for reproduction and GitHub CI for
release qualification. Investigate a diagnostic recurrence before claiming or
changing the cause.

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
writer and storage backend on the authorised test box, or investigate the next CI
event carrying this evidence; do not infer a repair from a passing run.

[D513 merge cost run 41105691430](https://github.com/waitron-io/waitron-cloud/actions/runs/41105691430/job/124234895797)
refuses `genuineLitestreamTransportBodyBytesAgreeWithSeparateStorageObserver` at
`replication-meter-snapshot` after both transport closes succeed. The initial
campaign inventory incorrectly names the storage-lifetime case; the raw job log
shows that case passing and the body-byte case failing after 9.92 seconds. Its
`Invalid cloud cost meter` message does not identify the failed check. You now get
the most recent snapshot refusal category, the first invalidation
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
deadlines remain in place.

On 1 November 2026, the authorised Linux test box passes the unchanged body-byte case
in 12.71 seconds on Cloud `80b994e481de3d6fc1b6a0641437aa2ebeb110d4`:

```sh
node scripts/cloud-cost/conformance.mjs --only stack-conformance.test.mjs \
  --pattern '^genuineLitestreamTransportBodyBytesAgreeWithSeparateStorageObserver$'
```

The case uses the genuine pinned writer and storage backend, and its complete
test body matches historical Cloud `7469d45ff89a09cdce7ea97de3ebbc04c3c8a1b1`.
`litestream.mjs` also matches that revision. The meter, smoke script, preparation
and shared fixture utilities have later changes, including diagnostics; this is
current qualification, not a recreation of the complete historical environment.
The current second conformance group passes all ten cases in 120.43 seconds,
including the body-byte case in 15.09 seconds. This keeps the group's normal
ordering rather than testing the failed case alone. All 34 native meter and
result-diagnostic checks pass. No runtime, assertion,
accounting guard or deadline changes in this investigation.

The Linux trigger remains unknown. Preserve the next failure's
`litestream-result` record before cleanup. If its stage is
`replication-meter-snapshot`, use `meter.snapshotRefusal`,
`meter.firstInvalidation` and `meter.pendingAttempts` to distinguish an unfinished
request from invalidated state, a clock refusal or a later accounting check.
Reproduce that category before changing behavior. A passing current run does not
repair the historical failure; do not repeat this baseline without a new trigger.

### Litestream request-validation diagnostics (D378)

The transport records the first refused request-validation boundary using fixed
stage names, including request identity, operation, retry sequence, after-stop
admission, content length, mutation body and lifetime bookkeeping. Stop checkpoints
and sanitized close records carry the stage without request paths, headers or
SDK invocation identifiers. Later requests cannot replace the first refusal.
Native HTTP checks still require refused requests to return 400 without forwarding
or publishing accounting, and include a successful forwarding control.

The [PR620 cost refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40600605206/job/122527571695)
reported request-validation at stop's idle step without identifying its check.
Its cause remains unknown. Reproduce the next labelled recurrence before changing
transport, stop, accounting or cleanup rules. Use the authorised Linux test box
for reproduction; these native checks do not qualify the genuine storage backend.

The first D378 qualification also found an absent fiscal worker identity in
[CI40604297872, job122540422831](https://github.com/waitron-io/waitron-cloud/actions/runs/40604297872/job/122540422831).
Its cause remains unknown. [PR711](https://github.com/waitron-io/waitron-cloud/pull/711)
removed the obsolete allocator, two-worker test and D380 diagnostic helper. This
historical failure no longer has a running Cloud fixture to reproduce. Migration
038 and dormant fiscal records remain governed by the registry retirement boundary.
This diagnostic qualification does not establish either historical cause.

Run `node --test scripts/cloud-cost/litestream-request-validation-diagnostics.test.mjs scripts/cloud-cost/litestream-close-diagnostics.test.mjs`
for the native HTTP controls. Diagnostics already landed in PR622, commit
`975395ec0dc590c8f5f7a7df7b821d9883e2d097`.

### Litestream after-stop admission diagnostics (D381)

You can now identify the exact refused admission guard in the stop checkpoint,
independent request audit and sanitized close record. Fixed categories distinguish
poisoned state, input shape, hop and phase, row metadata and identity, row capacity
and operation, duplicate admission, retry sequence, observer pairing, post-stop
operation and ordinal, clock order and the three-attempt bound. Later refused
calls retain the first admission cause. Producer and observer share the tracker,
so a later poisoned hop reports the earlier hop's cause. No request paths, headers, invocation
identifiers or accessor values are published; every existing refusal and accounting
rule remains in force.

The [PR622 merge refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40611462709/job/122563803926)
named after-stop admission without its inner guard. Its underlying cause remains
unknown. Reproduce a labelled recurrence before changing admission, stop, retry,
accounting or cleanup. Native controls exercise each category and real HTTP
refusal. Use the authorised Linux test box for genuine-backend reproduction;
the native controls do not qualify that backend. Current-head Linux CI must still
qualify the genuine backend before landing.

Run `node --test scripts/cloud-cost/litestream-admission-diagnostics.test.mjs scripts/cloud-cost/litestream-close-diagnostics.test.mjs`
for the native controls. Diagnostics already landed in PR625, commit
`d0a970e75d9c297ea56630c8963d9505c5cb3bf7`.

### Litestream refused operation and attempt diagnostics (D383)

The [PR625 merge refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40615344423/job/122576493560)
identified a non-list operation after stop, but omitted the operation and whether
it was an initial attempt or a retry. You can now read both fixed categories from
the validated internal row in admission errors, independent audit checkpoints,
transport checkpoints and sanitized close reports. Later poisoned calls retain the
first shared producer or observer cause, without adding their own request details.
Earlier refusals keep their existing context-free shape, including after stop.
Later clock and affected-attempt refusals retain the validated list and initial
attempt categories. Request identifiers,
paths, headers, arbitrary caller values and accessor output stay private.

Native controls exercise initial attempts and retries, shared first-cause retention,
real HTTP refusal and the privacy filters. Every original admission, stop, retry,
accounting and cleanup rule, assertion and deadline remains unchanged. The cause
of the historical refusal is still unknown. Reproduce the labelled operation
before changing runtime rules. Use the authorised Linux test box for genuine-backend
reproduction; native controls do not qualify that backend. Current-head Linux CI
must still qualify the genuine backend before landing.

[PR627's first qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/40617804734/job/122584381707)
reported three PostgreSQL statement timeouts in registration shard 5: two during
migration setup and one while creating an account fixture. Their cause is unknown.
D385 now labels those setup boundaries, so a changed qualification can retain more
evidence if they recur. Preserve the failing assertions and five-second database
limit, then reproduce a labelled failure before changing runtime rules.

Run `node --test scripts/cloud-cost/litestream-admission-operation.test.mjs scripts/cloud-cost/litestream-close-diagnostics.test.mjs`
for the native controls. Diagnostics already landed in PR627, commit
`4864bbfecea8f3e59cfa76566aab0a30a7db8220`.

### Registration SQL setup failure diagnostics (D385)

A registration setup failure reports its fixed boundary and, for migration
work, its ordinal in the shipped migration list. You can distinguish the advisory
lock, ledger creation and compatibility check, migration loading, lookup,
application and ledger recording, and transaction start or finish. Relay fixtures
identify schema creation, migration setup, issuer creation, the bounds clock, relay
configuration, venue preparation, each initial insert, session creation, grant
approval and lease construction. These failure-only records omit SQL,
parameters, schema and account names, credentials and caught error values.
Original errors, query text and arguments, rollback, cleanup and the five-second
statement limit stay in force. Successful setup remains silent.

[PR627 qualification](https://github.com/waitron-io/waitron-cloud/actions/runs/40617804734/job/122584381707)
refused two migration applications and one relay account insert with PostgreSQL
statement timeouts. The historical cause remains unknown. Native controls cover
labelled refusals and reporter failures; they do not reproduce these timeouts
against PostgreSQL. Use the authorised Linux test box for genuine PostgreSQL
reproduction, or inspect the next labelled CI recurrence. Reproduce the cause
before changing queries, transaction rules, concurrency or timeouts.
The [D383 diagnostics above](#litestream-refused-operation-and-attempt-diagnostics-d383)
already landed; neither diagnostic delivery establishes a runtime repair.

Run `node --test packages/registration/test/sql-setup-diagnostics.test.ts`
for the native controls. Diagnostics already landed in PR629, commit
`7ac885100ba5771fc6aeff7245b9e10d5295d8a2`.

Return to the [backlog index](../backlog.md).
