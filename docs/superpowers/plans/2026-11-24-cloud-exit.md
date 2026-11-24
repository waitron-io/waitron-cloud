# Cloud exit first slice

**Draft for Claude’s read, then PLAN FOR APPROVAL through the watcher.** The owner’s 24 November “y” covers planning only. The [9 November privacy-specialist pause](../../backlog.md#current-state) still blocks every D101 build. Billing slice G waits for usable return, read-only recovery and proven purge. Hosted non-payment also needs counsel’s clearance. [Billing design §8](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account)

## One download from test Cloud

With a fresh owner sign-in, save one verified encrypted archive for a synthetic venue and its managed backup key to private local files. Reuse Cloud’s owner-approved, expiring snapshot recovery and private delivery fixture at `ff7d12b44`. Use the matching venue master key from the venue’s Waitron recovery pack and prepare recovery against those exact bytes. The archive key decrypts the file. The venue master key authenticates recovery. Amazon’s encryption keys stay in its key service. [Cloud recovery](../../../packages/account-http/src/recovery.ts) · [Waitron file restore](https://github.com/clintongormley/waitron/blob/e5c428a18c536c1c906fa519e5f380b69a29226c/apps/server/src/restore-command.ts)

Candidate files are [the integration harness](../../../scripts/test-cloud-integration.mjs), [the offline restore fixture](../../../deploy/test-cloud/test-fixtures/integration-authorised-recovery.test.ts) and [the acceptance test](../../../scripts/test-cloud-paid-authorised-recovery.test.mjs). Estimate zero production lines and 80–150 test and fixture lines. Use synthetic venues and local storage. Defer portal, protocol, journal, scheduling and deletion changes.

Finish when the pinned Waitron consumer restores those files with Cloud and the old box unreachable. Check the digest, SQLite integrity and unchanged source sales and fiscal records. Keep trading and filing off. Waitron refuses wrong keys, damaged bytes and missing preparation before placement. Refuse billing-only or other-venue access. Expiry or revocation stops delivery. Keep bytes and keys out of logs. If the pinned consumer rejects the handoff, record the gap and leave restore unproved.

Full return still needs a consistent SQLite database, latest documented backup and portable key, required module and vault state, version manifest, checksums and offline instructions. Resolve external vault dependencies before release. Flag an unverified latest copy, include the last verified one and show any missing tail. Tell owners **You are now responsible for keeping your fiscal records. Download and check your copies.** [Exit roadmap](2026-10-22-cloud-data-protection.md#slice-8-resumable-full-exit-export-and-portable-keys)

## Later service end and purge proof

Reuse the lifecycle journal. Require Waitron’s stop and final capture evidence before runtime cleanup. Keep recovery read-only until the database UTC deadline, fixed at effective service end plus 90 × 24 hours. Verified early deletion takes priority. Withdraw links and readers and review exceptions before deleting. Resubscribe through the journal before the deadline only after verifying retained data. Refuse recovery once purge starts. [Lifecycle journal](../../data-lifecycle-journal.md)

Query actual stores after purge. Check database rows, backup versions, stream copies, disks, replicas, exports, scratch, unfinished uploads, queues, support attachments, logs and shared backups. Check every key dependency before retirement. Prove retries cannot resurrect data and neighbouring venues still restore. Scheduled key deletion, unknown outcomes and residual copies stay pending. Record observations without payloads. [Purge roadmap](2026-10-22-cloud-data-protection.md#slice-10-all-copy-purge-and-honest-deletion-receipts)

## Questions for counsel and the owner

- What terms cover return, early deletion and hosted non-payment? Put the 90-day instruction and earlier verified choice in the agreement. Clear hosted stops separately.
- What must survive, who may see it and when must it go? Keep only Cloud billing evidence routinely. Require documented authority, notice and expiry for any other hold.
- Can shared-backup expiry and Amazon key delays meet the deadline? Agree bounded expiry and reapply deletions before restored backups become accessible. Report pending until verified.
- Owner decision. What if a hosted venue lacks its matching pack? Require an owner-held pack before promising portable recovery.
