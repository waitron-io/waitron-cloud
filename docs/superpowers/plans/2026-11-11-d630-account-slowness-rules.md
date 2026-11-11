# D630 account slowness rules implementation plan

**Status:** written by this separate GPT-6.1 Sol/high draft invocation; pending Claude review and watcher clearance, obtained by the driver before building. The owner has not approved this plan.
**Authority:** watcher queued D630 at 10:00 on 11 November 2026; `docs/backlog.md:687–690` records design approval for building/rehearsing locally, not this plan.
**Ask verbatim**, recorded in `/Users/clintongormley/waitron-campaign-g/queue.md`, D630:

> monitoring design `docs/superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md:122-127` ("The share of real requests … that fail or are too slow") and :151 ("Not urgent, on the work list: … signal 3's slow rule"); backlog item 2 ("trial-derived targets, slowness rules and hosted-server measurements remain open"). Using D626's timing bands, report per request group whether the share of requests slower than a set limit breaches the same fast/slow rule shape D629 built, shown on the local collector. It pages nobody. Usable result: the local collector shows slowness breaches beside D629's failure breaches.

## Source assessment — reading, not execution evidence

- Read `docs/superpowers/plans/2026-11-11-d629-account-failure-rules.md`. Its evaluator, `deploy/local-stack/account-failure-rules.mjs:16–38`, supplies window/history/reset/calculation behavior to reuse.
- `packages/account-http/src/request-metrics.ts:21–27,32–64` distinguishes response totals from measured histogram counts; `packages/account-http/src/server.ts:64–81` leaves parser-only failures untimed.
- Consumers traced: `deploy/local-stack/operations-health.mjs:5–14` validates acquisition; `deploy/local-stack/operations-collector.mjs:53–57` formats/validates before updating rules. Collector APIs, startup and freshness are at `:13–28,65–99`; root `compose.yaml:151–166` starts it.
- Direct failure API/output consumers are the collector and its tests. `scripts/operations-collection-proof.mjs:27–45` consumes default-disabled output, not rule APIs; leave its assertions unchanged. Historical selector fixtures are not runtime consumers.
- Guides: `docs/operations-status.md:181–253` and monitoring item 2, `docs/backlog.md:719–723`. `package.json`'s `test:local-stack` discovers both existing rule/collector tests.

## Decisions

- Add optional `CLOUD_ACCOUNT_SLOWNESS_RULES`, forwarded only to the collector by root Compose.
  Unset/empty disables slowness independently. Enabled JSON has exactly `slownessTargets`, `fast`, `slow`.
  Every limit, share, window and multiplier is required, **without defaults**; design `:489` leaves trial values open.
- `slownessTargets` names a nonempty subset of the seven existing groups; each value has exactly `limitSeconds` and `share`.
  Limit equals a finite existing boundary: `0.05`, `0.1`, `0.5`, `1`, `5` seconds; share is finite in `(0,1]`.
  Each fast/slow rule requires `windowMs` (safe integer ≥ collection interval) and finite positive `multiplier`.
  Reject missing/unknown keys and invalid values; preserve D629's absence of ordering/product-at-most-one restrictions.
- Keep `parseFailureRules(raw,intervalMs)` and `createFailureRules(config,{intervalMs,timeoutMs})` APIs/errors unchanged.
  Add `parseSlownessRules`/`createSlownessRules` with matching argument/return shapes in the same module.
  Validate interval then both configs before listening. New error: `invalid_account_slowness_rules`; fixed CLI diagnostic:
  `Local operations collector failed; check CLOUD_ACCOUNT_SLOWNESS_RULES` (never print configuration values).
- Extract one private `createShareRules(targets,windows,options,project)` in `account-failure-rules.mjs`; use thin wrappers.
  Project cumulative per-group/outcome denominator and within-allowance counters: failure uses `total` and success/refused totals;
  slowness uses `count` and the selected bucket. Difference these counters; bad = denominator minus within allowance.
  Retain per-outcome reset detection, including denominator/selected-bucket decreases. No added trusted-snapshot validation.
- Slowness share = sum of increases in `count − buckets[limitIndex]` / sum of increases in `count`, across all four outcomes.
  Exactly-at-limit is allowed; only **strictly greater** is slow. Untimed responses never dilute the denominator.
  Configured `parser` is unknown without timings; unnamed groups emit nothing.
