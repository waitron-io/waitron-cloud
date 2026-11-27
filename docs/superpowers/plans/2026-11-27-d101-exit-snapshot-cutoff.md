# D101 test Cloud exit snapshot cutoff

Lane G’s CLOUD-EXIT queue says “A venue leaving Cloud can download its data and read it for 90 days”.
The watcher unblocked it after D642 landed (questions.md, 26 November 19:20). The 03:54 progress.log
entry narrows this slice to stopping new snapshot reservations and publication at the recorded end.
The owner cleared synthetic download work on 24 November at 17:46 and answered “yes to all” on
the exit rules at 17:58. The full-return audit stays parked. Build awaits watcher clearance,
and D621 has the 15:00–17:00 CET shared test window.

**Start with failing PostgreSQL cases.** In `packages/backups/test/plan-permissions.test.ts`,
reuse the paid fixture. Show that reservation and publication work with no journal row and
before a scheduled end. At the end, refuse a fresh reservation and publication of a previously
reserved capture, with no new capture or point row. Control the database clock as in
`packages/registration/test/data-lifecycle.test.ts`. Reuse its held venue lock and uncommitted
first journal insert to check that admission waits and sees the committed end. Cover a scheduled end
reached during legacy publication I/O. In `packages/backups/test/venue-service-backups.test.ts`,
record the first cancellation during the existing object copy wait while the venue keeps its
entitlement. Check refusal at both entry points and no point row when the copy resumes.
In `packages/backups/test/venue-service-captures.test.ts`, record the end during upload signing
and require the second reservation check to withhold the URL. Name the cases with `snapshot exit cutoff`.
Run `node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test --test-concurrency=1 --test-name-pattern='snapshot exit cutoff' test/plan-permissions.test.ts test/venue-service-backups.test.ts test/venue-service-captures.test.ts`.
First observe ended operations still succeeding, then rerun after the change. The paid fixture
builds its existing worker image in setup.

**Use one snapshot admission check.** In `packages/registration/src/data-lifecycle.ts`, add a
caller-transaction `LifecycleStore` check for `effective_end_at <= clock_timestamp()` in SQL
after locking. Proceed if the row or end is absent or the end is in the future. Both opted-in
modes already lock the venue during plan authority. Take `FOR SHARE` on the lifecycle row next,
matching the order for owner downloads and first cancellation. In `packages/backups/src/catalogue.ts`,
apply the check only at `reserveCapture` and `publish` admission in `test-free-paid` and
`test-venue-levels`, after plan authority and before installation or location locks. The same
check covers the signed reservation’s second call and venue-level publication’s second transaction.
Recheck before inserting new rows since a scheduled end can pass during lock waits or legacy
publication I/O. Refuse with `backup.permission_denied`. Keep the existing `active()` gates for
provisioning and rotation and `backupPlan()` gates for recovery, replacement and streams.
Publication means admitting a `backup_points` row. A copy already authorised in `test-venue-levels`
can leave an unadmitted object for existing capture cleanup. Keep existing grants, owner downloads
and the stored 90-day download deadline.

**Rehearse and finish.** In `deploy/test-cloud/test-fixtures/integration-account.mjs`, replace the
switch to free in `end-exit-download` with an assertion that the organisation stays paid and its
snapshot entitlement stays configured. Keep the database-time backdate that puts the deadline about
90 seconds away. In `scripts/test-cloud-integration.mjs`, reuse `exit-recovery-window` and its signed
reservation witness for HTTP 403 with no grant. The disposable `test-free-paid` run also checks
matching archive, key and manifest before cutoff, HTTP 410 after cutoff, intact stored bytes, and
the existing SQLite and offline-open proof. Run `node --test scripts/test-cloud-exit-download.test.mjs`
unskipped with the pinned images and private scratch settings in the
[test guide](../../test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online).
Allow roughly 25–40 implementation lines and 80–120 test and rehearsal lines. Finish with green
focused cases, `pnpm typecheck`, the unskipped receipt with image IDs and pass count, and one D101 note in
`docs/backlog.md` recording the test-only result.
