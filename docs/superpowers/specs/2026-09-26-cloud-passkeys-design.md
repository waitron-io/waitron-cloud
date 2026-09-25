# Optional Cloud passkeys

## Purpose

Waitron Cloud customers can add a passkey to an existing account and use it to sign in without typing their email or password. Passkeys remain optional. Password sign-in and email recovery continue to work, and a customer cannot remove or bypass either path through this feature.

This work covers customer accounts only. It does not add staff roles, support access, mandatory multi-factor authentication or a password-removal policy.

## Standards implementation

Use `@simplewebauthn/server` 14.0.3 and `@simplewebauthn/browser` 14.0.0. The maintained library owns WebAuthn encoding and cryptographic verification. Cloud owns account authority, durable challenges, credential records, session issuance and public error handling.

The implementation follows the library's [server ceremony guidance](https://simplewebauthn.dev/docs/packages/server), [browser API](https://simplewebauthn.dev/docs/packages/browser) and [passkey settings](https://simplewebauthn.dev/docs/advanced/passkeys). It also follows the W3C requirement to verify the [expected origin and relying-party scope](https://www.w3.org/TR/webauthn-3/#sctn-validating-origin).

Cloud uses the configured portal hostname as the exact relying-party ID and the complete configured portal origin as the only accepted origin. Registration requests resident credentials and requires user verification. Authentication uses discoverable credentials, so a passkey sign-in begins without an email address and does not reveal whether an account has a passkey. Attestation is `none`; Cloud does not collect authenticator make or serial information for an allow-list.

## Stored state

Migration `019_passkeys.sql` adds three groups of records:

- `cloud_passkey_users` gives each account one random 32-byte WebAuthn user handle. The handle is opaque and is not an email address or account UUID.
- `cloud_passkeys` stores a server-generated row ID, account, credential ID, public key, signature counter, transports, device and backup flags, creation time and last-use time. Credential IDs are globally unique. Counters are limited to the unsigned 32-bit range supported by authenticators and represented safely by JavaScript.
- `cloud_webauthn_ceremonies` stores a random ceremony ID, kind, challenge, optional account and initiating session, creation, expiry and consumption time. A ceremony lasts five minutes and can be consumed once. Invalid completion attempts consume it too.

The account and session foreign keys keep credential changes tied to the current identity model. Challenge history remains available for the separate D11 retention task; D9 does not choose or enable a legal retention period.

## Authority and ceremonies

Enrolment has two requests. The first request requires the live session cookie, its CSRF token and the current account password. After that fresh authority check, Cloud creates a registration ceremony bound to the account and exact session. The second request must use the same live session and CSRF token before Cloud consumes and verifies the response. Cloud rechecks the session before storing the credential, so suspension, logout or expiry during cryptographic work cannot enrol it.

Removal requires the live session, CSRF token, current password and an account-scoped passkey row ID in one request. An account can remove its last passkey because its password and recovery paths remain available. A credential row belonging to another account is indistinguishable from a missing row.

Passkey sign-in also has two requests. The first creates an unauthenticated discovery ceremony without accepting an email or account ID. The second consumes that ceremony, finds the credential by its high-entropy credential ID, verifies the response, requires its user handle to match the credential's account, advances the signature counter and records last use. Only then does it issue the existing session and CSRF cookies. Every failure uses the same public invalid-credentials response. Existing IP and general request limits apply, with passkey-specific begin and completion limits to bound challenge creation and verification.

Password reset continues to end all Cloud sessions but does not delete passkeys. A stolen email account must not silently remove a possession factor. Changing that policy needs a separate recovery decision.

## HTTP interface

All endpoints retain the current exact-host, exact-Origin, body-size, timeout, content-type and no-query rules.

- `POST /api/account/passkeys/authentication/options` with `{}` returns `{ceremonyId, options}`.
- `POST /api/account/passkeys/authentication/verify` with `{ceremonyId, response}` returns `{accountId}` and the existing session cookies.
- `GET /api/account/passkeys` returns `{passkeys: [{id, createdAt}]}` for the current account without extending passive session activity.
- `POST /api/account/passkeys/registration/options` with `{password}` and session/CSRF proof returns `{ceremonyId, options}`.
- `POST /api/account/passkeys/registration/verify` with `{ceremonyId, response}` and the same session/CSRF proof returns the new `{id, createdAt}`.
- `POST /api/account/passkeys/remove` with `{id, password}` and session/CSRF proof returns 204.

WebAuthn responses are nested JSON, so the account request reader gains a bounded JSON-object mode. Each passkey route validates its exact top-level shape before calling the identity store. Raw WebAuthn errors, public keys, challenges and submitted credentials never enter public responses or logs.

## Portal

The sign-in page keeps the current email and password form and adds a separate **Sign in with a passkey** action. It starts a deliberate browser ceremony on click; D9 does not enable conditional autofill.

The account page adds a small passkey section. It explains that passwords and recovery remain available, lists the enrolment dates for this account's passkeys, asks for the current password before adding or removing one, and reports cancellations without treating them as service failures. English and Spanish copy use the same controller states. Unsupported browsers leave password sign-in available and explain that passkeys are unavailable on that browser.

D10 will add richer account-security controls, including passkey last-use details and session management. D9 exposes only what customers need to add and remove passkeys safely.

## Failure and concurrency rules

- Expired, consumed, missing, wrong-kind and wrong-session ceremonies fail without being revived.
- A failed or cancelled browser ceremony creates no credential or session. A lost successful verification reply is reconciled by the ordinary session check for sign-in and by reloading the account's passkey list for enrolment or removal.
- Exact origin, relying-party ID, challenge, user verification and user handle must all match.
- Duplicate credential IDs and cross-account row IDs fail closed.
- Authentication locks the credential while checking and advancing its counter. Concurrent stale assertions cannot lower or overwrite the stored counter.
- Account disablement, password changes, logout and session expiry are rechecked at the identity transaction boundaries. No cached portal state grants authority.

## Verification

Use failing tests before each production change. Real PostgreSQL tests cover durable one-use/expiry behavior, session binding, fresh password checks, replay, cross-account access and counter updates. HTTP tests cover strict request shapes, Origin/CSRF, generic authentication failures, limits, cookies and suspension races.

A Playwright Chromium test uses the DevTools virtual-authenticator protocol to create a resident, user-verified credential, sign out, sign in with it and remove it. It also proves replay rejection and account isolation. Browser assertions cover English and Spanish at phone and desktop sizes in light and dark themes. Focused package tests and type checks run locally; the repository's normal push hook and exact-head CI own the full suite.
