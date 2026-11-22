# Keep a box connection request on reload

Lane G item D254-RELOAD-KEEPS-REQUEST, assigned by the watcher on 22 November 2026 at 22:41. See R8 in [the Cloud backlog](../../backlog.md).

## Finish line

Reload the connection page or the sign-in page it opened, then continue the same request. Enter the eight-digit code shown on the box after a reload. Cloud checks the current account and business permissions, and you still approve in Cloud and confirm on the box.

## Change

- In `apps/portal/src/app.ts` and `links.ts`, reuse the link parser and its request ID validation. Keep only the request ID in browser history state on the scrubbed `/connect` entry. A new valid link takes precedence. A malformed link shows the existing refusal and clears the request for that entry. Restore a valid ID from the selected entry when the address carries no link data.
- Carry the ID only to the `/login` entry opened from that connection and then to the existing sign-in return to `/connect`. Read the marker on reload or Back/Forward and clear the controller on unrelated entries. In a live journey, `PairingController` keeps the linked code through first sign-in and checks it once. The portal keeps the code and the current form details in memory. The existing server check decides when the request expires. [HTML History API](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-history-interface)
- The change is limited to Cloud's connection and its own sign-in pages. Recovery, installed-box setup, account creation and password reset have separate entry points. The server and signed box exchange own eligibility, expiry and approval.

## Verify

- In `apps/portal/test/pairing-browser.test.ts`, start with the real portal fixture. Reload the sign-in page opened by the connection and verify that signing in returns to that request. After reloading `/connect`, check for a blank code and require manual inspection of the same request. Keep the one-click check and verify a reload repeats neither inspection nor approval. Verify a new valid link takes precedence and a malformed link cannot revive the old one. Keep the missing-request assertion on a fresh bare `/connect` entry in the same signed-in browser. The earlier test inferred loss from login reload before making that visit.
- Build with `pnpm --dir apps/portal build`. Run `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/pairing-browser.test.ts` on the shared test box. Observe the reload regression fail before the change and pass after it. Re-run the existing `links.test.ts`, `pairing-controller.test.ts`, `pairing-account-fencing.test.ts` and `pairing-no-business-browser.test.ts` with Node's test runner in the portal directory, then run `pnpm typecheck`.
- Update the D254/R8 text in `docs/backlog.md` and `docs/refusal-self-service-audit.md`, the instructions in `docs/local-pairing.md` and the connection journey in `docs/waitron-integration-contract.md`. Estimate 30–50 added production lines and 40–70 added test lines.
