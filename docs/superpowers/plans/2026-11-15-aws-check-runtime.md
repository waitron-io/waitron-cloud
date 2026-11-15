# AWS check runtime implementation plan

**Ask:** “Bring each AWS check job towards four minutes without cutting checks or changing deadlines.” Source: `~/waitron-campaign-g/queue.md`, AWS-CHECK-TIME; `docs/backlog.md`. Watcher 15 November 05:33 cleared this smaller route, pending one Claude reread; no owner design approval claimed.

**Cause and finish line.** Healthy run [43652509564](https://github.com/waitron-io/waitron-cloud/actions/runs/43652509564) took 457/682/627/1,061 seconds per Check step. Preparation was 38.6–42.4 seconds; install 0.5–0.7. Serial guards took 391.7/613.1/565.7 seconds. Composition and binding tests each repeat the complete integration suite; `--all` repeats the real plans already executed by guards. Integration alone took 365.5 seconds; custody took 146.3 there and 152.1 in its guard. Buffered logs cannot separate provider startup from plans; health receipts qualify 2–3-second checkouts, no download 5xx or overlapping incident. Pinned CI must qualify every job’s execution against approximately 240 seconds, assertion counts and separate queue time.

- [ ] **Reuse the runner.** Add only `integration-global` and `integration-country` aliases in `deploy/aws/check.mjs`, each explicitly mapped to that root’s existing five filters. Keep twelve-suite `--all` iteration separate. Preserve both-root integration, immutable inspection, separate root containers, cleanup, `run.py`, every safety flag and 90-second/300-second/30-minute limits. No caches, provider changes or new scheduling framework.
- [ ] **Keep checks with their owner.** Replace `composition.test.mjs` and only the executable test in `provider-bindings.test.mjs` with `global-plans.test.mjs` and `country-plans.test.mjs`: one real full-root run each, retaining per-root aggregate `[29]`, network and foreign-operator cases, eight alias refusals and ten applicable composition occurrences; each root also asserts zero occurrences of the other root’s exclusive case. Static provider assertions stay. Two old tests become two root tests: baseline 359 remains, before new runner cases. Keep all 384 HCL cases, authority assertions and four exact handoff JSON/schema checks.

**Removed cell ownership:** `verify (suites)` runs no unique assertion. Its twelve suite executions remain required through these current guards:

| Suite | Guard file and line under `deploy/aws/` |
| --- | --- |
| canary; accounts; state | `runner.test.mjs:182`; `locks.test.mjs:11`; `state.test.mjs:90` |
| network; cell; database | `network.test.mjs:163`; `cell.test.mjs:8`; `database.test.mjs:84` |
| storage; observability; ingress | `storage.test.mjs:86`; `observability.test.mjs:83`; `ingress.test.mjs:78` |
| custody; dns | `custody.test.mjs:75`; `dns.test.mjs:85` |
| integration, all five filters | `composition.test.mjs:7`, `provider-bindings.test.mjs:96` move into both root files; `handoff.test.mjs:59` retains stricter JSON checks |

- [ ] **Eight fixed guard cells** in `.github/workflows/aws-infrastructure.yml`, named `guards-1` through `guards-8`, with matrix keys `cell`, `files` (space-separated explicit paths), `format` (true only for cell 8). Each runs serially; formatting moves after cell 8’s guards and is not reached after their failure. Test stems below omit `.test.mjs`:

| Cell | Files | Forecast Check seconds including preparation |
| --- | --- | ---: |
| 1 | custody | 195 |
| 2; 3 | global-plans; country-plans | 225 each |
| 4 | accounts,candidate,check,contracts,handoff,integration,modules-policy | 235 |
| 5 | runner,runner-batches,scheduling | 210 |
| 6 | database,locks,state | 205 |
| 7 | cell,network,storage | 190 |
| 8 | dns,ingress,observability,permissions,provider-bindings,replication-metrics,tools,topology | 230 |

Forecast assumptions combine measured cases, preparation and startup allowance; root split/workflow-test growth remain unmeasured. Keep path triggers, failure propagation and artifacts. Require all eight names in `scripts/ci-evidence.mjs`; update inventories in `scripts/{ci-evidence,ci-native-summary,ci-reuse-source,ci-plan-fallback}.test.mjs`, retaining every missing/duplicate/wrong-attempt refusal.

- [ ] **TDD:** new alias/batch and canonical `--all` inventory tests in `runner-batches.test.mjs` fail before implementation. Rework existing real-shell `integration.test.mjs` fixtures/stages for explicit paths and no suites stage to cover every discovered guard file once, all cells, failures and artifacts; add an independent literal 27 root/filter inventory to `runner-batches.test.mjs` independent of the alias table. Artifact uniqueness now covers eight names. Run named changed files locally, Docker cases via the shared helper; CI owns full suites. No permanent mutation harness.
- [ ] **Finish:** update `docs/aws-infrastructure.md` and delete finished backlog text. Forecast production/workflow +85/−55; tests/support +260/−160; guide/backlog/plan +60/−30. Claude finish-branch review, exact-head pinned CI and every final job’s counts/timing precede landing.

Watcher 15 November 05:33: “A second run of the same real plan that asserts nothing the first run does not is a repeat, not a check”; every current assertion remains required on the same pull requests. Claude’s corrected-plan read found no material issue; these executable clarifications need no further planning round.
