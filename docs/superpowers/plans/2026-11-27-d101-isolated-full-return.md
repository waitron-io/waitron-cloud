# D101 isolated full-return rehearsal

Show how far one saved Cloud backup gets on an isolated replacement box. Record the first refusal
and the input the venue still needs if recovery stops.

Use Cloud `0efb4144fef0084e223cd1da2a2e315d2b3dc401`. Match the source, verifier and replacement
on Waitron `c5f12f9163dbedf0924281a2ff2c7fc505d45d38` (A1629) and check pairing first. The existing
[authorised recovery proof](../../../scripts/test-cloud-paid-authorised-recovery.test.mjs) uses a
Cloud-selected copy and simulated clocks. This run uses the owner’s actual downloaded files.

1. **Save the files.** Use a disposable synthetic deployment on the approved Linux test box.
   Save the matching master key from Waitron’s ordinary first-setup recovery pack. Follow the
   [Backups guide](../../test-cloud.md#save-a-verified-backup-while-the-test-box-stays-online) to
   save one verified archive, key, manifest and SQLite from the same row into a private directory.
   Match the archive digest to the manifest. Open those bytes offline, compare the extracted SQLite
   to the browser save and run `PRAGMA integrity_check`. Keep the verifier result separate.
2. **Identify the keys.** The downloaded Cloud key opens the version 1 archive through
   `WAITRON_BACKUP_RECOVERY_KEY`. The recovery pack supplies the master key for authority.
   A1629 uses the saved box key in `backup.env` for sealed state. Start with the synthetic source
   that keeps its vault key in `secrets.env`. Record whether that key is present in the archive.
   For an externally keyed source, Waitron accepts its separately retained `WAITRON_CREDENTIALS_KEY`
   and matching version through private process settings. Record whether the fixture supports
   this mode. If it does not, say what fixture is needed. Retain no key values in the receipt.
3. **Try the supported preparation first.** Stop and disconnect the source and peers. Verify their
   recorded containers are stopped and the source listener is down. Follow Waitron’s
   [recovery guide](https://github.com/clintongormley/waitron/blob/c5f12f9163dbedf0924281a2ff2c7fc505d45d38/docs/operations/hour-recovery.md).
   Check for an owner procedure that prepares a current operation for this version 1 file. The
   setup file route requires version 2. If no supported tool prepares the downloaded copy, record
   the exact refusal before placement and name version 1 preparation as a Waitron dependency.
   With a supported tool, use the matching master key, sole recovery declarations and a real
   second clock from a device on the private network. Complete the normal clock checks and wait.
   Keep the replacement on the same system boot between clock confirmation and placement.
   Run `waitron-restore restore` with both isolation confirmations only with the operation it
   produced for that copy, event and target. Keep the replacement on the private network.
4. **Record the result.** Give the authority and vault checks separate results or mark each step
   that was never reached. After a successful restore, check one healthy replacement over private
   HTTPS with the source down. Compare saved sales, filing rows and old counters. Check old series
   retire and new ones start at one. Test vault access using Waitron’s local `readCertMaterial`
   (`packages/fiscal-verifactu/src/aeat-transport.ts`). Keep only the outcome and verify cleanup.

Update [Test Cloud](../../test-cloud.md) and the [backlog](../../backlog.md) with the observed result
and keep the read-only steps. Expect 15–25 guide and backlog lines, with zero committed code or test
lines. Use synthetic data and the shipped fiscal checks. Keep the shared Test Cloud and providers
outside the rehearsal. Waitron’s `docs/developers/offline-fiscal-restore.md` describes historical flags.
