# D642 · Qualify large downloads in Test Cloud

The [ranged route](2026-11-25-d642-ranged-download.md) lets a test venue owner save a verified backup, key and manifest and open SQLite by streaming once the checker, browser memory comparison and HTTPS rehearsal pass. Until then, the download cap is 16 MiB. [Owner’s exit design](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account)

## Verify a 512 MiB backup on the LAN worker

In a disposable Linux checkout set `deploy/backup-verifier/streamed-target.json` to the generated target for Waitron `71daa2410af1c50c3a23429596ae0fb0ef62f552`, already pinned for the Amazon test build. Build with `node scripts/build-backup-verifier.mjs --streamed` and set the disposable database policy to that target and image. Use the LAN worker with the Amazon flag unset and the existing 1 GiB memory limit, 16 GiB private verifier scratch and 5 GiB worker stage. The Waitron sort fix previously passed on a 375,215,594-byte archive. [Scratch and policy](../../backup-verifier-containment.md#use-a-private-disk-for-the-venue-level-trial) · [Waitron fix](https://github.com/clintongormley/waitron/pull/3731)

Use the matching Waitron writer and high-entropy synthetic print jobs. Tune the final payload against **encrypted** size, 536,870,912 bytes including framing, and record compressed and expanded sizes. Publish each candidate alone in disposable worker state. Run `deploy/test-cloud/backup-worker.mjs --once` and read the attempt for that point. Reuse `deploy/test-cloud/test-fixtures/integration-verification-evidence.mjs` to check the verified point, size, digest and child cleanup. Run a corrupt-copy refusal and confirm both disk stages clear. Separately verify a small archive from the old LAN writer (`b1dbf335`) under the old pin. Switch image and policy, confirm it goes pending, then run the worker and confirm it returns to verified. Bring failures and the smallest correction to the watcher before promoting the pin.

Keep the Linux replay as a lane receipt. Run `scripts/build-backup-verifier.test.mjs` for the builder. Document the matched image rebuild, policy switch and temporary loss of download access during re-verification in `docs/backup-verifier-containment.md`. Update `docs/backlog/data-lifecycle.md`. Expect 24 generated pin lines, up to 30 product and 30 test lines for a Cloud fix.

## Isolate and fix browser memory growth

Reproduce the matched loopback with the same fixtures and 4 MiB replies. Compare fetch and drain without writes, writing the same chunks without fetch, and opening staged archives with fresh profiles. Attribute peaks by browser process and record idle and phase-start readings. If local opening grows, compare heap snapshots or forced collection where supported and isolate the binary copy loops in `apps/portal/src/backup-download-worker.ts`. Change one variable per run.

Fix the measured cause. Run `apps/portal/test/backup-download-worker.test.ts` for shared opening changes. Preserve a range-only variant and its replay in the lane receipt, then carry that code into slice C and rerun the comparison against the integrated route. Use the original harness baseline, sampler, profile handling, phase order and fixtures. Require three repeats per size in Chromium, Firefox and WebKit, the existing repeat-spread rule, matching checksums and valid authentication. If only measurement effects or an engine limit explain the result, take the evidence to the watcher. Expect up to 50 product and 50 test lines for a shared fix.

Lane J can run both checks with released Waitron code in a disposable environment.
