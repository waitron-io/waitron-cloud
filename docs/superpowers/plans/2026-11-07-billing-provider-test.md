# D602: billing provider experiment

Answer [slice A](2026-10-29-cloud-billing.md#the-slices-in-order) and the
[payment design](../specs/2026-10-29-cloud-billing-design.md#6-taking-payment)
with four sandbox runs. Scope: owner/watchers’ authorization in lane G questions,
2026-11-07 13:12, and queue. No product implementation or live funds.

1. **Prepare privately.** Before the experiment, commit this plan with sign-off and
   obtain Claude’s `~/workspace/tools/claude-seat.sh review-branch` review. Keep scripts
   and private artifacts outside the repository at `~/waitron-campaign-g/receipts/d602`.
   Use headless Chromium. If a prerequisite CLI is absent, install an isolated official
   binary outside the repository. Read keys only in process from
   `~/.config/waitron-billing-test/{sumup,stripe}.env`; never read
   `~/.sumup-experiments/env`. Never print, copy, commit or log keys, tokens or signing
   secrets; disable verbose request/browser logging.
2. **Check before mutation.** Privately confirm SumUp `/v0.1/me` has `extdev: true`
   and matches the expected merchant. Confirm a Stripe test key and `livemode: false`.
   Stop that provider’s run on mismatch. Use only synthetic names and provider-documented
   cards/IBANs; use a synthetic, non-delivering email address where required.
3. **Run 1, SumUp.** Follow the official
   [Payment Widget tokenization guide](https://developer.sumup.com/online-payments/guides/tokenization-with-payment-sdk/)
   with `SETUP_RECURRING_PAYMENT`. Save the card, close the payer browser, then attempt
   a server-only saved-token charge without payer interaction. Record status and observed
   sandbox fee availability. Missing or zero simulated fees do not establish a production
   1.95% rate. Record refusal or missing capability as evidence for slice F’s fallback.
4. **Runs 2–4, Stripe.** Follow official
   [SEPA guidance](https://docs.stripe.com/payments/sepa-debit) and its documented test
   IBAN scenarios. For each success, failure and dispute scenario, collect a mandate
   through hosted Checkout in `setup` mode, close the browser, then create an
   off-session PaymentIntent using the saved method. Start this lane’s `stripe listen`
   forwarding to loopback before charging. Verify event signatures and `livemode: false`;
   correlate actual provider test notifications to that run’s PaymentIntent/charge.
   Record payment success/failure and dispute notifications, including elapsed time.
   Never substitute `stripe trigger` events. Stop only processes this lane started.
5. **Publish evidence.** Deliver `docs/billing-provider-test.md` with redacted commands,
   status outputs, timestamps and direct official citations; pseudonymize test object IDs.
   Exclude real account/merchant/customer IDs, secrets, tokens and raw provider payloads
   from repository, PR and logs. Record sandbox failures without broadening access or
   using live funds. Update only this work’s backlog sentence. Run focused documentation
   checks and use docs-only finish/land with existing approval and the Cloud lock.
