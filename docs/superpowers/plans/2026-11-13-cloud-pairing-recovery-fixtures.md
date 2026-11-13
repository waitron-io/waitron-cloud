# PLAN FOR APPROVAL

**Blocked:** recovery fixtures within [the original pairing-v2 scope](2026-11-09-cloud-pairing-v2.md). D636’s diagnostic landed as PR1203; the sole cleared pairing target-cap experiment then failed.

Lane G questions.md, 2026-11-13 19:45, watcher verbatim:

> After D636 lands, run only the experiment cleared at 12:27 (the recovery target's cap at 2,240 MiB). If that run passes, carry on to the pull request inside the plan. If it fails, stop building: mark the item blocked and write a half-page replan under PLAN FOR APPROVAL (what failed in each of the five fixture runs, the one change that would fix it, and its size). No further experiments without that plan being cleared. It has been open since 12 Nov 18:21 with no pull request.

Five runs, per supplied Lane G questions/receipts:

- 11:42: matching certificate verified snapshot; recovery-build refused retired REBUILD_MARKER import.
- 12:06: first-start/restore-flow port built; recovery-refusal failed.
- 12:14: diagnostics exposed expected staged versus actual placing.
- 12:22: cleared placing assertion passed; target1024MiB restore child SIGKILL, cause unproved.
- 20:56: target2240MiB restored and passed earlier guards; authorised fixture:132 failed because readCopyNodeAndVenue is undefined. One test: 0 pass/1 fail, no skips/cancellations, 246.79s. Target peak 1586.82MiB; no OOM/max event. These measurements establish no whole-box/production budget.

**One correction:** port only post-restore identity readback in deploy/test-cloud/test-fixtures/integration-authorised-recovery.test.ts:130–140 and integration-continuous-recovery.test.ts:141–149. At pin 5e67b8eb8efc3ea7c868c7d129547d291c64e037, use restore.ts:929 readCopyNode with restored BackupQuery and archive secretEntries; separately openVenueDatabase(venueDir), readCloudVenueId(handle.venue), then close. Follow native restore-fiscal-e2e.test.ts:366–383. Preserve exact source-node/stream-id equalities and explicit historical branch. Never pass BackupQuery to readCloudVenueId; add no helper/API, SQL or schema parser.

**After driver-arranged Claude review and watcher clearance:** use TDD; retain authority, record-equality, integrity, refusal, no-first-start/server/credentials/restored-Cloud-report assertions. Current-source negative controls must reject independently wrong source node and Cloud venue; no permanent self-mutation test. Run scripts/test-cloud-paid-authorised-recovery.test.mjs first; only after passing with room run test-cloud-paid-stream.test.mjs and test-cloud-paid-continuous-recovery.test.mjs. Stop on any new reason; no cap/deadline changes.

Estimate changed lines: fixtures 40–70; test support 0; production 0; docs 40–60. Later confirm the current published/merged H5g pin, reconcile main, update backlog and complete PR/CI. No product build/experiments while pending; no owner design approval claimed.
