# D621 scratch marker flush plan

Lane G’s `queue.md` records “The rest of P1’s checks: speed targets, losing the database machine, real services”. Its next step asks to “account for hard-stop marker durability raised in review and run the same-host dry run on the exact launch checkout.” The [prior repair](2026-11-27-d621-scratch-witness.md) changed marker placement only.

The launcher’s write and read commands ran in an isolated x86 Debian 13 VM on ext4 mounted in a file on another ext4 disk. Cutting power one and three seconds after the write lost the new marker and preserved an older one. Adding Debian’s `sync "$marker"` inside the write shell preserved both markers after the one-second cut. The Lane G `d621-hard-stop.5eQusYzy` receipt retains the probe and all three results.

## Pull request

- In [`scripts/amazon-run.test.mjs`](../../../scripts/amazon-run.test.mjs#L310), add one `baseline cold sync failure` case to the existing table. In the SSH stub, use `spawnSync` to run one generated write in its `sh -ec` shell with a temporary mount path and a test-only `sync` function. Have the function check that it received just the marker path and that the expected instance ID is already in the file, then return a distinctive failure. Pass that status back as an SSH rejection and assert that the launcher rejects without asking to stop all three machines. A zero exit follows the existing fake disk path. Run `node --test scripts/amazon-run.test.mjs` first and see the new case fail because the old write reaches the stop.
- In [`scripts/amazon-run.mjs`](../../../scripts/amazon-run.mjs#L535), add `sync "$marker"` after `printf` in the existing `sh -ec` write branch. SSH reports success only after the flush, and the existing wait for all three writes blocks the stop on any error. Rerun the launcher and bootstrap tests, preserving the existing recovery assertions. Repeat the VM check using the candidate’s generated write and read.
- Update the D621 entry in [`docs/backlog.md`](../../backlog.md#platform-work-to-scope) with the confirmed local evidence and the open Stockholm restart and restore. Estimate one launcher line, about 20–25 test lines including the stub, zero separate support lines or files, and 3–5 backlog lines.

## Scope and launch

Keep the current marker location, restart and recovery conditions, and timing targets. Bootstrap and paid rehearsal are outside this pull request. Paid runs used are 3 of 10.

After the fix lands, run `node scripts/amazon-run.mjs measured-stops-dry-run` on the launch host from the exact revised, clean and installed `main` checkout selected for launch, with the same private config and pinned Waitron image. Save the Cloud commit and bundled image IDs with the dry-run receipt. [Launch guide](../../aws-infrastructure.md#rehearse-the-full-service-journey-from-outside-the-cell)
