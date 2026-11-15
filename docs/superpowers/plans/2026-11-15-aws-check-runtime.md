# AWS check runtime implementation plan

**Request:** “Bring each AWS check job towards four minutes without cutting checks or changing deadlines.” Recorded in `~/waitron-campaign-g/queue.md`, AWS-CHECK-TIME, from `docs/backlog.md`. Claude review and watcher clearance are required before building; neither is owner design approval. Implement inline with TDD.

**Measured cause:** `~/waitron-campaign-g/receipts/aws-check-time/baseline-breakdown.json` records healthy run 43652509564, head `1597536eab19a79a1945e09e375de2d6d93cd345`: Check steps 457/682/627/1061 seconds; preparation 38.6–42.4 seconds; install 0.5–0.7. Serial guard execution totals 359 tests and 391.7/613.1/565.7 seconds. Composition/provider guards repeat every integration filter in both roots (369.85/294.71 seconds); custody takes 152. The complete-suite job serializes twelve suites. Buffered output cannot distinguish provider startup from individual plans or predict filter timings. The companion `../tofu-plugin-start/cap-pr-qualified-timing.json` qualifies spread, 2–3-second checkouts, no download 5xx and no overlapping incident.

- [ ] **Fixed slices, existing isolation.** In `deploy/aws/check.mjs`, add closed suite names `bindings-global` and `bindings-country` (only that root’s integration filter), `composition` (both roots’ composition/edge/evidence filters), and `handoff` (both handoff filters). Keep separate root containers, immutable inspected snapshots, cleanup and `run.py` unchanged. Preserve `integration` and canonical twelve-suite `--all` without also traversing aliases. No infrastructure/provider changes, caches, framework, or deadline changes: retain 90-second commands, 300-second containers and 30-minute jobs, mocked-only inspection and every existing refusal.
- [ ] **Assertion ownership.** Change `composition.test.mjs` to its slice; retain all twenty named occurrences, including the country-only permission refusal and global-only workload case. Move only the executable-plan test from `provider-bindings.test.mjs` into new `provider-global.test.mjs` and `provider-country.test.mjs`; retain static provider checks. Each new test requires aggregate `[29]`, one network-entry case, one foreign-operator refusal and all eight account/region refusals for its four aliases. This replaces `[29,29]` and two network occurrences across roots; the original 359 cases become 360 before new runner tests. Each root still executes 29 admission + 6 composition + 2 edge + 2 evidence + 2 handoff cases.
- [ ] **Fixed workflow allocations.** In `.github/workflows/aws-infrastructure.yml`, use explicit matrix file/suite lists, serial Node explicit-file execution, fail-fast false, unchanged preparation/artifacts; format only in plans-1. Test stems below mean `deploy/aws/<stem>.test.mjs`.

| Cell | Allocation |
| --- | --- |
| guards-1/2/3/4 | custody / provider-global / provider-country / composition |
| guards-5 | accounts,candidate,check,contracts,handoff,integration,modules-policy |
| guards-6 | runner,runner-batches,scheduling |
| guards-7 | database,locks,state |
| guards-8 | cell,network,storage |
| guards-9 | dns,ingress,observability,permissions,provider-bindings,replication-metrics,tools,topology |
| plans-1/2/3/4 | custody+canary / database+state+accounts / storage+network+cell / observability+ingress+dns |
| plans-5/6/7 | bindings-global / bindings-country / composition+handoff |

The four module allocations sum to 164.7/159.8/158.0/156.7 measured suite-seconds; new slices require CI timing.

- [ ] **TDD and consumers.** First watch `fixed slices preserve all CLI inventory` fail in `runner-batches.test.mjs` on unknown slices, using injected execution; then implement. Preserve existing behavioral checks. Update `integration.test.mjs` to execute every matrix shell, prove discovered-file/filter coverage exactly once, and retain failure/count/artifact checks. Update `scripts/ci-evidence.mjs` to require all sixteen verify names; update `scripts/{ci-evidence,ci-native-summary,ci-reuse-source,ci-plan-fallback}.test.mjs` inventories without weakening missing/duplicate/wrong-attempt refusals. Run focused tests: `node --test deploy/aws/integration.test.mjs scripts/{ci-evidence,ci-native-summary,ci-reuse-source,ci-plan-fallback}.test.mjs`; run runner-batches with `--test-name-pattern='fixed slices'`. No permanent self-mutation tests. CI owns full suites.
- [ ] **Finish.** Update `docs/aws-infrastructure.md` and the backlog entry. Estimated production/workflow +120/−35 lines; tests/test-support +300/−120; guide/backlog +40/−20. On the current-head pinned AWS workflow, read every job and retained assertion count, confirm complete coverage and report each job’s elapsed time and Check-step time against approximately 240 seconds, including preparation. Explain remaining excess from measured logs before claiming delivery; preserve all deadlines. Claude reviews built work through finish-branch.
