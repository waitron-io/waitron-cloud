# Stream whole-year Cloud backups

A venue can send, retain, verify and recover a whole-year backup through the local test Cloud without either side holding the archive in memory. The owner chose whole-file streaming at 23:16 on 17 November. Lanes G and J agreed the trial limits at 23:29–23:30. Claude reviews this plan and the watcher clears it before build.

## Transfer and retain the archive

Raise the inclusive ciphertext ceiling from 512 MiB to **2 GiB (2,147,483,648 bytes)**, about twice Lane M's 1,001,932,236-byte gzip from a 3,305,828,352-byte compact SQLite database. Lane J owns gzip inside WBK1, raw WBA1 recovery, the 4 GiB expanded WBA1 limit, and the box and verifier bundle changes. Object transfers keep their existing 14-minute limit and stop at least five seconds before scoped grant expiry. At the measured year size, that takes about 9.55 Mbit/s before overhead.

Share the cap across `object-transfer.ts`, `storage.ts`, `catalogue.ts`, the `verification-protocol.ts` archive fields and the bound child input. Reuse file-backed `BackupObjects.stage/putStaged`, exact ciphertext length and SHA-256, immutable keys and conditional writes. Keep the small buffered readers bounded. Trial a 50-second box and test proxy timeout for signed publish only (`deploy/test-cloud/proxy.cfg`) and one 45-second Cloud budget for read, compare, write and retries. Retain the final check of authority, generation and the existing 60-second signature age. Recovery keeps the exact v2 verifier binding, current owner authorisation and scoped read grant.

## Verify within measured disk and time limits

Extend only the verification lease to six minutes and the signed attempt deadline to five in `worker.ts` and `verification-admission.ts`. Thread the deadline through the bound launcher, container entry and child. Pin `verification-target.ts` and the image to J's landed runtime. Keep the 1 GiB memory cap, read-only root and isolated child. Give `deploy/test-cloud/backup-verifier-runtime.mjs` and its existing controller one 16 GiB fixed-size encrypted scratch filesystem per attempt on the approved local host. Mount only that filesystem at `/scratch` and check its quota and the exact mount before input. Reuse the controller's ownership checks and require child removal, scratch removal and key disposal before accepting success. Clean up on cancellation and restart. Bound the outside-child ciphertext stage separately.

## Qualify locally

Start with failing tests. The existing `object-transfer`, `storage` and `verification-protocol` tests own exact lengths, cap and cap-plus-one, retry and cancellation. PostgreSQL `venue-service-storage`, `verification-admission` and `worker-admission` tests own replay, live authority and stale claims. The `bound-container-verifier` and `verifier-controller` tests own deadline, isolation, full scratch and exact cleanup.

Reuse the test Cloud integration and storage fixtures. Publish a near-cap object over the real signed TLS route. Run a genuine synthetic ~1 GB ciphertext / 3.3 GB database through capture, retention, verification, owner approval and streamed recovery. Record exact bytes and digest, timing, peak memory and disk through placement, and confirmed cleanup. Use these measurements to justify the trial limits. Estimate 450–500 code lines and 330–430 test lines. [Existing verifier design](../specs/2026-10-18-backup-verification-without-fiscal-authority.md#L164-L172)

First-year retained object storage is estimated at **$4.09 per venue** using the pinned 14 October Spain rate of $0.023 per billed GiB-month, linear growth to M6, 30-day daily retention and a separate first-of-month copy kept for 12 months. Requests, downloads and temporary storage are outside that estimate. Update the integration and local guides and the data lifecycle backlog. Park incremental copies, piece storage and archive databases. Keep this local, with no schema, wire format or fiscal change. [Cost model](../../cloud-cost-model.md) · [Backlog](../../backlog/data-lifecycle.md)
