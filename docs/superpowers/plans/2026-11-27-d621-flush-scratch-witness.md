# D621 scratch marker flush plan

Lane G’s `queue.md` records “The rest of P1’s checks: speed targets, losing the database machine, real services”. Its next step asks to “account for hard-stop marker durability raised in review and run the same-host dry run on the exact launch checkout.” The [prior repair](2026-11-27-d621-scratch-witness.md) changed marker placement only.

The launcher’s write and read commands ran in an isolated x86 Debian 13 VM on ext4 mounted in a file on another ext4 disk. Cutting power one and three seconds after the write lost the new marker and preserved an older one. Flushing the marker and its containing directory with Debian’s `sync` preserved both after the one-second cut. The Lane G `d621-hard-stop.5eQusYzy` receipt retains the probe and results.

## Pull request

- In [`scripts/amazon-run.test.mjs`](../../../scripts/amazon-run.test.mjs#L310), add one `baseline cold sync failure` case. Run one real generated marker write locally in the SSH test double. Redirect its mount argument to a test-owned temporary directory and assert the original path is gone before executing the shell. Put executable `sudo` and `sync` stubs first on `PATH`, reusing the pattern in `scripts/cloud-cost/isolated-cancel.test.mjs`. The `sync` stub checks its two paths and the written instance ID before returning a distinctive error. The launcher must reject with that error before any all-machine stop, using the existing no-stop assertion. Run `node --test scripts/amazon-run.test.mjs` first. The base lacks the flush and wrongly reaches the stop.
- In [`scripts/amazon-run.mjs`](../../../scripts/amazon-run.mjs#L535), add `sync "$marker" "$2"` after `printf` so the file contents and its directory entry reach disk before the write reports success. The existing wait for all three writes blocks a stop if any fails. Run `node --test deploy/kubernetes/bounded-amazon/bootstrap.test.mjs scripts/amazon-run.test.mjs scripts/ci-docs.test.mjs`. Repeat the VM power cut using the candidate’s generated write and read.
- Update the D621 entry in [`docs/backlog.md`](../../backlog.md#platform-work-to-scope) with the local result and the open Stockholm restart and restore. Estimate one launcher line, 25–32 test lines including the stubs, and 3–5 backlog lines.

## Scope and launch

Keep the current marker location, restart and recovery conditions, and timing targets. Bootstrap and paid rehearsal are outside this pull request. Paid runs used are 3 of 10.

After the fix lands, run `node scripts/amazon-run.mjs measured-stops-dry-run` on the launch host from the exact revised, clean and installed `main` checkout selected for launch, with the same private config and pinned Waitron image. Save the Cloud commit and bundled image IDs with the dry-run receipt. [Launch guide](../../aws-infrastructure.md#rehearse-the-full-service-journey-from-outside-the-cell)

## Verification

The Lane G `d621-hard-stop.5eQusYzy` receipt keeps `probe-candidate.py` and `vm-candidate-gnu-revised-1s.log`. The repeat used the generated write from candidate `60b4c45d4` on loop-mounted ext4 with Debian 13 GNU `sync`. Power was cut one second after the write completed. On a fresh boot, the generated read found the marker and the earlier control seed was still present. The probe exited zero. The receipt also records a run that stopped at the GNU binary path check before the write.
