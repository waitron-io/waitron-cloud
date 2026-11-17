# CI discovery missing run: implementation plan

**Request:** Lane I `questions.md`, watcher 2026-11-17 02:46: fix discovery, then restore server routing and observe one natural admission. Driver commits; Claude reviews; watcher clears before build. No owner design approval claimed.
**Smallest usable result:** recover an omitted valid current-head PR candidate using existing admission, shared inventories and publisher. Keep hosted now; attempt 2 and Lane A notification are already handled.

## Evidence and scope decision

Receipts: `/Users/clintongormley/waitron-campaign-i/receipts/server-stuck-20261117-0221/`, particularly `app-inventory-probe.json`, `app-candidate-control.json`, `recent-runs.json` and `github-source-provenance.md`.
Queued 10/10 plus in-progress 1/1 omitted run 43992905158; direct reads found its valid queued job. Unchanged `findAutomatic` accepted the supplied run; unfiltered `gh run list --limit40` included it. Internal cause remains unknown. No alarm-time full payload exists; requested/waiting/pending were empty after rerun.
**Route after Claude's first read:** add one repository run-list request without a status filter (`per_page=100`), keep only queued/in-progress records and add previously unseen IDs to the existing pass; existing status-list records win overlaps. Reuse that same extra read for standalone `findAutomatic`, only when no pass was supplied.
**Question before build:** filtered lists remain the source for older runs, but a run omitted there and older than the newest 100 may still be missed; is that bounded repair acceptable? No per-PR head scans, history crawl or new completeness framework.
## Implementation and test ownership, after clearance

- [ ] `scripts/disposable-tests/ci-auto.test.mjs`: synthetic fixture preserves the captured complete-looking ten queued rows and one in-progress row while omitting a valid queued candidate; the unfiltered page adds that candidate and completed history. Assert the exact candidate survives discovery/admission, old rows remain, completed rows stay out and known IDs are not replaced; watch RED before the reader change.
- [ ] `scripts/disposable-tests/ci-canary.mjs`: reuse `runInventory` for the one additional page, existing per-run identity/current-PR/contributor checks and ID maps. Validate the returned page with the existing schema/uniqueness rules; on failed/malformed extra reads log and continue today's filtered-list behavior. No new defer/cancellation/capacity policy, terminal-page protocol or merge-conflict framework.
- [ ] Keep existing incomplete/duplicate/oversize/foreign/closed-PR guards and all limits. Test failure fallback once at the new reader and both readAutomaticPass/standalone discovery wiring; trace control.mjs:59–84,111–146, overflowInventory and reconcileDeadRuns so the shared pass is reused instead of another request.
- [ ] Run `node --test scripts/disposable-tests/ci-auto.test.mjs` red/green, then `node --test scripts/disposable-tests/ci-admission.test.mjs scripts/disposable-tests/ci-entry.test.mjs`; read counts. Root owner: `scripts/ci-disposable-local.test.mjs:25`. CI owns broader suites; no whole-workspace run.
- [ ] Update `deploy/disposable-tests/README.md` bounds and `docs/backlog.md` D592; distinguish controlled tests from installed qualification.

## Release only after review, clearance and landed source

Follow `deploy/disposable-tests/README.md:266-331`: save/read back hosted, drain without moving existing work; use `node scripts/disposable-tests/publish.mjs server /PRIVATE/publication.json`, `oldServer`, fresh release/state/generation and unchanged qualified host recipe/mapping.
Keep hosted through installed guest-tools/local-runtime/cancellation proofs; read back hashes, configuration, sole timer and usable pool. After qualification, restore/read back server mode with no selected head under the watcher's 02:46 direction; hosted is the temporary mitigation, so no second permission step is added.
Observe one natural admission; retain run/attempt/job, assignment and cleanup in existing receipts. This proves ordinary pickup, not the omission repair unless that omission recurs. The synthetic fixture proves the merge logic; the recorded earlier unfiltered result used gh credentials, so verify the extra view with installed App credentials before claiming its behavior. No dispatch. Absent natural work, qualification stays open; failed publication/qualification keeps hosted and existing recovery.

**Changed-line estimates (additions + deletions):** production 25–40; tests 65–100; support 0; docs 30–50 including this plan; total 120–190. Growth past 285 lines (1.5× upper estimate) or material scope changes goes to the watcher for an outside opinion.
**Excluded:** new ledger/protocol/deadline/infrastructure, status guesses, cancellation/rerun policy changes, speculative deployment and Waitron application/production changes. This invocation writes only this draft.
