# Billing provider records before live data

**Author:** Codex. **Authority:** the owner's D604 queue ask, matching [billing slice F](2026-10-29-cloud-billing.md#the-slices-in-order): “plus the supplier register rows and country flows both providers need before live data.”
Claude read this plan on 18 November (111 seconds); the reduced inventory was cleared by the watcher at 03:16, to build once PR4’s PR opened. This is watcher clearance, not owner approval of this new plan.

**Smallest usable outcome:** you can identify SumUp card and Stripe SEPA debit
surfaces, their data paths and missing country evidence in the existing documents.
Both remain **UNQUALIFIED**. Publishing these records permits no live data.

**Reuse:** `docs/superpowers/plans/2026-10-29-cloud-billing.md` slice F and
`docs/superpowers/specs/2026-10-29-cloud-billing-design.md` §10;
`docs/superpowers/plans/2026-11-07-billing-payment-methods.md` and `docs/billing-provider-test.md`.
Reuse the register's `cloud-billing` purpose. Read `packages/account-http/src/billing-method-providers.ts`,
`packages/account-http/src/billing-method-binding.ts`, `packages/account-http/src/billing-methods.ts`,
`apps/portal/src/billing-card.ts`, `packages/account-http/src/portal.ts` and the provider test receipt as the actual test-flow inventory.

1. Update `docs/cloud-data-processing-register.md`: add stable supplier names
   `sumup-payments` and `stripe-payments`, with separate evidence IDs
   `ev-sumup-card-v1` and `ev-stripe-sepa-v1`, linked to `cloud-billing`.
   Separate browser card/IBAN entry and consent from Cloud's synthetic identity,
   setup/customer/checkout references, saved token/payment-method and mandate IDs.
   Distinguish local owner/business/session bindings from fields actually sent.
   Inventory API, widget/hosted checkout, authentication frames, metadata and support.
   Link both supplier evidence IDs as dependencies of `ev-cloud-billing-v1`, without
   inheriting or granting its status. Keep country-flow evidence requirements only
   in the register. Processing regions and data-class names are unknown; invent no
   location label. Current fixed names, email and setup IDs are synthetic test
   fields. The real identity fields for live use remain undecided. Observed
   authentication frames are unqualified browser recipients and do not pass through
   the server's country matcher. No account, contract, retention or supplier
   qualification follows from this inventory. Choose no fixed retention period.
2. In `docs/country-policy.md`, add one sentence linking to the register and saying
   Spain's flow list contains no payment flows. Add no per-provider description or
   qualified flow configuration. Retain source links in the existing provider
   receipt; do no new provider research for an inventory of unknowns.
3. Update `docs/billing-provider-test.md` to link the records while preserving
   sandbox-only findings, and `docs/backlog.md` to distinguish documented inventory
   from unresolved qualification. Do not extend sandbox fee claims to production.

**Omit:** cancellation, closure, purchases, hosting, renewals, live enabling,
provider-account access, mail, code, migrations, new legal policy or runtime gates.
Existing generic country matching and test-only payment refusal remain the only
runtime rules in scope (`packages/registration/src/country-policy.ts:46`;
`packages/account-http/src/billing-methods.ts:16`).

**Verify during build:** run `node --test scripts/ci-docs.test.mjs`.
Manually cross-check every documented field, destination and local/provider boundary against the adapter, browser, CSP and receipt sources above. Add no tests for prose.

**Expected lines added/deleted:** production 0/0; tests/support 0/0; documentation about 45/5, plus this plan about 50/0.
