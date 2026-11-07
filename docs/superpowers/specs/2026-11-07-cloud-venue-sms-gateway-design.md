# D610: Venue SMS gateway

**Design only, 2026-11-07.** Free security policy decided; delivery proposed, provider **OPEN**. No build or landing authority. WATCHER 2026-11-07 22:47 quotes the owner: “sign in SMS would be level 1, and bookings would be an extra paid allowance.” This supersedes SMS's monthly allowance slot in [billing §3](2026-10-29-cloud-billing-design.md#3-allowances-owner).

## Two separate uses

Security codes are free at levels 1, 2 and 3, including trials, subject only to hourly/daily abuse limits. No monthly security allowance or global spending quota applies. Numeric recipient, resend, installation and account bounds need owner qualification. Purchases cannot raise them. Bookings cannot consume, reserve or block security capacity. A separate emergency transport stop or outage is not an allowance.

Booking confirmations, changes, cancellations and reminders require an **extra paid balance**, with no included units at any level or in trials. You can purchase it at level 1 without another subscription. You must deliberately purchase/authorise it before sending. Amount, price, renewal/reset and refund rules remain unapproved; no monthly period is assumed. Stop at exhaustion, without automatic charges, fallback sending or a reminder backlog.

At a security rate limit show “Code not sent. Try again at {time}” / “Código no enviado. Inténtalo de nuevo a las {hora}”. Offer a usable alternative proof only if already enrolled; require no new fallback enrolment. Never weaken a required factor or treat email alone as a second factor. SMS cannot replace a stronger enrolled factor; this introduces no identity methods. For bookings distinguish “Booking SMS not sent: no paid allowance” / “SMS de reserva no enviado: sin saldo de pago” from “Booking SMS not sent: allowance exhausted” / “SMS de reserva no enviado: saldo agotado”. Invent no reset date.

## Ownership and sending

