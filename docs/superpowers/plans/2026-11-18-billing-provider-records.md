# Billing provider records before live data

**Author:** Codex. **Authority:** the owner's D604 queue ask, matching [billing slice F](2026-10-29-cloud-billing.md#the-slices-in-order): “plus the supplier register rows and country flows both providers need before live data.”
This new plan still requires Claude read and watcher clearance before build.

**Smallest usable outcome:** you can identify SumUp card and Stripe SEPA debit
surfaces, their data paths and missing country evidence in the existing documents.
Both remain **UNQUALIFIED**. Publishing these records permits no live data.

**Reuse:** `docs/superpowers/plans/2026-10-29-cloud-billing.md` slice F and
`docs/superpowers/specs/2026-10-29-cloud-billing-design.md` §10;
`docs/superpowers/plans/2026-11-07-billing-payment-methods.md` and `docs/billing-provider-test.md`.
Reuse the register's `cloud-billing` purpose. Read `packages/account-http/src/billing-method-providers.ts`,
`packages/account-http/src/billing-method-binding.ts` and `packages/account-http/src/billing-methods.ts` as the adapter inventory.

1. Update `docs/cloud-data-processing-register.md`: add stable supplier names
   `sumup-payments` and `stripe-payments`, with separate evidence IDs
   `ev-sumup-card-v1` and `ev-stripe-sepa-v1`, linked to `cloud-billing`.
   Separate browser card/IBAN entry and consent from Cloud's synthetic identity,
   setup/customer/checkout references, saved token/payment-method and mandate IDs.
   Distinguish local owner/business/session bindings from fields actually sent.
   Inventory API, widget/hosted checkout, authentication frames, metadata and support.
2. Update `docs/country-policy.md`: describe each proposed payment flow's evidence
   requirements using the existing country/revision, purpose, supplier, account,
   data-class, endpoint and region match. A public API hostname never proves
   storage, processing or support country. Add no qualified flow configuration.
3. During build, consult current primary provider documentation; record dated
   source links and their limits. Exact account, legal entities/contracts, onward
   recipients, access countries, retention and production evidence stay unqualified
   unless reviewed private evidence actually exists. Reference private evidence
   without publishing identifiers or secrets. Choose no fixed retention period.
4. Update `docs/billing-provider-test.md` to link the records while preserving
   sandbox-only findings, and `docs/backlog.md` to distinguish documented inventory
   from unresolved qualification. Do not extend sandbox fee claims to production.

**Omit:** cancellation, closure, purchases, hosting, renewals, live enabling,
provider-account access, mail, code, migrations, new legal policy or runtime gates.
Existing generic country matching and test-only payment refusal remain the only
runtime rules in scope (`packages/registration/src/country-policy.ts:46`;
`packages/account-http/src/billing-methods.ts:26`).

**Verify during build:** run `node --test scripts/ci-docs.test.mjs`.
Manually cross-check every documented field, destination and local/provider boundary against the three adapter files above. Add no tests for prose.

**Expected lines added/deleted:** production 0/0; tests/support 0/0; documentation about 90/10, plus this plan about 45/0.
