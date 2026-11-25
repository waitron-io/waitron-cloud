# Turnstile for sign-up and password reset

“Use Cloudflare Turnstile instead” (owner, 25 November picker, Lane J questions). The watcher assigned both forms. Replace [step 4] for `POST /api/account/{signup,password-reset}/request`, including resends. These are the two comparable anonymous mail requests. Completion, signed-in email changes, login codes and recovery with an existing link keep their flows.

**Portal.** In `apps/portal/src/{app,api,screens,locale}.ts` and `styles.css`, keep #1401’s messages and #1403’s red-bar treatment. Managed Turnstile shows progress and may ask for a checkbox. Load only on request forms after link scrubbing and when the resend wait ends. Use EN/ES and automatic theme. Reset after expiry or submission and recreate on language change. On a blocked or timed-out script or widget error, retain the email and show a local retry message. Submit only with a token. [Widget mode], [Explicit render]

**Configuration.** The account CLI reads `CLOUD_TURNSTILE_SITE_KEY` and `CLOUD_TURNSTILE_SECRET_KEY` through `config.ts`. Reject half-configured startup. With neither, rehearsals retain existing limits. Log that state once in production mode. In `server.ts` and `portal.ts`, expose only the public key and add `https://challenges.cloudflare.com` to `script-src` and `frame-src` on `/signup` and `/forgot-password` documents, preserving both policy variants and `no-referrer`. Use full page navigation across this boundary when configured and carry the pairing and recovery IDs and language in tab storage for the next page only. Completion links never load the script. The local and test launchers pass both keys to the account role. No deployment uses it until configured. Reload can reset the displayed timer, and the server still enforces the wait. [Content security policy]

**Server.** In `packages/account-http/src/{app,turnstile}.ts`, check origin, existing IP limit and `turnstileToken` shape (2,048 characters maximum). Allow 20 verification attempts per connection per 15 minutes with IPv6 /64 grouping, and four simultaneous checks per process. POST only secret and token to Siteverify. Bound the response to 16 KiB and two seconds. Refuse redirects. Require success, configured hostname and form action (`signup` or `password_reset`). Cloudflare can accept closely spaced replays. Claim the SHA-256 digest for 300 seconds via `AccountRateLimiter` across both forms before the existing form quota or mail lookup. Log an invalid provider secret without credentials or form data. Refusals and outages show a generic retry error without a form cooldown. If Cloudflare is down or blocked, both protected mail requests stop. [Siteverify]

**Proof.** Start with failing `packages/account-http/test/{abuse-boundaries,portal,server}.test.ts` cases for refusals, headers, configuration and outages. Check sign-in capacity and unspent form quotas. With PostgreSQL and permissive fake Siteverify, prove one queue entry on parallel replay. Adapt #1403’s `apps/portal/test/email-browser-check.test.ts` and run `journey.test.ts` with local widget fakes and Mailpit. Show both forms in EN/ES, light/dark, 390/1280 before landing. Estimate 310 production and 310 test lines. Update the [backlog] and [API guide]. Close #1403 when its replacement PR opens.

**Notice and launch.** Show “Cloudflare checks your browser to prevent abuse” and “Cloudflare comprueba tu navegador para evitar abusos”. Link its addendum and update the account-authentication [register] and [annex]. Cloudflare receives browser IP, TLS fingerprint, user agent, sitekey and origin. It is a processor for providing the check and a controller for improving detection. Siteverify receives no form fields. Leave pre-clearance off so Turnstile does not set `cf_clearance`. Review other cookie behaviour and supplier evidence before live validation or enablement. The live widget is unverified with the portal’s policy and no-referrer setting. [Privacy], [Clearance]

Free offers “Up to 20 widgets”, “Unlimited challenges (traffic or verification requests)” and 10 hostnames per widget. Enterprise lists “Contact Sales”. After approval the owner selects Turnstile, then Add widget in Cloudflare Dashboard. Name the widget Waitron Cloud and choose Rest of World, the exact portal hostnames and Managed mode. Leave pre-clearance off. Choose Create and copy both keys. Set the public key and put the secret in the account service’s deployment secrets. Keep the secret out of chat and pull requests. Public enablement needs outbound HTTPS to Siteverify. [Plans], [Dashboard]

[step 4]: 2026-11-24-signup-abuse.md
[Widget mode]: https://developers.cloudflare.com/turnstile/
[Explicit render]: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/
[Siteverify]: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
[Content security policy]: https://developers.cloudflare.com/turnstile/reference/content-security-policy/
[backlog]: ../../backlog.md
[API guide]: ../../../packages/account-http/README.md
[register]: ../../cloud-data-processing-register.md
[annex]: ../../cloud-processing-annexes.md
[Privacy]: https://www.cloudflare.com/turnstile-privacy-policy/
[Clearance]: https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/
[Plans]: https://developers.cloudflare.com/turnstile/plans/
[Dashboard]: https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/
