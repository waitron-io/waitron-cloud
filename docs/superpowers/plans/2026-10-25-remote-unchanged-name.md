# Unchanged remote hostname implementation plan (D259)

**Execution:** Inline, one bounded portal task, under the unattended lane authorisation.
**Production files:** `apps/portal/src/remote-controller.ts`, `apps/portal/src/remote-screen.ts`.
**Spec:** D259’s portal-only requirements and the three recorded owner approvals.

**Goal:** Prevent unchanged remote-access names from reaching review or apply, using a portal-only guard.

**Scope:** Compare the cleaned input with the selected saved name. The owner approved the three test setup changes below; preserve all their assertions and deadlines. No server change.

1. **Confirm scope before implementation.** Recheck current main and active file reservations. Keep changes within the remote controller, screen, focused tests, and a new D259 section in `docs/backlog.md`. Leave server behavior and unrelated backlog sections untouched.

2. **Write failing regressions first.** Create `apps/portal/test/remote-unchanged-name-browser.test.ts`, bundling the real portal against stubbed account routes. Cover assigned and saved custom names, staff/public selection, untouched input, and equivalent whitespace/case/single-trailing-dot forms. Assert Review is disabled, Enter cannot review, confirmation stays absent, and no DNS or apply request occurs. Include changed-name preview/apply and custom-to-assigned controls. Run EN/ES at 390 px first and record the expected failures.

   Add direct tests in `remote-controller.test.ts`: call `preview()` despite the disabled UI, then `apply()`, and assert no confirmation or mutation request. Cover both kinds, comparison against the selected kind’s **current** name, and a name becoming unchanged after saving. Preserve existing invalid-input, permission, cooldown, stale-response, and uncertain-write assertions.

3. **Make exactly the three approved setup adjustments.** Retain every existing assertion, behavioral check, and deadline; document all three in the PR.

   - `installation-pending-browser.test.ts`: enter a different custom hostname before Review and provide its valid two-record DNS stub, preserving confirmation and all installation-refresh checks.
   - `remote-save-reconciliation.test.ts`: parameterize the starting saved current name. Where the unsuccessful-save case would otherwise remain assigned, start from a genuinely different saved custom name. Keep the requested custom target distinct from that starting name. Assert reconciliation returns either the committed target or the original saved name, then retain the timed switch back to assigned, request counts, revision, notices, and cooldown boundaries.
   - `remote-hostname-enter-browser.test.ts`: change only the hostname entered for the final rate-limit attempt to a different valid name. Retain pending, malformed-input, rate-limit, and Enter-never-applies checks.

4. **Implement the minimal shared guard.** Add a controller getter used by both `preview()` and `remote-screen.ts`. Compare input after trimming, lowercasing, and removing exactly one trailing dot with `view.names[kind].current`. Disable Review when unchanged and return from `preview()` before validation, confirmation creation, or requests. Preserve existing pending, cooldown, placement, revoked-access, and permission gates. Keep changed custom names on the DNS path and changed assigned names on the existing confirmation-without-DNS path. Retain the Enter handler and uncertainty reconciliation.

5. **Verify natively, without Docker.** Run focused controller, hostname-length, reconciliation, Enter-browser, pending-browser, hostname-field, and new regression tests using Node’s test runner with existing deadlines. Run portal typecheck and build. Exercise and inspect all eight EN/ES × light/dark × 390/1280 visual views, checking disabled controls, confirmation behavior, and overflow. Save receipts.

   In disposable copies, delete the screen guard and controller guard separately: browser and direct-controller regressions must respectively fail. Restore each guard and confirm passing controls.

6. **Finish and land through the required gates.** Add the owned backlog section, make signed-off commits, and announce readiness for `finish-branch`. After its initial rebase, obtain one Claude run-it whole-branch review in a disposable checkout; resolve findings, preserve hooks, and require full green CI on the current head. Then perform the authorised landing under the repository’s landing lock, rechecking the approved head and mergeability. Require full CI on the exact merge commit before reporting completion. Complete authorised main install and own-branch cleanup while holding the shared landing lock.
