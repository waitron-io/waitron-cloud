# Recovery proof status read

**Finish line:** One click on **Add a passkey** starts enrolment once the pending proof-status read arrives and confirms fresh proof, without another click or duplicate status request.

**Request, verbatim:** Watcher, `~/waitron-campaign-k/questions.md:362`, 18 November 01:12:

> Owner-recovery browser wait, second time: you take the root-cause fix (lane G owns D608 but is busy on CLOUD-BACKUP-STREAM). Diagnose in a disposable scratch checkout while the expiry-alert review finishes; bring the proved cause and the smallest fix, then a normal reviewed PR. Tell lane G what you find. No retries as a fix.

**Evidence:** Lane K's 01:15 probe reports the unchanged Linux journey fails at line 37/6000 ms when only `GET /api/account/action-proof` waits 1000 ms: proof GETs return 200; registration-options requests are zero. The unheld baseline passed options 200, verification 201, session 200. `account-action-proof-controller.ts:13` returns while pending; `ensure()` returns false; `app.ts:461` discards the click. This proves a mechanism, not the untraced historical cause of merge `1bd1e3906`'s red CI run `44204279476`. Lane G was told at 01:15; the watcher cleared the route at 01:16.

1. **Show RED before changing production code.** In `apps/portal/test/account-action-proof-controller.test.ts`, add `ensure waits for the initial status read without another request`. Defer the initial `load()` response, call `ensure()`, and assert it stays unsettled with one request; release fresh server status and assert true. In `apps/portal/test/owner-recovery-browser.test.ts`, delay only the recovery enrolment status GET by 1000 ms, ensuring the single enabled click occurs while that read is pending. Keep the real server and virtual authenticator. Show the first journey fails before the fix; retain its 6000 ms deadline and every authentication, recovery-authority and business-confinement assertion.

2. **Make the same cases GREEN.** Change only `apps/portal/src/account-action-proof-controller.ts` in production. Keep the simple controller and reuse `apps/portal/src/session.ts`'s shared-promise convention: `load()` waits for the current status read. Clear its reference when the account is fenced; an old completion must neither publish state nor clear a newer read. Preserve generation checks, server-reported freshness, pending verification/email refusal, errors and retry delays. No new API, record, gate, timer, timeout increase, automatic retry or framework.

3. **Verify each behaviour.** The controller case owns waiting/request count; existing cases retain account-change, refusal and retry checks unchanged. The browser journey owns real enrolment and confinement. Run the named files for RED and GREEN; read test counts. Database/browser commands go through `~/waitron-campaign-shared/test-box-run.sh K <checkout> <command…>`, with the authorised Mac wrapper only after exit75:

   ```sh
   node --test apps/portal/test/account-action-proof-controller.test.ts
   pnpm --dir apps/portal build
   node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 test/owner-recovery-browser.test.ts
   ```

   No mock-only, source-text or implementation-mirroring tests. No broad local package suite; CI owns package suites and workspace typechecking.

4. **Record and finish later.** Update `docs/backlog/portal-panel-waits.md` and `docs/backlog.md` with commands/results and historical uncertainty. Expect production +12/−3 lines, tests +35, docs 5–10. Count growth; at 1.5 times the estimate stop for watcher opinion, not a hard ceiling. Claude reviews this plan before build; watcher clears it without owner design approval. The separate whole-branch review through `finish-branch`, one PR after the expiry-alert slice and current-head CI follow later.
