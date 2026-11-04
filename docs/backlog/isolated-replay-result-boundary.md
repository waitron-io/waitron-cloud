# Isolated replay result-boundary refusal (D297)

An altered-stream control refused before reading its changed worker result in
[cost CI](https://github.com/waitron-io/waitron-cloud/actions/runs/40281251676/job/121434888588).
The counts variant failed again in [D543 merge CI](https://github.com/waitron-io/waitron-cloud/actions/runs/41202820800/job/124541925301)
before the host read the result, after a clean native replication exit. That trace
names checkpoint admission, but does not identify its refusing guard. A transport
refusal now adds its first fixed reason, request-validation boundary and pending/completed
request counts before cleanup. Controlled HTTP refusals after an idle callback and
a request admitted after that callback retain distinct evidence through worker and
host admission. The earlier preparation/worker/host stages and result-read status
remain available without private output. Existing assertions, deadlines and refusal
rules are unchanged. The unchanged counts case passed on the Linux test box; this
is not a repair of its historical failure. Collect an instrumented recurrence to
identify the cause before changing request or shutdown behavior.

## Current qualification and reproduction

The [Linux host group at Cloud commit 65b81252](https://github.com/waitron-io/waitron-cloud/actions/runs/41847362561/job/126639867964)
passes all thirteen cases, including all three altered-worker controls, the genuine
copy-refusal reporter and actual worker-to-host checkpoint forwarding. Ten relevant
fixture, reporter, transport, controller and runner inputs match current main
`2208befc414b6236bdbc8798082b433f7d0f01d4`. The counts case takes 14.0 seconds.
This recorded run does not explain either historical failure.

Use the campaign's shared Linux test-box helper to run the counts case, then the
host group in its original order:

```sh
node scripts/cloud-cost/conformance.mjs \
  --only isolated-replay-conformance.test.mjs \
  --pattern '^isolatedHostRefusesAlteredWorkerStreamEvidence_counts$'
node scripts/cloud-cost/conformance.mjs \
  --only isolated-replay-conformance.test.mjs --pattern '^(?:isolatedHost|streamResultReporter)'
```

Keep D297 open. On a new failure, read `isolated-stream-result-refusal` first.
`resultRead` distinguishes a refusal before the host reads the result from a
rejected result; `changed` records whether the host saw the intended alteration.
For `checkpoint-admission`, retain the preceding `checkpoint-transport` event,
including its fixed reason, validation stage and pending/completed request counts.
Use those observations to reproduce the refusing operation before changing a guard.
Preserve the result-boundary assertion, deadlines, cleanup rules and private-output
filtering while investigating.