- Reuse D629's comparison `share ≥ target × multiplier × (1 − 1e-9)`, baseline/slack/pruning, and reset/zero-window semantics.
  Keep history across missed polls; each enabled evaluator uses the shared helper with its own configured windows.
- Add optional `slownessRules` to `createCollection`/`serveCollection`; update both from the same validated reading/timestamp.
  Reuse the acquisition availability/freshness gate and share the metric-rendering loop; keep current readings during unfinished polls.
  Current rules remain independent of operations inspection failure; status/raw-metric suppression and failure output stay unchanged.
- Export gauges `waitron_cloud_account_slowness_rule_ready{group,rule}` and `waitron_cloud_account_slowness_rule_breached{group,rule}`.
  Both are 0/1; breach appears only when ready. Startup/empty/unavailable/stale means ready 0, no breach value.
  Keep bounded group labels, `rule=fast|slow`, contiguous typed families, and existing validation through `parseRequestMetrics`.

## Red → green steps and test owners

For each step, add assertions first, run the named file and observe the expected missing/wrong behavior; implement minimally, rerun green and read test counts. Preserve all existing failure assertions.

1. **Evaluator:** extend `deploy/local-stack/account-failure-rules.test.mjs`, then `deploy/local-stack/account-failure-rules.mjs`.
   Add “slowness requires explicit settings”: disabled/valid subsets, missing fields, unknown keys/groups, invalid values/non-boundary limits.
   Add “measured shares use strict bucket boundaries”: existing `RequestMetrics` builds equal/greater durations at every finite boundary;
   assert all outcomes, per-group fast/slow breach/clear, exact decimal equality/below threshold, and untimed counts that would dilute `total`.
   Add “slowness retains coverage and resets”: startup/empty/parser-only unknown, new outcome, missed poll/old baseline, restart,
   count/selected-bucket decreases and backward time. Leave D629's existing behavioral tests unchanged.
   Native red/green command: `node --test deploy/local-stack/account-failure-rules.test.mjs` (no Docker).
2. **Collector/wiring:** extend `deploy/local-stack/operations-collector.test.mjs`, then `deploy/local-stack/operations-collector.mjs` and `compose.yaml`.
   Add “rules coexist independently”: neither/failure-only/slowness-only/both, opposite failure/slowness outcomes, literal gauge families/labels.
   Add “slowness shares freshness and history”: operations failure, request failure/recovery, missed poll, exact expiry and unfinished poll;
   assert breach/clear/unknown omission while preserving status/raw/failure assertions. Keep arithmetic tests in the evaluator file.
   Add “slowness reaches HTTP and fails closed”: real `serveCollection` loopback scrape shows a breach after a short explicit window;
   invalid config rejects before collection/listening, and CLI diagnostic hides values. Extend existing Compose assertions for collector-only
   forwarding and empty-disabled wiring; retain security checks. This file invokes Compose: run only through the Linux helper below.
3. **Docs/qualification:** update `docs/operations-status.md` with config/units/formula, independent opt-ins, unknown/reset/freshness limits;
   any example values are synthetic, never trial recommendations. Keep failure-only guidance accurate.
   Update only monitoring item 2 in `docs/backlog.md` after tests: locally exercised failure/slowness rules; trial values/hosted measurements stay open.

**Focused red/green collector command, then final check:** run `~/waitron-campaign-shared/test-box-run.sh G "$PWD" node --test deploy/local-stack/operations-collector.test.mjs`; finally run the same helper with both `deploy/local-stack/account-failure-rules.test.mjs deploy/local-stack/operations-collector.test.mjs` explicitly listed after `node --test`.
Never direct Mac Docker; on exit 75 do independent work. No whole local suite or local typecheck when no TypeScript changes.
**CI:** inspect actual current-head selection/jobs; CI owns full suites. Deployment changes retain `test:local-stack` (`scripts/ci-local-stack-receipt.mjs:33–54`); `scripts/ci-plan.mjs` retains conservative selection. No selector machinery or new proof; driver handles branch review/CI after clearance.

**Forecast excluding plan:** production 90–140 changed lines; tests 130–190; test support **0**; docs 20–35: about 240–365 total across the seven named implementation/test/Compose/docs paths.
**Missing/outside scope:** trial-derived settings, hosted-server measurements, paging/work items, providers/accounts and production activation. No instrumentation, buckets, store, rule engine, endpoint or service added. This draft claims no executed tests or rehearsal.
