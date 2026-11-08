# Status incident history implementation plan

**D612, Lane G.** Generate a local bilingual status bundle with the current post and dated resolved incidents. The [runbook requires visible history](../../incident-response.md#restore-verify-and-close); [monitoring item 2](../../backlog.md#launch-platform-work-in-priority-order) tracks it. Follow the [approved public-text rules](../specs/2026-10-24-cloud-monitoring-alerting-status-design.md#9-the-public-status-page).

**Authority:** watcher assignment, Lane G `queue.md` and `questions.md`, 2026-11-08 14:21: “D612 is at the top of your queue. Plan first as it says.” The item delegates input format and history length. This plan still needs watcher approval after Claude’s read. Execute inline; campaign authority covers finishing and landing. No build before approval.

## Files and size

Only these paths may change:

- `docs/superpowers/plans/2026-11-08-status-incident-history.md` (this plan).
- `packages/operations/src/status-page.ts` (validation and rendering).
- `packages/operations/test/status-page.test.ts` (public behavior).
- `packages/operations/test/status-page-cli.test.ts` (actual bundles and refusals).
- `scripts/ci-package-readers.mjs` (only that CLI test’s reviewed blob identifier).
- `docs/incident-setup.md` (input example, date meanings and failure handling).
- `docs/backlog.md` (monitoring item 2 only).

Estimate: 60–100 production lines, 180–250 test lines, 40–70 documentation lines including this plan, and one declaration line; about 350–450 total, at most 600. No dependencies. The CLI forwards parsed JSON unchanged (`status-page-cli.ts:9`); leave it alone.

## Input and display

Keep the renderer signature and output paths. Add optional `history` to either existing input shape. Missing history or `[]` preserves exact output, including CSS. Otherwise require an array of objects with exactly `{service,impact,startedAt,resolvedAt}`. Reuse fixed service/impact vocabulary and the fixed redacted error; reject wrong types, unknown/missing fields and arbitrary/private text. Dates must be real calendar timestamps exactly `YYYY-MM-DDTHH:mm:ssZ`, with start no later than resolution. Do not compare history with the current post’s timestamp: a resolved post’s `updatedAt` names its own recovery, not publication time.

Driver default: show every supplied incident, newest resolution first; equal resolution times retain input order. Preserve duplicates and input bytes; no cap, pagination, inferred entries or deletion. `startedAt` means the earliest confirmed start of impact, never detection or an estimate; `resolvedAt` means actual confirmed recovery. The operator can trim the input.

After the current article append an `<h2>` and `<ol>` headed “Past incidents” / “Incidencias anteriores”. Entries show fixed service, existing resolved-impact sentence, “Started” / “Inicio” and “Resolved at” / “Resuelto el”, with dated UTC `<time>` elements. Keep unknown impact; promise no next update. Emit any history CSS only with history. No publisher/accounts/uploads, external calls, verified-health wording, incident IDs or database changes.

## Build and verify

- [ ] Add renderer and CLI tests first; observe expected history failures. Check legacy/empty byte equality, each current state unchanged after removing the history section, literal bilingual entry contents, unsorted records and stable ties, duplicates, no inferred entry, privacy/shape/date rejection, midnight/leap dates, equal start/recovery, and history later than a resolved current post.
- [ ] Implement minimally; rerun to green. CLI tests inspect both files, invalid-input refusal without leaks/output, and existing destinations/symlinks. Retain all existing assertions. Review the changed CLI reader and renew its exact hash manually following [reader instructions](../../ci-package-readers.md#review-and-renew-a-declaration); repeat after any rebase.
- [ ] Run explicit focused tests and inspect counts:

```sh
node --test packages/operations/test/status-page.test.ts packages/operations/test/status-page-cli.test.ts
node --test scripts/ci-installed-reader.test.mjs scripts/ci-package-reader-boundaries.test.mjs scripts/ci-package-revisions.test.mjs scripts/ci-scope.test.mjs
pnpm typecheck
```

- [ ] Update setup/backlog for this slice. Invalid input keeps the existing bundle untouched: correct history locally and regenerate. Inspect eight standalone views, English/Spanish × dark/light × 390/1280, with long labels and multiple dated records; empty history uses byte-equality tests. Keep experiments/screenshots outside the repository; no mutation tests. Complete Claude’s execution review and read every current-head CI job before landing. CI owns full suites.

**Finish line:** a usable local bilingual bundle shows the unchanged current post and supplied dated incident history. Publication and launch work remain open.
