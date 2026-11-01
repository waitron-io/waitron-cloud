# Cost-stack isolation command refusal (D152)

The earlier native-batch case refused during isolation, with command exit 1 after
1,043 milliseconds. An instrumented recurrence in [D163's exact-merge cost run
40041135283, job 120712388129](https://github.com/waitron-io/waitron-cloud/actions/runs/40041135283/job/120712388129)
refused the Litestream body-byte case before its workload: `outbound-canary`,
exit 1 after 2,924 milliseconds, stderr category `container-state`. That category
covers both a missing container and one that is not running. Neither record
identifies the affected service or explains why its state changed.

A failed outbound command now inspects its previously validated container ID
before cleanup. The report retains only the service role, a known state, running,
exit code, out-of-memory, dead and restarting flags. Missing containers and
unavailable or timed-out inspection have explicit categories. The extra read is
limited to 1.5 seconds and 8 KiB; an inspection failure preserves the original
refusal and owned cleanup. Raw errors, identifiers, paths and unknown fields
stay private. Controlled Docker-free checks exercise these boundaries. A Linux
case deliberately stops this invocation's storage service before its isolation
command and checks both refusal and cleanup. Independent Linux observations
also exercised the original eight-case group: [run 40042726726](https://github.com/waitron-io/waitron-cloud/actions/runs/40042726726)
passed the new control and all eight original cases on each of four runners,
36 checks in total, without a historical recurrence. The temporary investigation
workflow is removed; the new control remains in ordinary conformance CI. A second
Linux check exits the child abruptly after stopping its storage service. The
parent's fallback requires recorded creation IDs plus fresh owner, project and
name checks before removing a resource; matching labels alone cannot authorise
removal. Native controls cover foreign identity and ownership refusals.

A later instrumented recurrence in [PR362 cost run 40054514898, job
120754852118](https://github.com/waitron-io/waitron-cloud/actions/runs/40054514898/job/120754852118)
identifies the gateway: exited with code 1, without an out-of-memory kill, dead
state or restart. Its binary output was discarded, so this does not explain
why HAProxy stopped. The generated gateway now retains a private failure record
before exiting. Only fixed categories for name resolution, socket binding,
certificate loading, child exit, signal or process creation are retained, with
bounded exit metadata. Raw output stays private and only its first 8 KiB are
inspected. Failure output drains for at most 250 milliseconds after the master
exits; an orderly stop does not wait for descendants holding stderr open.
Synchronous and asynchronous process-creation failures retain the same fixed
categories. The parent reads at most 1,025 bytes of a private regular file before
cleanup, validates every field and rejects unknown fields or values. Missing
or invalid evidence preserves the original refusal. Real child-process checks
cover the categories, split output, large output, signal and spawn failures;
a Linux control forces a real HAProxy name-resolution failure and checks that
the parent retains its category and removes the owned resources. This
controlled failure does not establish the historical recurrence's cause.

A new instrumented recurrence in [PR369 cost run 40062864377, job
120780089952](https://github.com/waitron-io/waitron-cloud/actions/runs/40062864377/job/120780089952)
identifies a HAProxy name-resolution failure: gateway exit 1 during the outbound
check, after 1,754 milliseconds, without an out-of-memory kill or restart.
A controlled Linux regression starts the generated gateway first through its
real Compose plan. Without a backend dependency, HAProxy exits with the same
name-resolution category. The generated gateway now depends on the Waitron
service reaching its started state, so its backend joins the private network
before HAProxy resolves `waitron:8080`. The regression then requires all six
services to become ready, all isolation checks and owned cleanup. This fixes
the reproduced ordering defect; attributing the earlier intermittent event to
that order remains an inference. The separate replication interruption remains
open.

The strict 4.01-second streamed-day control covers setup as well as later
phases. A slow setup can consume that budget before idle begins, as observed
in [run 40064831558](https://github.com/waitron-io/waitron-cloud/actions/runs/40064831558).
Following the owner's 24 October decision, this control requires refusal after
the original deadline in whichever phase it reaches, unchanged source data,
removed private state and collection of every child actually started. It also
checks that each recorded child has exited. A separate native control enters
idle before firing the unchanged deadline callback; real HTTP, SQLite and
child processes must be collected before another caller operation. An opening
control fires that same deadline while storage setup is held. Removing the
deadline makes both native controls fail; restoration passes. Only the deadline
clock is controlled in these native cases; the full Linux streamed-day journey
keeps its real clock. All runtime timers, budgets and isolation checks remain.
Local Docker-backed checks are unavailable while Docker is down; GitHub CI
supplies that evidence.

### Local signal check stopped before worker admission (D502)

The SIGINT cleanup check failed on main `d94391a3` in
[cost run 41003177471](https://github.com/waitron-io/waitron-cloud/actions/runs/41003177471/job/123892097439)
before it observed an admitted worker. Its log did not retain the child outcome
or preparation stage, so the cause remains unknown. On a failed SIGINT or
SIGTERM check, you now get bounded exit status, signal, output byte counts,
forced-collection state, elapsed time and the last recognised journal stage
before fixture teardown. Raw streams, paths, tokens and resource IDs remain
private. Run `node --test scripts/cloud-cost/local-command-diagnostics.test.mjs`
for the native controls, including a real child exit.

Keep the admission, cleanup and private-output assertions and both existing
timers. Attribute any new failure from this evidence before changing the
controller or signal handling. Use the shared Linux test box through the
campaign's `test-box-run.sh` helper while the Mac's Docker is off.

#### Linux reproduction on 1 November 2026

At Cloud commit
[`7e1b76c0`](https://github.com/waitron-io/waitron-cloud/commit/7e1b76c0cc876f2099fde0dcdd5c2b13de95a49c),
both unchanged signal checks pass: SIGINT in 6.35 seconds and SIGTERM in
5.22 seconds. Run this selection on the test box:

```sh
node scripts/cloud-cost/conformance.mjs \
  --only isolated-replay-conformance.test.mjs \
  --pattern '^localCommandWaitsForOwnedCleanupOn_'
```

The current third conformance group also passes all 25 cases in its original
order, including the preceding genuine-writer check. SIGINT takes 5.28 seconds
and SIGTERM 5.27 seconds; the complete group takes 194.70 seconds. Run it with:

```sh
node scripts/cloud-cost/conformance.mjs \
  --only isolated-replay-conformance.test.mjs \
  --pattern '^(?!(?:^isolatedController|^(?:isolatedHost|streamResultReporter)))' \
  --skip-pattern '^isolatedController|^(?:isolatedHost|streamResultReporter)'
```

The controller, local execution helper, command reader and command entry point
are byte-identical to historical head `d94391a341a6d8fb96ca74aa548e04a4eaf73dde`,
checked with `git diff --exit-code d94391a341a6d8fb96ca74aa548e04a4eaf73dde 7e1b76c0 -- scripts/cloud-cost/isolated-replay.mjs scripts/cloud-cost/local.mjs scripts/cloud-cost/run-local.mjs scripts/cloud-cost/cli.mjs`.
The current fixture includes later failure reporting. All original signal-case
assertions, the 10 ms observer interval, 20-second forced collection and
30-second synthetic writer hold remain. The native diagnostic suite passes
eighteen checks, including real child exit and hangup controls.

These observations do not reproduce the historical 31.69-second failure or
qualify its complete environment. Keep the cause open and collect a labelled
recurrence. Read `local-command-refusal` first: `childClosed`, `status`, `signal`
and `timerFired` distinguish the recorded child outcome from forced collection;
`workerStarted` and `lastPreparation` locate its recorded progress. These are
directions for investigation, not an explanation of the historical event.
