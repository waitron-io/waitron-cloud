# Status page generator implementation plan

**D600.** Build only the owner-authorised local slice of [design section 9](../specs/2026-10-24-cloud-monitoring-alerting-status-design.md#9-the-public-status-page), following [public communication rules](../../incident-response.md#publish-only-service-information). Node 26, pnpm 9.15.0; no dependencies. Before implementation, Claude reads this plan through `~/workspace/tools/claude-seat.sh review-branch`; if unavailable, do not build. Execute inline.

## Interface and boundary

Create `packages/operations/src/status-page.ts` exporting pure `renderStatusPage(input: unknown): {'index.html': string; 'es/index.html': string}`. For incident posts require exactly four JSON fields:

- `state`: `investigating|fix_being_applied|monitoring|resolved|no_incident`.
- `service`: `cloud|remote_access|backups|email|hosted_servers` (Cloud overall, or the named service).
- `impact`: `some|all|unknown`.
- `updatedAt`: real calendar timestamp, exactly `YYYY-MM-DDTHH:mm:ssZ`; reject normalised impossible dates and unrepresentable next-update times.

Reject missing/unknown fields, wrong types, arrays, null and unknown enum values. No optional text. `no_incident` takes only `state` and `updatedAt`, since absence is not an incident post.

Use fixed English/Spanish service, state and impact sentences: Investigating/Investigando; Fix being applied/Aplicando una solución; Monitoring/En observación; Resolved/Resuelto; No incident reported/No hay incidencias notificadas. Show service, UTC update, impact (some venues/all venues/unknown), and next update exactly 30 minutes later, including date rollover, for incident posts. Resolved describes the supplied incident, never universal health. No incident leads with a setup/unverified-health heading in both languages, then absence and timestamp; no service/impact/next-update promise. Input supplies evidence-backed state; generator performs no investigation or recovery decision.

No venue identifiers, personal data, private hostnames, logs, secrets, exploit details, investigator/owner prose or invented recovery time. No provider accounts, uploads, paging, ledger or protocol.

## Build and verify

- [ ] TDD: create `packages/operations/test/status-page.test.ts` and `status-page-cli.test.ts`. Watch focused behavioral tests fail for the expected reason before minimal implementation, then pass. Cover all states/services/impacts, bilingual parity, truthful absence, timestamp rollover/invalid dates, private-field rejection and malformed input without echoed contents.
- [ ] Generate only `index.html` and `es/index.html`, with relative language links, inline CSS, system light/dark, responsive layout; correct lang/hreflang; no JavaScript, assets or network dependencies.
- [ ] Add `packages/operations/src/status-page-cli.ts`: `node packages/operations/src/status-page-cli.ts INPUT.json NEW_DIRECTORY`. Validate/render before writing; exclusively create destination, refuse existing paths, remove only its own incomplete output on failure. Exit 0 on success, 1 with fixed errors otherwise. Test subprocess success, invalid JSON/schema, existing destination preservation and output-creation failure; no production fault hook.
- [ ] Update `docs/incident-setup.md` with that command, one setup example and the field list; trim `docs/backlog.md` to distinguish local proof from remaining publication work.
- [ ] Run `node --test packages/operations/test/status-page.test.ts packages/operations/test/status-page-cli.test.ts`, inspect counts, then `pnpm typecheck`. Use existing Playwright to inspect every state across eight required combinations: EN/ES × light/dark × 390/1280px. CI owns full suites. One PR; one Claude run-it whole-branch finish review via `claude-seat.sh review-run`; inspect current-head CI jobs.

**Upload needs:** separately authorised account/project and outside publisher. [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) (read 2026-11-07): “Within a Direct Upload project, you can switch between creating deployments with either Wrangler or drag and drop.” Its deploy section documents `wrangler pages deploy BUILD_OUTPUT_DIRECTORY`. No upload here.

**Queue authority:** watcher 2026-11-07 12:15 assigned D600; its ask explicitly requires checking and quoting Cloudflare upload support and opening every state locally. Standing repository rules require EN/ES, light/dark, 390/1280 visual inspection. These override review suggestions to omit those checks.
