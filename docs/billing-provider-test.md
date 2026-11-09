# Billing provider sandbox test

These runs exercise billing plan [slice A](superpowers/plans/2026-10-29-cloud-billing.md#the-slices-in-order).
Use them as sandbox evidence, not approval to take live money. All names, card details,
addresses and bank details were synthetic. No account settings were changed.

## How the runs were isolated

The private probes ran on the Mac with Node 26.13.0, Playwright 1.63.0 and headless
Chromium. Before any write, `provider-common.mjs` read SumUp `/v0.1/me`, required
`extdev: true` and matched the expected sandbox merchant from the private campaign item.
Stripe `/v1/balance` had `livemode: false`; the probe accepted only a test key and
refused any returned live object. The preflight at 2026-11-07 12:23:26 UTC printed:

```json
{"stage":"guards","sumupSandbox":true,"expectedMerchant":true,"stripeTestMode":true}
```

Scripts and sanitized run logs stay outside the repository in
`$HOME/waitron-campaign-g/receipts/d602/`. Keys were read from the owner's private
`waitron-billing-test` files in process. The scripts kept card tokens and webhook signing secrets in memory;
this receipt and the sanitized logs contain no keys, tokens or checkout URLs. The real SumUp profile was not used.

Stripe CLI 1.55.8 was installed only under the private probe directory. The downloaded
ARM Mac archive matched the SHA-256 digest on its official GitHub release:
`7e38bc433b869dd93e7dc6fc342623f2283d76eb196f0b2586b858a462ff298a`.
Each probe started its own listener and loopback receiver before collecting a mandate:

```sh
stripe --config <private-config> listen --forward-to http://127.0.0.1:<port>/webhook \
  --events setup_intent.succeeded,payment_intent.succeeded,payment_intent.payment_failed,charge.dispute.created
```

The launcher supplied `STRIPE_API_KEY` through the child process environment, following
[Stripe's CLI key guidance](https://github.com/stripe/stripe-cli/wiki/using-stripe-api-keys).
This replaces the item's `--api-key` flag because arguments appear in process listings.
The listener's signing secret stayed in memory. The receiver verified the signature
against the raw request bytes and checked the timestamp and `livemode: false`.
It matched each notification to that run's actual PaymentIntent or its charge.
No `stripe trigger` event stood in for a debit. Each browser, listener and local server
was closed after its run.

## Run 1: SumUp saved card and unattended charge

The probe followed SumUp's [Payment Widget tokenization guide](https://developer.sumup.com/online-payments/guides/tokenization-with-payment-sdk/)
with `purpose=SETUP_RECURRING_PAYMENT`, a synthetic customer and the
[documented sandbox Visa](https://developer.sumup.com/online-payments/testing/)
`4200000000000091`. It selected consent in the widget and completed the provider's
synthetic authentication frame using its Approve/Submit control. The setup checkout
used **€1**, as recorded by `run-sumup.mjs`'s setup-checkout request, and became
`PAID` at 2026-11-07 12:37:54 UTC. A provisional token seen before authentication
had not qualified the setup; the completed run read an active saved instrument for
the exact synthetic customer.

After closing the payer browser, the server created a separate €10 checkout and
processed it with `payment_type=card`, the saved token and customer ID. At
12:37:56 UTC the checkout was `PAID`, without `next_step`. This qualifies the sandbox
API path for a customer-absent payment. It does not establish live-account enablement.

```sh
node "$HOME/waitron-campaign-g/receipts/d602/run-sumup.mjs"
node "$HOME/waitron-campaign-g/receipts/d602/read-sumup-fee.mjs"
```

Selected output:

```json
{"stage":"setup-result","status":"PAID","tokenPresent":true}
{"stage":"payer-browser-closed"}
{"stage":"saved-instrument-read","savedInstrumentCount":1,"matchingToken":true,"active":true}
{"stage":"saved-charge","status":"PAID","nextStep":false,"amount":10,"currency":"EUR","pass":true}
{"stage":"fee-read","status":"SUCCESSFUL","amount":10,"currency":"EUR","feeFields":{"fee_amount":0.25},"descriptionMatches":true}
```

The payment probe then exited with a fee-lookup error: its old
`/v0.1/me/transactions` read returned HTTP 404. No payment was repeated. The separate
read-only fee probe used the current [transaction endpoints](https://developer.sumup.com/api/transactions/get/),
selected the unique successful €10 charge in the original 12:37:50–12:38:00 UTC
window, and matched its description and transaction code. At 12:38:51 UTC its
`fee_amount` was **€0.25, or 2.5% of €10**. This is a reported sandbox fee, not a
production quote. It does not confirm the design's 1.95% assumption; SumUp's live
pricing or the merchant contract must settle that before live card billing.
The private probe now uses the current fee endpoint.

Earlier attempts stopped on nested card frames, the widget's custom consent control
or the uncompleted setup authentication. They sent no unattended charge and do not
show that SumUp lacks saved-card support. The completed server-only charge above
is the result for slice F.

## Runs 2–4: Stripe SEPA debit

For each run, the probe created a synthetic Customer and a hosted Checkout session
with `mode=setup`, EUR and `payment_method_types[]=sepa_debit`. Headless Chromium
entered the synthetic name, address and the corresponding
[documented test IBAN](https://docs.stripe.com/payments/sepa-debit/set-up-payment?payment-ui=checkout).
The hosted page collected consent. The probe read the successful SetupIntent and its
mandate, closed the payer browser, and then confirmed a €10 off-session PaymentIntent
with that saved payment method and mandate. API reads independently checked the final
payment and charge state.

| Scenario | German test IBAN | Signed notification received | Final API read | UTC notification | Whole probe |
| --- | --- | --- | --- | --- | --- |
| Success | `DE89370400440532013000` | `payment_intent.succeeded` | `succeeded` | 2026-11-07 12:30:56 | 33 seconds |
| Failure | `DE62370400440532013001` | `payment_intent.payment_failed` | `requires_payment_method` | 2026-11-07 12:32:03 | 33 seconds |
| Dispute | `DE35370400440532013002` | `charge.dispute.created` | `succeeded`, charge disputed | 2026-11-07 12:33:29 | 120 seconds |

Commands actually run, with the private directory written using `$HOME`:

```sh
node "$HOME/waitron-campaign-g/receipts/d602/run-stripe.mjs" success
node "$HOME/waitron-campaign-g/receipts/d602/run-stripe.mjs" failure
node "$HOME/waitron-campaign-g/receipts/d602/run-stripe.mjs" dispute
```

Selected output from the three completed probes, with timestamps shown in the table:

```json
{"scenario":"success","pass":true,"event":"payment_intent.succeeded","eventVerified":true,"eventCorrelated":true,"paymentStatus":"succeeded","chargeDisputed":false,"livemode":false}
{"scenario":"failure","pass":true,"event":"payment_intent.payment_failed","eventVerified":true,"eventCorrelated":true,"paymentStatus":"requires_payment_method","chargeDisputed":false,"livemode":false,"failureCode":"payment_intent_payment_attempt_failed"}
{"scenario":"dispute","pass":true,"event":"charge.dispute.created","eventVerified":true,"eventCorrelated":true,"paymentStatus":"succeeded","chargeDisputed":true,"livemode":false}
```

Initial browser attempts did not complete mandate setup. Prefilling the synthetic
German billing address and selecting its country on Checkout resolved the local form
setup. They are not evidence of a provider refusal. The table records the completed
runs, not those earlier incomplete attempts.

## What this leaves open

These simulated elapsed times do not measure production settlement. Stripe's
[current SEPA guidance](https://docs.stripe.com/payments/sepa-debit) remains the source
for its published timing; slice A's production timing assumption is unqualified by
these tests. Test-mode availability also does not qualify live-account enablement,
production fees, supplier/privacy work or real-money billing.

## Local account panel, 7–8 November 2026

The separately scoped payment-method piece ran through a local Cloud server and a
throwaway PostgreSQL database. The command was
`node "$HOME/waitron-campaign-g/receipts/d604/payment-methods/sandbox-journey.mjs"`.
The final sanitized log is `sandbox-journey-final.log` in that directory.

At 23:58:14 UTC the account panel verified and selected a SumUp sandbox card. At
23:58:27 UTC it verified a Stripe test SEPA mandate after returning from Checkout
to plain `/account`. The card run checked that renewal anchors stayed null. This
journey collected no live payment or renewal. Its browser, local server, database
and test connection fixtures closed successfully.

The card confirmation observed these parent-page origins with zero Content Security
Policy violations: scripts from `gateway.sumup.com`; connections to `api.sumup.com`,
`gateway.sumup.com` and `js.sumup.com`; frames at `gateway.sumup.com`, `api.sumup.com`,
`eu-test.oppwa.com`, `test.oppwa.com` and `test.ppipe.net`; images from
`static.sumup.com`. These exact hosts qualify this sandbox run only. The policy
keeps forms on Cloud and adds no wildcard or live-provider qualification.

After the review removed the unmeasured `data:` image allowance, the same command
ran again. `sandbox-policy-tightened.log` records card selection at 00:11:36 UTC
and mandate selection at 00:11:49 UTC on 8 November, with zero policy violations
and successful fixture cleanup.
