# Cost conformance fixture investigations

Every cause below is unexplained unless it says otherwise. Keep pins, attempt limits, budgets,
checksums, cancellation, accounting, cleanup and deadlines; inspect the next labelled failure
before claiming a repair. A passing run explains nothing.

### Fixture archive download retries (D311)

Downloads retry HTTP 5xx, resets and 30 seconds of silence within a shared 120-second budget.
Unexplained: HTTP 504 on the SeaweedFS archive
([40373727040](https://github.com/waitron-io/waitron-cloud/actions/runs/40373727040)), a body
stalled at 10,237,952 bytes ([40811399202](https://github.com/waitron-io/waitron-cloud/actions/runs/40811399202/job/123243127986))
and HTTP 500 on all three Litestream attempts
([41139422264](https://github.com/waitron-io/waitron-cloud/actions/runs/41139422264/job/124349848462)).
Responses now carry fixed service labels.

### Replay close scheduling (D530)

[PR #1225](https://github.com/waitron-io/waitron-cloud/actions/runs/43719646426/job/132828722954) and
[PR #1227](https://github.com/waitron-io/waitron-cloud/actions/runs/43734040435) failed close cases;
two controlled schedules reproduce and fix them
(`node --test scripts/cloud-cost/replay-stream.test.mjs`). The hosted callback order and the
official Litestream shutdown are unqualified.

### Cost fixture timing under ordinary CI load (D530)

[PR #1224's receipts job](https://github.com/waitron-io/waitron-cloud/actions/runs/43706133990/job/132787577662)
exceeded a ten-second image-build limit and a five-second install deadline. Controlled pressure
(24 workers on one CPU) reproduces both; the original runner's load is unmeasured, and the
repaired native-install case still fails its limit under that pressure. On a recurrence, time the
package tool's start inside CI; never raise the limit. The header-progress, exhausted-attempts
and body-stall cases now use a controlled clock; production networks and expiry before a request
reaches the server stay unmeasured.

### Conformance image acquisition during D135 qualification

[Cost run 39977546909](https://github.com/waitron-io/waitron-cloud/actions/runs/39977546909/job/120496895328)
timed out waiting for Docker Hub's token endpoint, and
[41143129809](https://github.com/waitron-io/waitron-cloud/actions/runs/41143129809/job/124361956617)
received HTTP 502 for image metadata. Builds retry metadata 5xx within the original budget.
Fresh Docker-backed qualification and both causes remain open.

### Litestream conformance transport-close refusal (D141)

[Cost run 39987879658](https://github.com/waitron-io/waitron-cloud/actions/runs/39987879658/job/120531832768)
lost its original error. Close, result-assembly, request-validation, admission and refused-attempt
diagnostics now keep the first refusal without private content. Still to attribute:

| Refusal | Evidence |
| --- | --- |
| Result assembly after clean closes (PR556) | [40433930926](https://github.com/waitron-io/waitron-cloud/actions/runs/40433930926/job/121958110536) |
| Delayed committed PUT aborted at stop (G474) | [40961277969](https://github.com/waitron-io/waitron-cloud/actions/runs/40961277969/job/123754465362) |
| Body-byte comparison at `replication-meter-snapshot` (D513) | [41105691430](https://github.com/waitron-io/waitron-cloud/actions/runs/41105691430/job/124234895797) |
| Request validation at stop idle (D378, PR620) | [40600605206](https://github.com/waitron-io/waitron-cloud/actions/runs/40600605206/job/122527571695) |
| After-stop admission (D381, PR622) | [40611462709](https://github.com/waitron-io/waitron-cloud/actions/runs/40611462709/job/122563803926) |
| Non-list operation after stop (D383, PR625) | [40615344423](https://github.com/waitron-io/waitron-cloud/actions/runs/40615344423/job/122576493560) |
| Registration SQL setup timeouts (D385, PR627) | [40617804734](https://github.com/waitron-io/waitron-cloud/actions/runs/40617804734/job/122584381707) |

For D513, use `meter.snapshotRefusal`, `meter.firstInvalidation` and `meter.pendingAttempts` from
the next `litestream-result` record; do not repeat the passing body-byte baseline without a new
trigger.
