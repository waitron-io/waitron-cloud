# CLOUD-EXIT · Download a version 2 backup

In Test Cloud Backups, save a verified backup and its checksum. The same Waitron opener
that setup **Restore** uses must open the saved copy with the venue’s one master key.
The [filing and vault rehearsal](2026-11-27-d101-isolated-full-return.md) covers setup,
current authority, placement and activation. Lane G’s watcher chose this slice on
27 November at 22:22 and cleared it with the changes below at 23:17.

**Use the key already in the verified copy.** Waitron main
[`5cc7bf033a`](https://github.com/clintongormley/waitron/tree/5cc7bf033ad3af159fd622ed7de210eb8bcf4124)
captures the payload with a separate Cloud key (`cloud-archive-target.ts:274–281`).
Read the derived backup key, number, master key ID and date from the same optional
`secrets/backup.env` member (`backup-key-record.ts:13–25`, `backup-env-writer.ts:54–74`,
`archive-entries.ts:88–106`). Before capture, mint the synthetic venue’s master key with
the helper used by `integration-recovery-authority.mjs`, write the numbered record with
Waitron’s `writeBackupKeyOne`, and keep the master key privately for the proof. For a
missing, malformed or duplicate record, show
that the restore file is unavailable. A copy can name an earlier key. Show the ID and date
at export and explain how to match the current pack before relying on one-key recovery.
Keep capture, stored copies, managed recovery, the account API and Waitron setup as they are.

- **Backups.** Update `apps/portal/src/{backup-screen,backup-controller,backup-types,locale}.ts`
  and the save binding in `app.ts` if needed. Send both small and ranged **Download backup**
  saves through the worker. Offer an explicit checksum save for that exact export. Retire the
  key download button and use the existing key and manifest requests within the worker.
  Keep the independent **Download database** action and current owner proof and deadline.
- **Conversion.** In `apps/portal/src/{backup-database-download,backup-download-worker,backup-download-bytes}.ts`
  reuse the existing length, SHA-256 and AES-GCM checks, the 16 MiB small transfer and 4 MiB ranges.
  Authenticate the source before reading the needed member with the bounded archive reader.
  Stream a fresh opening of the copy into the existing Waitron version 2 frame format
  (`packages/provisioning/src/artifact-cipher.ts`), preserving every original decrypted byte.
  Use fresh salt and IV, fill in the tag, then hash and save the same completed output.
  Keep large input and output in separate encrypted staged files and include both in the
  storage refusal path. Keep the small transfer bounded if disk staging is unavailable.
  Clear temporary files and key bytes on completion or cancellation. Include the version 2
  format, key ID and date, original capture time and exact output SHA-256 in the saved manifest.
- **Test first.** Use Portal `test/backup-download-worker.test.ts` and its download fixture for
  payload bytes, missing key metadata and corrupt input. Compare the worker’s output
  byte for byte with a small fixed frame made once by the pinned Waitron with a fixed
  key, salt and IV. Use
  `test/{backup-browser,backup-transport-boundary}.test.ts` for normal small and ranged saves,
  checksum pairing and cancellation. Preserve deadline, tenant and independent SQLite checks.
  Build before browser tests and inspect English and Spanish in both themes at 390 and 1280 pixels.
- **Prove the handoff.** Adapt `scripts/test-cloud-{integration,exit-download.test}.mjs` and the
  existing `deploy/test-cloud/test-fixtures/integration-recovery-authority.mjs` fixture to open
  the browser’s actual save with `openingKeyFor` and `decryptBackupFile` at the Waitron pin above.
  Use that pin for the exit rehearsal and keep the general integration pin.
  Compare the full payload and verify the master key ID. The opener gets only the master key.
  Update [Test Cloud](../../test-cloud.md) and the [backlog](../../backlog.md) in the feature
  PR with the observed result.

Estimate 230–330 added product lines and 130–190 added test lines. Use synthetic data on
isolated infrastructure.
