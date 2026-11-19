# Cloud backup and restore check on the Amazon test machine

The paired Juniper Test Cafe box sends a synthetic, non-fiscal backup and the
operator shows the owner the isolated restore-check result for those same bytes.
The portal row stays pending because recovery remains unavailable. This is part of
the [Amazon test Cloud request](2026-11-16-test-cloud-aws.md). The watcher cleared
the public route and result on 19 November at 10:05/10:13 and the exact-release
verifier on 10:18. On 19 November at 11:34 the watcher cleared the pin,
builder and their checks to land first, so Lane G can use them for its
local rehearsal. The watcher cleared the upload and test worker to land before
fresh pairing on 19 November at 12:58. Only the live capture waits for pairing.

1. **Bind the verifier to the reset release.** Lane J owns the single authorised
   reset and records the installed release SHA and immutable app image. The
   owner must pair the new synthetic venue before live capture. Confirm the
   installed image and source, and keep that exact Git commit fetchable.
   On disposable Linux run the same app image with network off, no volumes and a
   Node entrypoint to read `currentBackupVerificationTarget()` from
   `/app/backup-verification.js`. The output supplies
   `deploy/backup-verifier/amazon-test-target.json`. Check its SHA against the
   app image label. `scripts/build-backup-verifier.mjs --amazon-test` archives
   only that commit and retains the check that its compiled target equals the pin.
   `deploy/test-cloud/{runtime,backup-worker}.mjs` passes
   `CLOUD_TEST_AMAZON_BACKUPS=1` to the test backup worker to supply the pin's SHA
   to its existing `expectedRevision` option. Refuse other modes. The shared
   verifier runtime and its two other pins keep their current paths. Extend `scripts/{build-backup-verifier,ci-proof-inputs}.test.mjs`,
   `ci-proof-inputs.mjs` and `deploy/test-cloud/{runtime,backup-worker}.test.mjs`
   for the Amazon pin, defaults, mode, image ID and revision checks.
2. **Accept the upload on existing HTTPS.** In `packages/backups/src/captures.ts`
   and `deploy/test-cloud/{account-worker,service-runtime}.mjs`, substitute the
   canonical origin only in the signed reservation reply in explicit Amazon test
   mode. Provisioning, grants and server-side storage stay private. In
   `proxy.amazon.cfg`, forward only length-bounded
   `PUT /venue-<UUID>/incoming/<UUID>` on the exact host. Preserve signed fields,
   allow the SDK's `x-id=PutObject` query and strip forwarding headers. Refuse
   other storage methods, paths, copy headers and queries. Storage checks the
   scoped signature. Verify backend TLS at `waitron.local` with only the public
   portion of the private CA, copied by `bootstrap.mjs`. The existing
   `venue-service-captures.test.ts` and `bootstrap.test.mjs` check the endpoint and
   CA. `proxy-proof.test.mjs` checks the real signed PUT, plus unsigned, wrong or
   expired signatures, oversize, other paths and methods, and non-test refusal.
3. **Verify and show the result.** Opt in through Amazon Compose.
   `scripts/test-cloud-deploy.test.mjs` checks the driver's selection and private
   mounts. Only the trusted worker gets Docker control. The child has no network
   and retains 1 GiB RAM. Use the bounded disk scratch described below. In `docs/test-cloud.md`
   add the venue bucket and `BackupCatalogue.provision` steps. Set the existing
   test Cloud policy to the validated full Amazon pin and exact image ID with
   `release_ready=false`. Confirm only the synthetic venue uses this policy.
   After step 2, rehearse with a fresh archive and real uploader from the exact
   release on disposable Linux. Use the snapshot fixture's capture and
   publication pieces. The ordinary recovery proof retains its current policy.
   Measure archive, image, scratch and host RAM/disk during the verifier run.
   Stop on capacity or failed checks and record the exact sizes, status and
   reason. Privately transfer the matching verifier and read back its image ID.
   The private trial read starts from the capture's latest attempt. Require
   admission, a passing result, the current policy and image, matching digest and
   bytes, all required module checks and confirmed child cleanup.
   `verification-admission.test.ts` checks that result alongside pending
   qualification and `recovery-qualification.test.ts` checks recovery refusal.
   Readiness stays false, so the normal 48-hour stale snapshot notice can still
   appear. Explain it during the trial.

Run focused tests first, whole-branch review and current-head CI before Amazon
rollout. Capture only from the confirmed synthetic venue. Show the readout and
continued Staff access. Record the upload route, off and rollback steps and trial
result in the PR and update `docs/backlog.md`. The source stays the sole writer.
Estimate +250/−20 runtime and configuration lines, +245/−10 test lines, one
generated pin and about 45 guide lines. The upload ceiling stays 512 MiB. The
trial archive must fit the verifier's smaller scratch budget. Continuous upload,
activation and fiscal proof sit outside this slice.

**Bounded disk scratch amendment, pending watcher clearance.** The pinned release
reserves 256 MiB free before it can expand a compressed backup. Lane K's real
uploader stored 102,338 bytes in disposable Linux and the verifier returned
`unavailable / resource_limit` at the 256 MiB cap. Use Lane G's measured archive
size and verified volume bound with its margin once posted. Record both before
building or equipping the test host.

On the existing Amazon disk use private, fixed-size ext4 filesystems under
`/opt/waitron-cloud/amazon-backup-stages`. Reuse the owner-labelled scratch volume
in [verifier containment](../../backup-verifier-containment.md#use-a-private-disk-for-the-venue-level-trial)
and the account/worker paths in `deploy/test-cloud/compose.backup-stage.yaml`.
Mount only the separate `work` directories inside the filesystems so startup fails
if the filesystems are missing. The controller sees verifier scratch at its absolute
host path and the child sees it only at `/scratch`. Keep the exact image and 1 GiB
memory limit, no child network, existing cleanup and `release_ready=false`.
Use `deploy/test-cloud/{deployment,backup-worker}.test.mjs` to prove the mounts and
refusal without the owned scratch. Rehearse the pinned uploader and isolated restore
on disposable Linux and record the same digest, peak resource use and cleanup.
