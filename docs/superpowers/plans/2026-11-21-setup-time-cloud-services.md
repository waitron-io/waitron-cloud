# Cloud services during setup

A box that signs in before Admin can use address completion in the venue form and choose Cloud email during setup. Saving files its venue. Skip keeps manual setup. Lane D owns the box screens. Remote access and guest menus still need a trial or paid plan. The watcher assigned the Cloud work on 21 November at 07:33. Reuse [the installed-box round trip](2026-11-20-cloud-setup-pairing.md#2-reuse-the-trip-during-setup) with synthetic data and providers in test mode.

## 1. Address lookup for registered boxes

In `packages/account-http/src/address-lookup.ts`, replace the configured account, venue and installation tuple with the signed installation, its stored venue, and the account from its completed registration. Refuse missing or conflicting attribution. Recheck ownership, lease and revocation under the existing allowance locks. Keep the provider switch, workflow rules, installation limits and existing account caps. In `packages/account-http/test/address-lookup.test.ts`, prove access from two registered boxes and refusal after loss of authority. Verify shared caps on two boxes of one account and isolation from another account. Update `docs/address-lookup-trial.md` and `docs/backlog.md`. Estimate 65–125 implementation lines, 65–110 test lines, 2–3 hours.

## 2. Register on redeem and file on save

Use signed redeem in `packages/registration/src/setup-pairing.ts` to create a registered placeholder through `RegistrationStore`, once per attempt, with no trial. In migration 080 and `migrate.ts`, store its installation separately from the completed result so the signed save still requires a current session and the original key. Save uses the existing venue details and business matching. Account HTTP keeps its bound callback, verifier and installed-box flow. Cover redeem and save replay, wrong key and changed session in the existing registration and account HTTP `pairing.test.ts` files. Pin migration history. Estimate 130–240 implementation lines, 90–150 test lines, about 3 hours once scope is settled.

**Business decision.** Migration 048 binds recorded service use to the original business, venue and installation. The final tax match can differ from the business picked before the form. Recommend retaining the same identity where there is one eligible business and the saved details match it, with a clear refusal outside that pilot. To support cross-business filing, agree on a separate final registration and retirement of the placeholder before building that case. Preserve recorded usage, ownership, key uniqueness and quota scope.

## 3. New account continuation and email proof

In `apps/portal/src/{links,app,screens}.ts`, carry the pairing context through existing verification and enrolment, then resume fresh sign-in in the originating tab. Test in `pairing-browser.test.ts` and `required-enrollment-browser.test.ts`. Use the existing test relay grant and Mailpit in `deploy/test-cloud/free-services-relay.test.mjs`. The test operator can approve a grant through `deploy/test-cloud/service-controls.mjs`. Choose whether this prepared test grant suffices or the setup journey itself must collect consent. The latter needs its own scope. Keep production defaults. Estimate 55–110 implementation lines, 55–105 test lines, 2–3 hours for continuation and the prepared grant proof.

## Contract and verification

Publish the agreed contract in `docs/waitron-integration-contract.md` and tell Lane D the exact landed commit. Proposed v4 keeps start, authorize, return and complete. Redeem and bound status return the existing registration shape early. The box renews its lease through signed `/api/installations/renew` and uses the existing address action and servicesVersion 2 configuration to discover an approved relay grant. The request ID grants no access on its own.

Run each named changed file first for a failure and again after the fix. Use `scripts/test-postgres.mjs` for the database paths and `pnpm typecheck` for shared types. Look at changed screens in English and Spanish, light and dark, at 390 and 1280 pixels. Each slice must leave main usable on its own.
