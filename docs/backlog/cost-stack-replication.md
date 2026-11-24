# Cost-stack replication interruption (D152)

**Open:** the historical causes, and a trustworthy boundary for "all background storage work has
finished" that survives the genuine storage and restore journeys.

The owner decided against a custom Litestream binary on 25 October. Keep the official release
and its pins. The [after-stop accounting design](../superpowers/specs/2026-10-24-litestream-native-drain-design.md)
replaced it with a small, separately counted shutdown allowance (at most three affected
attempts), shipped in #437. Keep the acceptance guard, the two-second stop budget, the
three-attempt cap, ordinary accounting, restore assertions and every deadline. A generic
`active-close`, a broken pipe and any interrupted exchange still refuse measurement.

What controlled experiments establish (none identifies a historical event):

- Stopping on a committed PUT's held reply cancels the exchange, and the fixed smoke waits for
  it. A client that closes early reproduces `response-pipeline` with `put` or `list`.
- `POST /stop` can return `stopped` while a snapshot-retention LIST is unfinished
  (`Store.monitorCompactionLevel` → `Store.EnforceSnapshotRetention`), and a later LIST can
  start after the transport first reads idle. The
  [store monitor](https://github.com/benbjohnson/litestream/blob/v0.5.17/store.go#L560) uses the
  store context, while the [stop handler](https://github.com/benbjohnson/litestream/blob/v0.5.17/server.go#L221)
  disables only the database. So an idle transport, a stop reply and a zero exit code are not a
  drain, and an admission count does not say when the writer issued a request.
- Waiting through the observed final retention level avoids cancellation with one toy database
  and three levels. It is not a production rule.
- Initial uploads can be admitted after stop: see
  [D393](../backlog.md#initial-upload-admitted-after-stop-d393).

Unexplained refusals to compare a recurrence with: transport close after 21 attempts
([40015106057](https://github.com/waitron-io/waitron-cloud/actions/runs/40015106057/job/120625121669)),
`response-pipeline` on a list
([40099523703](https://github.com/waitron-io/waitron-cloud/actions/runs/40099523703/job/120888687281)),
`ERR_STREAM_PREMATURE_CLOSE` with equal bodies but different outcomes
([41303338930](https://github.com/waitron-io/waitron-cloud/actions/runs/41303338930/job/124838744224),
[nightly 41990933182](https://github.com/waitron-io/waitron-cloud/actions/runs/41990933182/job/127137641411)),
and `active-close` at stop
([40144823848](https://github.com/waitron-io/waitron-cloud/actions/runs/40144823848/job/121023853072)).
Reproduce a new diagnostic recurrence before changing transport, accounting or cleanup.
Official-binary truncated streams, production shutdown and real process-exit timing are
unqualified.

### Broken-pipe shutdown investigation (D270)

[Cost run 40216346521](https://github.com/waitron-io/waitron-cloud/actions/runs/40216346521/job/121238245625)
refused at the stop's idle step with `EPIPE` and one unsettled accounting attempt. A caller
closing while a large list reply starts reproduces the error; attribution needs a labelled
recurrence.

### Delayed PUT shutdown investigation (D268)

The committed-PUT-reply check refused at `idle` with one pending exchange
([40181699752](https://github.com/waitron-io/waitron-cloud/actions/runs/40181699752/job/121133970845)),
and again in the [PR823 merge](https://github.com/waitron-io/waitron-cloud/actions/runs/41243190309/job/124661299921)
with a PUT 498 ms old at the 2,002 ms refusal. The fixture now orders uploads by transaction;
it cannot see transactions still inside the writer or predict later uploads. Stop refusals keep
up to sixteen upload records; use them to investigate the remaining idle timeout.
