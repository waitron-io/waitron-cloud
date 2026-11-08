# D610: Venue SMS gateway

**Design only, revised 8 November 2026.** Choose SMS when receiving a text is easier than opening email. Email remains the default for a sign-in check; SMS cannot replace an enrolled authenticator app or sign you in by itself. The owner chose GatewayAPI. Registered (level 1, free) includes 10 texts per Cloud account a month; Connected (level 2) includes 25; Hosted (level 3) includes Connected. Monthly figures are initially unenforced. The 60-second request wait permits up to 1,440 texts per phone and purpose a day, with no cap on phones per account. This is not a spending cap. Nothing is built or approved for provider access, spending or implementation.

Owner and supervising reviewer decisions are recorded with dates in the [revision plan](../plans/2026-11-08-cloud-sms-design-revision.md). The D608 owner-lifecycle draft is separately being revised to the settled 8 November sign-in rules; this gateway decides neither recovery nor which proof an account needs.

## Codes and monthly figures

SMS carries codes for phone confirmation and a second check the person chooses. A venue registered with Cloud can request SMS from Waitron at every level; registration here means pairing its box, not buying the Connected level. Cloud's own account sign-in process supplies its account and country, never a caller-selected account; a venue box cannot issue Cloud-owner codes.

Count every send per account, including phone confirmation and uncertain provider replies. Refusing before submission counts zero; an unchanged retry keeps its message ID and count. Templates fit one encoded part per text. Monthly enforcement starts off, with a configurable limit that can later be enabled or raised. The [billing design](2026-10-29-cloud-billing-design.md#3-allowances-owner) makes this an exception to per-venue allowances and refusal at a monthly limit. **Open:** which single figure applies to an account with several venues or mixed levels, and whether the paid figure replaces or adds to the free one.

Only the request wait restrains sending initially: one account can repeatedly request codes to a number it does not control. Assuming the earlier €0.0342 survey price per part, 1,440 texts cost about €49 before extras/tax; 10 cost €0.342 and 25 cost €0.855. This is an assumption, not a verified current tariff. Confirm the [actual route price](https://gatewayapi.com/pricing/) before enablement. No extra quota is chosen here.

## Requesting a code

Reuse the [email relay's authority rules](../../transactional-email-relay-contract.md#authority-belongs-to-an-installation-and-a-consenting-account): authenticate the paired box and derive its consenting account, venue and country. Cloud owns delivery and account counting; Waitron owns its codes and checks replies. Keep customer records and credentials in-country. Owner consent to the service is separate from proving control of a phone. The first confirmation text necessarily goes to an unproven number; its recipient-consent rule remains to settle before enablement.

Callers supply one international-format phone number, purpose, template name, values, English/Spanish language, expiry and a message ID kept across retries. Cloud holds the fixed templates. Refuse free text and any value outside its template's allowed type and length: a code is digits; a time is a time. Refuse caller-selected senders, country overrides, credentials, marketing and expired requests. Recheck current authority and consent before sending, including after queue delays. Never log raw phones, codes or bodies.

Enforce 60 seconds between requests per phone number and purpose, regardless of account or browser. Five wrong guesses end a sign-in attempt; resending cannot reset that count. Codes expire and work once. **Open:** apply that same guess cap to phone confirmation too? Wait message: “Code not sent. Try again at {time}” / “Código no enviado. Inténtalo de nuevo a las {hora}”. Another permitted proof must not weaken enrolled proof requirements.

Use one small send function returning accepted, rejected or unknown. If the provider's answer is unknown, count the message and do not resend it; the person can ask for a new code after the wait. Never send expired codes. Provider acceptance does not establish delivery, and a send already underway cannot be recalled.

## Before enablement

Fixed English/Spanish templates, with digit-only code values, must fit one encoded part at their largest permitted size. For example: “Your Waitron code is {code}” / “Tu clave de Waitron es {code}”. Reject oversized or incompatible values, without truncating or stripping accents. GatewayAPI's [encoding guidance](https://gatewayapi.com/docs/limitations/) and [special-character example](https://gatewayapi.com/help-center/special-characters/), read on 8 November, explain why characters such as “á” can increase the number of charged parts. Real delivery remains untested.

Refuse destinations outside Spain until separately qualified. Sender-brand eligibility and registration, provider privacy/processing location, and final templates/delivery remain unqualified. Booking messages are outside this revision; any future booking SMS offer needs the guest's opt-in. No paid-booking mechanism, WhatsApp integration or automatic alternative delivery is designed here. Waitron and Cloud integration remains to build after approval.
