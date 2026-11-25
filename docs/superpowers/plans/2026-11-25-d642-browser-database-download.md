# D642 · Download the venue database in Backups

On 21 October the owner asked for a “Full standard-format download of database, latest backup and its key”. On 25 November they asked “would it decrypt via streaming as opposed to opening the whole file in memory?” and answered “yes” when told it would stream. Claude read the earlier plan and its fixes. The watcher cleared two parts at 17:50 in Lane J’s questions. [Owner decision](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account) · [Test scope](2026-11-24-cloud-exit.md)

## Part 1 · Save SQLite from a verified test backup up to 16 MiB

After you confirm sign-in, **Download database** saves `waitron-backup-<point ID>.venue.db` from the selected verified copy. The venue database can contain staff and customer records. Box state and secrets stay in the encrypted archive. Keep the encrypted backup, key, manifest and warnings about freshness and fiscal retention.

- Reuse the three owner POSTs, including the test-venue, proof and 90-day cutoff checks. Keep server staging and its pre-send checks. A browser worker checks Content-Length, the manifest SHA-256 and WBK1’s 128-bit authentication tag before extracting `db.dump` from raw or gzip WBA1. Freeze WBK1’s scrypt settings at N=131072, r=8, p=1 and 32 derived bytes. Pin Forge and Noble in `apps/portal/package.json` and the lockfile. Stage only ciphertext while checking the digest and tag. Feed gzip in 4 KiB blocks on the second pass and save only `db.dump`, up to 512 MiB expanded. The key stays in worker memory.
- Save through a plain file link. Delete the encrypted stage once extraction ends. Keep the extracted file for up to ten minutes after saving and remove it sooner on the next database save, sign-out, account change or portal start. Spare an active download in another tab. On failure or cancellation, delete temporary files. On failure, say the backup could not be opened. Use a strict same-origin worker response policy. Production needs a boundary for readable browser storage because pages on one origin share it.
- Wire `apps/portal/src/{api,app,backup-controller,backup-types,backup-screen,locale}.ts`, the new worker, `apps/portal/build.mjs` and `packages/account-http/src/portal.ts`. Worker tests own truncation, digest or tag refusal, expansion, quota and abort. `backup-browser.test.ts` owns the save and account change. `portal-memory.test.ts` and its `fixtures/portal-memory.ts` cover asset delivery and policy. Extend `scripts/test-cloud-exit-download.test.mjs` with a genuine verified point from Waitron `44dc45af` or later. Keep the online-box check, update the test Cloud guide and backlog, and show both languages and themes at 390 and 1280 px.

Estimate 310–390 production and 150–210 test lines, plus the lockfile and guides.

## Part 2 · Save SQLite and the encrypted backup up to 512 MiB

Start after browser memory stops growing between the two probe sizes. Set a literal 512 MiB exit ceiling in `packages/backups/src/catalogue.ts`. Keep pre-send checks, allow one staged exit archive at a time until disposal and qualify stage disk. Adjust the 10-second server, 15-second proxy and 30-second browser deadlines separately from local opening time. Update `deploy/test-cloud/proxy.cfg` and the bounded stage configuration as needed. [Stage](../../../packages/backups/src/catalogue.ts) · [Proxy](../../../deploy/test-cloud/proxy.cfg)

Stream the larger encrypted save too. Any remaining Blob path checks Content-Length before buffering and returns `download_too_large` on oversize. `backups.test.ts` owns authority, limit and disposal. Portal transport and browser tests own early refusal and both saves. Rehearse with a verified copy over 16 MiB through test HTTPS. Estimate 140–210 production and 100–150 test lines, plus guides. Year-sized publication, download audit and production exit remain open. [Year-sized work](../../backlog/data-lifecycle.md#open) · [Exit work](2026-11-24-cloud-exit.md#later-retention-and-deletion)

## Loopback probe

The demo archive was 143,804 bytes. The trading-year example was 3.31 GB of SQLite and about 1 GB compressed. Chromium 153, Firefox 155 and Playwright WebKit 26.6 each saved byte-matching SQLite with delayed cleanup, cleared abandoned files on restart, and cleared staged files on simulated sign-out and account change. All three saved 3.31 GB from an 8.56 MB encrypted archive. Earlier runs rejected a changed tag and showed why immediate removal breaks saves. In the compressed case, 4 KiB extraction inputs reduced sampled extra memory from 718 to 124 MiB in Firefox and from 1,483 to 98 MiB in WebKit. [Demo](2026-11-24-cloud-exit.md#first-usable-slice-on-test-cloud) · [Year](https://github.com/clintongormley/waitron/blob/5e8d24f2851cefcfb029944b14ed04cbabb70894/docs/backlog/setup.md)

The larger path remains gated. These are sampled browser-only peaks above idle, in MiB, for transfer to disk, decryption and extraction. All six runs saved matching files. Lane J’s D642 follow-up receipts retain the commands and browser logs.

| Engine | 512 MiB archive | 1.86 GiB archive | Open time, small / large |
| --- | ---: | ---: | ---: |
| Chromium | 61 / 0 / 109 | 128 / 0 / 261 | 75 / 121 s |
| Firefox | 1,025 / 783 / 836 | 3,780 / 2,672 / 2,529 | 42 / 232 s |
| Playwright WebKit | 538 / 924 / 585 | 826 / 985 / 406 | 13 / 50 s |

Pacing Firefox’s 512 MiB transfer at 20 MiB/s still peaked at 892 MiB above idle during transfer. Qualify that stage before raising the limit.
