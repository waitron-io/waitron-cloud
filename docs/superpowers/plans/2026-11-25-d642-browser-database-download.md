# D642 · Download the venue database in Backups

The owner’s 21 October ask was “Full standard-format download of database, latest backup and its key”. On 25 November they asked “would it decrypt via streaming as opposed to opening the whole file in memory?” and answered “yes” when told it would stream. In the existing disposable test Cloud, **Download database** saves `venue.db` from the selected verified snapshot after you confirm sign-in. Only your browser opens the copy. The box’s `node.dump` stays inside the encrypted download. Audit and production exit follow the existing exit plan. [Billing decision](../specs/2026-10-29-cloud-billing-design.md#8-cancelling-lapsing-and-closing-an-account) · [Synthetic test scope](2026-11-24-cloud-exit.md) · Lane J `queue.md`, D642.

## Browser probe and size

The Waitron demo yielded 143,804 encrypted bytes. A synthetic year with shipped print retention yielded 3,305,828,352 compacted SQLite bytes and 1,001,932,236 gzip bytes. Cloud currently admits 512 MiB. The shared trial targets 2 GiB encrypted and 4 GiB expanded. The year-sized HTTPS rehearsal needs the shared publication and verification path to qualify that size. [Demo](2026-11-24-cloud-exit.md#first-usable-slice-on-test-cloud) · [Year](https://github.com/clintongormley/waitron/blob/5e8d24f2851cefcfb029944b14ed04cbabb70894/docs/backlog/setup.md) · [Cloud limits](../../backlog.md).

The loopback probe used Waitron `5e8d24f2851cefcfb029944b14ed04cbabb70894`. Chromium, Firefox and WebKit saved exact-size, matching SHA-256 SQLite from 17,852,697-byte gzip and 2,105,530-byte raw archives. A flipped tag left no download or temporary file in any engine. Data below is for 1,997,912,969 encrypted bytes and 3,307,339,776 SQLite bytes. Resident memory sums the harness and browser processes and can double-count shared pages.

| Engine and method | Open / save | Baseline / peak RSS |
|---|---:|---:|
| WebKit, direct from network | 47.5 / 1.4 s | 456 / 4,818 MiB |
| Firefox, direct from network | 349.3 / 8.3 s | 1,130 / 6,073 MiB |
| Chromium, direct from network | 189.3 / 6.8 s | 1,044 / 2,342 MiB |
| WebKit, stage ciphertext to disk first | 117.6 / 1.7 s | 458 / 2,499 MiB |
| WebKit, disk first at 20 MiB/s | 141.0 / 1.3 s | 460 / 2,778 MiB |

WebKit’s private context refused browser disk storage. Immediate revocation and removal broke saving in all three engines. Before product work, qualify bounded memory for the large fixture and a save that keeps its disk file available while the browser reads it. Prove scratch cleanup on failure, cancellation and abandonment. The page has no browser download-complete event. Receipts are in Lane J `receipts/d642-browser-probe/`.

## Build and checks

1. Keep the existing same-origin archive, key and manifest POSTs tied to one snapshot. In `packages/backups/src/catalogue.ts` and `packages/account-http/src/backups.ts`, lift the 16 MiB exit limit to the qualified staged-object ceiling in `packages/backups/src/object-transfer.ts`. Preserve owner and fresh proof checks, current verification, exact day-90 HTTP 410, digest and key-version checks around staging, and cleanup on close. Measure stage and proof time before changing the current 10-second stage deadline and the 15-second HAProxy idle timeout. Scope a proxy change to the archive POST. `packages/account-http/test/backups.test.ts` covers authority, cutoff, above-16 MiB streaming and disposal.
2. `apps/portal/src/api.ts` streams the archive with the existing session and CSRF rules. Verify counted bytes and ciphertext SHA-256 against #1416’s manifest. Bound key and manifest responses. Keep the 16 MiB limit on the existing Blob save, checking declared size before reading and enforcing the limit during reads. `apps/portal/test/backup-transport-boundary.test.ts` owns these checks.
3. Bundle `apps/portal/src/backup-worker.ts` via `apps/portal/build.mjs` and serve it from `packages/account-http/src/portal.ts` with same-origin worker and connection rules. Keep the key in worker memory. Authenticate the full WBK1 scrypt/AES-256-GCM frame before parsing raw or gzipped WBA1. Bound encrypted and expanded bytes and publish only verified `db.dump` as disk-backed `venue.db`. Build before running `apps/portal/test/backup-browser.test.ts` for exact output, tag refusal, cleanup and the fallback to existing encrypted downloads when this browser mode cannot open the copy.
4. Reuse Backups selection and sign-in proof in `apps/portal/src/{app,backup-types,backup-controller,backup-screen,locale}.ts`. Cancel stale work on venue, account or route change. Keep both existing warnings and show opening, ready and failure in English and Spanish. Send the owner both themes and languages at 390 and 1280 px before landing. Extend `scripts/test-cloud-integration.mjs` and `scripts/test-cloud-exit-download.test.mjs` with a verified point from Waitron `44dc45af` or later, exact saved bytes, the existing encrypted-copy checks and the online box. Update `docs/test-cloud.md` and `docs/backlog.md` with what passed.

Run each new behavior check to its expected failure and back to green. Estimate 400–560 production lines and 250–360 test lines. Claude reviews the plan, the watcher clears the build, and the implementation gets the lane’s security-sensitive review.
