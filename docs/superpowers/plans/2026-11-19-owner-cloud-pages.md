# Split the Cloud account into four pages

After sign-in, you can reach the existing controls from a navigation bar. Each page has its own address.

| Page | Controls and data it loads |
| --- | --- |
| `/account` | Sessions, credentials, passkeys, authenticator, ownership transfer and password reset. Read security, verification methods and transfer state. Keep email-change links here. |
| `/account/venues` | Organisation choice, venue and service status, usage, alerts, monitoring, backups, diagnostics, translation consent and stopping access. Read installations, selected organisation usage, alert preferences and consent. |
| `/account/remote-access` | Organisation and venue choice, remote status, addresses, custom domains and guest-menu controls. Read installations, verification methods and eligible billing venues so the trial link can appear. |
| `/account/billing` | Connected trial and prices, tax details and test payment methods. Read billing and verification methods. D604’s remaining billing actions will go here. |

## Build

- In `apps/portal/src/app.ts` and `screens.ts`, use one account-page lookup for rendering, heading, session checks and activity, expiry, submit refusal, redraw and page reads. Keep the existing controller lifetimes and stale-response protection. Show waits for the current page with each controller’s retry delay preserved. Retry an interrupted billing read.
- Use the existing link and heading-focus handling. Show a labelled, wrapping navigation list only after ordinary sign-in. Mark the current link with `aria-current="page"` and an underline. Add translated titles in `locale.ts` and style in `styles.css`. Under the existing billing flag, show Billing. Otherwise, opening its address takes you to Account. Keep sign-out, enrollment precedence and sign-in destinations.
- Reuse the venue list in `installation-screen.ts` and retain the remote panel’s current permission and revoked-venue checks. In `remote-screen.ts` and `billing-screen.ts`, reuse the identity-confirmation controls on the current page, link to Account for enrollment, and keep the trial link’s selected venue and focus on its Billing start button. Keep Account overview, emailed account links and the signed box destination at `/account`. Preserve existing token handling, pairing and recovery addresses.
- Add the three exact document paths in `packages/account-http/src/portal.ts`. In `billing-method-providers.ts`, return new Stripe test checkouts to Billing. Existing API, permissions and provider limits apply. Update that package’s README and coordinate the account portal entry in `docs/backlog.md` with Lane G.

## Verify

- Start with a failing `apps/portal/test/account-pages-browser.test.ts` for page contents, current link, direct loads, reload, history, session activity and expiry, sign-out and Billing visibility. Extend `accessibility.test.ts` and inspect all four pages in English and Spanish, light and dark, at 390 and 1280 pixels.
- Keep the assertions and deadlines in existing venue, remote and billing browser tests as their entry points move. Use `remote-refusal-guidance-browser.test.ts` for trial venue and focus, `remote-action-proof-browser.test.ts` and `billing-methods-browser.test.ts` for verification and return, and `required-enrollment-browser.test.ts` and `links.test.ts` for enrollment and existing email links. Update redacted navigation in `portal-trace.ts`.
- Move the browser entry points in `scripts/test-local-remote.mjs` and `scripts/test-waitron-translation.mjs` to Venues. In `packages/account-http/test/portal.test.ts` and `billing-method-client.test.ts`, cover document admission and both Stripe return URLs. Build and typecheck, run the focused tests and run both rehearsals on the approved test rig. CI runs the selected suites. Coordinate test-host rollout after landing.

Estimate +180–260/−60–110 production lines and +500–700/−200–300 test lines, including replacement of browser entry points across several dozen files.
