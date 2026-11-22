# Keep a box connection request on reload

Lane G item D254-RELOAD-KEEPS-REQUEST, assigned by the watcher on 22 November 2026 at 22:41. See R8 in [the Cloud backlog](../../backlog.md).

## Finish line

Reload the connection page or the sign-in page it opened, then continue the same request. Enter the eight-digit code shown on the box after a reload. Cloud checks the current account and business permissions, and you still approve in Cloud and confirm on the box.

## Change

- In `apps/portal/src/app.ts` and `links.ts`, reuse link parsing and request ID validation. Scrub the address with the existing callback, then merge the validated `pairingRequestId` into browser history state on the `/connect` entry. A fresh valid link wins. A malformed link clears that entry and shows the existing refusal. A clean address restores the ID of the selected entry. Browsers can save history state to disk, so store only the ID. Inspection needs the code and the server checks eligibility, expiry and approval. [HTML History API](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-history-interface)
- Carry the ID from `/connect` to `/login` on the signed-out redirect, session expiry, Sign out and the connection's sign-in link. Carry it back on the existing password, factor and passkey sign-in paths. Opening a fresh Account, signup, reset or standalone login entry ends the connection context. Today the in-memory ID can follow those page changes. Browser Back can return to a connection entry with its own ID.
- Reuse `PairingController` for the live journey, including the linked code's one automatic inspection on first sign-in. Keep linked and typed codes and form details in memory. Installed-box setup, recovery, account creation and the signed box exchange are outside this change.

## Verify

- In `apps/portal/test/pairing-browser.test.ts`, use the running portal. Replace the generic Sign out button wait after sign-out, reload and sign-in with the Connect heading and blank code field. In the linked-code journey, keep the one-click assertions. Reload and verify the active request is ready for code entry, with no repeat inspection or approval, then manually inspect the original request. Also reload its sign-in page and require manual code entry after sign-in. Reload a page opened with a malformed link and verify the missing-request message. Keep that same assertion on a fresh bare `/connect` entry in the signed-in browser. The stubbed R8 account-switch case continues to cover switching accounts without reload.
- Build with `pnpm --dir apps/portal build`. Run `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/pairing-browser.test.ts` on the shared test box. Observe the reload regression fail before the change and pass after it. Re-run the existing `links.test.ts`, `pairing-controller.test.ts`, `pairing-account-fencing.test.ts` and `pairing-no-business-browser.test.ts` with Node's test runner in the portal directory, then run `pnpm typecheck`.
- Update the D254/R8 text in `docs/backlog.md` and `docs/refusal-self-service-audit.md` and the connection journey in `docs/waitron-integration-contract.md`. Estimate 30–50 added production lines and 45–75 added test lines.
