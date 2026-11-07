# Status page generator implementation plan

**D600.** Build only the owner-authorised local slice of [design section 9](../specs/2026-10-24-cloud-monitoring-alerting-status-design.md#9-the-public-status-page), following [public communication rules](../../incident-response.md#publish-only-service-information). Node 26, pnpm 9.15.0; no dependencies. Before implementation, Claude reads this plan through `~/workspace/tools/claude-seat.sh review-branch`; if unavailable, do not build. Execute inline.

## Interface and boundary

Create `packages/operations/src/status-page.ts` exporting pure `renderStatusPage(input: unknown): {'index.html': string; 'es/index.html': string}`. Require exactly four JSON fields:

- `state`: `investigating|fix_being_applied|monitoring|resolved|no_incident`.
- `service`: `cloud|remote_access|backups|email`.
- `impact`: `some|all|unknown`.
- `updatedAt`: real calendar timestamp, exactly `YYYY-MM-DDTHH:mm:ssZ`; reject normalised impossible dates and unrepresentable next-update times.

Reject missing/unknown fields, wrong types, arrays, null and unknown enum values. No optional text. `no_incident` requires `service=cloud, impact=unknown`.

Use fixed English/Spanish service, state and impact sentences: Investigating/Investigando; Fix being applied/Aplicando una solución; Monitoring/En observación; Resolved/Resuelto; No incident reported/No hay incidencias notificadas. Show service, UTC update, impact (some venues/all venues/unknown), and next update exactly 30 minutes later, including date rollover, for every state. Resolved describes the supplied incident, never universal health. No incident explicitly says setup is in progress and current service health is unverified in both languages. Input supplies evidence-backed state; generator performs no investigation or recovery decision.

No venue identifiers, personal data, private hostnames, logs, secrets, exploit details, investigator/owner prose or invented recovery time. No provider accounts, uploads, paging, ledger or protocol.

## Build and verify

- [ ] TDD: create `packages/operations/test/status-page.test.ts` and `status-page-cli.test.ts`. Watch focused behavioral tests fail for the expected reason before minimal implementation, then pass. Cover all states/services/impacts, bilingual parity, truthful absence, timestamp rollover/invalid dates, private-field rejection and malformed input without echoed contents.
- [ ] Generate only `index.html` and `es/index.html`, with relative language links, inline CSS, system light/dark, responsive layout; no JavaScript, assets or network dependencies.
- [ ] Add `packages/operations/src/status-page-cli.ts`: `node packages/operations/src/status-page-cli.ts INPUT.json NEW_DIRECTORY`. Validate/render before writing; exclusively create destination, refuse existing paths, remove only its own incomplete output on failure. Exit 0 on success, 1 with fixed errors otherwise. Test subprocess success, invalid JSON/schema, existing destination preservation and write failure cleanup.
- [ ] Update `docs/incident-setup.md` with that command and five tiny complete synthetic JSON examples, one per state; trim `docs/backlog.md` to distinguish local proof from remaining publication work.
- [ ] Run `node --test packages/operations/test/status-page.test.ts packages/operations/test/status-page-cli.test.ts`, inspect counts, then `pnpm typecheck`. Inspect every rendered state across eight combinations: EN/ES × light/dark × 390/1280px. CI owns full suites. One PR; one Claude run-it whole-branch finish review via `claude-seat.sh review-run`; inspect current-head CI jobs.

**Upload needs:** a separately authorised account/project and publisher remain open. [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) (read 2026-11-07): “This guide will instruct you how to upload your assets using Wrangler or the drag and drop method.” The same project supports both; `wrangler pages deploy BUILD_OUTPUT_DIRECTORY` supports later deployments. No upload implementation or deployment authority here.
