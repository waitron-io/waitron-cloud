# D621 Stockholm failure evidence

The next Stockholm rehearsal should tell us whether PostgreSQL on a surviving machine restarted when its neighbour stopped. Two paid failures lost Account database connections about ten seconds after a stop and logged `57P01`. Run 2 stopped earlier because a separate checkout lacked a dependency. The launch-host import succeeded after a locked install. [D621 backlog](../../backlog.md#platform-work-to-scope) · [Session retry plan](2026-11-26-d621-passive-session-retry.md)

## Dry run on the launch host

Add a dry-run option for measured stops in `scripts/amazon-run.mjs`. Use one clean, installed candidate checkout for both runs. Exercise the paid launcher's local setup through the image bundle check. Check host tools, import the measured services and backup modules, archive the source, and build and verify the Linux amd64 bundle with the pinned Waitron and Flux assets. Report the exact commit and image IDs, then clean up owned local files and images. The dry run exits before the first AWS call, including identity and quota checks. Remote machine setup starts in the paid run.

## Record failures and finish the sequence

- Give `observeP1` in `scripts/p1-observer.mjs` an opt-in evidence mode. Record each rejected or overdue post-recovery probe once, with probe name, elapsed time and reason. Cancel overdue probes at the existing deadline and keep sampling. A failed final backup read ends that check as a failure. Keep the normal fail-fast mode and the same-cookie retry deadline.
- In `scripts/kubernetes-services.mjs`, start sampling before each stop, including the full restart. Once a second through rejoin, resolve the writer and query `pg_postmaster_start_time()` in its pod. Record timestamp, node, pod name and UID, restart count and last exit reason. Bound each request and mark gaps. Capture previous PostgreSQL logs from each pod, operator and Flux logs, and cluster events around each stop and rejoin. Correlate them with the existing request timing and SQL error codes. Retain private output with secrets removed.
- Carry the failures through `measureServiceStops` and the retained-client path in `scripts/test-cloud-integration.mjs`. Finish the three stops, full restart, retained backup read and isolated restore of a new capture when the existing fault, rejoin and cancellation gates permit. Print the evidence and every failure, including partial results on abort, before teardown. A single failed read after recovery still makes the result fail. Keep the existing signup and inbox checks. The separate staff-notice, inbox and Billing trials wait for a later run. Update the D621 backlog entry with the evidence obtained.

## Checks and finish line

Write focused failing tests first, then rerun `node --test scripts/{amazon-run,p1-observer,kubernetes-services,test-cloud-integration}.test.mjs`. The launcher tests prove the dry run never calls AWS and the failed receipt survives teardown. The observer tests check deadline handling, continued sampling and the strict default. The service tests check the writer evidence and gaps. The retained-client test checks that a failed read reaches the later stops, restart and restore and still yields a failed result.

Save the exact-candidate dry-run receipt and one paid report with completed stages, failures, evidence gaps and independent teardown verification. The owner’s 08:11 approval covers ten runs with fixes first in free. The watcher’s 19:47 direction allows this evidence run without another free attempt to reproduce the service failure. Two slots were used. The next uses one slot, three machines, at most 150 minutes and about USD 2.17. Expect 200 code lines and 130 test lines. Build after Claude review and watcher clearance.