Staff/owner codes and the four booking classes remain proposed. The source reading at Waitron `9086f8d54eb5b231de3d0949647a80f2b144333f`, not runtime verification, found no SMS sender/caller: [bookings](https://github.com/clintongormley/waitron/blob/9086f8d54eb5b231de3d0949647a80f2b144333f/packages/bookings/src/bookings.ts#L66) store `contactPhone`; [account email](https://github.com/clintongormley/waitron/blob/9086f8d54eb5b231de3d0949647a80f2b144333f/apps/server/src/account-email.ts#L48) covers invitations, resets and email changes. Separate Waitron integration remains. Leave its existing booking-location read untouched.

Under [documentation ownership](../../documentation-ownership.md), Cloud owns transport and allowances. Waitron owns venue codes, enrolled-number possession, validity and recovery. Cloud identity issues Cloud-owner codes under the same free policy; a trusted box cannot issue them.

Reuse [email relay](../../transactional-email-relay-contract.md#authority-belongs-to-an-installation-and-a-consenting-account) authority, encrypted queue and retry patterns, not its allowance policy; its [message classes](../../../packages/registration/src/relay-payload.ts#L9) exclude SMS. Authenticate the paired box; derive account, venue and country. Accept one international-format phone, allowed purpose, fixed bounded template, EN/ES locale, expiry and stable ID. Reject arbitrary text, sender, country overrides, credentials and marketing. Require recorded guest booking consent; a stored number proves neither consent nor possession. Recheck authority and consent after waits and before sending. Log no raw phone, code or body.

Atomically reserve each encoded segment at admission against the separate paid booking balance. Rejected admissions cost zero. Code attempts use hourly/daily abuse budgets. Exact retries keep original booking attribution and return saved status without extra charge; changed fields refuse. Retain unknown submissions and their reservations; release only on proven non-submission, never twice. Never duplicate/resend unknown work or send expired codes/reminders. “Accepted” is not “delivered”; in-flight sends cannot be recalled.

Use **one small send function** taking validated bounded template, phone, expiry and stable ID, returning accepted/rejected/unknown plus status. No routing service or pluggable framework. Existing IDs stay bound to their provider; switching providers must not duplicate an unknown submission.

## Provider decision and costs

**Recommend comparing candidates before the owner chooses a provider.** No purchase. The survey dated 2026-11-07 is not independently verified in full; this revision checked 360NRS's public price. Prices below are per encoded part to Spain, before extras/tax, subject to change, without currency conversion.

| Candidate | Per part / 200 parts | Evidence and caveat |
| --- | --- | --- |
| [GatewayAPI](https://gatewayapi.com/pricing/) | €0.0342 / €6.84 standard; €0.0409 / €8.18 premium | Survey; route/delivery quality, supplier/privacy unqualified |
| [Altiria](https://www.altiria.com/comprar-sms-precio-sms/) | €0.039 / €7.80 | Survey; 1,000 minimum (€39), non-expiring credits; numeric terms not driver-reverified |
| [360NRS](https://www.360nrs.com/precios/espana) | €0.039 / €7.80 | Driver checked public price; minimum/fees unqualified |
| [AWS End User Messaging](https://aws.amazon.com/end-user-messaging/pricing/) | $0.07 / $14 | Prior public CSV; sender onboarding required |

[SES](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html) “is an email platform”; SMS belongs to [End User Messaging](https://docs.aws.amazon.com/sms-voice/latest/userguide/what-is-sms-mms.html): Pinpoint SMS/MMS/voice “are now called AWS End User Messaging”. The [prior AWS CSV](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/business-applications/approved/documents/End-User-Messaging-SMS-Prices.ebc340b4d416d90832dd59629c4792b0deb6f8bc.csv), read 2026-11-07, also lists per-part/200-part costs: Portugal $0.03031/$6.062, France $0.07401/$14.802, Italy $0.08/$16 and UK $0.05/$10. These are illustrative destinations, not approved markets: [launch is Spain only](2026-10-22-cloud-production-deployment-design.md#11-day-one-and-what-it-costs). Propose Spanish recipients initially; publish the qualified country list before enablement. Foreign guest numbers need separate qualification; venue country does not determine recipient country.

Fifty one-part security codes cost €1.71 at survey GatewayAPI, €1.95 at checked 360NRS or $3.50 at AWS; 200 booking messages cost €6.84/€7.80/$14 respectively. These are cost examples, not inclusions or promises; they motivate the separate paid-bookings decision.

WhatsApp is an optional comparison: survey authentication/utility €0.0166/message, €3.32/200 before extras/tax. The driver could not reverify that number because Meta returned 429/login; see [official pricing](https://developers.facebook.com/docs/whatsapp/pricing/). Recipients need WhatsApp, opt-in and approved templates. Eligibility/privacy remain unqualified; no integration or fallback is chosen, and it does not replace SMS.

## Sender and message bounds

[Spain sender registration](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-spain.html) requires CNMC brand registration, provider-specific onboarding and qualifying certificate/representative credentials. Company/brand eligibility is not assumed. Exact casing matters; generic aliases are prohibited; unregistered aliases have been blocked since 15 September 2026. Propose a shared Waitron brand. Only if AWS is chosen: obtain its provider-details form, complete CNMC registration/verification, then submit to AWS.

[Encoding limits](https://docs.aws.amazon.com/sms-voice/latest/userguide/sms-limitations-character.html): The GSM7 alphabet usually fits 160 characters in one part, 153 in each multipart part; extension characters count twice. Other text fits 70 units, 67 per multipart part; some symbols use two units. Propose fixed GSM7 EN/ES templates, checked at worst-case bounded substitutions, rejecting over one part to bound message cost, not impose a security quota. Spanish é/ñ fit GSM7; á/í/ó/ú do not. For example, use “Tu codigo de Waitron es {code}” and “Reserva {date}, {time}”. Omit guest names or reject incompatible values; never silently strip their accents or truncate.

Provider choice comes first. Supplier/privacy, retention, supported countries, sender eligibility, numeric abuse bounds, billing commercial values and Waitron integration remain open. Qualify provider credit and sending capacity so bookings cannot exhaust security capacity before enablement.
