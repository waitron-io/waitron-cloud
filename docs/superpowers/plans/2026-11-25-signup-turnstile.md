# Turnstile for sign-up and password reset

“Use Cloudflare Turnstile instead” (owner, 25 November picker, Lane J questions). From current `main`, replace only [step 4](2026-11-24-signup-abuse.md). Protect `POST /api/account/signup/request` and `POST /api/account/password-reset/request`, including resends. No other anonymous route sends comparable links. Exclude completions, login codes, signed-in email changes, owner transfers, token-based owner recovery, the local puzzle and shared gateway.

**Browser.** Port #1403’s red-bar refusals and assertions, retaining #1401’s wording. In `apps/portal/src/{app,api,screens,locale}.ts` and `styles.css`, preserve forms, cooldowns and generic acknowledgements. Load the official script and explicitly render Managed Turnstile only on the two request forms and their resend views. Fit narrow screens and localize status and any checkbox in English/Spanish. Keep the widget stable across rerenders, ignore stale callbacks, reset on expiry and every API attempt, and remove on navigation. [Widget mode] [Explicit render] [Script]

**Configuration.** In `packages/account-http/src/{config,server,portal}.ts`, require `CLOUD_TURNSTILE_SITE_KEY` and `CLOUD_TURNSTILE_SECRET_KEY` together or neither. Without keys, keep the rate-limited local flow. Prepare the shared document with a validated public-key meta tag so client-side navigation works. On enabled documents add the provider origin only to `script-src` and `frame-src`, retaining `no-referrer` and other policies. Inject test fakes without bypass credentials. [Content security policy]

**Server.** In `account-http/src/app.ts` and new `turnstile.ts`, accept `turnstileToken` on those requests. Verify after the origin check and existing connection limits, including IPv6 /64 grouping, before account lookup or queueing. POST only `secret` and `response` to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. Reject missing, invalid, expired, reused or oversized tokens (2,048 characters maximum, 300-second lifetime). Match action (`signup` or `password_reset`) and configured portal hostname. Cap the call at two seconds and refuse redirects. Network errors, HTTP failures and malformed replies get generic localized red-bar retry copy and queue nothing. Cloudflare can accept replays even in sequence. After success, claim the SHA-256 digest (subject limit 1,024 characters) once per 300 seconds in one `AccountRateLimiter` scope across both forms. [Siteverify]

**Proof.** Start with failing `account-http/test/{abuse-boundaries,portal}.test.ts` cases for refusals, outages, quotas and headers. With PostgreSQL, send parallel requests for different addresses. Fake Siteverify accepts the same token twice. Expect one admission and queue entry. Adapt #1403’s `email-browser-check.test.ts` and run it with `signup-reset-acknowledgement-browser.test.ts` and `journey.test.ts` with Playwright fakes and Mailpit. Check refusal focus, retained email, fresh resends and navigation. Send the owner pictures of both forms in all eight English/Spanish, light/dark, 390/1280 combinations before landing. Estimate 270 production and 260 test lines. Claude reviews the plan and the watcher clears it before building. Close #1403 as superseded after opening its replacement PR. Update [backlog](../../backlog.md) and [API guide].

**Notice and launch.** EN “Cloudflare checks your browser to prevent abuse.” ES “Cloudflare comprueba tu navegador para evitar abusos.” Link to the privacy addendum and update the draft [register] and [annex]. Cloud controls account abuse checks. Cloudflare is processor for the service and controller for improving bot detection. It uses browser IP, TLS fingerprint, user agent, sitekey and origin. Form values stay with Cloud. Pre-clearance off means no Turnstile `cf_clearance` cookie. Review terms, locations and consent/cookie evidence before enablement. [Privacy] [Clearance]

Free suffices with “Up to 20 widgets”, “Unlimited challenges (traffic or verification requests)” and 10 hostnames per widget. Enterprise lists “Contact Sales”. After approval, the owner selects Add widget under Turnstile in Dashboard. Name it, select Rest of World, enter exact portal hostnames, choose Managed, leave pre-clearance off and create. Store the private key in deployment secrets and configure the public key. Public launch awaits key and supplier approval. This change qualifies the integration locally. [Plans] [Dashboard]

[Widget mode]: https://developers.cloudflare.com/turnstile/
[Explicit render]: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/
[Script]: https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
[Siteverify]: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/#token-reuse-and-network-convergence
[Content security policy]: https://developers.cloudflare.com/turnstile/reference/content-security-policy/
[API guide]: ../../../packages/account-http/README.md
[register]: ../../cloud-data-processing-register.md
[annex]: ../../cloud-processing-annexes.md
[Privacy]: https://www.cloudflare.com/turnstile-privacy-policy/
[Clearance]: https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/
[Plans]: https://developers.cloudflare.com/turnstile/plans/
[Dashboard]: https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/
