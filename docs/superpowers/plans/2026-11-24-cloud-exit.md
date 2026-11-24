# Download a backup before leaving Cloud

The 24 November request covers planning. The [D101 pause and slice limits](../../backlog.md#current-state) still apply. Billing slice G needs full return, 90 days of read-only recovery and purge for cancellation, lapses and account closure. [Billing design](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account)

## First usable slice on test Cloud

In Backups, the test venue’s owner confirms their sign-in, saves one verified encrypted archive and retrieves its matching archive key. Their box can keep trading. Reuse the snapshot list and account action proof. Add the test-only download to `packages/account-http/src/{app,backups}.ts` using `packages/backups/src/{catalogue,storage}.ts` for selection, key version and the bounded read. Reuse the security audit with identifiers only. Extend `apps/portal/src/{backup-screen,backup-controller,api,locale}.ts` in English and Spanish. Estimate 180–260 implementation lines and 150–220 test lines.

In `packages/account-http/test/backups.test.ts`, refuse normal service mode, stale proof, non-owners, other venues and unverified points. Revoke access while the object read waits and check that both file and key are withheld. Exercise both downloads in `apps/portal/test/backup-browser.test.ts`. Keep responses out of caches, keys out of URLs and both out of logs.

Run the planned `node --test scripts/test-cloud-exit-download.test.mjs` on the disposable stack. Check the source stays online. Open the saved archive with its key using the compiled Waitron verifier at `44dc45af7a64d399037747499ba633594a63f84d` in the existing network-disabled container. Record the image digest. Check archive digest, SQLite integrity and module state without activation. Wrong keys and changed bytes must fail. Starting a replacement box requires separate Waitron recovery authority. The [existing disaster recovery proof](../../../scripts/test-cloud-paid-authorised-recovery.test.mjs) requires the old box to be unavailable.

Full return also needs a consistent SQLite database with module and vault state, latest backup with its key, version manifest, checksums and offline instructions. If the latest is unverified, include the last verified copy and show the missing tail. Warn owners **You are now responsible for keeping your fiscal records. Download and check your copies.** [Exit roadmap](2026-10-22-cloud-data-protection.md#slice-8-resumable-full-exit-export-and-portable-keys)

## Later retention and deletion

Reuse the lifecycle journal. Fence ended-service writers and keep verified recovery available after paid access lapses until effective service end plus 90 × 24 hours in database UTC. Verified earlier deletion takes priority. Resubscription before the deadline requires evidence the retained data exists. [Lifecycle journal](../../data-lifecycle-journal.md)

After synthetic purge, query venue rows, enumerate all backup versions and stream copies, and check replicas, disks, exports, scratch, unfinished uploads, queues, attachments and logs. Include sealed venue key rows in restored platform backups. Prove deletion survives that restore and a neighbouring venue can still recover. Report residual and unconfirmed copies as pending. [Purge roadmap](2026-10-22-cloud-data-protection.md#slice-10-all-copy-purge-and-honest-deletion-receipts)

## Decisions

- **Owner.** May the synthetic download proceed during the pause? Clear this single test-Cloud action and keep the remaining lifecycle work paused.
- **Counsel.** What terms govern the 90-day instruction, earlier verified deletion and hosted non-payment? Write the return/delete choice into the agreement and clear hosted stops separately.
- **Counsel and owner.** Which billing, immutable security and usage rows, or legal holds must survive, who can see them and for how long? Keep billing evidence routinely and require documented authority, restricted access and expiry for each exception.
- **Counsel and owner.** Can shared backups and key copies meet the deadline? Agree bounded expiry, reapply deletion before restored access and report residual copies as pending. Keep shared encryption keys available to other venues.
