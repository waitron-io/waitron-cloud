# Keep test venue snapshots through day 90

A synthetic venue owner can save an older verified snapshot on day 90 after ordinary
cleanup would have expired it. The venue keeps its paid plan. The fixed UTC deadline
still closes the download. The owner said “Yes” to synthetic downloads at 17:46 on
24 November and “yes to all” to the exit rules at 17:58, recorded in Lane G’s archived
questions. The watcher named this slice in Lane G’s questions at 09:01 on 27 November.
[Exit rules](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account)

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
- In `deploy/test-cloud/test-fixtures/integration-account.mjs`, have the existing
  `end-exit-download` phase call the real `cleanupOne` after recording the shifted
  end. Require `null` on its first call. Advance the expiry comparison time from
  the database clock by the same shift and retain the signed capture timestamps.
  Record the database time after cleanup. In `scripts/test-cloud-integration.mjs`,
  confirm the list contains the two verified snapshots, with the newer one as
  fallback and the earlier one past ordinary expiry and free of recovery holds.
  Compare the earlier archive, key and manifest over HTTPS in the final 90 seconds.
  Keep the offline and SQLite checks, the grant refusal, the three HTTP 410 checks
  and the final stored-archive check. In `scripts/test-cloud-exit-download.test.mjs`,
  require cleanup to have finished during the open window and the read to succeed.
- Run the two named PostgreSQL files through `scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test --test-concurrency=1`.
  Show each guard’s test failing with the guard removed in a disposable checkout.
  Run `pnpm typecheck` and the unskipped HTTPS test with the pinned local images.
  Explain the test pause in `docs/test-cloud.md`, `docs/local-backups.md`,
  `packages/account-http/README.md` and `docs/backlog.md`. Record how future
  resubscription and verified purge must handle it in `docs/data-lifecycle-journal.md`.
  [Rehearsal command](../../test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online)

Estimate 10–15 product lines, 45–65 PostgreSQL test lines and 25–40 rehearsal lines.
