# Stop new test snapshots at service end

In the disposable Cloud rehearsal, recording service end stops new snapshot reservations and
publication while the venue still has a paid plan. Its owner can still save the verified backup
files through the existing download window.

Lane G's queue asks for download and 90 days of read-only access. The watcher unblocked the item
after D642 in Lane G questions.md at 19:20 on 26 November. Lane G's 03:54 progress entry on 27
November proposed this snapshot-only slice. Lane G's archived 24 November questions record the
owner's 17:46 “Yes” to synthetic downloads and 17:58 “yes to all” on the later exit rules. The
watcher's 25 November 09:31 note leaves the audit for full return. The proposed slice awaits
watcher clearance.

**Snapshot admission.** In `packages/backups/src/catalogue.ts`, opt in to the check from
`reserveCapture` and both publication paths, in `test-free-paid` and `test-venue-levels`.
Give `active()` a snapshot-write option so the check runs after plan authority and before
installation and location locks. Reuse `LifecycleStore.readExitRecovery` in the caller's
transaction. Refuse with `backup.permission_denied` if the reader refuses or returns a window.
It locks the venue and lifecycle rows in the same order as the first cancellation and reads
the current database time after waiting. A scheduled future end still permits admission.
Recheck before inserting a capture or publishing a point so an end reached during a lock wait
or legacy storage write takes effect. The signed grant's second reservation check withholds any
URL or credentials obtained during cancellation. The venue-level publication's second
transaction refuses if cancellation committed during the copy. A publish replay after end also
refuses. Existing credentials expire normally, and existing capture cleanup handles copies
without a published point. Provisioning, rotation, recovery and streams keep their own gates.

**Focused tests first.** In `packages/backups/test/plan-permissions.test.ts`, use the existing
paid setup and database-relative scheduled times. Reserve and publish before end, then refuse
a new reservation and publication of a reserved capture after end without creating rows. Hold
a first cancellation open on a second connection and verify admission sees it after commit.
For legacy publication, schedule end before the operation, hold the object write and use the
database clock to release it after end. In `venue-service-backups.test.ts`, record cancellation
during the existing copy wait with entitlement intact and assert refusal and no new point.
In `venue-service-captures.test.ts`, record end during upload signing and assert the response
withholds the URL. Use `node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test --test-concurrency=1 --test-name-pattern='snapshot exit cutoff' test/plan-permissions.test.ts test/venue-service-backups.test.ts test/venue-service-captures.test.ts`
before and after the fix.

**Disposable proof.** In `deploy/test-cloud/test-fixtures/integration-account.mjs`, replace the
downgrade in `end-exit-download` with a check that the plan stays paid. Reuse the signed
reservation refusal and download comparisons in `scripts/test-cloud-integration.mjs`.
PostgreSQL tests own publication refusal. Run `pnpm typecheck` and the unskipped
`scripts/test-cloud-exit-download.test.mjs` with the pinned images and scratch settings in the
[test guide](../../test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online). Record
the image IDs and pass count. Update the guide and D101 backlog. Ordinary retention can still
expire older snapshots in the 90 days when the plan stays paid. The rehearsal checks the recently
captured files and the access deadline. It leaves long-term retention and deletion for later work.
Estimate 15–25 implementation lines and 80–120 test and rehearsal lines.
