# D610: Venue SMS gateway

**PROPOSED, design only, 2026-11-07.** Allowances/pricing unapproved; no implementation or landing authorised. Watcher 2026-11-07 21:34 records the owner: “something we want to provide on the free level (or maybe the first paid level)”.

## Purpose and ownership

Offer SMS through Cloud like email. Staff/owner sign-in codes are proposed only if Waitron wants them; guest booking confirmation, change, cancellation and reminder messages are also proposed. Source reading at Waitron `9086f8d54eb5b231de3d0949647a80f2b144333f`, not runtime verification, found no SMS sender. [Bookings](https://github.com/clintongormley/waitron/blob/9086f8d54eb5b231de3d0949647a80f2b144333f/packages/bookings/src/bookings.ts#L66) store `contactPhone` without notifications. [Account email](https://github.com/clintongormley/waitron/blob/9086f8d54eb5b231de3d0949647a80f2b144333f/apps/server/src/account-email.ts#L48) covers invitations, password resets and email changes. Neither SMS login nor booking sending is built.

Cloud owns the contract, provider and allowances under [documentation ownership](../../documentation-ownership.md); Waitron integration needs separate work. Scope every request to one venue and its paired box.

## How your box asks

Reuse the [email gateway's authority](../../transactional-email-relay-contract.md#authority-belongs-to-an-installation-and-a-consenting-account), queue protection and retry rules; its [current message classes](../../../packages/registration/src/relay-payload.ts#L9) exclude SMS. The authenticated, currently paired box submits one recipient, allowed purpose, fixed template with bounded fields, locale, expiry and stable message ID. Cloud derives account, venue and country; no arbitrary text, sender, country override, credentials or marketing. Recheck consent and authority after waits and before sending.

For codes, Waitron must verify possession of the enrolled number. For guests, require valid international format and recorded booking-message consent; a stored phone field alone is insufficient, and this does not claim verified possession. Waitron owns those checks and code validity. Cloud uses an approved sender, encrypts queued payloads and logs no phone, code or body. An identical retry returns saved status; changed fields refuse. Never blindly resend an uncertain provider submission or submit expired codes/reminders. “Queued” is not “delivered”; in-flight delivery cannot be recalled.

## Proposed allowance and limits

Recommend monthly **level 1: 10 segments per account across boxes; level 2: 50 per venue; level 3: the same 50**. Paid venues cannot also draw from the free balance. A no-payment trial gets 10 within that account's shared free limit; a payment-backed trial gets 50 per venue. This tighter no-payment trial extends billing’s AI-only trial rule to SMS. These are proposals, not billing policy.

Propose UTC calendar-month resets, without rollover. Upgrades/downgrades do not refill the same period. Atomically reserve encoded segments at admission, retaining original period/attribution across retries. Rejected requests cost zero; retries cost zero extra. Retain reservations through unknown status; release only for proven absence of provider submission, never refund twice.

Cloud account-security SMS is not built; if added, it needs separate bounded capacity outside venue pools. Venue codes and booking messages share one allowance with no reserved portion. Enable venue SMS sign-in only after an alternative valid sign-in method is enrolled and usable, and explain that bookings can exhaust its SMS allowance. That alternative is Waitron’s to define and build, not a promise of new identity methods. Never bypass a required factor or treat email alone as a second factor. This creates no reset identity rule or unlimited security bypass.

Apply independent short-lived per-recipient, resend, installation, account and global spend caps, plus a recipient-country allowlist. Numeric launch bounds need owner qualification. Free-account creation abuse remains real; these caps do not establish safety.

At exhaustion show “SMS not sent. Resets {date}” / “SMS no enviado. Se restablece el {fecha}”. Stop reminders rather than accumulating them. Offer email only when already configured, agreed and available; never silently switch channels. Login uses an existing valid alternate proof if enrolled, not unlimited email fallback. Recovery stays box-owned; trading continues. No surprise bill, top-up, new price or extra SMS charge.

## Supplier, destinations and cost

Recommend AWS End User Messaging SMS, without purchase. [SES](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html) “is an email platform”. Pinpoint SMS/MMS/voice “are now called AWS End User Messaging” ([AWS](https://docs.aws.amazon.com/sms-voice/latest/userguide/what-is-sms-mms.html)). [AWS pricing](https://aws.amazon.com/end-user-messaging/pricing/) and its [SMS CSV](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/business-applications/approved/documents/End-User-Messaging-SMS-Prices.ebc340b4d416d90832dd59629c4792b0deb6f8bc.csv), read 2026-11-07, give these illustrative outbound USD costs, excluding applicable extras/tax and subject to change:

| Recipient destination | Per segment | 200 segments |
| --- | ---: | ---: |
| Spain | $0.07 | $14.00 |
| Portugal | $0.03031 | $6.062 |
| France | $0.07401 | $14.802 |
| Italy | $0.08 | $16.00 |
| UK | $0.05 | $10.00 |

Only Spain is the [planned launch](2026-10-22-cloud-production-deployment-design.md#11-day-one-and-what-it-costs); other rows are illustrative destinations, not expansion. Tourists may have foreign numbers: venue country is not recipient country. Propose initially sending only to Spanish numbers, publishing the supported list before enablement. The watcher must identify next markets before committing a broader allowlist.

[AWS Spain guidance](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-spain.html) says “All alphanumeric sender IDs” “must be registered” with CNMC. Create the AWS form for provider details, complete CNMC using a qualifying digital certificate or authorised representative, approve its verification, then submit AWS. Unregistered aliases have been blocked since 15 September 2026. Exact casing matters; generic aliases are prohibited. The Waitron company and qualifying registration credentials are not assumed to exist. Propose a shared Waitron brand rather than venue-specific names, subject to approval; neither brand eligibility nor registration is promised.

[AWS character limits](https://docs.aws.amazon.com/sms-voice/latest/userguide/sms-limitations-character.html): one segment holds 160 GSM7 or 70 Unicode characters; multipart holds 153/67 per part. Count encoded segments, not visible messages. Propose checking templates at their longest allowed field values and refusing anything over one segment; never truncate silently. Some Spanish accented letters force the shorter limit.

A café's 10 Spanish one-part messages cost $0.70; 50 cost $3.50; 200 reminders cost $14, or $28 if two-part messages were allowed. $14 is significant beside [billing's working €10 level-2 price](2026-10-29-cloud-billing-design.md#2-the-three-levels-owner); currencies are not equivalent. Small free plus paid 50 explicitly departs from §3's goal that normal venues never hit allowances. Including 200 needs an owner subsidy/pricing decision.

## Acceptance and decision

Examples: an identical retry returns saved status without another segment; changed recipient under that ID refuses; revoked consent blocks pending sending; an expired reminder is not submitted; exhaustion shows the reset date in both languages.

One owner question for the watcher: approve free 10 plus paid 50, as recommended, or level-2-only 50? All other defaults above remain proposed. Country/supplier qualification, privacy/retention, sender registration, numeric abuse bounds and separate Waitron agreement remain open before enablement.
