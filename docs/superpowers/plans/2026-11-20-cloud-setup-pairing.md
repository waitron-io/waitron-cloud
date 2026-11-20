# Register a new box from setup

After creating the box administrator, sign in or sign up from the box and use Cloud address lookup before entering the venue. Saving the form files a fresh venue under the matching business and lets the setup email step use Cloud. The 20 November 13:11, 13:20 and 13:49 owner decisions are recorded in Lane K's questions. Lane D owns the box and shared contract changes. This replaces the direction of the [19 November link plan](2026-11-19-cloud-one-click-pairing.md).

## 1. Bind the signed box to the account

- Add test-only `POST /api/pairing/setup/{start,bind,status}` in `account-http/src/setup-pairing.ts` and wire it in `app.ts` (paths relative to `packages/`). Use the existing box key and the shared pairing encoder. Lane D supplies the new setup action and covers the locally authenticated administrator and HTTPS credential entry.
- Reuse Cloud's password and challenge handlers and `requireConnectionProof` in `registration/src/connection-proof.ts`. The first test path uses the existing authenticator app or recovery proof. Bind is automatic after authentication. Cloud issues a challenge bound to the account session, and verifies the setup action, challenge, request ID, test environment and key together. Cloud credentials and session cookies stay out of persistent box state.
- In `registration/src/setup-pairing.ts` and one new migration listed in `migrate.ts`, store the short-lived setup binding and return its request ID and state. A lost reply can recover the same binding using the same signed key. Account disablement or security revision changes end unfinished authority.
- In `account-http/test/setup-pairing.test.ts`, prove that fresh account proof and the bound signature are both required, a different key/account cannot reuse the challenge, and retry returns the same result. Cloud can exercise this endpoint with a synthetic existing account. Estimate +170–250 implementation lines, +120–180 tests.

## 2. Verify a new account from the box

- Extend `registration/src/signup.ts` and the setup HTTP handler to reuse verification mail, password screening and account creation. Complete setup signup with verification entered on the box. Business names come later. Enrol the authenticator using the existing challenge rules, then bind automatically as above.
- Extend `registration/test/signup.test.ts` and the setup HTTP tests to prove verification is bound to this setup and that the account can pair without invented business details. Use Mailpit. Estimate +100–150 implementation lines, +80–130 tests.

## 3. Use the basic services and file the venue

- Give the exact privately configured test account and box access to address lookup from the setup binding. Reuse `account-http/src/address-lookup.ts` and its provider and workflow limits. Propose account-scoped setup reservations in `registration/src/billing-allowances.ts` so the existing account cap applies through finalization. Migration 048 makes existing venue and business attribution immutable. A temporary business followed by reassignment conflicts with those facts.
- Add signed `POST /api/pairing/setup/finish` to the setup handler. Sign the request ID and exact name, address and tax number. Under the account lock, match country and trimmed, case-insensitive tax number across its eligible owned businesses. Reuse a unique match. On no match, create a business in the sole eligible organisation, or create the first organisation and business for a new account. Reuse `RegistrationStore` in `registration/src/index.ts` to create the venue, preserve the key, store the trading address with the venue, and return the original result on exact retry. An empty Cloud venue ID always creates a new venue. Leave existing business billing details and recorded usage intact.
- After filing and before the setup email step, use the existing test relay's consent, origin and grant controls. Lane D reads the grant through signed `/api/installations/configuration`. In `account-http/test/address-lookup.test.ts` prove lookup before the form and cap continuity. In `registration/test/setup-pairing.test.ts` prove tenant-scoped matching, concurrent finish, new venue on a new box and unchanged existing billing data. Run `account-http/test/relay-messages.test.ts` for the email boundary. Budget separate PRs for lookup (+120–200 implementation, +90–140 tests) and filing (+150–220 implementation, +120–170 tests).

## Release checks and decisions

Run the named files through `scripts/test-postgres.mjs`, plus `pnpm typecheck`. Update the integration contract and backlog with each shipped slice. Lane D and K walk through account verification, address completion, filing, captured email and the remote access trial gate on an isolated test stack. Portal removal shipped in #1330. Released pairing and recovery stay available. Guest-menu eligibility and live providers are separate.

Before build, agree on the shared actions with Lane D. Recommend that the first test covers authenticator users and leaves passkey-only sign-in to a Cloud-origin proof design. Where duplicate matches or several eligible organisations make filing ambiguous, fail closed without a business picker. Confirm the pre-form address allowance and the email step order before building those slices.
