# Test-box translation implementation plan

Deliver D582-S step5 in one PR, up to the absent key. Read-only baseline: `d821c06cf`; no behavior verified here.

## Recorded authority

`/Users/clintongormley/waitron-campaign-shared/a951-simple-brief-20261106.md`, step5:

> **Translate all first, because it is mostly built.** Finish only what stops one real translation
> of the test box's menu with `CLOUD_TRANSLATION=1`, then show the owner the result. Keep the
> approved cap, consent and paging rules.

`/Users/clintongormley/waitron-campaign-d/questions.md`, WATCHER 2026-11-06 23:25:

> The owner will supply an OpenAI key tomorrow, which I take as yes to your narrow exception: the owner's test-box demo menu only, the unconditional production refusal stays, plus existing consent, cap and paging.

> Prepare step 5 up to the point of needing the key

> Do not touch the guard for anything but this test installation.

Same file, WATCHER 2026-11-07 06:45:

> Your next step stays step 5 up to the keys.

These verbatim approvals are embedded for restricted Claude review under the runbook exception; no reconfirmation. Obtain the required `claude-seat.sh review-branch` read before building.

## Implementation and proof

- [ ] TDD: add `packages/translation/test/test-box-worker.test.ts`; observe expected failures, then implement minimally. Use real disposable PostgreSQL, synthetic signed jobs and fake provider only. Intercept fixed-HTTPS fetches and forward to loopback; assert destination, wire body, refusal and request counts. Exercise the actual launcher too, without real keys.
- [ ] In `packages/translation/src/openai-client.ts`, add `createTestBoxTranslationWorker(pool,{installationId,venueId,apiKey}):TranslationWorker`, consumed by new `src/test-box-worker-cli.ts`. Keep transport private, fixed to `https://api.openai.com/v1`; reuse `localTransport`, parser and limits. Leave both existing client factories unchanged. No generic real-client export, endpoint override or default/production enable flag.
- [ ] Add optional fixed installation/venue scope in `src/worker.ts`. Filter queued and expired-lease selection; leave other jobs untouched. Immediately before every first/review/retry provider call, recheck job binding, current unrevoked installation, matching venue, test environment, live lease and consent. Compose with existing permission checks; retain prices, accounting, cap, batching and paging. No location scope or billing prerequisite added.
- [ ] Prove same-venue other-installation refusal, wrong venue, revocation, production transition and consent withdrawal during waits; retain paid results/cost without further calls. Prove cap stops requests and signed collection walks every page before release. Keep existing assertions intact; tests roughly twice added source or less. Disposable omission checks only, no permanent mutation harness.

Run focused proof and unchanged worker/outbound checks:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test test/test-box-worker.test.ts test/worker.test.ts test/outbound-disabled.test.ts
pnpm typecheck
```

Document the separately injected, one-pass launcher in package README:

```sh
node --env-file=/root/waitron-translation/openai.env packages/translation/src/test-box-worker-cli.ts INSTALLATION_UUID VENUE_UUID --once
```

Require server-only `DATABASE_URL`; key file root-owned 600, parent directory root-owned 700. Do not run this command now. Update only the existing `docs/backlog.md` translation entry with synthetic proof, approval and remaining live/production limits. No provider call, compatibility claim, dependency, table, job, accounting system, protocol, manifest, ledger or broad refactor. Key supply and live result remain pending; unresolved design choices: none.
