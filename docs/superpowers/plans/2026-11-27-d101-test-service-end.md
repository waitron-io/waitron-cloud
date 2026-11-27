# End snapshot capture from test Cloud Backups

A synthetic venue owner confirms **End test snapshot capture** in Backups. Cloud
records the end, stops admitting new snapshots and shows the existing UTC download
deadline. The owner can still save the verified files. The owner cleared synthetic
downloads on 24 November at 17:46 and accepted the later exit rules at 17:58. Lane G’s
archived questions record both answers. The watcher’s 27 November 11:19 note says to
continue CLOUD-EXIT. [Exit rules](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account)

## Reuse the test download path

- Wire `POST /api/account/backups/end-test-snapshots` in `packages/account-http/src/{app,backups}.ts`.
  Reuse the opt-in test plan modes, test venue and exit catalogue checks. Also require
  non-production account mode. Return 404 when the action is off. Accept `venueId`
  alone and use the existing origin, session, rate limit and request forgery checks.
  Advertise optional `testSnapshotEndAvailable` in the Backups list only where this action is enabled.
- Reuse `LifecycleStore.request`’s write in `packages/registration/src/data-lifecycle.ts`.
  Take the account, session and scoped owner membership locks in the transaction that
  locks the venue and journal, taking the venue before the journal. Recheck fresh
  connection proof and test venue after the lock waits. Record one cancellation at
  database time using the current revision and a server operation ID. No caller timestamp.
  A replay after effective end returns 204 without another write or a later deadline.
  A future end, pending deletion or purge returns a refusal. The existing journal fixes
  the deadline at 2,160 hours and the existing list reads it back.
- In `apps/portal/src/{api,app,backup-controller,backup-screen,backup-types,locale}.ts`,
  use the existing inline confirmation and account proof controls. Explain the immediate
  cutoff in English and Spanish. After proof, let the owner confirm again. Reload the
  list after 204 to show the dates. Ignore late replies when the account or selected
  venue changes. Keep the action inside the test Backups panel. Billing cancellation,
  hosted shutdown, download receipts, restore, resubscription, sealing and deletion
  remain separate. [Exit roadmap](2026-10-22-cloud-data-protection.md#slice-9-enforce-service-end-read-only-recovery-and-producer-fencing)

## Prove the owner action and the existing deadline

- Start with failing cases in `packages/account-http/test/backups.test.ts` for a
  disabled action, foreign or non-test venue, missing proof, caller timestamp, proof
  expiring during a venue lock wait and repeated or concurrent calls leaving one end.
  Run that file and `packages/registration/test/data-lifecycle.test.ts` through
  `scripts/test-postgres.mjs`, one file at a time. Leave existing journal assertions in place.
- In `apps/portal/test/backup-browser.test.ts`, check confirm, cancel, proof and the
  dates after refresh. Check both languages and themes at 390 and 1280 pixels.
- In `scripts/test-cloud-integration.mjs`, use the new HTTPS action before changing
  any lifecycle date. Verify the fixed window, the next snapshot grant refusal and
  a matching verified save with the plan still paid. Shift the recorded dates only
  in `deploy/test-cloud/test-fixtures/integration-account.mjs` for the existing day-90
  cleanup, download and HTTP 410 checks. Run `scripts/test-cloud-exit-download.test.mjs`
  with the pinned disposable images and no skips. Run `pnpm typecheck`.

Update `docs/backlog.md`, `docs/test-cloud.md`, `docs/data-lifecycle-journal.md` and
`packages/account-http/README.md`. Estimate 100–150 product lines and 100–160 test
and fixture lines. [Test Cloud rehearsal](../../test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online)
