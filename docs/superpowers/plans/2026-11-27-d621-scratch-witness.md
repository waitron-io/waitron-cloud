# D621 verifier scratch disk after a full restart

Move the Stockholm restart marker to the root of its scratch disk so the backup verifier can start and clear its work directory without erasing the marker. The free Linux probe used the real verifier controller. It refused startup with the marker in its work directory and removed the marker during cleanup. The same operations succeeded and left the marker readable at the root of the same ext4 disk. [D621 backlog](../../backlog.md#platform-work-to-scope) · [Full restart plan](2026-11-20-d621-stockholm-all-machine-restart.md)

- In `scripts/amazon-run.test.mjs`, extend the `baseline cold` rehearsal to check the scratch marker's write and read path is `/var/local/d621-verifier/mount`. Run the launcher test file first and see it fail on the old work path. Keep the existing checks for all three instance IDs, the restart order and the read after mount verification.
- In `scripts/amazon-run.mjs`, pass the ext4 root to the existing `cold-scratch-witness` command. Remove the unused import. Reuse the current boot and mount checks, write failure handling and restart sequence. The bootstrap, write flush behavior, timing and database probes stay outside this repair.
- Run `node --test deploy/kubernetes/bounded-amazon/bootstrap.test.mjs scripts/amazon-run.test.mjs`. Repeat the free Linux probe using the revised launcher command and the real verifier controller. Check that the controller starts with empty work, cleans up its owned child and leaves the marker readable. The full hard stop and restore in Stockholm remain open.
- Update `docs/backlog.md` with the verified local result and the open Stockholm restart and restore. Record that the PostgreSQL process restarted inside the same pod on the surviving machine, and that the saved kubelet events lack the affected object and probe detail needed to identify the trigger.

Expected size is two implementation lines changed and about three to five test lines, plus the backlog update. Paid launch is outside this pull request.

## Verification

- The retained 26 November launcher log records three single-machine stop confirmations, hold and rejoin measurements, and 1,098 `d618-cold-restart: No such file` messages (`aws-stderr.private.log:5393` onward). The third-stop writer samples (`:3964–3972`) report the same pod identity, a restart count rising from zero to one and a new PostgreSQL start time. The kubelet records at `:5084` contain only time, reason and component.
- The `test-box-run.sh G … node --input-type=module -e …` probe ran the launcher’s marker shell on a 64 MiB ext4 mount with the real verifier controller. It exited zero and reported `{"placement":"ext4-root","markerSurvived":true,"workEntriesAfterCleanup":[]}` after verifier startup and owned-child cleanup. Hard-stop durability and restore still need Stockholm evidence.
