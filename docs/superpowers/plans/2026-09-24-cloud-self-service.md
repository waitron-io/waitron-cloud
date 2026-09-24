# Cloud self-service programme

> Execute inline with superpowers:executing-plans, TDD, then finish-branch and land-branch
> for each feature. The owner explicitly requested autonomous execution of all four.

## Sequence

1. **Venue overview** (`feat/venue-overview`). Spec: ../specs/2026-09-24-venue-overview-design.md.
   Extend the account read model, portal types/controller/rendering and translations.
   Test real membership isolation and snapshot state; browser-test both languages and
   organisation switching. Preserve existing revoke behavior. Finish, land, clean up.
2. **Backup catalogue**. Add a bounded, authorised snapshot-list API and customer screen
   with capture dates, verification, retention and clear unavailable-recovery explanation.
   Pagination must not leak another venue. No keys, object paths or download grants in
   browser data. Specify this branch's details before implementation; finish and land.
3. **Background backup workers**. Schedule verification and retention cleanup, retry
   interrupted work, fence concurrent workers, expire abandoned capture uploads, and
   provide a runnable local worker plus operational status. Actual restore verification
   must use the existing Waitron contract; no upload-only verification. Specify resource
   bounds and crash behavior, then implement, review and land independently.
4. **Monitoring and alerts**. Persist incident state for disconnected venues, stale
   backups and failed verification. Deduplicate email alerts through the existing outbox,
   clear/recover incidents and expose useful customer status. Test clock boundaries,
   concurrent workers, owner changes and notification delivery in local Mailpit. Specify
   concrete thresholds before implementation, then review and land.

## Constraints and checks

- English and Spanish; existing shared UI and session rules; one organisation at a time.
- Local integration only. No live provider deployment or real customer email sends.
- Continuous server replacement/activation stays gated on Waitron's remaining SQLite work.
- Signed-off commits, normal hooks, one isolated Claude run-it review per meaningful
  feature branch, and green current-head CI before the authorised merge.
- Use focused failing behavioral tests first; reuse existing tests, preserving assertions.
- Keep backlog, implementation notes and a durable execution ledger current.

## Execution ledger

2026-09-24: first worktree created; overview design grounded in existing installation UI,
registration lifecycle, backup catalogue and account API. Existing UI already shows
connection/service state; this branch adds business context and actual snapshot freshness.

Overview implementation: focused API/controller checks and both bilingual phone-width
browser journeys pass; existing stop-access, lost-reply and stale-observation assertions
remain. The organisation selector uses an explicit accessible label. The isolated run-it review found no blocker. Follow-up regression checks cover metadata
after revocation, deleted snapshots, name fallback and legacy/Unicode names. PR #38 landed after green CI on abf4750; main ee9404e. Both branches and the
worktree are removed. Task 2 uses the backup-catalogue design/spec and its embedded plan.

Catalogue: owner-scoped pagination, public metadata, retention protection and bilingual
selection are implemented. PostgreSQL/controller and browser checks pass; review follows.
