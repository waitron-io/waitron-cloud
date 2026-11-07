# D610: Venue SMS gateway

**PROPOSED, design only, 2026-11-07.** Allowances/pricing unapproved; no implementation or landing authorised. Watcher 2026-11-07 21:34 records the owner: “add the SMS service to cloud as well, I think it is something we want to provide on the free level (or maybe the first paid level)”.

## Purpose and ownership

Offer SMS through Cloud like email. Proposed callers are staff/owner sign-in codes and guest booking confirmation, change, cancellation and reminder messages. Source inspection at Waitron `9086f8d54eb5b231de3d0949647a80f2b144333f` found no SMS sender (`git grep -n -i -E '\b(sms|twilio|vonage)\b' 9086f8d54eb5b231de3d0949647a80f2b144333f -- packages apps ':!*.test.ts'`). [Bookings](https://github.com/clintongormley/waitron/blob/9086f8d54eb5b231de3d0949647a80f2b144333f/packages/bookings/src/bookings.ts#L66-L92) store `contactPhone`, without notifications. [Account email](https://github.com/clintongormley/waitron/blob/9086f8d54eb5b231de3d0949647a80f2b144333f/apps/server/src/account-email.ts#L48) covers invitations, password resets and email changes. This was source reading, not runtime verification; existing sign-in methods remain separate. Neither SMS login nor booking sending is built.

Cloud owns the shared contract, provider and allowances under [documentation ownership](../../documentation-ownership.md); future Waitron integration is separately assigned. Leave existing location reads untouched; add nothing to them.

## How your box asks

Reuse installed machine authentication, lease, current pairing and consenting-account authority from the [email contract](../../transactional-email-relay-contract.md#authority-belongs-to-an-installation-and-a-consenting-account). Submit one verified international phone recipient, allowed purpose, fixed template with bounded fields, locale, expiry and stable message ID for safe retries. Cloud derives account, venue and country. Reject arbitrary text, sender, country overrides and credentials. Use a fixed approved sender; no marketing.

Waitron owns code validation, phone verification, action/recipient authority and booking consent. A template is not arbitrary-send permission. Recheck account ownership, grants and pending authority at admission and before sending, including after waits; unreadable authority never permits sending.

Same ID and fields returns saved status; mismatched fields refuse. Retries must not duplicate messages. Never blindly replay ambiguous provider submissions. Recheck expiry before handoff; never submit expired codes/reminders. In-flight delivery cannot be recalled. Admission means queued/accepted, not delivered. Reuse existing queue patterns with protected payloads, not a claim that email currently supports SMS. Encrypt customer payloads; log no raw phone, code or body.

## Proposed allowance and limits

Recommend monthly **level 1: 10 segments per account across boxes; level 2: 50 per venue; level 3: the same 50**. Paid venues cannot also draw from the free balance. A no-payment trial gets 10 within that account's shared free limit; a payment-backed trial gets 50 per venue. These are proposals, not billing policy.

Reset on UTC calendar months, without rollover. Upgrades/downgrades do not refill the same period. Atomically reserve encoded segments at admission, retaining original period/attribution across retries. Rejected requests cost zero; retries cost zero extra. Retain reservations through unknown status; release only for proven absence of provider submission, never refund twice.

Cloud-own D608 security SMS has separate bounded capacity, outside venue pools. Venue sign-in codes share the venue allowance. Before opting into SMS, offer a local app/passkey/recovery option. Never bypass a required factor or treat email alone as a second factor. This creates no reset identity rule or unlimited security bypass.

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

[AWS Spain guidance](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-spain.html) says “All alphanumeric sender IDs” “must be registered” with CNMC. Create the AWS form for provider details, complete CNMC using a qualifying digital certificate or authorised representative, approve its verification, then submit AWS. Exact casing matters; generic aliases are prohibited. Propose a shared Waitron brand rather than venue-specific names, subject to approval; neither brand eligibility nor registration is promised.

[AWS character limits](https://docs.aws.amazon.com/sms-voice/latest/userguide/sms-limitations-character.html): one segment holds 160 GSM7 or 70 Unicode characters; multipart holds 153/67 per part. Count encoded segments, not visible messages. Prefer rejecting templates exceeding one segment over silent truncation. Spanish Unicode samples can exceed the limit.

A café's 10 Spanish one-part messages cost $0.70; 50 cost $3.50; 200 reminders cost $14, or $28 at two parts each. $14 is significant beside [billing's working €10 level-2 price](2026-10-29-cloud-billing-design.md#2-the-three-levels-owner); currencies are not equivalent. Small free plus paid 50 explicitly departs from §3's goal that normal venues never hit allowances. Including 200 needs an owner subsidy/pricing decision.

## Acceptance and decision

Examples: an identical retry returns saved status without another segment; changed recipient under that ID refuses; revoked consent blocks pending sending; an expired reminder is not submitted; exhaustion shows the reset date in both languages.

One owner question for the watcher: approve free 10 plus paid 50, as recommended, or level-2-only 50? All other defaults above remain proposed. Country/supplier qualification, privacy/retention, sender registration, numeric abuse bounds and separate Waitron agreement remain open before enablement.
