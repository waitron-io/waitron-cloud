# Cloud backup and restore check on the Amazon test machine

After setup, the existing paired test box can send a synthetic, non-fiscal backup.
The same encrypted backup is retained and passes the isolated data restore check.
The watcher put this first on 19 November at 09:16 under the owner's 16 November
test-workflow request in the [Amazon plan](2026-11-16-test-cloud-aws.md).
This proposal awaits watcher clearance. Guest menus, switch trials, email,
continuous streams, ordinary recovery and fiscal verification follow their own work.

1. **Accept the box's upload on existing HTTPS.** In `packages/backups/src/captures.ts`
   and `deploy/test-cloud/{account-worker,service-runtime}.mjs`, allow the explicit
   Amazon test setting to substitute the canonical account origin only in the
   response to the box's signed reservation. Keep the catalogue, scoped credential
   exchange and all server-side object operations on private storage. Have
   `proxy.amazon.cfg` forward only the signed upload's `PUT /venue-<UUID>/incoming/<UUID>`
   on the exact HTTPS host. Preserve the signed Host, path, query and headers.
   The proxy verifies `waitron.local` against the private storage CA's public
   certificate copied by `bootstrap.mjs` into its existing certificate volume. Storage has no
   published port. Use the existing private bucket setup and
   `BackupCatalogue.provision` for one synthetic test venue after confirming
   current backup permission. Use `venue-service-captures.test.ts` for response
   location and private grant location, and `proxy-proof.test.mjs` for the real
   signed upload, rejection of other storage operations and backend TLS refusal.
2. **Run the existing verifier with bounded storage.** Reuse the stage mounts
   from #1285 and the disk-backed verifier from #1289. Add an explicit
   `compose.amazon-backups.yaml` opt-in and validate it in
   `scripts/test-cloud-deploy.mjs`. Mount Docker control only in the trusted
   backup worker. Keep the verifier child networkless and retain its 1 GiB
   memory limit. Pass the stage, scratch and immutable image settings only to
   their consumers in `runtime.mjs`. Use the repository's streamed target and
   matching Waitron verifier image. Confirm the real box's archive compatibility
   before enabling it. The existing verification policy and catalogue APIs
   handle admission. Use `test-cloud-deploy.test.mjs` for rendered mount and
   profile admission, and `backup-worker.test.mjs` for image and scratch wiring.
   Measure capacity with the existing disk/RAM floors and 512 MiB archive
   ceiling. Stop for the watcher if the current machine cannot fit it.
3. **Exercise one real backup.** Use named failing tests before each change,
   then repeat them with disposable PostgreSQL and Linux where needed. Once
   reviewed and green, use the existing private rollback procedure and stage
   within the running host's space. Use one synthetic capture from the
   pre-production box to show upload, retention of matching bytes and the
   verifier's result. Read back the capture digest, child cleanup, peak resource
   use and continued Staff access. The source stays the sole writer. Record the
   result in `docs/test-cloud.md` and `docs/backlog.md`.

Estimate +230/−25 lines of runtime and configuration, +200/−10 of tests and
about 40 lines of guides. If it needs separate pull requests, the first delivers
upload and retention with verification pending. The second verifies that same
retained capture. The plan uses the existing machine, DNS, disk and test box.
