# Offline translation house-style preparation

The watcher queued TRANSLATE-REMAINING on 15 November at 23:23 in `~/waitron-campaign-g/queue.md`: build remaining translation parts that need no owner trial, provider key or production decision. Separate Sol/high drafted this plan; Claude reviewed it at `~/waitron-campaign-g/receipts/translation-remaining/plan-review.md`. The watcher cleared this scope at 23:33 on 15 November in that lane’s `questions.md`. No owner approval of this plan is claimed.

**Finish line.** Implement only [Task 23](2026-10-14-translate-all.md#task-23-owner-involved-needs-the-real-key-measure-the-house-style-examples) steps 1–2. You can rehearse the blind-set comparison with accepted tuning examples through the existing loopback-only trial. This measures no translation quality. Task 22 and Task 23 measurements/grading remain owner-only. Task 24 needs its private catalogue and a destination compatible with the public repository's no-real-data rule; build no empty set scaffolding.

**Reuse and files.** In `packages/translation/quality/scorer.ts`, expose the existing shown-entry shape as `ShownName` and `shownEntries`. In `quality/trial.ts` (under that same package), add `acceptedHouseStyle(set,shown,limit=300)`: exclude marked names, correction-language entries, unknown products and languages already given by the venue. Choose the most-run text for each product/language; ties use plain `<`. Keep product order, preserve given names, emit product examples, cap at 300, honor a smaller limit and mutate no input. Pass optional style through `trialJob` and `runTrial`; add `--house-style tuning-accepted`, sourcing tuning examples for **blind runs only**. Refuse tuning plus house style and invalid option values before requests/output. Record the chosen style or `null` in trial results. Reuse parser, batches, fake provider and both passes; only the existing first-pass input carries examples.

**Tests first.** In `packages/translation/quality/trial.test.ts`, add a small synthetic selector case with literal expected examples for exclusions, run-count/tie choice, order, cap and input preservation. Extend existing CLI coverage with one styled loopback run: compare emitted examples with the independently unit-tested selector over current tuning files, require both passes and recorded metadata. Extend existing default/invalid cases for empty style/null metadata and the named refusals. Keep every existing assertion. Reuse `test/fake-openai.ts` unchanged.

Observe the new tests fail before implementation, then pass with the minimal change:

```sh
node --test packages/translation/quality/trial.test.ts
```

Then run that file plus `quality/scorer.test.ts`, `quality/scorer-cli.test.ts`, `quality/offline-boundaries.test.ts` and `test/outbound-disabled.test.ts`, all explicitly named under `packages/translation/`. CI owns package suites and workspace types. Do one-time guard removals in a disposable candidate, retaining no mutation tests.

**Docs and limits.** Add the flag explanation to `packages/translation/README.md` and one offline-scope sentence to `docs/backlog/translation.md`; trim completed status text from `docs/backlog.md`, keeping every remaining gate. No prompt/model/batching/runtime, key, activation or gating changes; translation stays off. Expected added/removed lines combined: harness 35, tests 60, test support 0, docs 40 including this plan; total 135, watcher size stop above 202. No framework, private catalogue access or provider calls.
