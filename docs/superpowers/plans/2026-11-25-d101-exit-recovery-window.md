# D101 test Cloud exit recovery window

In the disposable `test-free-paid` rehearsal, a made-up venue loses retained snapshot service.
Backups shows when service ended and the fixed download deadline 90 days later. The owner
can save a currently verified archive and its key before the deadline. Both routes refuse
at and after the deadline. The dates stay visible and the files stay stored.

The watcher assigned this plan on 25 November at 09:31 in Lane G’s questions. This
slice reuses the [existing verified download](2026-11-24-cloud-exit.md) and the test downgrade,
so it can ship ahead of the [full service-end work](2026-10-22-cloud-data-protection.md#slice-9-enforce-service-end-read-only-recovery-and-producer-fencing).
A persistent test deployment, a product service-end action, resubscription, restore authority,
full return and its audit, sealing and deletion are later work. The lifecycle tables already exist.

## Server

- [ ] Start in [backups.test.ts](../../../packages/account-http/test/backups.test.ts). Check
  the fixed dates, both routes before and after expiry, terminal-state refusal even without dates,
  and disposal when the archive’s deadline passes during staging. Keep existing authority checks.
- [ ] Add a caller-transaction read in [data-lifecycle.ts](../../../packages/registration/src/data-lifecycle.ts)
  and export it from [index.ts](../../../packages/registration/src/index.ts). Use `FOR KEY SHARE`
  on the venue before `FOR SHARE` on its lifecycle row. Compare in SQL against the database
  clock after locking. Refuse `purging` and `purged` first. With no row or before service end,
  use existing behavior. Otherwise allow release only while the clock is strictly before the stored deadline.
- [ ] Use this read in the test owner’s list and download proof check in [backups.ts](../../../packages/account-http/src/backups.ts).
  Include optional `exitRecovery` with `effectiveEndAt`, `deadlineAt` and `expired` for ended windows.
  Omit the dates for terminal rows and omit the download flag when release is refused. Keep HTTP 410
  for unavailable files. The archive repeats the check after staging. In [catalogue.ts](../../../packages/backups/src/catalogue.ts),
  repeat it after loading the key. A transfer admitted before expiry can finish.

## Backups

- [ ] [Controller tests](../../../apps/portal/test/backup-controller.test.ts) cover optional
  page parsing in [backup-types.ts](../../../apps/portal/src/backup-types.ts). [Browser tests](../../../apps/portal/test/backup-browser.test.ts)
  check both dates and download actions before and after expiry in English and Spanish with the browser in Europe/Madrid.
- [ ] In [backup-screen.ts](../../../apps/portal/src/backup-screen.ts), show the dates labelled
  UTC using [dates.ts](../../../apps/portal/src/dates.ts) and [locale.ts](../../../apps/portal/src/locale.ts).
  Show that downloads have ended without suggesting deletion. Keep the ordinary snapshot retention label distinct.
  A stale click uses the existing unavailable message. A tab with the old portal bundle needs a reload to read the added fields.

## Rehearsal and cost

- [ ] Keep the [proof](../../../scripts/test-cloud-exit-download.test.mjs) that the original download opens offline while the box stays online.
  Then use the same venue in [the runner](../../../scripts/test-cloud-integration.mjs) and [account fixture](../../../deploy/test-cloud/test-fixtures/integration-account.mjs).
  Switch it to free with `OrganisationPlanStore.set` and record a single end with `LifecycleStore.request`
  at database time minus 2,160 hours plus about 90 seconds. Reuse the downgrade’s snapshot-grant
  refusal check. Save the same archive and key before the deadline and compare with the previously
  verified files. Wait for the stored deadline and check both 410s, unchanged dates and retained bytes
  within the existing ten-minute sign-in proof window.
- [ ] Run the focused account tests on disposable PostgreSQL, build the portal, run its controller
  and browser tests, typecheck and run the rehearsal unskipped. Record the exact Cloud image,
  Waitron pin `44dc45af7a64d399037747499ba633594a63f84d`, verifier image digest and pass count.
  Update the [API guide](../../../packages/account-http/README.md) and [test procedure](../../test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online).

Estimate 75–115 implementation lines, 110–170 test and rehearsal lines and 15–25 guide lines.
Allow up to three hours to open the pull request with the pinned images and local Linux box ready.
The local rehearsal needs no additional provider spend.
