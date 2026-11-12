# A1473 automatic quota fallback implementation plan

**Scope:** Step 2 only; separate Sol/high draft, Claude read (189 s), driver corrections. The watcher cleared capacity-based switching with existing labels draining at10:34 on12November in LaneI questions.md; no owner design approval is claimed. Node26, no dependency.

**Request:** Lane I `questions.md:356`, watcher2026-11-12 02:15, verbatim:

> The controller used up the GitHub App's 5,000 requests an hour at 01:58 and no CI job started until 02:08; the 4,000 switch to GitHub was missed because it is applied by hand. Before noon, in this order: (1) make the controller use fewer requests (say which calls dominate, with counts from one hour); (2) make the switch at 4,000 automatic, and switch back after the reset; (3) only then the staged overflow test; (4) close with what works. Also say in progress.log why the server ran below 12 slots at 01:48.

**Measured prerequisite:** Installed Cloud#1181 `078ede8ddb77`, 08:11–09:11UTC: 60 complete minutes/139 scopes, no missing/conflicting/malformed/unfinished records or failed fetches. Non-token completed non-304 proxies2,472; tokens135 separately. GETjobs586(23.7%), GETjob429(17.4%), GETvariable392(15.9%) dominate; job-inventory304share51.4%, peak sampled core used1,845/5,000. Campaign receipt `receipts/firing-20261112-0624/a1473-cache-hour-summary.json` retains distinct reset series. No causal savings claim across different workloads.

**Smallest result:** Publish zero available `DISPOSABLE_TESTS_CAPACITY.slots` at returned core used>=4,000; normal computed capacity returns after that observation's reset. New placements use GitHub. Keep serving existing server-labelled jobs, active workers and cleanup; skip forward overflow during the hold. No admission stop, mode/head writes or ownership framework. The headroom is not a guarantee against exhaustion or secondary throttles.

**Consumer/dependency:** Waitron `scripts/ci-server-health.mjs:188–222` selects hosted with slots0, without an expiry. PR#2932's planner also selects hosted with slots0; it landed as4f59b6f33dd93006318e5840acabaff3cc7b5020 before this build. Its real server planner passed in43190152811/job131087112395. A zero snapshot does not claim a full server: `serverFull` requires slots>0. Scheduled planner rescue may retry an untouched queued planner after five minutes; health still reports actual stalls, and the pickup probe remains manual. Existing mode/selected-head/hosted-attempt gates keep their meaning.

## Build and verify

- [ ] TDD in `scripts/disposable-tests/{github-app,leases,ci-auto}.test.mjs`:3999 normal capacity,4000 zero; worker-only observation, fresh-process hold before reset/normal capacity afterward, lower alternate-reset observation cannot release early; existing labels still admitted and active reservations preserved. Retain manual hosted/selected-head checks. Malformed/token/far-future headers do not change holds; a refused ledger write does not replace the HTTP answer or existing401/403/429 retry semantics.
- [ ] `github-app.mjs`: one process-scoped `withQuotaObserver(work,observe)` response hook in `githubFetch`, independent of request counting, including304/errors/direct job-log reads; install around existing entry points in `manual.mjs` and `control.mjs`. Do not parse diagnostics or wire individual constructors. Before locking, filter non-token/core, integer used>=4000 and reset in `(now,now+3660s]`, suppress repeated observations in that process, log/swallow storage failures. Preserve HTTP behavior; the existing lock can delay recording.
- [ ] `leases.mjs`: one optional validated `quotaHoldUntil` milliseconds, taking the maximum crossing reset through existing durable `LocalLeases.transaction`; never change slots/turns. Expired values need no clearing. No new ledger.
- [ ] `control.mjs`: read hold after recovery/before pass inventory. Keep pickup/cleanup; suppress overflow while held. At the existing publication cadence reuse `publishCapacity({healthy:false,...})` with current observations/time. If the variable already has slots0, skip rewriting it. After expiry publish normal capacity at that same cadence. No throttle bypass or preserved stale timestamp.
- [ ] Run `node --test scripts/disposable-tests/{github-app,leases,ci-auto}.test.mjs`, read counts; update `deploy/disposable-tests/README.md` and `docs/backlog.md`.

**Qualification:** Controlled loopback returned-header/state test, then existing immutable quiet-window publication/readback: hashes, timer, capacity, active-work preservation. Never force real-App exhaustion, cancel shared work or drain a busy pool. Local controls are not live threshold evidence. Staged overflow remains separate. Expected code+60–100/-10–20, tests+90–130/-0, docs+15–25/-5–10. No new service/schedule/collector/protocol. The watcher cleared that policy; land this plan before implementation.


2026-11-12 11:06 watcher amendment after built-work review: drop the skip-rewrite rule above.
Publish a fresh zero-capacity snapshot at each normal publishing minute during the hold.
Single-slot ledgers do not record holds; only multi-slot automatic pickup consumes them.
