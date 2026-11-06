# Account HTTP boundaries


## Signup and password-reset HTTP acknowledgements (D423)

An unexpected reply must not tell you an account is ready or a password has
changed. The client requires HTTP 202 with `accepted` for either email request,
HTTP 201 with nonblank account, organisation and business IDs for signup, and
HTTP 200 with `completed` for password reset. Other success codes, malformed
bodies and transport failures remain unsuccessful. An error code inside a success
reply is unexpected too, so it cannot turn an uncertain completion into a definite
refusal. A deliberate retry can accept
a valid reply; the client never repeats an uncertain account operation itself.

Run the acknowledgement and transport checks:

```sh
node --test apps/portal/test/signup-reset-response-boundary.test.ts apps/portal/test/signup-reset-transport.test.ts
```

Controlled replies cover exact statuses, blank identifiers and request bodies.
Real local HTTP connections hold headers or JSON bodies beyond the 15-second
deadline for all four calls. These public actions do not require a signed-in
management cookie. Browser requests retain the same-origin credentials, JSON
content type and automatic Origin header, which the server checks before acting.

Run `node --test apps/portal/test/signup-reset-acknowledgement-browser.test.ts`
for English and Spanish, light and dark, at 390 and 1280 pixels. The real portal
bundle keeps a wrong-status reply on the form, preserves the password for a
deliberate retry and shows success only after the exact acknowledgement. These
journeys intercept server replies and do not prove email delivery.

The existing `packages/account-http/test/account-http.test.ts` exercises the
production HTTP handlers with real PostgreSQL and local Mailpit. It checks
one-use links, origin refusals, exact server statuses, account creation and
password-reset session revocation. Run that file with:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=120000 test/account-http.test.ts
```

This local delivery proof does not qualify the production mail provider. D102's
owner-only enablement checklist still owns live delivery.
