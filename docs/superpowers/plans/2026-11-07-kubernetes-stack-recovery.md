# Kubernetes stack recovery implementation plan

> Implement inline, test first, after Claude reads this plan through `~/workspace/tools/claude-seat.sh review-branch`. This delivery edits only this plan; no code, tests, commits or AWS calls.

**Approval:** WATCHER, `/Users/clintongormley/waitron-campaign-g/questions.md`, **2026-11-07 16:29**:

> **Fix:** remove the reservation
>
> Because the reservation also kept the sweep to one run at a time, make the sweep safe to overlap (or show it already is), test first, with a test that fails if two overlapping runs could double-act.

**16:31 OWNER:**

> Retry after a clean down

This supersedes the no-retry plan. You may retry failed setup only, with no machine launched, after same-folder `down` verifies all owned AWS resources gone through existing guards. Preserve every original private byte. Keep fresh opening plus fresh reservation strictly below USD10. No new owner folder, general budget release, second completed drill, lock or protocol.

- [ ] **1. Reservation and overlap.** Replace the approved `deploy/kubernetes/proof/setup.test.mjs:233` reservation pin with property-absence assertions for both renderers; observe failure, then remove `ReservedConcurrentExecutions` from `setup.yaml`. In `expiry.test.mjs` and the rendered-Lambda fixture, synchronize overlapping runs over shared fake inventory. Cover same-ID termination, deletion returning not-found and root-disk reads racing termination. Assert one effective transition, exact owned targets, fresh/foreign/attached resources preserved, independent cleanup continuing and no heartbeat after refusal. Repeated requests are acceptable. Keep `expiry.mjs` unchanged unless tests demonstrate otherwise; preserve disk guards. A heartbeat confirms a completed request pass, not physical deletion.

- [ ] **2. Named refusals.** Test first in `scripts/kubernetes-proof-control.test.mjs`; minimally change `createManualFirstSetup` and checked CLI dispatch. Label time, template, stack-ID and status refusals. Read one bounded events page for the validated exact stack; report validated status and allowlisted fixed text for the known Lambda minimum-unreserved-concurrency failure. Withhold arbitrary reasons. Test missing/malformed/oversized/control-character/secret-bearing events and diagnostic failure; preserve original refusal, stderr suppression, predicates, waits and 51,200-byte limit.

- [ ] **3. Same-folder recovery.** Test command-level rollback→down→up before implementation in `scripts/kubernetes-proof-control.mjs`. Keep original root files untouched, including prices, `setup/`, any `initialized.json`, `launch.json` and `history/`. After guarded export, exact stack deletion and verified resource absence, failed-setup-only `down` exclusively publishes private `release.json`: cleanup time/reason, exact stack identity and hashes of original private files, opening and booking. Release eligibility excludes initialized/completed setup or any launch/run evidence; normal down remains available. Stage, sync and validate publication; pending/partial persistence or any file failure refuses recovery without erasing evidence.

  `up` validates release and original bytes, then exclusively creates `retry/` inside the same folder. Route every current setup, initialized, launch, reconcile, down and history consumer there; originals remain the prior attempt. Existing `retry/` prevents another up. Render current fixed code; preserve prior amounts as history and use fresh billing/price guards. Never reset monthly history. Assert byte-for-byte preservation across the connected regression. Retain wrong-owner/tag/time/type, live-instance/interface/disk and export-failure refusals. Test absent release, incomplete/uncertain cleanup, altered release/booking, existing launch, interrupted writes/syncs, and opening+reservation equal to or above USD10; assert no creation or launch.

- [ ] **4. Verify.** With Node 26, run focused new/affected tests by explicit file and name; inspect counts. CI owns full file/package suites. Run pinned template validation. Update proof README and D570 backlog with local evidence, limits and same-folder down→up instructions. List the approved changed assertion under **Changed test checks**; complete branch review/CI before owner use.
