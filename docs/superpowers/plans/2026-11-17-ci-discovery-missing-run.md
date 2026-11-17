# CI discovery missing run: implementation plan

**Request:** Lane I `questions.md`, watcher 2026-11-17 02:46: fix discovery, then restore server routing and observe one natural admission. Driver commits; Claude reviews; watcher clears before build. No owner design approval claimed.
**Smallest usable result:** recover an omitted valid current-head PR candidate using existing admission, shared inventories and publisher. Keep hosted now; attempt 2 and Lane A notification are already handled.

## Evidence and scope decision

Receipts: `/Users/clintongormley/waitron-campaign-i/receipts/server-stuck-20261117-0221/`, particularly `app-inventory-probe.json`, `app-candidate-control.json`, `recent-runs.json` and `github-source-provenance.md`.
Queued 10/10 plus in-progress 1/1 omitted run 43992905158; direct reads found its valid queued job. Unchanged `findAutomatic` accepted the supplied run; unfiltered `gh run list --limit40` included it. Internal cause remains unknown. No alarm-time full payload exists; requested/waiting/pending were empty after rerun.
**Route:** supplement status lists with configured-workflow reads without a status filter for the latest commit of each open PR (`head_sha`); retain queued/in-progress rows after existing identity checks.
**Question before build:** this cannot guarantee “every queued run”: omitted main/scheduled/manual runs and heads exceeding 100 historical runs remain uncovered. Is the narrower current-open-PR repair acceptable? Otherwise settle a supported bounded source first; do not add an unbounded history crawl.

## Implementation and test ownership, after clearance

- [ ] `scripts/disposable-tests/ci-auto.test.mjs`: synthetic fixture preserves captured queued 10/10 omission and active 1/1; unfiltered head response supplies the valid candidate plus completed history. Assert discovery and exact run/attempt/job acceptance; watch it fail first.
- [ ] `scripts/disposable-tests/ci-canary.mjs`: reuse open-PR observations; share one internal supplemental reader between `readAutomaticPass` and standalone `findAutomatic`. Scan distinct same-repository heads, at most 100 historical rows/head, fewer than 100 open PRs.
- [ ] Require stable nonnegative counts, complete pages, unique IDs and terminal empty page; reject mismatches, duplicates and oversize. Merge source overlap by ID, refusing conflicting identity/attempt. Count equality alone is insufficient.
- [ ] Preserve per-status 100-active-run bounds, ignored-empty allowance, 100-job and 16-slot limits. Completed history consumes only the head bound. Incomplete supplementation defers; it cannot authorize cancellation, overflow or capacity publication.
- [ ] Trace `control.mjs:59-84,111-146`, `overflowInventory` and `reconcileDeadRuns`; share enriched runs/jobs, retain wide-inventory fallback with supplemented standalone pickup. Preserve identity/contributor/current-head checks, hosted markers and active-worker exclusions.
- [ ] Retain incomplete/duplicate/oversize/foreign/closed-PR assertions; add head-boundary/page-mismatch refusals and controller admission. Preserve sharing/capacity-time checks when request counts change.
- [ ] Run `node --test scripts/disposable-tests/ci-auto.test.mjs` red/green, then `node --test scripts/disposable-tests/ci-admission.test.mjs scripts/disposable-tests/ci-entry.test.mjs`; read counts. Root owner: `scripts/ci-disposable-local.test.mjs:25`. CI owns broader suites; no whole-workspace run.
- [ ] Update `deploy/disposable-tests/README.md` bounds and `docs/backlog.md` D592; distinguish controlled tests from installed qualification.

## Release only after review, clearance and landed source

Follow `deploy/disposable-tests/README.md:266-331`: save/read back hosted, drain without moving existing work; use `node scripts/disposable-tests/publish.mjs server /PRIVATE/publication.json`, `oldServer`, fresh release/state/generation and unchanged qualified host recipe/mapping.
Keep hosted through installed guest-tools/local-runtime/cancellation proofs; read back hashes, configuration, sole timer and usable pool. After qualification, restore/read back server mode with no selected head under the watcher's 02:46 direction; hosted is the temporary mitigation, so no second permission step is added.
Observe one natural admission; retain run/attempt/job, actual assignment and cleanup in existing receipts. No dispatch. Absent natural work, qualification stays open; failed publication/qualification keeps hosted and existing recovery.

**Changed-line estimates (additions + deletions):** production 90; tests 120; support 0 (reuse controller/publisher); docs 30 plus this 31-line plan; total about 271. Stop for watcher direction on material scope changes or more than 407 lines (1.5× total), not a ceiling.
**Excluded:** new ledger/protocol/deadline/infrastructure, status guesses, cancellation/rerun policy changes, speculative deployment and Waitron application/production changes. This invocation writes only this draft.
