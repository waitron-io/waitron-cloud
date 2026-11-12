# A1473: retain conditional reads across unrelated writes

**Request and authority:** Lane I `questions.md`, watcher 2026-11-12 02:24: “Yes, the smallest alternative: keep each GET's ETag after writes that do not change that resource, keep the authorization boundary and the protection against an in-flight response crossing a write, with a test that a 409 cancel and the minute's capacity PATCH leave the job-inventory read conditional.” The watcher cleared this correction's scope, not this implementation. A separate Sol/high author drafted the broader quota plan; the driver narrowed it here. Claude must read this plan before build, and the watcher clears the reviewed result.

**Smallest usable result:** the existing controller keeps asking GitHub to validate cached job inventories after unrelated writes, allowing unchanged replies to use 304 instead of throwing away their validators. This addresses a reproduced mechanism, not a promise that busy-hour quota use stays below 5,000.

**Evidence:** Lane I `receipts/firing-20261112-0207/cache-invalidation-probe.log` reproduces unchanged inventory GET200, GET304, cancel POST409, then unconditional GET200. The retained hour has 7,003 HTTP requests, including 905 304s; controller job reads are 1,797 with only five 304s. These HTTP counts are not quota charges. One hour of charged requests, excluding 304s, with category shares is required after publication and before planning the automatic 4,000 switch.

## Files and work

- `scripts/disposable-tests/github-app.mjs`: reuse its bounded ETag/body map and response epoch. Separate discarding bodies on authorization changes from advancing the epoch after every non-GET, including failures. Keep validators after writes and still revalidate every GET; a genuinely changed reply replaces the old body. Preserve the unconditional retry for a conditional response crossing a write and prevent a late pre-write response from repopulating the map. Preserve the 64-entry/4-MiB bounds and returned-body isolation. No caller changes.
- `scripts/disposable-tests/github-app.test.mjs`: first observe a failing loopback HTTP case: job inventory stays conditional after cancel409 and capacityPATCH, and changed inventory returns its new body. Replace only the mutation row of the existing invalidation matrix with the new retention expectation; token-change and missing-ETag checks keep their old assertions. Existing in-flight304, bounds and body-isolation tests remain. Add a focused delayed200 check only if needed to pin late pre-write cache admission. The client owns these rules; callers do not repeat them.
- `deploy/disposable-tests/README.md`: replace its write-invalidation claim with the tested behavior. State that controller publication uses a quiet-queue window rather than a long serial drain while lanes have work queued (watcher 11 November 13:05).
- `docs/backlog.md`: replace the stale completed-hour implication with the reproduced exhaustion, this correction and the pending charged-hour/automatic-switch/overflow qualification.

## Validation and delivery

Run `node --test scripts/disposable-tests/github-app.test.mjs` red, implement minimally, then run that file and the existing admission/automatic-controller consumers (`ci-admission.test.mjs`, `ci-auto.test.mjs`). Use a disposable copy of the old revision for a fixed mixed inventory/capacity/refused-cancel replay; compare total requests, 304s, conditional headers and returned data. Count HTTP requests minus 304s only as the replay's charged-request proxy, not as a live GitHub quota measurement.

Then finish-branch with the required Claude run-it review wave, normal repository gates and current-head CI; land and publish by the existing pinned installer only in a quiet-queue window. Read the installed version and actual quota/request logs; collect one complete hour excluding 304s before the next slice. A busy queue postpones publication rather than draining it.

**Expected size:** production +5/−2; tests +50/−5; docs about +15/−8. No new helper, collector, cache, state field, routing decision, job cancellation, protocol, dependency or schedule. The automatic 4,000/reset switch, memory-sized slots and staged overflow are separate later work.
