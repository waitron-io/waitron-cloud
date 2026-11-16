# Browser reconnect historical reset attribution

**Open.** The earlier Linux socket resets do not all have an attributed cause.
Waitron's [lifecycle repair](https://github.com/clintongormley/waitron/pull/2279)
and Cloud's stronger readiness qualify the later consumer observations, rather
than explain every earlier failure. Keep the refusing traces below for a matching
recurrence; a passing retry is not a repair.

Both CPU groups in [run 42296821904](https://github.com/waitron-io/waitron-cloud/actions/runs/42296821904)
completed all 24 samples and the six original fault controls. The separate
observation workflow and its private instrumentation are retired under D638.
The ordinary cost-conformance journey and all eight current fault variants remain.

## Retained refusing traces

| Run | Refusing sample and observed route |
| --- | --- |
| [40920925400](https://github.com/waitron-io/waitron-cloud/actions/runs/40920925400) | First browser-facing reset trace; sample and cancelled route were not identified in this record. |
| [40922185069](https://github.com/waitron-io/waitron-cloud/actions/runs/40922185069) | Ordinary sample 13: live-stream cancellation; single-CPU sample 9: API cancellation around reload. |
| [40988995366](https://github.com/waitron-io/waitron-cloud/actions/runs/40988995366) | Single-CPU sample 4: cancelled API request around navigation; endpoint and initiating document unproved. |
| [40990548906](https://github.com/waitron-io/waitron-cloud/actions/runs/40990548906) | Single-CPU sample 22: application closes a connecting live stream before drain/reload. |
| [41023281681](https://github.com/waitron-io/waitron-cloud/actions/runs/41023281681) | Single-CPU sample 8: API reset in the navigation gap; initiating document unproved. |
| [41028304505](https://github.com/waitron-io/waitron-cloud/actions/runs/41028304505) | Ordinary sample 21: unspecified route; single-CPU sample 4: cancelled alerts read without a matching protocol record. |

The native Chromium/TLS reproduction identifies an old page's error callback
starting a late read. Applying that explanation to the historical Linux reset
remains an inference. Connecting-stream replacement and API cancellation around
reload are distinct observations; neither establishes a shared cause.

## Preserve the measurement boundaries

Keep the original three-second readiness deadline, browser waits and fault
controls. Do not accept socket resets, discard interrupted bytes, close streams
before reload or retry a failed sample to qualify a journey. A cancelled stream
previously retained a real byte-count disagreement; agreeing local counters do
not prove Chromium consumed the response. Accounting gaps keep their current
reporting rules; this retirement changes no accounting success condition.

Readiness covers the top-level dashboard. Whether the genuine page navigates
during a drain or opens a child-frame stream remains unverified. Retain a matching
trace before extending that scope. Keep URLs, headers, initiators and abort reasons
private while collecting fixed route categories and numeric socket/request facts.
The separate storage bind-refusal history belongs to the
[storage investigation](storage-cache-fixture.md).

Cloud's browser pin is `99c265981ba98f1afd0e5fc822624a9a91822ad2`; historical
replay measurements still use `fbadd15785464e59747e697c11048bfbc6e4938f`.
Those pins have distinct provenance. D638's scoped pruning supersedes the older
replay-design instruction to leave this investigation's prose unchanged, while
preserving that historical replay pin.

Run the active boundaries with:

```sh
node --test scripts/cloud-cost/browser-readiness.test.mjs scripts/cloud-cost/remote-refusal-evidence.test.mjs scripts/cloud-cost/browser-relay-evidence.test.mjs
```
