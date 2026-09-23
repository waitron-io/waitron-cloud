# Cloud account portal

Status: approved by the owner, 2026-09-23. English and Spanish, browser-language
selection and a language switch are agreed. The
[implementation plan](../plans/2026-09-23-account-portal.md) is ready for review.

## Outcome

You can create a Cloud account, sign in, sign out and recover a password without a
working venue server. The usual customer supplies one business name; the underlying
organisation and legal business remain separate records. Use the existing account
API and private `@waitron-io/ui-core@0.1.0` controls.

This first portal ends at a small authenticated account page with sign-out and
password-recovery access. Venue connection, subscriptions, service dashboards and
staff administration follow separately. The portal grants no platform permissions.

## Approach

Build `apps/portal` with Lit and esbuild, following the already verified Cloud browser
fixture. Serve its built files and the API from the same account-server origin. Keep
the current API-only server usable when no portal assets are configured. A documented
build-and-serve command enables the portal; development can rebuild on changes without
introducing a second public origin or a separate authentication proxy.

This reuses the installed controls and current Hono server. A separate frontend server
would add proxy and cookie configuration. A new application framework would add a
second component model to this first set of forms. Neither is needed for this slice.

Keep routing, translated strings, the API client, session state and screen rendering
separate. Use ordinary URLs and browser back/forward navigation. Support direct loads
of named screen routes; unknown paths return 404. Serve only known build assets, with
correct content types and GET/HEAD handling. Static requests do not consume the
account-operation rate counters or password-operation admission slots. Retain host
validation and bounded HTTP connections for both kinds of request.

## Screens and journeys

| Route | What you do |
| --- | --- |
| `/signup` | Enter your email, or finish signup after opening its emailed link. |
| `/login` | Sign in, with links to create an account and recover a password. |
| `/forgot-password` | Request a reset link. |
| `/reset-password` | Choose a new password using the emailed link. |
| `/account` | See that you are signed in, sign out or start password recovery. |
| `/` | Resolve the session, then open account or login. |

Use a compact account card that works on a phone and keyboard. Reuse the shared
input, button, card, spinner, form-actions and error-summary controls, theme tokens
and Enter helper. Follow the system light/dark preference. A visible language switch
is available on every screen. Do not add service buttons that have no working route.

Signup requests only an email initially. Show a generic check-your-email response
with resend and change-address actions. After following the link, enter a password
and your legal business name. Explain that a sole trader can use their own legal name.
Use that name for the organisation too, with an optional disclosure for a different
organisation name. Display Spain as the business country for this initial Spain-only
journey. The backend continues to support other country codes; this form makes no
claim about purchased services or data residency. Tax details belong to billing.

Do not claim the email is verified merely because a token is present. Completion
verifies the token and creates the account and both business records atomically.
After success, offer sign-in. Reset completion likewise offers sign-in and explains
that existing sessions have ended. Neither completion creates a session automatically. Email completion screens remain
accessible when a different account is already signed in; they never silently switch
accounts. Their sign-in action opens the login form even if a session already exists.

Use one password field with a reveal control and password-manager autocomplete.
New passwords follow the existing rules: at least 15 Unicode code points and at most
1024 UTF-8 bytes. Login must accept existing passwords without applying the new-password
minimum. Keep browser validation aligned with the server; the server remains authoritative.

## English and Spanish

Choose an explicitly saved language first, otherwise the first supported browser
language, with English as fallback. Save only this preference in local storage;
continue working if storage is unavailable. Set the document language and translate
labels, errors, statuses, titles and email messages. Switching language preserves
entered fields, the current token and request state.

Add an optional `locale` field, restricted to `en` or `es`, to signup-request,
reset-request and reset-completion bodies. Existing callers can omit it and retain
English. Other unknown fields remain rejected. Pass the locale through the existing
stores into the encrypted email payload: request locale selects verification/reset
mail, and reset-completion locale selects its password-change notification. Old queued
payloads without a locale still render in English. This needs no account-language column
or change to token ownership, cooldowns or expiry.

