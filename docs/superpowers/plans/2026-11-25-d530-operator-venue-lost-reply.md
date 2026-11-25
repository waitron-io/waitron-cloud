# Keep the operator venue lost-reply check working

The browser check must show a saved stop after losing the successful reply. In [the failed main CI job](https://github.com/waitron-io/waitron-cloud/actions/runs/45659730755/job/139366227504), the old Stop button stayed visible. A Linux reproduction on `d1088a43c` with the same one-shot route and passive tracing showed the stop commit and Chromium dispatch the verification read. The server received no read before the existing five-second assertion timed out. The reproduction localises the stall. The exact order inside Chromium is still unknown.

## Change

In `apps/portal/test/cloud-actions-journey.test.ts`, keep the route that drops the successful stop reply installed until the existing assertion sees the Allow button. Then unregister it before the browser reloads and sends the next write. Reuse the ordering in `apps/portal/test/remote-browser.test.ts`, which keeps interception active through its follow-up read. Keep the original failed-request wait, success status check, five-second UI assertion and saved audit history check. The production controller and endpoints stay as they are.

Add the new evidence to `docs/backlog/portal-lost-reply-ordering.md` and update the existing entry in `docs/backlog.md`. The separate historical failures stay open. The controlled protocol tracing and alternate fault injections belong in the investigation receipts.

## Checks

- Use the unchanged Playwright assertion as the regression check. The Linux trace with the original route already observed it fail after a committed write and browser dispatch. On the test box, compare the original and retained routes with the same passive Chromium tracing and original assertion. Record the counts and where the verification read stops or completes.
- Build with `pnpm --dir apps/portal build`. Through `scripts/test-postgres.mjs exec`, run `pnpm --dir apps/portal exec node --test --test-name-pattern='operator venue journey' test/cloud-actions-journey.test.ts` for both normal CI languages. The same file checks that the browser loses the reply, shows the saved stop and records the stop and allow in audit history. Treat any retained-route timeout as evidence to investigate.

Expected size is zero production lines, around five test lines and ten to fifteen lines for the backlog record, plus this plan.
