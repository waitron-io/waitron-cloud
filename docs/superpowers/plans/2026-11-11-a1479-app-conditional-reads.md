# A1479 App conditional reads — implementation plan

**Goal:** Reduce unchanged polling reads' primary quota cost while asking GitHub on every poll.
**Request:** “The App's primary rate limit stopped admission tonight. Measure how many App reads the controller makes per hour against that limit, and fix the cause if normal load can reach it. This is a priority fix under ci-failure-rule.md, not a one-off.”
**Provenance:** `/Users/clintongormley/waitron-campaign-i/questions.md, heading`, WATCHER 2026-11-11 04:05 point 2; apply `~/waitron-campaign-shared/ci-failure-rule.md`.
**Execution:** Routine inline TDD; Claude plan review through `~/workspace/tools/claude-seat.sh review-branch`, corrections and watcher clearance are required before build. This page records neither review nor clearance.

## Evidence and limits

| Source / provenance | Observation |
| --- | --- |
| [GitHub REST best practices, “Use conditional requests”](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests), read 2026-11-11 | Exact words: “does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized”; the sentence requires an `Authorization` header. |
| External `~/waitron-campaign-i/receipts/a1479-rate-publication-20261111/` (`request-count-summary.json`, controller logs; supplied measurement) | All 590 scopes have final records: 18,232 local fetch attempts; 6,323 in 2026-11-10 UTC 23:00–00:00; peak rolling hour 7,047. Token requests are included; these totals are not installation consumption. Two observed primary reset groups reach remaining 0. |
| Same directory, `read-trace.jsonl`; monitor at `scripts/disposable-tests/ci-canary.mjs:589` and `:608` | Supplied ordinary read-only pass with three running workflows uses 16 GETs, including queued-candidate validation. Each worker additionally reads its job every 15 seconds and run every 60 seconds: nominally 300 GETs/worker-hour, excluding other work. |
| Same directory, `conditional-probe.json`, read 2026-11-11 | Authenticated `actions/jobs/130294181339`: 200 with ETag, then `If-None-Match` returned 304; both reported remaining 4392/reset 1794369755. One probe establishes neither sustained headroom nor safety of all traffic. |

`scripts/disposable-tests/github-app.mjs:43–68` currently sends unconditional requests; `:29–38` counts actual fetches and retains quota/status snapshots. These are code readings, not new runtime verification.

## One bounded change

- Modify only `scripts/disposable-tests/github-app.mjs`, `scripts/disposable-tests/github-app.test.mjs`, `deploy/disposable-tests/README.md`, `docs/backlog.md`, and this plan.
- Keep `GithubApp`'s public API. Add a private in-memory cache per instance, bound to that App/installation and exact request URL including query; never share representations across authorization identities or retain credentials as cache keys/data.
- Cache only authenticated JSON GETs. Every call still fetches; send the saved ETag as `If-None-Match`. Accept 304 only when this request sent that ETag and holds the matching successful local body; otherwise fail visibly.
- On 200, enforce the existing 2 MiB response bound and parse JSON successfully before replacing the entry. Store private body bytes and parse independently for every return, including the initial 200, so caller mutation cannot change later results.
- Cap at **16 entries**, evicting oldest insertion/replacement first: at most **32 MiB retained body bytes**, plus small metadata and transient parsing allocations. Do not retain parsed object graphs as well.
- A successful response without ETag removes any older entry and remains unconditional next time. HTTP errors, malformed/oversized/interrupted bodies and fetch failures still fail; never serve expired or stale data on error. A later successful conditional revalidation may reuse its matching body.
- Never cache tokens, credentials, mutations or job-log downloads. Preserve deadlines, cancellation, path/origin checks and primary/secondary backoff. No persistence or cross-process service.
- Keep `requests` meaning actual fetch attempts, including 304. Retain existing status/quota headers; add only an optional 304 count to the current event if live validation actually needs it, without a new event system.

## Build and checks

- [ ] Trace `request`/`call`/`get`, token and log paths and their readers in `control.mjs`, `ci-canary.mjs`, `publish.mjs` and `manual.mjs` before changing request handling.
- [ ] Reuse real-loopback HTTP fixtures in `github-app.test.mjs`. Add named checks: **200 then 304 returns data** (two HTTP requests, conditional header, unsolicited 304 fails); **mutation isolation** (nested edits after 200 and 304); **changed response replaces body and ETag**; **HTTP error never uses old data**; **no ETag stays fresh** (including removal after an earlier ETag); **oldest entry eviction** (17 URLs, evicted URL fetched unconditionally).
- [ ] Pin cache exclusions and per-instance separation in these cases; preserve all existing behavioral assertions, authentication, counting and failure checks. Own cache behavior here; do not repeat it in caller tests.
- [ ] For each behavior, write its test first, run it and observe the expected failure, implement the minimum, rerun to green. Read the TDD skill before writing any test or implementation.
- [ ] Run `node --test scripts/disposable-tests/github-app.test.mjs scripts/disposable-tests/ci-runtime.test.mjs scripts/disposable-tests/ci-auto.test.mjs` before checkpoints and any size stop; read counts and report failures. These are the actual client, monitor and automatic-admission owning files.
- [ ] Update the README and existing backlog entry with conditional semantics, measurements and remaining qualification; keep raw receipts outside this public repo. List any changed test checks explicitly in the PR; weaken none.

## Size, publication and finish

Expected diff: production +25/-5, tests/support +90/-0, docs including this plan +35/-5, about 160 added/removed lines. This page may use about 50 lines. Report actual additions/removals by category; **stop above 1.5× (240 total lines)**, run named tests, and return the smallest cut to the watcher before expanding.
Before landing: `finish-branch` Claude run-it review (second seat if its risk triggers apply), resolve findings, one fresh fix read, then inspect every selected current-head CI job; use `land-branch` and inspect exact merge-commit CI.
After reviewed/landed publication through A1479's matched existing publisher (`node scripts/disposable-tests/publish.mjs server /PRIVATE/publication.json`), collect successful conditional 304 samples under ordinary load and quota movement. Reuse the qualified host recipe if host files are unchanged; do not patch frozen releases.
Measure controller and worker attempts separately over an actual busy hour; record concurrency/cadence, 200/304 observations and installation resource/limit/remaining/reset headers, compare consumption within reset groups, and distinguish token calls and other App users. Check GitHub incident history/run health under the CI failure rule before judging measurements.
**Finish line:** Published controller returns current polled data, retains admission/cancellation checks, and has live conditional samples plus honestly bounded hourly/quota evidence in the existing README/backlog. Label an incomplete hour incomplete and keep sustained headroom open; synthetic checks cannot prove all traffic safe.
**Deliberately excluded:** Changes to monitor cadence, admission, cancellation rules, routing, either backoff, ledger, state, protocol or public API; new host recipe when unchanged, cross-process caching, persistence and a new measurement framework.
