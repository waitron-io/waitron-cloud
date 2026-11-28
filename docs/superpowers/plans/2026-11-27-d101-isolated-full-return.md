# D101 isolated full-return rehearsal

Run this after Cloud offers a version 2 download that the venue’s master key opens. Use the same
master key for filing authority in Waitron setup Restore. The download and
read-only steps are in [Test Cloud](../../test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online).

1. **Prepare the files and keys.** Use a disposable synthetic deployment on the approved Linux
   test box. Match the source, verifier and replacement on the Waitron release used for the new
   download. Use a source with its vault key in the box’s settings file, which the encrypted
   archive includes. Save the verified version 2 archive, manifest and SQLite through Backups.
   Match the archive digest to the manifest. Keep the master key from the recovery pack private.
2. **Prepare and place the recovery.** Stop and disconnect the source and peers. Verify that
   their containers are stopped and the source listener is down. Follow the release’s filing-box
   recovery procedure for the saved archive. Use the master key, the sole recovery declarations
   and a real second clock from a separate device. Complete the clock checks and
   wait. Keep the replacement on the same system boot between clock confirmation and placement.
   Run `waitron-restore restore` with both isolation confirmations and the prepared operation for
   that copy, event and target. Keep the replacement on the private network.
3. **Check authority and vault access.** With the source down, check one healthy replacement over
   private HTTPS. Compare saved sales, filing rows and old counters. Check that the old series
   retire and the new ones start at one. Check that Waitron’s local
   `readCertMaterial` (`packages/fiscal-verifactu/src/aeat-transport.ts`) can open the restored
   vault’s filing certificate. Record authority and vault results separately, with the first
   refusal if either check stops. Verify cleanup and keep key values out of the receipt.

On 28 November, the browser-saved archive passed setup preview and staging. The replacement
compared its clock with a separate device, completed the wait and restored over the ordinary
command-line path. SQLite passed its integrity check. The ten practice sales, ten filing
records and ten submission rows matched the saved copy exactly. The four old series retired
with their counters intact and four new series started at one. The replacement used the key in its
restored settings file to open the filing certificate. It matched the certificate’s saved
fingerprint and answered its private HTTPS health check. This was a disposable preproduction rehearsal with the source stopped.
