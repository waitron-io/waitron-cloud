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
| b+c | 280.5 | 4207 |
| a+b+c | 280.5+H | 4207−15.847H |

H is residual304s after removals, separately per row. b assumes 19 permission+52 pages+72 source+up to40 startup-run calls removed; parent already paid. c retains ≥23 admission/final calls from153; ≤130 monitors, with finite-window first15s ticks reducing the asymptotic75% saving. Cold calls remain. Supplied169s sampler (cold200/conditional200/304): job23/47/55, run1/0/2, controller4/5/15 plus six404, page1/2/3. **No set honestly projects below4000 yet.** Missing: matched short-worker residual304 counts and finite-window avoided polls. a+b needs ≥111 hits; a+b+c ≥14 under optimistic bounds. Choose the smallest measured set; no blanket58% or overlapping savings.

No quota set is selected or cleared; implementation details wait for that decision. One Claude source-only read took 222 seconds; no reread, per watcher 06:09. Receipts: `~/waitron-campaign-i/receipts/a1479-quota-window-20261111/{installation-304-probe.jsonl,token-mint-control.json,live-counts.log,combined-plan-review.md}`. The 568 fetches span two returned core/reset series; this is an all-local demand proxy, not attributed installation units. Full first-window split is in `first-reset-window.json`.

Full 568 categories: worker job153/run94/pages52/runner42/variable36/token21/permission19/source72/registration12; controller token1/variable14/runs10/pull5/pages31/permission1/source3/PATCH2. Worker variable rows all end404, so the review's suggested second-routingHead304 saving is unavailable. c also avoids dependent monitor runner calls; category totals mix those with fixed registration/cleanup reads, so no unmeasured saving is credited. Cache hits exist only within a client process. Sharing admission narrows the permission/open-PR recheck window; that needs an explicit decision before b is selected.

The real hourly model separates admissions (including code75 respawns) from concurrent monitoring; a burst scale-up cannot qualify it. Existing complete count records now cover a 20-minute busy window, retained as `live-counts-complete.jsonl`: 3,250 fetches in fully contained buckets, 80 worker processes; those aggregate counters still do not identify residual304s or per-worker finite-window avoided polls. No blanket hit fraction is applied across removed calls or cold clients. Next: watcher chooses a read-only matched shadow sample using the existing sampler, or explicitly clears a bounded implementation trial without pretending the current projection meets4000. Future routing stays hosted until live and one qualifying full busy hour remains under limit.

Separately cleared by watcher 06:39: a pre-registration quota refusal may retry once after its recorded retryAt, only after independent guest absence and runner cleanup. Reuse the existing retained-turn mechanism; fresh run/job checks and registration stay. Failed or ambiguous POST registration is never retried by this path. Owning files: `leases.mjs`, `ci-canary.mjs`, `control.mjs`; behavioral tests: `ci-runtime.test.mjs` (refusal-to-success), `ci-auto.test.mjs` (pickup and one retry), existing lease cleanup cases. About production +30/−15, tests +35/−5; README/backlog update in the same priority branch. This clearance is independent of the unselected quota options above.

Watcher 06:51 clears the bounded admission retry as its own small change, independent of the quota choice. The same note clears one 10–15 minute matched read-only sample before choosing a subset of a/b/c; no further plan read is required for that subset. Future routing stays hosted until both are live and a full hour remains below the limit.
