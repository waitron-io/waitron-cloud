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

