# Keep a box connection request on reload

Lane G item D254-RELOAD-KEEPS-REQUEST, assigned by the watcher on 22 November 2026 at 22:41. See R8 in [the Cloud backlog](../../backlog.md).
Claude reviewed the plan. The watcher cleared the revised approach at 22:55 in Lane G's questions.

## Finish line

Reload the connection page or the sign-in page it opened, then continue the same request. Enter the eight-digit code shown on the box after a reload. Cloud checks the current account and business permissions, and you still approve in Cloud and confirm on the box.

## Change

- In `apps/portal/src/app.ts` and `links.ts`, keep the existing link parsing and address scrub. Whenever Cloud opens `/connect` or `/login` with a connection request in memory, merge its `pairingRequestId` into that page's history entry. A fresh valid link takes precedence. A malformed link clears the stored ID and shows the existing refusal. If there is no request in memory, restore a valid ID from the entry, using the same validation as the link. Browsers can save history state to disk, so store only the ID. Inspection needs the code and the server checks eligibility, expiry and approval. [HTML History API](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-history-interface)
- Reuse `PairingController` for the live journey, including the linked code's one automatic inspection on first sign-in. Keep linked and typed codes and form details in memory. Installed-box setup, recovery, account creation and the signed box exchange are outside this change.

## Verify

- In `apps/portal/test/pairing-browser.test.ts`, use the running portal. Replace the generic Sign out button wait after sign-out, reload and sign-in with the Connect heading and blank code field. In the linked-code journey, keep the one-click assertions. Reload and verify the active request is ready for code entry, with no repeat inspection or approval, then manually inspect the original request. Also reload the sign-in page from a code-bearing link and require manual code entry after sign-in. Put a malformed link on an entry with an existing request and verify the missing-request message survives reload. Keep that same assertion on a fresh bare `/connect` entry in the signed-in browser. The stubbed R8 account-switch case continues to cover switching accounts without reload. In `links.test.ts`, verify that the parser ignores a malformed ID from history.
- Build with `pnpm --dir apps/portal build`. Run `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/pairing-browser.test.ts` on the shared test box. Observe the reload regression fail before the change and pass after it. Re-run the existing `links.test.ts`, `pairing-controller.test.ts`, `pairing-account-fencing.test.ts` and `pairing-no-business-browser.test.ts` with Node's test runner in the portal directory, then run `pnpm typecheck`.
- Update the D254/R8 text in `docs/backlog.md` and `docs/refusal-self-service-audit.md` and the connection journey in `docs/waitron-integration-contract.md`. Estimate 20–30 added production lines and 35–55 added test lines.
