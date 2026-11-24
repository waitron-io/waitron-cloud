# D621 — Amazon test verifier pin

After this change, a fresh Amazon test deployment and its Linux rehearsal can use the same signed-upload Waitron build for the box and the backup verifier. This slice ends with a checked pin on Cloud main. The full free rehearsal of that exact pair follows. A paid Stockholm run depends on that rehearsal passing and the existing run limits.

## Change the pin

- Use merged Waitron `71daa2410af1c50c3a23429596ae0fb0ef62f552` (#4204). The full free rehearsal used its PR head `26e93da6b7256546f9122863c8a1ed4b7dfc2d30`. Comparing those revisions shows no difference in migration files, backup policy or signed-upload code. The merge does change the release identity and lockfile, so read the target from its own built server.
- Replace `deploy/backup-verifier/amazon-test-target.json` with the output of the compiled Waitron server's `currentBackupVerificationTarget()`. Use the existing Waitron build and release generator on an isolated Linux host. Run Cloud's normal `node scripts/build-backup-verifier.mjs --amazon-test` with that JSON so the Dockerfile checks equality against the compiled target. Report the revision, runtime fingerprint and target digests in the PR.
- Update the D621 paragraph in `docs/backlog.md` to give the new pin and leave the exact-pair rehearsal and paid qualification open. Keep the general and venue-level verifier pins, deployment code and test assertions as they are.

## Check and review

- Run `node --test scripts/build-backup-verifier.test.mjs scripts/ci-verifier-build-refusals.test.mjs deploy/kubernetes/services.test.mjs`. Use the existing rehearsal target selector with `requireNativeMatch: true` to accept the new compiled target and refuse the old `bd0f485` target. Check the worker's existing image-revision refusal with the same old and new revisions before attempting any deployment.
- The optional single-host Amazon backup worker reads this pin, as do the bounded Amazon run and Kind service rehearsal. Restarting an updated single-host worker with the former verifier image would refuse that image. A box still on `bd0f485` cannot qualify new backups against the new exact target. Tell the watcher before landing and keep the shared test Cloud on its current deployment during this PR.
- Expect one generated JSON update of at most 40 changed lines and two backlog lines, with no implementation code or new test files. The existing checks own the target format, compiled equality and revision refusal. Run the whole-branch review and read exact-head CI before landing.
