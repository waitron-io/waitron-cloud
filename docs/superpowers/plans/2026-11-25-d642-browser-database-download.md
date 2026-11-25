# D642 · Download the venue database in Backups

The owner asked for a “Full standard-format download of database, latest backup and its key” on 21 October. On 25 November they asked “would it decrypt via streaming as opposed to opening the whole file in memory?” and answered “yes” when told it would stream. In the disposable test Cloud, **Download database** should save an ordinary `venue.db` from the selected verified copy after you confirm sign-in. `node.dump` and box secrets stay in the encrypted backup. Keep both existing warnings about freshness and fiscal retention. Audit and production exit follow the existing plan. [Owner decision](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account) · [Test scope](2026-11-24-cloud-exit.md) · Lane J `queue.md`, D642.

## Probe and finish line

The Waitron demo yielded 143,804 encrypted bytes. A synthetic trading year yielded 3,305,828,352 compacted SQLite bytes and 1,001,932,236 gzip bytes. Cloud publication allows 512 MiB today. Verification has refused 269 MB and 368 MB examples. The separate 2 GiB encrypted and 4 GiB expanded trial still needs year-sized publication and verification. D642 qualifies its own exit ceiling above 16 MiB and within verified sizes. [Demo](2026-11-24-cloud-exit.md#first-usable-slice-on-test-cloud) · [Year](https://github.com/clintongormley/waitron/blob/5e8d24f2851cefcfb029944b14ed04cbabb70894/docs/backlog/setup.md) · [Cloud verification](../../backlog/data-lifecycle.md).

All three engines saved byte-matching SQLite from a 17,852,697-byte gzip archive and an older raw archive. A flipped tag left no file or download. The 1,997,912,969-byte archive saved the exact 3,307,339,776-byte SQLite file in regular desktop profiles. Sampled resident memory includes the harness and may count shared pages twice. Probe receipts are in Lane J `receipts/d642-browser-probe/`.

| Engine, direct response | Open / save | Baseline / peak resident memory |
|---|---:|---:|
| Chromium | 189.3 / 6.8 s | 1,044 / 2,342 MiB |
| Firefox | 349.3 / 8.3 s | 1,130 / 6,073 MiB |
| WebKit | 47.5 / 1.4 s | 456 / 4,818 MiB |

WebKit’s disk-first run with fixed-size reads reached 2,407 MiB in 53.3 seconds. Immediate file and URL removal broke saving in all three engines. A service worker scoped to one local save route saved the smaller fixture in all three and removed the private file when the response finished. A private WebKit profile refused disk storage.

**Follow-up probe.** Streaming memory and save lifetime still need qualification before product work. Compare 512 MiB and 1.86 GiB in all three engines against a proposed fixed 512 MiB increase in private process memory above idle. Use the scoped save response to check completion, abort, restart and account change. Ensure another tab cannot access or remove active scratch. Measure temporary disk and test quota refusal. Browser modes without a qualified save keep the existing encrypted fallback up to 16 MiB and show that limit.

## Build after qualification and watcher clearance

1. Reuse the archive, key and manifest owner POSTs for one selected verified point and the same-origin session and CSRF checks. Use an explicit exit ceiling in `packages/backups/src/catalogue.ts`. Claude proposes reading the immutable encrypted object directly for the browser path to avoid concurrent disk stages. That choice needs watcher clearance because #1410 checks bytes at the server before sending them. Preserve fresh proof, verification, object identity and key version around storage open and HTTP 410 on requests at day 90. If staging stays, prove concurrent disk bounds and align catalogue, storage, browser and proxy deadlines. Keep transfer deadlines separate from local opening time. Test authority, limits and disposal in `packages/account-http/test/backups.test.ts`.
2. Give a same-origin worker the page’s CSRF token. Fetch the manifest and key before the archive. Derive from the WBK1 header's salt, compare counted bytes with Content-Length and ciphertext SHA-256 with #1416’s manifest. Use a reviewed pin of Forge streaming AES-256-GCM with a fixed 128-bit tag and Noble scrypt as in the probe. Authenticate the whole frame before parsing raw or gzip WBA1, then save only `db.dump`. Bound both sizes. Serve the worker via `apps/portal/build.mjs` and `packages/account-http/src/portal.ts` with explicit same-origin worker and connection rules in every policy variant. Keep readable scratch away from portal pages that allow third-party scripts.
3. Wire `apps/portal/src/{api,app,backup-controller,backup-types,backup-screen,locale}.ts`; preserve the existing Blob path's own 16 MiB check. Cover the transport in `backup-transport-boundary.test.ts` and the real save in `backup-browser.test.ts`. Extend `scripts/test-cloud-exit-download.test.mjs` for a genuine verified point written by Waitron `44dc45af` or later. Keep the online-box check, update `docs/test-cloud.md` and `docs/backlog.md`, and show the owner both themes and languages at 390 and 1280 px.

Estimate 450–600 production and 250–360 test lines once the follow-up proves a route. Use test-first implementation and the lane’s security-sensitive review.
