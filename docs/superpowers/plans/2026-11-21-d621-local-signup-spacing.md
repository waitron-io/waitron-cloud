# D621 local signup spacing

The outside-venue Linux rehearsal can start each later machine stop with
room for a signup request and a retry. The primary-first replay exhausted the
rehearsal's allowance after an injected timeout. Expiring the oldest call
restored signup within 16 seconds. The live run delivered mail on both stops
without HTTP 429, then failed at the returning machine's outside storage port.

Codex wrote this plan and Claude reviewed it. In Lane G questions.md on
21 November, the watcher cleared the scope at 07:06 and the plan at 07:47.
The scope was:

> Cleared: (1) the rehearsal waits long enough for its own signup allowance to free a retry before starting the next recovery clock, caps and the 90-second deadline unchanged; (2) the focused storage-return run with the direct-pod and port capture, since the metrics timeout came back; then one full dry run.

1. Add `signupDelayMs()` to the existing budget in `scripts/p1-observer.mjs`.
   Use its monotonic clock and signup timestamps to calculate when at most
   six calls are recorded in the 15-minute window, leaving two of eight free.
   Both endpoints, setup calls and failed calls still count. In
   `scripts/test-cloud-integration.mjs`, pass a second `spaceSignup(signal)`
   argument to `stopServices` only when `kubernetes.amazon` is absent. Log
   a positive delay before sleeping and recheck after waking. Pass the
   callback to `measureServiceStops` in `scripts/kubernetes-services.mjs`
   and await it under the stop signal after a healthy return when another
   leg remains. The next inventory and recovery clock start afterwards.
   With two calls free the wait is zero. The six-minute hold and 90-second
   recovery bound put the worst wait per gap at about 10 minutes 30 seconds.
   The last complete journey took 31 minutes 42 seconds. With two such
   pauses that projects to about 53 minutes of test time. Give the opt-in
   machine-stop test 54 minutes. The guest’s separate 55-minute limit
   includes setup and can end the test sooner.
2. Test first in `scripts/p1-observer.test.mjs` for zero wait with two calls
   free, exact expiry with seven or eight signup calls, and separate login
   accounting. In `scripts/kubernetes-services.test.mjs`, show the
   callback holds back the next stop and observer, runs only between
   healthy legs, and can abort without another stop. Run both files and
   `scripts/test-cloud-integration.test.mjs`. Expect about 25 lines of code
   and 60 lines of tests, plus short updates to `docs/backlog.md` and
   `docs/aws-infrastructure.md`.
The pull request covers steps 1–2. Run steps 3–4 from the built branch
with the local capture patch and save their results in the lane receipts.

3. Name the focused Linux run and decision in `progress.log`. Reuse
   `receipts/d621-run9-dry-run/metrics-return-capture.patch` from Lane G.
   Compare both direct pod counts, the bridge and the guarded outside port
   within the existing rejoin deadline. Stop for product investigation if
   either pod fails to count all drives, repair fails, or a working direct
   and bridge path points to a fault in shared outside routing. Isolate
   any local fixture fault before qualifying the next run.
4. Run one full local dry run with capture and cold restart enabled after
   the focused run passes or a demonstrated fixture fault is fixed. Require
   all three repairs, cold restart, fresh restore and confirmed guest
   removal within the existing test and guest limits. Record actual holds
   and local signup pauses, and report the hold-adjusted Stockholm timing
   required by the watcher's 01:21 dry-run decision. Billing and launch
   readback and the paid run remain open.
