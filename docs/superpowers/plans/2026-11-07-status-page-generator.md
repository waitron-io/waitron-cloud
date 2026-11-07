# Status page generator implementation plan

**D600.** Local slice of [design section 9](../specs/2026-10-24-cloud-monitoring-alerting-status-design.md#9-the-public-status-page), following [public communication rules](../../incident-response.md#publish-only-service-information). Node 26; no new dependencies. Claude reads before build; execute inline.

## Interface and boundary

Create `packages/operations/src/status-page.ts` exporting pure `renderStatusPage(input: unknown): {'index.html': string; 'es/index.html': string}`. For incident posts require exactly four JSON fields:

- `state`: `investigating|fix_being_applied|monitoring|resolved|no_incident`.
- `service`: `cloud|remote_access|backups|email|hosted_servers` (Cloud overall, or the named service).
- `impact`: `some|all|unknown`.
- `updatedAt`: real calendar timestamp, exactly `YYYY-MM-DDTHH:mm:ssZ`; reject normalised impossible dates and unrepresentable next-update times.

Reject missing/unknown fields, wrong types, arrays, null and unknown enum values. `no_incident` takes only `state` and `updatedAt`, since absence is not an incident post.

Use fixed English/Spanish sentences: Investigating/Investigando; Fix being applied/Aplicando una solución; Monitoring/En observación; Resolved/Resuelto; No incident reported/No hay incidencias notificadas. Show service, UTC update and impact; open incidents get a next update30minutes later. Resolved uses past impact; unknown reuses the current unknown sentence. Label updatedAt “Resolved at”/“Resuelto el”; omit its next update per spec correction7November12:37. No incident leads with a setup/unverified-health heading in both languages, then absence/time; no service/impact/next-update promise. Input supplies evidence-backed state.

No private details, arbitrary prose or invented recovery time. No uploads, paging or provider calls.

## Build and verify

- [x] TDD: create `packages/operations/test/status-page.test.ts` and `status-page-cli.test.ts`. Watch expected failures before implementation, then pass. Move resolved from the open-state loop to stricter past-impact/time/no-deadline assertions. Cover vocabulary, absence, calendar rollover, private-field rejection and redacted errors.
- [x] Generate only `index.html` and `es/index.html`, with relative language links, inline CSS, system light/dark, responsive layout; correct lang/hreflang; no JavaScript, assets or network dependencies.
- [x] Add `packages/operations/src/status-page-cli.ts`: `node packages/operations/src/status-page-cli.ts INPUT.json NEW_DIRECTORY`. Validate/render before writing; exclusively create destination, refuse existing paths, remove only its own incomplete output on failure. Exit 0 on success, 1 with fixed errors otherwise. Test subprocess success, invalid JSON/schema, existing destination preservation and creation failure beneath a regular-file parent. Add no production fault hook.
- [x] Update `docs/incident-setup.md` with command, setup example, fields and resolved timestamp/deadline semantics; trim `docs/backlog.md` to distinguish local proof from remaining publication work.
- [ ] Run `node --test packages/operations/test/status-page.test.ts packages/operations/test/status-page-cli.test.ts`, inspect counts, then `pnpm typecheck`. Use existing Playwright: longest incident and setup across EN/ES × light/dark × 390/1280px; open other states once. CI owns full suites. One PR; Claude run-it finish review; inspect current-head CI jobs.

**Upload needs:** separately authorised account/project and outside publisher. [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) (read 2026-11-07): “Within a Direct Upload project, you can switch between creating deployments with either Wrangler or drag and drop.” No upload here.

**Authority:** `~/waitron-campaign-d/queue.md`, D600, watcher 2026-11-07 12:15: “Do not build the upload; write one line in the plan saying what the upload step will need, and check (by reading Cloudflare’s own documentation, quoted) whether its upload tool can publish to a Direct Upload project”. Repository visual rules apply.
