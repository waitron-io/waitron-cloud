# D621 local signup spacing

An operator can run the outside-venue Linux rehearsal through three machine
stops and a full restart with a fresh signup retry available before each
subsequent stop. The Lane G watcher cleared the sequence on 21 November at
07:06. Codex wrote this plan. The timed dry run, billing and launch readback,
and paid Stockholm qualification remain open.

The replay of the primary-first trace reproduced the 90-second failure after
one injected transport timeout used the last local signup attempt. Expiring
the oldest call restored recovery in 16 seconds. The live trace delivered
mail on both stops without HTTP 429, then failed to count drives through the
returning machine's outside storage port.

1. In `scripts/p1-observer.mjs`, add `signupDelayMs()` to the existing budget.
   Read the same monotonic clock and timestamps to find when at most six
   calls remain in the 15-minute window. This restores the existing
   two-attempt reserve under the eight-call cap. Both endpoints, setup calls
   and failed attempts still count. In `scripts/test-cloud-integration.mjs`,
   pass a callback for local measured stops through `stopServices`. In
   `scripts/kubernetes-services.mjs`, invoke it with the enclosing stop
   signal after a healthy return and before the next inventory or recovery
   clock. Log any wait in milliseconds. Both sets of request limits, the
   90-second recovery deadline and the six- and 15-minute holds stay in force.
2. Test first. In `scripts/p1-observer.test.mjs`, show there is no wait when
   two calls are free and that the recorded timestamps free two calls at the
   exact boundary. In `scripts/kubernetes-services.test.mjs`, hold the
   callback open to show the next observation and stop wait for it, between
   legs only. Keep the existing assertions. Run those two files and
   `scripts/test-cloud-integration.test.mjs` by name. Expect about 35 lines
   of code and 55 lines of tests, plus short backlog and guide updates in
   `docs/backlog.md` and `docs/aws-infrastructure.md`.
3. Reuse the saved disposable storage capture for one focused return run.
   Compare both pods' own drive counts, the bridge port and the guarded
   outside port under the existing rejoin deadline. Persistent missing
   drives or failed repair needs storage investigation. Healthy direct
   counts with a failing port need the route traced to locate the fault.
4. Run one full disposable Linux dry run using the same outside-venue test,
   with the diagnostic capture available and the cold restart enabled.
   Require all three rejoin and repair checks, cold restart, fresh restore
   and verified guest removal. Record actual wall time and each signup
   wait. For the Stockholm projection, subtract measured local-only pauses,
   replace the three measured holds with 15 minutes each, and report the
   single-stop and cold-restart timings against the launcher windows. The
   48-minute test, 55-minute guest and 150-minute launcher limits apply.
