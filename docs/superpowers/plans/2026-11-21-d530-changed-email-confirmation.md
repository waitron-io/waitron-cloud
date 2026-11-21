# Keep email confirmation available when the session list is ready

An owner opening the verification link in the tab already showing their account can confirm the new address with one click. A successful confirmation signs them out so they can sign in with the new address.

Lane G's watcher assigned the work in its local questions file on 21 November at 12:36: “Do a focused reproduction that captures the confirmation response and the next session read, keeping the original checks and deadline; then find the cause and fix it at the root.” The owner's paid run 9 result takes priority when the watcher reports it.

On Linux, the probe released the session read started by opening the link after pointer-down. The ensuing session-list request disabled the button before pointer-up. The browser sent no confirmation and still showed the account after five seconds. The two historical CI logs lack the timing needed to establish their request order.

- In `apps/portal/test/account-security-browser.test.ts`, hold the first session read after opening the same-tab link in one desktop journey. Check the button is disabled both before that read returns and while the list is pending. Release both requests in cleanup. Keep the original click, five-second sign-in wait, and new-address sign-in in all eight combinations. Watch the new check fail before changing the button.
- In `apps/portal/src/account-security-screen.ts`, add `!app.security.loadAttempted` to the existing disabled condition. Reuse the existing session-list state. The watcher cleared this scope at 12:55 on 21 November. It covers email confirmation only. Record the unlikely overlap with a carried-over retry delay in the pull request thread.
- Use the existing failure trace for the confirmation journey and add the static confirmation and session-list paths to `apps/portal/test/portal-trace.ts`. Exercise both paths in `apps/portal/test/portal-panel-evidence.test.ts`.
- Run `pnpm portal:build`, the named browser file through `node scripts/test-postgres.mjs exec node --test --test-timeout=120000 apps/portal/test/account-security-browser.test.ts`, the named evidence test, and `pnpm typecheck`.
- Correct the changed-email explanation in `docs/backlog/portal-panel-waits.md` and `docs/backlog.md` with the reproduction and the limits of the historical CI evidence. Record that sign-out and session-revoke buttons share the window before the session check and stay outside this change. After landing, start `gh workflow run nightly.yml --ref main` and read the result for the dispatched commit.

Expect about 1–3 production lines and 35–55 test and trace lines.
