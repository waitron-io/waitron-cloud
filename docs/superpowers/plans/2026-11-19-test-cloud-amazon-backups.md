# Cloud backup and restore check on the Amazon test machine

After one private setup, the paired test box can send a small synthetic, non-fiscal
backup. In the portal's Venues page, you can see that same backup marked Verified.
The watcher put this first on 19 November at 09:16 under the owner's 16 November
request in the [Amazon plan](2026-11-16-test-cloud-aws.md). This proposal awaits
watcher clearance. Guest menus, switch trials and email follow this slice.

1. **Check the inputs first.** Read the reserved test box's current image and pairing
   without changing them. The 18 November 21:14 trial left revision `7cf65e7eea`
   paired, but the current source and pairing need a fresh check. Agree a synthetic
   non-fiscal venue on that box before capture. Leave the owner's restored data alone.
   Rehearse an archive from that source on disposable Linux. Verify compatibility
   and size against the standard pinned `deploy/backup-verifier/target.json` image
   with 1 GiB memory and 256 MiB scratch. Use that profile, which needs no new
   disk stages. Measure the image and peak RAM/disk against the current host floors.
   If the archive needs a different target or disk-backed scratch, stop for a
   smaller plan decision using the measured sizes.
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
   `proxy-proof.test.mjs` checks a real signed PUT, refusals and backend TLS.
3. **Use the existing verifier and show the result.** Opt in through the Amazon
   Compose configuration. Wire the immutable image and validate the selected
   worker and mount roles in `scripts/test-cloud-deploy.mjs`. Only the trusted
   worker gets Docker control and private controller state. Its child has no
   network. Use `test-cloud-deploy.test.mjs` for opt-in and mount refusals and
   `backup-worker.test.mjs` for the pinned image and controller. Add private
   operator steps to `docs/test-cloud.md`: create the synthetic venue's bucket,
   call `BackupCatalogue.provision` on that paired installation and install the
   existing verification policy. Use the existing backup and rollback procedure.
   After named tests, whole-branch review and green CI, use the running host for
   one agreed synthetic capture. Read back matching bytes, the check, child
   cleanup and continued Staff access. Show the owner the Verified row and
   update `docs/backlog.md`. The source stays the sole writer.

Estimate +150/−15 runtime and configuration lines, +140/−10 test lines and
about 40 guide lines. The existing machine, disk, DNS and 512 MiB archive ceiling
stand. The continuous-stream endpoint stays private, so stream uploads may retry.
Show the retained backup result only. Restoring onto a box and fiscal checks
remain separate.
