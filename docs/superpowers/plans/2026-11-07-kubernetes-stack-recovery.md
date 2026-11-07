# Kubernetes failed-setup recovery

Implement inline with TDD after Claude reads this plan. No lane AWS calls.

Approval is in lane G `questions.md`, outside the reviewer checkout. Relevant dated quotations:

- WATCHER **2026-11-07 16:29**: “remove the reservation”; “make the sweep safe to overlap (or show it already is), test first”; “including the observed StackStatus and the first FAILED event’s reason in the refusal.” The watcher explicitly authorizes replacing the reserved-concurrency assertion.
- OWNER, recorded by WATCHER **16:31**: “Retry after a clean down”. The same note requires the same folder, preservation of the first attempt, release with when/why after verified absence, and unchanged opening plus reservation strictly below US$10.

Preserve existing account, ownership, permission, clock, spending and cleanup checks. Failed setup recovery does not permit another completed drill. Keep original private bytes; no file-hash manifest, staged publication or fixed retry count. These corrections follow the first Claude read; its smaller-scope finding awaits the watcher before landing.

- [ ] **Reservation and overlap:** Replace the approved reservation pin with absence assertions for both renderers; observe red before removing `ReservedConcurrentExecutions`. Synchronize two real sweeper invocations over shared synthetic inventory, including the rendered Lambda. Check exact owned targets, repeated same-ID termination, foreign/fresh/attached resources preserved, and independent cleanup after failure. A repeated deletion returning not-found or a root-disk read racing termination must refuse that sweep’s heartbeat. Requests may repeat; the provider model changes each target once. Keep the engine unchanged if those tests pass. Synthetic checks do not qualify live EC2 behavior.

- [ ] **Diagnostics:** Test distinct setup time/template/stack-ID/status reasons, preserving predicates and waits. On status failure, read a bounded exact-stack events page; identify the earliest non-cancellation CREATE_FAILED resource. Show validated status/resource and a recognized safe reason. Unknown provider text goes only into the owner-only private folder, with its path in the refusal, pending watcher agreement. Test the known Lambda failure, unavailable events and suppression of arbitrary secret-bearing/control text. Keep raw stderr suppressed.

- [ ] **Recover failed setup:** Add command-level rollback→down→up regressions. Release qualifies only for a failed/rolled-back stack whose retained export contains solely setup.json, with no initialized, launch, run or monthly ledger. Before deletion retain its exact stack ID in one small private cleanup/release file; after verified deletion mark when/why released. Reuse privateWrite and sync; retain enough identity to repeat down after deletion accepted, a timeout or interruption. An incomplete local write must prevent deletion, and must be repairable through fresh guarded down. A resumed down checks exact DELETE_COMPLETE identity and remaining owned resources before release; uncertainty never releases.

  Resolve the current attempt once at command entry. A verified released attempt routes to its retry child within the original folder; ordinary setup/launch guards prevent duplicate creation or a second completed drill. An empty interrupted retry may continue; each later failed attempt requires its own clean down. Preserve all prior bytes and fresh price/billing guards. Test interrupted removal/publication, pending rollback, partial initialization, duplicate up, failed cleanup, live resources, foreign ownership, changed source and the exact monthly cap.

- [ ] **Finish:** Run focused named tests; CI owns full suites. Update only the proof guide and D570 backlog lines. Keep the changed-assertion list, one run-it review and current-head CI. Handoff: updated main, then down, up, drill using the same original private folder and temporary staging sign-in.
