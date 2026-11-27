# D101 isolated full-return rehearsal

Run this after Waitron setup Restore can stage and prepare a version 1 Cloud download using its
downloaded recovery key and the separately held master key for filing authority. The current
refusal and read-only recovery steps are in [Test Cloud](../../test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online).

1. **Prepare the files and keys.** Use a disposable synthetic deployment on the approved Linux
   test box. Match source, verifier and replacement on a Waitron release with version 1 preparation
   support. Use a source that keeps its vault key outside the archive. Save one verified archive,
   key, manifest and SQLite through Backups. Match the archive digest to the manifest. Keep the
   master key from the recovery pack and the separate vault key and version private.
2. **Prepare and place the recovery.** Stop and disconnect the source and peers. Verify that
   their containers are stopped and the source listener is down. Follow the release’s filing-box
   recovery procedure for the saved archive. Give the replacement `WAITRON_CREDENTIALS_KEY`
   and matching `WAITRON_CREDENTIALS_KEY_VERSION` as private process settings. Use the master
   key, the sole recovery declarations and a real second clock from a device on the private
   network. Complete the clock checks and
   wait. Keep the replacement on the same system boot between clock confirmation and placement.
   Run `waitron-restore restore` with both isolation confirmations and the prepared operation for
   that copy, event and target. Keep the replacement on the private network.
3. **Check authority and vault access.** With the source down, check one healthy replacement over
   private HTTPS. Compare saved sales, filing rows and old counters. Check that the old series
   retire and the new ones start at one. Check that Waitron’s local
   `readCertMaterial` (`packages/fiscal-verifactu/src/aeat-transport.ts`) can open the restored
   vault’s filing certificate. Record authority and vault results separately, with the first
   refusal if either check stops. Verify cleanup and keep key values out of the receipt.

Update [Test Cloud](../../test-cloud.md) and the [backlog](../../backlog.md) with the observed
result. Use synthetic data, isolated infrastructure and Waitron’s shipped fiscal checks.
