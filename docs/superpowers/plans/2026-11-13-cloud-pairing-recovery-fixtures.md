# PLAN FOR APPROVAL

**Blocked:** recovery fixtures within [the original pairing-v2 scope](2026-11-09-cloud-pairing-v2.md). D636’s diagnostic landed as PR1203; the sole cleared pairing target-cap experiment then failed.

Lane G questions.md, 2026-11-13 19:45, watcher verbatim:

> After D636 lands, run only the experiment cleared at 12:27 (the recovery target's cap at 2,240 MiB). If that run passes, carry on to the pull request inside the plan. If it fails, stop building: mark the item blocked and write a half-page replan under PLAN FOR APPROVAL (what failed in each of the five fixture runs, the one change that would fix it, and its size). No further experiments without that plan being cleared. It has been open since 12 Nov 18:21 with no pull request.

Five runs, per supplied Lane G questions/receipts:

- 11:42: matching certificate verified snapshot; recovery-build refused retired REBUILD_MARKER import.
- 12:06: first-start/restore-flow port built; integration.command_failed:recovery-restore-refusal, exact child check not yet retained.
- 12:14: the repeated proof failed fixture.assert.refused_phase: expected staged, observed placing.
- 12:22: cleared placing assertion passed; target1024MiB restore child SIGKILL, cause unproved.
- 20:56: target2240MiB restored and passed earlier guards; authorised fixture:132 failed because readCopyNodeAndVenue is undefined. One test: 0 pass/1 fail, no skips/cancellations, 246.79s. Target peak 1586.82MiB; no OOM/max event. These measurements establish no whole-box/production budget.

**One correction:** port only post-restore identity readback in `deploy/test-cloud/test-fixtures/integration-authorised-recovery.test.ts:130` and `integration-continuous-recovery.test.ts:141`. At pin `5e67b8eb8efc3ea7c868c7d129547d291c64e037`, exported `restore.ts:929 readCopyNode` returns `{node: ProvisionedNode}`; `packages/module/src/provisioning.ts:8` gives `node.nodeId`. Retain the first validated copy’s `secretEntries`, as continuous already does: pinned `validateEntries.discard` only removes its scratch directory and `validateDatabaseEntries.discard` is a no-op (`restore.ts:278–308`, source read only). Avoid decrypting again. Inside `currentRecovery` only, dynamically obtain/check `readCopyNode`, read the restored read-only query and close it in `finally`; then separately `openVenueDatabase(venueDir)` → `readCloudVenueId(handle.venue)` → close in `finally`, following native `restore-fiscal-e2e.test.ts:366`. Exact source-node/stream-id equalities and historical branches stay. Post-restore compatibility of the node reader is unverified: any refusal stops the work. No helper/API, SQL or schema parser.

**After Claude review and watcher clearance:** the observed 20:56 failure supplies the red test. Retain every authority, record-equality, integrity, refusal, no-first-start/server/credentials/restored-Cloud-report check; compare exact identities to independently supplied inputs, with no added paid control runs. Run `scripts/test-cloud-paid-authorised-recovery.test.mjs` first, recording peak/events and child/case elapsed time against existing 2240 MiB/90 s/300 s limits; only after a pass run `test-cloud-paid-stream.test.mjs` and `test-cloud-paid-continuous-recovery.test.mjs`. Stop on any new reason; no cap/deadline changes.

**Size:** fixture additions 14–22/removals 10–14; production 0; new support 0. Separately retain the already-cleared uncommitted harness cap at `scripts/test-cloud-integration.mjs:517` (+1/−1). Documentation: this plan about 25 lines, backlog 2–4 later. Published/merged H5g pin, main reconciliation and final CI still remain; recheck exports at the final pin. No build/experiments while pending; no owner design approval claimed.
