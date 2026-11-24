# Download a backup before leaving Cloud

The 24 November request covers planning. The [D101 pause and slice limits](../../backlog.md#current-state) still apply. Cancellation, unpaid trials, lapses and account closure need full return, 90 days of read-only recovery and purge. [Billing design](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account)

## First usable slice on test Cloud

In Backups, the synthetic venue’s owner confirms their sign-in and saves one verified encrypted archive and its key while the box stays online. Reuse the snapshot list, action proof and `lockVenue` test-venue check. Change `packages/account-http/src/{app,backups}.ts`, `packages/backups/src/catalogue.ts` and `apps/portal/src/{backup-screen,backup-controller,api,locale}.ts` (English and Spanish). Real use requires a download audit event, which needs a migration. [Audit constraints](../../../packages/registration/migrations/026_support_grants.sql)

Stage with `BackupObjects.stage()` and cap the archive at 16 MiB. Allow 10 seconds through staging and final authorisation so headers arrive before the proxy’s 15-second idle timeout. Confirm the digest and recheck current owner and proof before streaming. Check owner and proof again when releasing the selected archive’s exact key version. Dispose of staged files on completion or abort. Use a dedicated binary POST with same-origin credentials, the existing CSRF header, a 30-second browser deadline and the portal’s file-save pattern. Exclude responses from caches and keys from URLs and logs. [Staging](../../../packages/backups/src/storage.ts) · [Proxy](../../../deploy/test-cloud/proxy.cfg) · [Portal requests](../../../apps/portal/src/api.ts)

`packages/account-http/test/backups.test.ts` owns the refusals for normal service mode, stale proof, non-owner members, other venues, unverified points, oversize archives and authority lost during staging. `apps/portal/test/backup-browser.test.ts` checks both files save. The [verifier tests](../../../deploy/test-cloud/verifier-genuine.test.mjs) already own wrong keys and changed bytes.

Extend `scripts/test-cloud-integration.mjs` and `docs/test-cloud.md`. Run `node --test scripts/test-cloud-exit-download.test.mjs` with the disposable Cloud and Waitron images. Record the unskipped pass, verifier image digest and Waitron pin `8eed667ab0586a3144ed7911b57cf50fcb3b0766`. Match the saved archive to the stored digest, open it with the saved key in the network-disabled verifier and show the source stayed online. Estimate 220–300 implementation lines, 200–290 test and harness lines and 20–35 guide lines.

## Later retention and deletion

Full return needs consistent SQLite, module and vault state, the latest backup and key, a format manifest, checksums and offline instructions. Include the last verified copy if the latest is unverified and show the missing tail. Warn owners **You are now responsible for keeping your fiscal records. Download and check your copies.** [Exit roadmap](2026-10-22-cloud-data-protection.md#slice-8-resumable-full-exit-export-and-portable-keys)

Reuse the lifecycle journal to stop writes and permit read-only recovery through the fixed UTC deadline. Earlier verified deletion takes priority. Today, falling below the retained-snapshot service level blocks recovery and stops cleanup. Test that expired service can still recover during the 90 days, that earlier deletion takes effect and that resubscription requires retained data. [Catalogue checks](../../../packages/backups/src/catalogue.ts) · [Lifecycle journal](../../data-lifecycle-journal.md)

The delete call omits the version ID. Both backup bucket sets retain old versions without expiry, and security audit and usage rows reject deletion. In the purge rehearsal, list snapshot and stream versions and unfinished uploads in both regions. Query venue rows, queues and sealed keys. Inventory disks, replicas, scratch, exports, attachments and logs. Restore a platform backup in isolation, reapply deletion before access and check that the erased venue’s data and keys are inaccessible and its neighbour can recover. Mark residual copies pending. [Storage rules](../../../deploy/aws/modules/storage/main.tf) · [Purge roadmap](2026-10-22-cloud-data-protection.md#slice-10-all-copy-purge-and-honest-deletion-receipts)

## Decisions

- **Owner.** May this one synthetic download proceed during the pause? Clear the test-Cloud action and keep the rest paused.
- **Counsel.** Settle the terms for stopping a hosted venue for non-payment before enabling hosted stops. [Billing questions](../specs/2026-10-29-cloud-billing-design.md#12-questions-for-others)
- Use the existing [lawyer questions 1, 2 and 5](../specs/2026-10-22-cloud-data-protection-design.md#10-questions-for-the-lawyer-not-engineering-guesses) for the exit instruction, retained billing records and shared backup expiry. Make venue audit and usage rows deletable unless counsel identifies a duty to keep them. Agree bounded shared-backup expiry and reapply deletion before restored access. Keep shared encryption keys available to other venues.
