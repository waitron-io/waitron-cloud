# Status incident history implementation plan

**D612, Lane G, watcher assignment 2026-11-08 14:21.** Build a local English/Spanish status bundle containing the supplied current post and dated resolved incidents. Sources: [approved design §9](../specs/2026-10-24-cloud-monitoring-alerting-status-design.md#9-the-public-status-page), [runbook](../../incident-response.md#restore-verify-and-close), and [monitoring item 2](../../backlog.md#launch-platform-work-in-priority-order).

**Start condition:** no runtime build until this plan is committed, read by Claude and watcher approved. Execute inline. No publisher, provider accounts/uploads, external calls, verified-health wording, incident IDs or database changes. No time-based retention or pagination.

## Allowed files and size

Only these files may change:

- `docs/superpowers/plans/2026-11-08-status-incident-history.md` (this plan).
- `packages/operations/src/status-page.ts` (validation, ordering, rendering).
- `packages/operations/test/status-page.test.ts` (public behavior).
- `packages/operations/test/status-page-cli.test.ts` (real bundle and refusals).
- `docs/incident-setup.md` (input example and limits).
- `docs/backlog.md` (monitoring item 2 only).

Budget: production ~100–150 changed lines, tests ~200–300, docs ~50–80, plus this plan; total ≤600. No dependencies. `rg -n 'renderStatusPage' .` traces callers to the renderer test and CLI; `status-page-cli.ts:9` already forwards parsed JSON unchanged, so exclude CLI source changes.

## Input and display

Keep `renderStatusPage(input: unknown)` and its two output paths. Add optional `history` to either existing input shape. Missing history or `[]` produces the existing page without a history section. Otherwise require an array of objects with exactly `{service,impact,startedAt,resolvedAt}`. Services remain `cloud|remote_access|backups|email|hosted_servers`; impacts remain `some|all|unknown`. Reject null, arrays as records, missing/unknown fields, wrong types and arbitrary/private text with the existing fixed error.

Require real calendar timestamps exactly `YYYY-MM-DDTHH:mm:ssZ`, with `startedAt <= resolvedAt <= updatedAt`; equality is allowed. Validate every supplied record before selection, including discarded records. Display at most 20, resolvedAt descending; ties use startedAt descending, then service and impact ascending by ASCII value. Preserve duplicates; do not alter input or delete stored history. Never infer or copy the current post into history.

Append a semantic list headed “Past incidents (latest 20)” / “Incidencias anteriores (últimas 20)”. Each entry shows the fixed service, existing resolved-impact sentence, “Started” / “Inicio” and “Resolved at” / “Resuelto el”, with dated UTC `<time>` elements. History promises no next update. Keep the current post, no-incident warning, states, UTC-next-update and resolved-impact checks unchanged (`status-page.ts:1–19,39–41,51–58`).

## Build and verify

- [ ] TDD: first add renderer tests. Cover legacy/empty input, all current states alongside history, both languages/vocabularies, unchanged current post, no inferred history, malformed containers/records, private fields and redacted errors, timestamp formats/impossible dates, reversed/future times, equality, midnight and valid/invalid leap dates. Use hand-stated expected entries/order for shuffled >20 records, ties crossing the cutoff, duplicates and an invalid discarded record; do not reproduce the sorting algorithm in tests.
- [ ] Before implementation, add CLI tests: inspect both actual output files for history; invalid history writes nothing and leaks no input/path; history input preserves existing destinations and symlinks. Retain all existing refusal/privacy checks. Run the explicit test command below; observe expected history failures in both files. Implement minimal validation/rendering, then rerun to green.

```sh
cd /Users/clintongormley/workspace/worktrees/cloud-feat-status-incident-history && pwd && node --test packages/operations/test/status-page.test.ts packages/operations/test/status-page-cli.test.ts
cd /Users/clintongormley/workspace/worktrees/cloud-feat-status-incident-history && pwd && pnpm typecheck
```

- [ ] Inspect passing test counts. Update setup examples/limits and backlog with measured local evidence, leaving publication/launch work open. Actually inspect standalone local output in English/Spanish × dark/light × 390/1280, including 20 longest-label entries and empty history. Keep bundles, screenshots, experiments and helper scripts outside the repository; no permanent source-mutation tests. CI owns full suites.

**Finish line:** one usable local bilingual bundle shows the unchanged current post plus the latest supplied resolved incidents; focused checks, typecheck, eight visual inspections and accurate docs pass. Then finish and land under the lane’s existing authority.
