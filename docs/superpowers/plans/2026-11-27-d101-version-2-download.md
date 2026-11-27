# CLOUD-EXIT · Download a version 2 backup

On an authorised Test Cloud account, save a verified backup and its checksum from Backups.
Use the venue master key in Waitron setup **Restore**. A synthetic venue on the matched
release must be able to stage and prepare those exact bytes with one secret. The separate
[filing and vault rehearsal](2026-11-27-d101-isolated-full-return.md) covers placement and activation.
Lane G's watcher chose this slice on 27 November at 22:22.

**Use the numbered key already in the verified copy.** Waitron main at
[`5cc7bf033a`](https://github.com/clintongormley/waitron/tree/5cc7bf033ad3af159fd622ed7de210eb8bcf4124)
captures the full payload with a separate Cloud key (`cloud-archive-target.ts:274–281`).
The optional `secrets/backup.env` copied into that payload holds the box's derived backup key,
its number and its master key's ID and date (`backup-key-record.ts:13–25`,
`backup-env-writer.ts:54–74`, `archive-entries.ts:88–106`). The owner enters the master key
only in Waitron. Use a fresh synthetic source set up with the same current master key for
archive opening and recovery authority. A fixture that inserts only an authority row needs the
normal Waitron backup-key writer too. Show a specific refusal when a copy lacks a usable numbered
record. Older packs can name a different key. A single-key recovery claim covers the matching
copy and pack that the setup proof exercises. Test controls, capture, stored copies, managed
recovery and Waitron setup stay on their existing paths.

- **Backups.** Update `apps/portal/src/{backup-screen,backup-controller,backup-types,locale}.ts`
  and the existing save binding in `app.ts` if its signature changes. **Download backup** saves
  the version 2 file and a manifest hashed from those exact bytes with the original capture time.
  Remove the separate recovery-key and manifest buttons. Reuse the worker's internal key and
  source-manifest requests. **Download database** remains available for read-only access.
- **Conversion.** Update `apps/portal/src/{backup-database-download,backup-download-worker,backup-download-bytes}.ts`
  as needed. Reuse the small transfer, 4 MiB ranges, bounded browser staging, length, SHA-256 and
  AES-GCM checks. Read only the required fields from the authenticated archive's bounded
  `backup.env` member. Seal the same compressed payload in Waitron's existing `WBK1` v2 format
  with its derived key, number, ID and day, and fresh salt and IV. Match
  `packages/provisioning/src/artifact-cipher.ts` in Waitron. Save after both the sealed output
  and its hash are ready. Clear temporary files on cancellation or failure.
- **Test first.** Extend Portal `test/backup-download-worker.test.ts` and its
  `test/fixtures/backup-download.ts` fixture for the exact frame, unchanged payload, missing
  metadata and corrupt input. Extend `test/{backup-browser,backup-transport-boundary}.test.ts`
  where they own simple and ranged Backups saves, exact output hash, proof and cancellations.
  Keep existing deadline and tenant checks and the independent SQLite byte comparison.
  Build the portal before browser tests and check English and Spanish in both themes at 390
  and 1280 pixels.
- **Prove the handoff.** Use Waitron's pinned `openingKeyFor` and `decryptBackupFile` on the actual
  browser save and compare the complete payload. Run the normal setup stage and preparation
  with that file and the synthetic venue pack. Reuse the local journey in
  `scripts/test-cloud-{integration,exit-download.test}.mjs`. An archive that requires a second
  authority key fails this proof. Update [Test Cloud](../../test-cloud.md) and the [backlog](../../backlog.md) with what passed.

Estimate 200–280 added product lines and 100–150 added test lines. Use synthetic data on
isolated infrastructure.
