# D101 isolated full-return rehearsal

Show what a synthetic venue can recover on one isolated Waitron box from a saved Cloud backup.
If recovery stops, record the first refusal and the input the venue still needs.

**Pins.** Cloud `0efb4144fef0084e223cd1da2a2e315d2b3dc401` and Waitron main
`c5f12f9163dbedf0924281a2ff2c7fc505d45d38` (A1629). Cloud #1455 records the earlier
`restore.hook_failed (module fiscal-verifactu: sif.allocation_invalid)`.

1. **Download.** Reuse the [exit download rehearsal](../../../scripts/test-cloud-exit-download.test.mjs)
   on the approved Linux test box with a private synthetic venue and the matched Waitron verifier.
   Use the same Waitron environment on the target as on the source.
   Save the actual archive, key, manifest and SQLite from one verified Backups row in the exit window.
   Match archive size and SHA-256 to storage and the hash to the manifest before opening those bytes
   offline. Match extracted SQLite to the browser save byte for byte. Run `PRAGMA integrity_check`
   in `sqlite3 -readonly`, read saved sales and filing rows and counters, and record the verifier verdict.
2. **Keys and isolation.** Supply the downloaded Cloud key as `WAITRON_BACKUP_RECOVERY_KEY` for the
   version 1 file. Retain the matching recovery pack for authority (`--master-key-file` or
   `WAITRON_MASTER_KEY` in `restore-command.ts`). A1629 uses the saved box key in `backup.env` for
   sealed box state. Record whether the archive carries the vault key. For an externally keyed
   source, supply its separately retained vault ring via private `WAITRON_CREDENTIALS_KEY` and
   `WAITRON_CREDENTIALS_KEY_VERSION`, with the previous pair if needed.
   Stop and disconnect the source and any peers. Verify their container IDs are stopped and the
   source listener is down. Confirm there is only one recovery attempt before making declarations.
3. **Authority and restore.** Follow Waitron's `docs/operations/hour-recovery.md` on the target. Use the
   master key for authority, make the two declarations, compare clocks with an independent device,
   confirm the time if asked and let Waitron choose an unused UTC minute after its normal wait.
   Use staged restore and its restart checks, or `waitron-restore restore <archive>` with
   `--confirm-old-box-gone`, `--confirm-sole-recovery` and a `WAITRON_RECOVERY_OPERATION_FILE` from
   real preparation on that same archive, event and target (`hour-recovery-placement-1.test.ts:464`).
   The setup file route refuses version 1 (`backup-file-key.ts:13`). If the existing procedure cannot
   prepare a valid operation from the saved file, record the step, code and reason and leave the
   target inactive. Ask the watcher to route preparation of the download with both keys to Waitron.
4. **Outcome.** After authorised placement, verify one healthy target over private HTTPS and the source
   still down. Compare saved sales, filing rows and counters. Check old series retired and new series
   starting at one. Confirm the vault credential decrypts with local `readCertMaterial`. Keep a
   secret-free receipt. Verify cleanup of the run’s files and containers and release the test-box slot.

**After evidence.** Update [docs/test-cloud.md](../../test-cloud.md) and [docs/backlog.md](../../backlog.md).
Keep the read-only steps, report the result or missing input, and check the diff and links. Expect 0 code,
0 test and 15–25 documentation lines. Exclude shared Test Cloud, real data, provider calls and product
changes. Keep fiscal code, authority, fixtures, expected results and gates as shipped. The flags in
`offline-fiscal-restore.md` are historical.
