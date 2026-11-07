# Test-box translation implementation plan

Prepare one test-box menu translation; provider activation waits for its key.

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

The campaign instructions permit these embedded approval quotes. The required Claude reads accepted the direction; the 7 November 07:02 decision approves the smaller implementation. The whole-branch review owns execution evidence.

## Build after review

- [x] Files: `packages/translation/src/openai-client.ts`, `packages/translation/src/worker.ts`, new `packages/translation/src/test-box-worker-cli.ts`, new `packages/translation/test/test-box-worker.test.ts`, `packages/translation/README.md`, `docs/backlog.md`, `docs/test-cloud.md` (brief trial/default distinction). No `package.json` change.
- [x] TDD: expected failure first, then `createTestBoxTranslationWorker(pool,{installationId,venueId,apiKey}):TranslationWorker` with private transport fixed to `https://api.openai.com/v1`. Ordinary clients/default deployments stay unchanged; no service/container/default flag. Existing-mode trial only: CLI explicitly rejects non-existing plan modes/allowance settings, never silently omits spend. No global sweep. Report the selected job state or an idle pass; errors stay fixed and redacted.
- [x] Scope BOTH queued/expired-lease arms. Use the existing permission hook before EACH provider attempt (first/review/retry), recheck installation/venue binding, revocation, test environment, lease and consent; retain old hook semantics, accounting and paid results/cost.
- [x] Disposable PostgreSQL, synthetic signed jobs, direct fake fetch; no loopback forwarder. Test cross-installation/venue isolation and mid-wait revocation/environment/consent changes. Launcher tests cover refusal/empty queue only. Reuse cap/paging assertions. Run focused new/outbound, worker, venue-service, allowance and retention tests through `scripts/test-postgres.mjs`; `pnpm typecheck`. CI owns full package suites; no whole-package local finishing requirement.

## Operator handoff after key

Driver runtime readback (`docker inspect`/`docker exec`): rented-server `d582-account` runs `[node,src/server-cli.ts]`, cwd `/app`; `/app/workspace/translation/src/worker.ts` exists; `DATABASE_URL` inherited; `CLOUD_TRANSLATION`/both plan flags unset. Actual server honours `CLOUD_TRANSLATION`. This approved separately injected source-mounted trial is not `deploy/test-cloud`.

Defer enablement until key/consent ready: existing process gets `CLOUD_TRANSLATION=1` through its private launcher, preserving fixed-box tunnel options; restart only `d582-account`. After reviewed source refresh:

```sh
docker exec -i d582-account env -u CLOUD_OPENAI_API_KEY node --env-file=/dev/stdin /app/workspace/translation/src/test-box-worker-cli.ts INSTALLATION_UUID VENUE_UUID --once < /root/waitron-translation/openai.env
```

Operator checks keyfile root-owned 600/directory 700; Node loads envfile before CLI; clear the inherited key in that subprocess. Real key never enters arguments/logs/source/parent service. Account `DATABASE_URL` stays inherited. Other signed jobs may queue; scoped worker never leases them. Stop: remove keyfile; do not rerun one-pass.

Post-key Waitron handoff: existing reviewed Waitron Translate-all caller, current account owner's existing consent, synthetic menu; collect all pages, then release/show owner. Fake tests establish no new joint proof; real API compatibility/live result remains unqualified. Trial scope disappears when public privacy/service work replaces it.
