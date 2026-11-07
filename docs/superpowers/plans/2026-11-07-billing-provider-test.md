# D602: billing provider experiment

Answer [slice A](2026-10-29-cloud-billing.md#the-slices-in-order) and the
[payment design](../specs/2026-10-29-cloud-billing-design.md#6-taking-payment)
with four sandbox runs. Authority: lane G watcher, 2026-11-07 13:12: “The owner placed the SumUp sandbox
and Stripe test keys on the Mac… Take it next. Plan first, one page, Claude read.”
No product implementation or live funds.

1. **Prepare privately.** Before the experiment, commit this plan with `git commit -s` and
   obtain Claude’s `~/workspace/tools/claude-seat.sh review-branch` review. Keep scripts
   and private artifacts outside the repository at `~/waitron-campaign-g/receipts/d602`.
   Use headless Chromium. If a prerequisite CLI is absent, install an isolated official
   binary outside the repository and verify its official checksum. Read keys only in process from
   `~/.config/waitron-billing-test/{sumup,stripe}.env`; never read
   `~/.sumup-experiments/env`. Never print, copy, commit or log keys, tokens or signing
   secrets; disable verbose request/browser logging.
2. **Check before mutation.** Privately confirm SumUp `/v0.1/me` has `extdev: true`
   and matches the expected merchant. Confirm a Stripe test key and `livemode: false`.
   Stop that provider’s run on mismatch. Use only synthetic names and provider-documented
   cards/IBANs; use a synthetic, non-delivering email address where required.
3. **Run 1, SumUp.** Follow the official
   [Payment Widget tokenization guide](https://developer.sumup.com/online-payments/guides/tokenization-with-payment-sdk/)
   from a loopback page with `SETUP_RECURRING_PAYMENT`. Save the card, close the payer browser, then attempt
   a server-only saved-token charge without payer interaction. Record status and observed
   sandbox fee availability. Pass only on paid status with no authentication, redirect
   or next step. Record a challenge/refusal for slice F’s fallback. Missing or zero
   simulated fees cannot prove 1.95%; that needs published pricing or the merchant contract.
4. **Runs 2–4, Stripe.** Follow official
   [SEPA guidance](https://docs.stripe.com/payments/sepa-debit) and its documented test
   IBAN scenarios. For each success, failure and dispute scenario, collect a mandate
   through hosted Checkout in `setup` mode attached to a synthetic Customer, close the browser, then create an
   off-session PaymentIntent using the saved method. Start this lane’s `stripe listen`
   forwarding to loopback before charging; pass the key through `STRIPE_API_KEY` in its
   environment, never command arguments. Capture its signing secret only in memory.
   Verify event signatures and `livemode: false`;
   correlate actual provider test notifications to that run’s PaymentIntent/charge.
   Record payment success/failure and dispute notifications, including elapsed time.
   Sandbox elapsed time cannot qualify production settlement timing; leave that open
   for slice G and cite Stripe’s current timing guidance.
   Never substitute `stripe trigger` events. Stop only processes this lane started.
5. **Publish evidence.** Deliver `docs/billing-provider-test.md` with redacted commands,
   status outputs, timestamps and direct official citations; pseudonymize test object IDs.
   Exclude real account/merchant/customer IDs, secrets, tokens and raw provider payloads
   from repository, PR and logs. Record sandbox/headless/challenge blockers without broadening access or
   using live funds. Update only this work’s backlog sentence. Run focused documentation
   checks and use docs-only finish/land with existing approval and the Cloud lock.
