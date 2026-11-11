# A1479 — installation demand

PLANFORAPPROVAL: Lane I `questions.md`, WATCHER 2026-11-11 06:09 supersedes 05:47. Parent owns one source-only Claude plan read, corrections, then watcher clearance; no further plan reread or owner approval claimed.

[GitHub documentation](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api?apiVersion=2026-03-10): “does not count against your primary rate limit if a 304 response is returned and the request was made while correctly authorized”. Authorization is required; this is not PAT-only.

| Supplied provenance, 2026-11-11; no author experiments | Receipt |
| --- | --- |
| Documentation/installation probe; mint control | 200 used21 → authenticated304 used21 → control200 used22, same resource/reset. Reads198→199 after mint→200: no extra mint unit observed in that series. |

568 fetches/227.17s projects **9001/h startup/churn**, not hourly evidence. Excluding 22 App-JWT mints gives an upper-demand proxy of 8653/h; never sum distinct installation core/reset header series.

| Change | Maximum saving/sample | Optimistic proxy/h, rounded |
| --- | ---: | ---: |
| a: conditional GETs | H, unknown | 8653−15.847H |
| b: shared admission | 183 | 5753 |
| c: minute polling | 97.5 | 7107 |
| a+b | 183+H | 5753−15.847H |
| b+c | 280.5 | 4208 |
| a+b+c | 280.5+H | 4208−15.847H |

H is residual304s after removals, separately per row. b assumes 19 permission+52 pages+72 source+up to40 startup-run calls removed; parent already paid. c retains ≥23 admission/final calls from153; ≤130 monitors, with finite-window first15s ticks reducing the asymptotic75% saving. Cold calls remain. Supplied169s sampler (cold200/conditional200/304): job23/47/55, run1/0/2, controller4/5/15 plus six404, page1/2/3. **No set honestly projects below4000 yet.** Missing: matched short-worker residual304 counts and finite-window avoided polls. a+b needs ≥111 hits; a+b+c ≥14 under optimistic bounds. Choose the smallest measured set; no blanket58% or overlapping savings.

After clearance, implement inline in `scripts/disposable-tests/`:

- a, `github-app.mjs`: settled always-revalidated authenticated JSON-GET cache, per-instance; 2MiB responses, 64 entries/4MiB bodies, least-recently-used eviction, refreshed200/304. Capture match before await; independently parse matching304. Valid200 replaces/noETag removes; errors refuse. No stale/token/mutation/log/persistent cache; reuse counters.
- b, `control.mjs`: bounded optional JSON through trusted root-child `job`; validate existing `ciIdentity` against configured repository/workflow and requested run/job. Legacy `findOrdinary` remains. Preserve fresh pre-registration run/job reads, routing-head checks, assignment, five-attempt final readback, cleanup/locks.
- c only if needed, `ci-canary.mjs`: `lastJobRead`60s, first15s tick; failed/busy retry15s. Only full fresh healthy checks advance/clear refusal; skips preserve it. Guest/controller cadence stays.

TDD, then run existing named tests: `github-app.test.mjs` loopback200→304/changed200/error/noETag/mutation-isolation/eviction; `ci-auto.test.mjs`/`ci-entry.test.mjs` validate once, eliminate duplicates, refuse fresh changed run/job before mint; optional `ci-runtime.test.mjs` cadence/refusal/cancellation/busy/deadline. Preserve cleanup assertions. Update `deploy/disposable-tests/README.md`, `docs/backlog.md`, this plan. All-three forecast: production+110/−30, tests+100/−20, docs+40/−30 (~330 lines).

Two run-it branch reviews, one fixes read, current-head CI/land, matched publisher. Future routing stays hosted until live and one qualifying full hour stays under limit, targeting4000 per series. Idle load cannot qualify busy headroom; watcher settles missing natural server-job cohorts through existing tools. No new framework/private logs; synthetic identifiers only.
