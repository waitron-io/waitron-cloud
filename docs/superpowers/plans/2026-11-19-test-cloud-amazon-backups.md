# Cloud backup and restore check on the Amazon test machine

After one private setup, the paired test box can send a small synthetic, non-fiscal
backup, then see the restore-check result for those same bytes with the operator.
The watcher put this first on 19 November at 09:16 under the owner's 16 November
request in the [Amazon plan](2026-11-16-test-cloud-aws.md). Guest menus, switch
trials and email follow this slice.

1. **Bind the verifier to the reset release.** At 10:18 on 19 November the watcher
   cleared a verifier from Lane J's exact installed Waitron SHA for this Amazon
   test Cloud. Lane J owns the authorised single reset and records the release.
   The owner pairs Juniper Test Cafe again before live capture. Read back the
   source image and confirm the venue is wholly synthetic and non-fiscal.
   The 10:15 comparison found that both existing pins differ in core migrations
   from a fresh install on Waitron main.
   Generate `deploy/backup-verifier/amazon-test-target.json` from
   `currentBackupVerificationTarget()` in the exact release's compiled bundle.
   Add `--amazon-test` to `scripts/build-backup-verifier.mjs`. Keep committed-source
   archival and the Dockerfile check that the built target equals the full pin.
   In `deploy/test-cloud/{runtime,backup-worker,backup-verifier-runtime}.mjs`,
   select that pin via the explicit Amazon backup opt-in and have only the
   backup worker receive the immutable verifier image ID. Verify its revision
   label against the pin. Build and verify a fresh archive from the same release
   through the real proxy on disposable Linux. Retain 1 GiB memory and 256 MiB
   scratch. Measure archive, image and peak RAM and disk. Stop with the measured
   sizes if they exceed the limits. Privately transfer the matching image and
   read back its ID. The default and streamed pins keep their existing paths.
   `scripts/build-backup-verifier.test.mjs` checks source selection and defaults.
   `runtime.test.mjs` checks opt-in and role selection. `backup-worker.test.mjs`
   checks the image/SHA binding and standard limits.
2. **Accept the upload on existing HTTPS.** In `packages/backups/src/captures.ts`
   and `deploy/test-cloud/{account-worker,service-runtime}.mjs`, substitute the
   canonical origin only in the reply to the signed reservation in explicit Amazon
   test mode. Keep the stored location, grant exchange and server-side object
   traffic private. In `proxy.amazon.cfg`, forward only a length-bounded
   `PUT /venue-<UUID>/incoming/<UUID>` on the exact host. Preserve signed fields,
   allow the SDK's `x-id=PutObject` query and strip forwarding headers. Refuse other
   storage methods, paths, copy headers and queries. Storage checks the scoped
   signature. The proxy verifies `waitron.local` with the public portion of the
   private storage CA from `bootstrap.mjs` in the existing certificate volume.
   `venue-service-captures.test.ts` checks the split and the test-only gate.
   `bootstrap.test.mjs` checks the CA copy. `proxy-proof.test.mjs` checks backend TLS,
   a real signed PUT, and unsigned, wrong or expired signatures, oversize, alternate
   paths/methods and non-test mode through the proxy.
3. **Use the existing verifier and show the result.** Opt in through
   `deploy/test-cloud/compose.amazon.yaml`. Validate the immutable image, worker
   and mount roles in `scripts/test-cloud-deploy.mjs`. Only the trusted
   worker gets Docker control and private controller state. Its child has no
   network. Use `scripts/test-cloud-deploy.test.mjs` for opt-in and mount refusals.
   Add private operator steps to `docs/test-cloud.md`: create `venue-<venueId>`, call
   `BackupCatalogue.provision` for that paired installation, load the Amazon-test
   expected target and call `setVerificationPolicy(client, expectedTarget,
   'local.waitron-verifier@' + builtImageId, false)`; exercise both steps on disposable
   Linux. Run the existing release-disabled check in
   `packages/backups/test/verification-admission.test.ts` and recovery refusals in
   `packages/backups/test/recovery-qualification.test.ts` against throwaway PostgreSQL.
   Keep `release_ready=false`: no backup becomes eligible for recovery approval.
   Use the existing backup and rollback procedure.
   After named tests, whole-branch review and green CI, use the running host for
   one agreed synthetic capture. Read back matching bytes, the check, child
   cleanup and continued Staff access. Show the owner the matching admitted
   restore-check result in the guided trial. The portal row stays pending and
   recovery stays gated.
   Record how to turn off the upload in the PR and update `docs/backlog.md`.
   The source stays the sole writer.

Estimate +235/−20 runtime/build/configuration lines, +225/−10 test lines,
one generated target JSON and about 40 guide lines. The existing machine, disk,
DNS and 512 MiB archive ceiling
stand. The continuous-stream endpoint stays private, so stream uploads may retry.
Show the retained backup result only. Restoring onto a box and fiscal checks
remain separate.
