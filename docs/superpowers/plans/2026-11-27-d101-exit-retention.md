# Keep test venue snapshots through day 90

A synthetic venue owner can save an older verified snapshot on day 90 after ordinary
cleanup would have expired it. The venue keeps its paid plan. The fixed UTC deadline
still closes the download. This is the slice the watcher requested on 27 November
at 09:01 under the owner’s 24 November exit rules. [Exit rules](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account)

## Pause ordinary snapshot cleanup at service end

In `packages/backups/src/catalogue.ts`, reuse `LifecycleStore.readExitRecovery` in the
two test plan modes. Allow `cleanupOne` to proceed only when the journal permits
recovery and reports no effective service end. Check after the existing plan,
verification policy, backup location and job checks, both before marking a point
for deletion and before removing its object in the second transaction. This uses
the database clock after lock waits. A future end still permits ordinary expiry.
After the end, keep all snapshots that were still available. A point marked
deleting earlier stays unavailable and its removal pauses. Keep ordinary cleanup
paused after the download deadline because deletion requires proof of return.

The rehearsal covers the existing test download. Full return, download audit,
sealing and deletion remain later exit work. [Exit plan](2026-11-24-cloud-exit.md#later-retention-and-deletion)

## Check expiry and prove the day-90 download

- Start with failing PostgreSQL checks. In `packages/backups/test/plan-permissions.test.ts`,
  keep the plan paid and use two verified daily snapshots. The older point is
  past ordinary expiry and the newer one is the fallback. Check the rows and
  bytes just after service end and past the download deadline. In
  `packages/backups/test/venue-service-backups.test.ts`, prove expiry before a
  scheduled end. Use the existing job check on the second transaction to wait
  for the database clock to reach the scheduled end between selection and deletion.
  Confirm the object survives and the marked row stays unavailable on retry.
- In `deploy/test-cloud/test-fixtures/integration-account.mjs`, call the real
  `cleanupOne` against the disposable storage after recording the shifted end.
  Advance the supplied expiry comparison time by the same shift and retain the
  captured timestamps used in verification. In `scripts/test-cloud-integration.mjs`,
  prove the earlier of the two verified snapshots has reached ordinary expiry
  and has neither a recovery hold nor fallback protection. Then compare its
  archive, key and manifest over HTTPS in the final 90 seconds. Keep the existing
  offline and SQLite checks, the grant refusal and the three HTTP 410 checks.
  Require the cleanup time and successful read in `scripts/test-cloud-exit-download.test.mjs`.
- Run the two named PostgreSQL files through `scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test --test-concurrency=1`.
  Show each guard’s test failing with the guard removed in a disposable checkout.
  Run `pnpm typecheck` and the unskipped HTTPS test with the pinned local images.
  Update `docs/test-cloud.md`, `docs/data-lifecycle-journal.md` and `docs/backlog.md`.
  [Rehearsal command](../../test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online)

Estimate 10–15 product lines, 45–65 PostgreSQL test lines and 25–40 rehearsal lines.
