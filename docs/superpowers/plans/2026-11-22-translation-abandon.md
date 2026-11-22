# Let a box abandon a Cloud translation job

A box can free the venue’s job slot with its original submit ID, even after losing the reply. The watcher assigned the Cloud action on 22 November at 03:47 and said “Move to TRANSLATION-ABANDON (plan first)” at 05:44 in Lane G’s questions. Waitron’s plan at `13d655dda2` records the lost-reply case. Box integration follows in Waitron. Translation stays off.

**Signing.** Waitron lane B publishes the shared action. A synthetic proof was refused by Cloud’s installed `@waitron-io/contract@0.2.42`. Follow [signing package adoption](../../shared-ui-release.md#prepare-private-signing-packages-for-disposable-tests). Extend `scripts/disposable-tests/{private-packages.py,dependencies.test.mjs}` and `deploy/disposable-tests/{session.py,guest-tools.test.py}`. Qualify the matched disposable recipe before changing `packages/registration/package.json` and `pnpm-lock.yaml`.

**Request.** Register `POST /api/installations/translation-abandon` in `packages/account-http/src/translation.ts` and dispatch in `packages/translation/src/machine.ts`. Reuse signed proof, lease, limits and the off switch. Sign the original submit ID as `operationId` with the exact body `{"version":1}`. Return `200 {"version":1}` for a match, a repeat or an absence. With translation off, POST returns 503. Release still confirms durable collection.

**Store.** In `packages/translation/src/job-store.ts`, lock an existing row by installation and operation ID. A miss writes nothing to the job or allowance tables. A submit still in progress may create the job later. A box getting a busy response can repeat abandon for the same original operation ID. Use the same expiry helper as the sweep in `packages/translation/src/retention.ts` to release untouched allowance, delete the body and results, set `expired`, and clear the lease deadline. Abandon keeps the lease ID of a running job so a reply can still be counted. The sweep clears lease IDs. Keep the fingerprint and job ID for submit replay. A collected or expired row succeeds as is. Preserve allowance that was already spent or whose job was already leased.

**Worker.** In `packages/translation/src/worker.ts`, check the same lease ID and running state inside the cap check for plain `existing` mode only. In `spent`, match the job and lease ID so a reply that comes back after abandon still counts against the monthly cap. Reuse the current shared cancellation for everything else. Completed-job reporting still covers only jobs that finished.

**Prove it first in PostgreSQL.** Run each new case before feature code, then pass it with the same command through `node scripts/test-postgres.mjs exec pnpm exec node --test` and explicit files.

- `packages/translation/test/machine.test.ts` covers absence, installation scope, queued removal, retry and submit replay. `packages/account-http/test/translation.test.ts` covers the signed reply, malformed body and disabled route. Add the action to `packages/registration/test/installation-proof.test.ts`.
- `packages/translation/test/worker.test.ts` pauses a fake provider call in plain `existing` mode and abandons the job. Let the call return and run the worker to completion. Check that its cost was recorded, that no further provider call ran and that no results were saved.
- Rerun translation `test/{retention,worker-retention-admission,worker-cancellation-shutdown,batch-runner-cancelled-callback-failures,batch-runner-callback-ordering}.test.ts` and `pnpm typecheck`. Prove the admission and scope assertions catch a removed guard in a disposable copy.

In `docs/waitron-integration-contract.md`, add the signed body, original operation ID and success reply to the action rules at line 1331. Add abandonment to the `expired` definition at line 1358. Update `docs/backlog.md`.

The watcher cleared this scope at 06:30 on 22 November in Lane G’s questions. Start the build when Lane B posts the published signing version. Estimate 65–120 production and configuration lines and 85–150 test lines, including signing adoption.
