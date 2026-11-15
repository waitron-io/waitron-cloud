# Translation house-style preparation

Claude must review this plan, then the watcher must clear it before build. No owner approval of this plan is claimed. The maintained trial stays loopback-only; no real-key trial is authorised.

**Request and judgement.** Follow TRANSLATE-REMAINING, recorded verbatim in `/Users/clintongormley/waitron-campaign-g/queue.md` (23:23, 15 November). Task 23 steps 1–2 explicitly specify this preparation (`2026-10-14-translate-all.md:4493–4538`). It is a warranted, usable result: you can rehearse selecting accepted tuning examples and attaching them to a blind-set trial entirely against loopback. It supplies no quality measurement. The current trial supplies empty house style (`packages/translation/quality/trial.ts:8–11`).

**Smallest finish line and exact files.** Paths below start at `packages/translation/` unless stated otherwise.

1. In `quality/scorer.ts`, expose `ShownName` and `shownEntries`, reusing the recorded shown-file shape and `gradeKey` semantics without changing scoring. In `quality/trial.ts`, add deterministic `acceptedHouseStyle`: exclude marked (`fix`/`wrong`), given, unknown-product and correction-language (`fix`) entries; use only shown candidates. Choose the most-run text per product/language, breaking ties by text order; preserve product order, merge given names unchanged, cap at 300 products by default, honor a smaller limit, and mutate no inputs.
2. In `quality/trial.ts`, pass optional style through `trialJob` and `runTrial`; accept only `--house-style tuning-accepted`, always sourcing examples from tuning, including for blind runs. Record `houseStyle: 'tuning-accepted'` or `null`. Reuse parsing, batching, both passes and the strict CLI. Keep omitted-option behavior empty and reject invalid options before requests/output.
3. Update `README.md`, root `docs/backlog.md` and `docs/backlog/translation.md` to describe only completed offline preparation. Remove only that finished open scope; retain Task 22, Task 23 measurements/vocabulary grading, Task 24 and every owner/commercial/production gate.

**Behavioral ownership and red/green.** Add focused synthetic cases in `quality/trial.test.ts` for the selection exclusions above, most-runs/text tie-break, order, limit and no mutation, plus optional style reaching `trialJob`. Extend its native child-process CLI coverage with one styled fake-provider run: inspect exact first-pass examples, require both passes, and verify recorded metadata. Review retains its existing input contract (`src/prompt.ts:77–85`); no review-prompt change. Extend existing default/invalid-option checks only for null metadata and the new option. Reuse `test/fake-openai.ts` unchanged. Retain every existing assertion and guard.

After clearance, follow the TDD skill. Write these tests first, run this explicit list and observe the expected missing-export/option failure; implement minimally, then rerun the identical command green:

```sh
cd /Users/clintongormley/workspace/worktrees/cloud-feat-translation-house-style-preparation && pwd && node --test packages/translation/quality/trial.test.ts
```

Then rerun unchanged scorer, archive, outbound and trial gates; inspect counts:

```sh
cd /Users/clintongormley/workspace/worktrees/cloud-feat-translation-house-style-preparation && pwd && node --test packages/translation/quality/scorer.test.ts packages/translation/quality/scorer-cli.test.ts packages/translation/quality/offline-boundaries.test.ts packages/translation/quality/trial.test.ts packages/translation/test/outbound-disabled.test.ts
```

**Limits.** No prompt/model/batching/runtime, key, activation or gating changes; translation stays off. No real measurements, grades, Task 24 source access/dataset/scaffolding, permanent mutation tests or framework. Expected changed lines: production/harness 60 (runtime zero), tests 100, test-support zero, docs 90 including this plan; total 250. Stop above 375 lines (1.5×), or for additional scope/support, and return to Claude/watcher before proceeding.
