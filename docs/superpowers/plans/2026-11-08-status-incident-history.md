# Status incident history implementation plan

**D612, Lane G.** Generate a local bilingual status bundle with the current post and dated resolved incidents. The [runbook requires visible history](../../incident-response.md#restore-verify-and-close); [monitoring item 2](../../backlog.md#launch-platform-work-in-priority-order) tracks it. Follow the [approved public-text rules](../specs/2026-10-24-cloud-monitoring-alerting-status-design.md#9-the-public-status-page).

**Authority:** watcher assignment, Lane G `queue.md` and `questions.md`, 2026-11-08 14:21: “D612 is at the top of your queue. Plan first as it says.” The item delegates input format and history length. Watcher approved this plan at 15:06 with the three cuts below and explicitly no further Claude read. Build after D613’s pull request is open. Execute inline; campaign authority covers finishing and landing.

## Files and size

Only these paths may change:

- `docs/superpowers/plans/2026-11-08-status-incident-history.md` (this plan).
- `packages/operations/src/status-page.ts` (validation and rendering).
- `packages/operations/test/status-page.test.ts` (public behavior).
- `docs/incident-setup.md` (input example, date meanings and failure handling).
- `docs/backlog.md` (monitoring item 2 only).

Estimate: 20–40 production lines and 60–100 test lines; the 40–70 documentation-line estimate including this plan is unchanged. About 120–210 changed lines total; ask before exceeding 315 lines (1.5 times the upper estimate). No dependencies. The CLI forwards parsed JSON unchanged (`status-page-cli.ts:9`); leave it alone.

## Input and display

Keep the renderer signature and output paths. Add optional `history` to either existing input shape. Missing history or `[]` preserves exact output, including CSS. Otherwise require an array of objects with exactly `{service,impact,startedAt,resolvedAt}`. Reuse fixed service/impact vocabulary and the fixed redacted error; reject wrong types, unknown/missing fields and arbitrary/private text. Reuse the existing calendar timestamp check at `status-page.ts:39–41`; require start no later than resolution. Do not compare history with the current post’s timestamp: a resolved post’s `updatedAt` names its own recovery, not publication time.

Driver default: show every supplied incident, newest resolution first; equal resolution times retain input order. No cap, pagination or deletion. `startedAt` means the earliest confirmed start of impact, never detection or an estimate; `resolvedAt` means actual confirmed recovery. The operator can trim the input.

After the current article append an `<h2>` and `<ol>` headed “Past incidents” / “Incidencias anteriores”. Entries show fixed service, existing resolved-impact sentence, “Started” / “Inicio” and “Resolved at” / “Resuelto el”, with dated UTC `<time>` elements. Keep unknown impact; promise no next update. Emit any history CSS only with history. No publisher/accounts/uploads, external calls, verified-health wording, incident IDs or database changes.

## Build and verify

- [ ] Add renderer tests first; observe expected history failures. Check legacy/empty byte equality, each current state unchanged after removing the history section, literal bilingual entry contents, unsorted records, privacy/shape/date rejection, midnight/leap dates, equal start/recovery, and history later than a resolved current post.
- [ ] Implement minimally; rerun to green. The command-line program passes parsed input straight through; renderer tests own the behavior checks. Retain all existing assertions.
- [ ] Run explicit focused tests and inspect counts:

```sh
node --test packages/operations/test/status-page.test.ts
pnpm typecheck
```

- [ ] Update setup/backlog for this slice. Invalid input keeps the existing bundle untouched: correct history locally and regenerate. Generate the actual bundle with the existing command, then inspect eight standalone views, English/Spanish × dark/light × 390/1280, with long labels and multiple dated records; empty history uses byte-equality tests. Keep experiments/screenshots outside the repository; no mutation tests. Complete Claude’s execution review and read every current-head CI job before landing. CI owns full suites.

**Finish line:** a usable local bilingual bundle shows the unchanged current post and supplied dated incident history. Publication and launch work remain open.
