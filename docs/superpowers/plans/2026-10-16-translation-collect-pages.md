# Translate all: bounded collect prerequisite

**Status:** documentation prerequisite for the owner-approved Translate all design and plan.
The owner approved the US$5 per-venue calendar-month (UTC) safety cap, submit admission of
4 in flight and 1 per address, and bounded collect before go-live. Runtime implementation,
cross-repository qualification and owner quality trials remain open.
The page limit preserves the existing accepted inputs, including language tags.

**Authority:** the [wire contract](../../waitron-integration-contract.md#translate-all-version-1)
owns request and response behavior. This amendment supplies the design rationale and replacement
implementation steps for the [original 24-task plan](2026-10-14-translate-all.md), especially
Tasks 3, 8, 10, 11 and 18. It supersedes their conflicting single-collect interfaces, snippets and
assertions, including helpers that collect once before release. Preserve their other behavioral
assertions and original task numbers. The [approved spec](../specs/2026-10-14-translate-all-design.md)
points to the same contract.

## Collect without losing the end of a job

A legal job can produce more than 16 MiB of suggestions. A one-reply caller can lose the remainder
if it accepts a first page and releases the job. Bound the complete decoded compact JSON response
to 16,777,216 UTF-8 bytes and make durable completion of the page walk a release prerequisite.

Status and release retain their exact signed `version` and `jobId` body. Collect alone adds an
optional safe-integer cursor, default 0. Authenticate, perform the installation-scoped job lookup,
then validate `0 <= cursor < total`, then apply collect's existing state rules. Invalid cursor
values on an owned job are 400 `invalid_request`; unknown/foreign jobs remain 404. Positive
cursors may select any offset, without a previous page or an opaque token.

Use the submitted item order after filtering out `missing: []`. Resolve each ref to exactly one
terminal result or failure. Do not use batch or completion order. Return the largest nonempty
consecutive segment that fits after serializing the entire response with its actual UUID and
`nextCursor`. The exact six fields are `version`, `jobId`, `state`, `results`, `failed`,
`nextCursor`; the next cursor is the following offset, or null at the end. Items remain atomic,
with names and corrections unchanged. Context stays absent. Retried cursors produce identical
semantic pages while retained, and collect neither deletes nor extends retention.

Store each validated page and its continuation through Waitron's existing durable suggestion
reconciliation. Deduplicate refs per job and recover a crash by replaying the last uncommitted
page. Never concatenate response strings or retain unbounded response buffers. Release only after
the null-cursor page and all `total` unique refs are durably accounted for. Keep the existing
release state rules, including release of a `failed` job without collect. A valid collect after
release or expiry is 410; an interrupted walk remains partial, never a full job.

## Single-item size proof

Choose 16 MiB so every legal item can fit without changing the accepted inputs. The original
Task 4 regex has no total language-tag length limit. A 4 MiB page cannot be proved to hold an
item when its ten corrections repeat a long enabled tag. Do not add a new tag restriction.

The existing 1,048,576-byte submit bound includes the enabled language tags. Their combined
ASCII lengths, and therefore the sum of keys in one result's `names`, cannot exceed that bound.
Each of at most ten `correction.field` values is either one of those tags or `internal`.
Allow a full 1 MiB for each field, even though this overestimates any accepted job. All other
variable text has explicit UTF-16 length bounds; JSON needs at most six bytes per code unit.

| Contribution | Conservative maximum bytes |
| --- | ---: |
| All language keys in `names` | 1,048,576 |
| Ten correction fields, each allowed a full job's byte budget | 10,485,760 |
| Twenty 500-unit names, twenty 500-unit correction texts and a 128-unit ref, at six bytes per unit | 120,768 |
| Fixed fields, quotes, punctuation, booleans, arrays, UUID, state and actual cursor | 65,536 |
| **Complete singleton page** | **11,720,640** |

The fixed fields have bounded counts: six envelope fields, four result fields, twenty names,
ten three-field corrections, a 36-character UUID and at most four cursor digits (or `null`).
Their syntax is below the generous 65,536-byte allowance. A failed-ref singleton is smaller.
Thus every legal singleton fits below 16,777,216 bytes without truncating data. This is a
conservative serialization calculation; production sizing still needs behavioral tests.

## Implement inline with failing behavioral tests first

These are future implementation steps. This milestone edits documentation only and runs none of
the commands below. Read the TDD skill before writing code, observe each added test fail for its
intended reason, implement the minimum change, then run it green. Keep routine implementation
inline; there is no automatic implementer/reviewer agent per task.

| Original task | Exact Cloud files to create or modify | Required replacement and proof |
| --- | --- | --- |
| 3 | `packages/translation/src/job-store.ts`, `src/index.ts`, new `src/collect-page.ts`, `test/job-store.test.ts`, new `test/collect-page.test.ts` | Pass cursor to collect; read the retained submit body and terminal batch entries under the job lock. Build the filtered submit-order list and detect missing/duplicate outcomes as invariant failures, without silently dropping data. Page using the complete serialization, including actual UUID and continuation. Preserve submit/cap/status/release assertions. |
| 8 | `packages/translation/src/worker.ts`, `test/worker.test.ts` | Keep saved batch outcomes and lease/retry/cap/usage behavior. Reverse completion order and family/category batch order relative to submit order; a full paged walk must still match the filtered original refs exactly, with each outcome once. Update collect helpers without losing existing assertions. |
| 10 | `packages/translation/src/machine.ts`, `test/machine.test.ts`, `test/fixtures.ts` | Split collect body parsing from status/release. Keep exact allowed fields; carry cursor through owner lookup before validity/range checks. Keep proof, lease, revocation and submit-check ordering. |
| 11 | `packages/account-http/src/translation.ts`, `test/translation.test.ts`, new `test/translation-collect-pages.test.ts` | Emit the same compact body that was measured; prove decoded full-body byte limits through a real listener as well as route calls. Preserve security headers, refusals, feature-off behavior and request limits. |
| 18 | `packages/translation/src/retention.ts`, `test/retention.test.ts`, `test/no-names-in-logs.test.ts`, `packages/account-http/test/translation-sweep.test.ts` | Keep deletion/expiry schedule and no-name diagnostics; test release and sweep between pages, concurrent collect/release locking and repeated collects retaining the body. Update log-test collection to walk all pages before release. |

All abbreviated `src/` and `test/` paths in the table belong to the package named in that row.
Export the page limit and page shape from `packages/translation/src/index.ts`; the HTTP layer must
not reformat or add fields after sizing. No new database table or migration is required by paging:
the plan already retains the submitted body and terminal batches until release/expiry.
Replace the Task 3 collect fixture's synthetic `{}` body with a valid submitted job that names
its stored outcome refs; preserve its installation, state, result and deletion assertions.

- [ ] Test a singleton against the conservative maximum above, ordinary Unicode, astral pairs, quotes,
  backslashes, control characters and lone surrogates. Count UTF-8 bytes, not string length.
  Include all 20 names, all ten corrections, the full UUID and the actual continuation field.
- [ ] Construct a legal submit at or below 1 MiB whose legal outputs exceed 16 MiB. Verify every
  emitted page stays within the limit and adding the next atomic outcome exceeds it. Exercise an
  exact-limit body and a candidate one byte over; include the last page's null-cursor size.
- [ ] Walk mixed successes, placeholders, failures and context across several pages. Check ref
  order against submitted filtered items, no omission/duplication, unchanged text/corrections,
  arbitrary in-range positive offsets, omitted versus explicit 0, and repeat-page equality.
- [ ] Refuse negative, fractional, unsafe, string, null, boolean, `cursor == total` and larger
  cursors with 400 on owned jobs. Unknown/foreign job plus those cursors stays 404. Status/release
  with a cursor stays 400; unchanged exact bodies and state refusals still pass.
- [ ] Prove the checks detect deliberate breakages: character counting; omitting envelope or
  `nextCursor` bytes; using worker/batch order; silently removing a correction; deleting on
  collect; releasing after page one. Keep existing behavioral assertions during refactoring.

Focused commands follow the original plan's database wrapper and each test's existing deadline;
for example, after the package and tests exist:

```sh
pnpm --dir packages/translation exec node --test test/collect-page.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-concurrency=2 --test-timeout=30000 test/job-store.test.ts test/machine.test.ts test/worker.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-concurrency=2 --test-timeout=30000 test/translation.test.ts test/translation-collect-pages.test.ts
```

## Joint qualification and release gates

- [ ] **Waitron lane B A689-21:** implement a real signed-cursor pagination loop, decoded
  16 MiB-per-page reader, response validation and durable reconciliation. At Waitron commit
  `8eb93dbf3a0583f479d96b5bf0bc214d974ba080`, `apps/server/src/cloud-translation.ts`,
  `collectTranslation`, makes one request and ignores `nextCursor`. Trace and record the exact
  signer, collector, reader, reconciliation, release and test paths in that lane before editing.
  A byte-reader-only change can silently release unseen pages and cannot qualify the client.
- [ ] **Pinned joint proof before go-live:** real Cloud HTTP/PostgreSQL plus the real Waitron
  caller must walk a greater-than-16-MiB result, store all refs exactly once, and release only after
  durable final completion. Exercise lost page replies, crash before/after page persistence and
  cursor advancement, restart/ref deduplication, lost release reply, arbitrary offsets and
  release/expiry between pages. Assert no full-job success or release from a partial walk.
- [ ] **Reader controls:** refuse oversized decoded bodies both with misleading/missing
  `Content-Length` and with compressed transport, cancel the read, and keep only bounded page
  buffers. Prove failure when the loop is removed or early release restored. Preserve Waitron's
  stale-result, current-authority and human-save rules; suggestions never directly publish names.
- [ ] **Existing release gates stay open:** pricing/billing and replacement monthly allowance
  before the first live venue; consent wording/provider processing and retention decisions;
  production key custody/deployment; quality non-regression and house-style/other-kind trials.
  Tasks 22–24 are owner-only **after 2026-11-02**. Their commands remain in the original plan and
  must not run during this milestone or autonomous implementation.

## Current migrations and push policy

On 2026-10-16, `ls packages/registration/migrations` ends at
`038_fiscal_allocation_registry.sql`; `packages/registration/src/migrate.ts` registers the same
last migration. Thus 039/040 are currently unused here, but they are not reserved for translation.
Before implementing Tasks 2 and 17, re-read both inventories and append the then-current next two
numbers, updating filename/count/index assertions and upgrade fixtures together. Never edit or
renumber a landed migration. The original plan's 039/040 snippets are conditional examples; this
documentation milestone creates no migration.

During implementation, run focused behavioral checks. **Before every push**, run the complete
suites of every touched package and all packages that depend on them, including source/test/fixture
readers outside manifest dependencies. Whole-workspace suites are required only for shared
configuration changes. Limit local database-test concurrency when machine headroom requires it, preserving every file,
deadline and build step. Current-head CI and normal hooks remain required; CI does not replace
the local pre-push suites.