Email links carry their language so a new browser can open the right screen. The
page offers the same language switch after arrival. Render expiry times using the
selected language and show a time-zone label.

## Email links and request failures

Generate new links with token and language in the URL fragment, for example
`/signup#token=<secret>&lang=es`. The fragment stays out of the HTTP request URL.
Accept already-issued `?token=` links on the two completion screens during transition.
Reject duplicate or conflicting token parameters. Capture the token in memory and
remove it from the address bar with `history.replaceState` before rendering forms
or making account requests. Opening a link never submits it automatically.

Do not store tokens or passwords in browser storage, telemetry or logs. On reload,
explain how to reopen the email or request another link. Send tokens only in completion
POST bodies. Keep no-referrer, no-store and nosniff headers on portal documents and
account responses. Use a content-security policy allowing this origin's scripts and
connections, with framing and object embedding disabled. Test it with the actual Lit
build; no third-party scripts or fonts are needed.

Disable duplicate submission while a request is pending. Present field errors and
an error summary, move focus deliberately, and announce progress without trapping focus.
Obey `Retry-After`; resending a successfully requested email waits at least the existing
one-minute cooldown. Unknown and existing accounts receive the same email-request UI.

Do not automatically retry writes. A lost signup/reset completion reply may follow a
committed transaction: offer sign-in with the chosen password, alongside a deliberate
retry. An expired or used link offers sign-in and a fresh-link route. A failed login
response can be followed by a passive session check to determine whether sign-in
succeeded. Network or database failures show a retry action, not a claim that the
account is missing or the password change rolled back. Only display confirmed success.

## Sessions

Let the browser send the existing HttpOnly session cookie. Read the matching CSRF
cookie only to supply activity and logout headers. Never persist or display session
secrets. Resolve the session on initial entry, on returning to a visible tab and before
protected actions; passive reads do not extend its lifetime.

Renew activity only after real keyboard or pointer interaction on an authenticated
screen, throttled to at most once per minute. Timers and background tabs do not renew
sessions. Use the returned expiry to schedule a passive recheck. On a confirmed 401,
clear authenticated state and offer login. On 503 or a connection failure, show that
session status could not be checked and allow retry. Sign-out is not reported complete
until confirmed; a failed request keeps a visible retry action.

## Verification and delivery

Use failing tests before changing behaviour. Preserve existing account-store, HTTP,
queue and SMTP tests. Add browser journeys against the real HTTP server, disposable
PostgreSQL, the real email worker and Mailpit: signup from captured mail, login,
reload, activity, logout, reset and old-session rejection. Verify both languages,
email rendering, legacy links, token removal and replay, password-manager fields,
keyboard submission, phone layouts, both themes and accessibility.

Use controlled browser network failures for pending/double clicks, rate limits,
unavailability and lost completion replies. Test the distinction between passive
session checks and user activity. Add real HTTP assertions for direct screen loads,
asset types, unknown routes, host checks, security headers and unchanged API limits.
Check that tokens are absent from subsequent browser request URLs and referrers.

Run focused tests locally and mandatory suites in CI. Review production changes once
through the normal Claude run-it review, then finish and land automatically under the
owner's standing authorization. Public deployment still requires the separately tracked
provider, ingress and account-security work; this slice proves a working local portal.

## Existing contracts

- [Account API](../../../packages/account-http/README.md): routes, cookies, error codes,
  session lifetimes and HTTP limits.
- [Signup](../../cloud-signup-implementation.md) and
  [recovery](../../password-recovery-implementation.md): ownership, completion and retry rules.
- [Shared UI release](../../shared-ui-release.md): installed package and browser proof.
- Source inspection at Cloud `7c52285785655f89ef8cbcbf467915d0d9611e5c`:
  `packages/registration/src/account-mail.ts` generates query-token links;
  `packages/account-http/src/app.ts` rejects queries and currently sends all requests
  through account limits. Static routing and fragment links therefore need explicit
  implementation and regression checks, not just frontend markup.
