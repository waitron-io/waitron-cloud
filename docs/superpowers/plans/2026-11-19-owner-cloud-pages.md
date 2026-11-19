# Split the Cloud account into four pages

When you sign in, you can open Account, Venues, Remote access or Billing from the same navigation bar. Each page has its own address and contains the controls you already use.

| Page | What moves there |
| --- | --- |
| `/account` | Sign-in and security settings, sessions, email and password changes, passkeys, authenticator, ownership transfer and password reset. Existing email-change links still work here. |
| `/account/venues` | Organisation choice, usage, venue and service status, alerts, monitoring, backups, diagnostics, translation consent and stopping access. |
| `/account/remote-access` | Organisation and venue choice, remote status and addresses, custom domains, and guest-menu controls. Retain the existing controls for revoked venues. |
| `/account/billing` | Connected trial and prices, tax details and test payment methods. This is where D604 will add its remaining billing actions. |

## Build

- Add four explicit page paths to the existing Lit routes in `apps/portal/src/app.ts` and `screens.ts`. Use the existing link and heading-focus handling. A labelled navigation list stays visible and wraps on small screens. The current link uses `aria-current="page"` and a visible underline. Give each page a translated heading and title in `locale.ts`, and style the bar in `styles.css`.
- Reuse session and controller setup for the three new account addresses. Keep sign-in destinations, enrollment precedence, session activity and expiry, cooldowns and stale response protection. Keep sign-out on every account page, and retry a billing read interrupted by navigation. Pairing and snapshot recovery keep their current addresses.
- Reuse the venue list and organisation choice in `installation-screen.ts`. Render the existing remote panel only on Remote access, with its current venue permission checks. Reuse the confirmation-of-identity controls in place on Remote access and Billing so verification leaves the pending action available. Link to Account for passkey or authenticator setup. Update `remote-screen.ts` and `billing-screen.ts` for those links and keep the existing test billing gate.
- Keep the remote trial link’s venue selection and focus the trial start button on Billing. Add the three exact addresses to `packages/account-http/src/portal.ts` under the existing document rules. Return new Stripe test checkouts to Billing in `billing-method-providers.ts`. The scope is navigation and page layout. The existing API, permissions, plans and test-provider limits apply.
- Update `packages/account-http/README.md` and the account portal entry in `docs/backlog.md`. Coordinate the backlog edit with Lane G before building.

## Verify

- Start with a failing `apps/portal/test/account-pages-browser.test.ts` for distinct contents, current link, direct loads, reload, history, keyboard focus, session expiry and sign-out. Extend the existing `accessibility.test.ts` coverage to all four pages. Inspect English and Spanish in light and dark at widths 390 and 1280.
- Reuse `remote-refusal-guidance-browser.test.ts` for the selected venue and focus on the trial link, `remote-action-proof-browser.test.ts` and `billing-methods-browser.test.ts` for confirmation and return flows, and `required-enrollment-browser.test.ts` and `links.test.ts` for existing sign-in restrictions and email links. Change existing browser setup to open the relevant page, preserving assertions and deadlines.
- In `packages/account-http/test/portal.test.ts`, cover direct GET and HEAD plus invalid paths. In `billing-method-client.test.ts`, check Stripe’s two return URLs. Build, typecheck and run the focused files on the local test stack. CI runs the full selected suites. Test Cloud rollout follows the existing test-host process after landing.

Estimate 170–250 production lines added and 60–110 removed. Tests add 450–650 lines and remove 180–280, including browser navigation setup moved to new routes.
