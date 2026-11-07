# One Cloud owner: handover and lost access (D608)

**Design only; nothing built.** Watcher 2026-11-07 21:29 records the owner's accepted direction: protect login/reset with an enrolled factor, require enrolment before box/remote/payment actions, recover through a paired-box administrator, hand over at recipient acceptance, and add SMS. Details labelled **Proposed** still need owner acceptance. No implementation or landing is authorised.

Watcher 21:32 records the owner:

> An account's strongest factor decides. If the owner has set up an authenticator app or a passkey, SMS alone does not complete a password reset (the app, a passkey or a recovery code does); SMS may still be offered for sign-in only if you show why that is safe, otherwise not. If SMS is the account's only factor, SMS is the factor for both sign-in and reset.

## Your email and strongest factor

Without an enrolled factor, your verified email is your entire identity, as at signup. There is no personal/business identity to investigate. You must enrol a factor before connecting a venue box, enabling remote access or adding a payment method, including alternate routes and completion after waits. A user-verified passkey counts, as do the app or SMS. This gates the next such action, including for existing accounts.

With an app/passkey enrolled, sign in with password plus app/recovery code, or a verified passkey. Password changes require current strong proof; reset requires your verified-mailbox link plus app, passkey or recovery code. A passkey needs no extra app. Exclude weaker SMS sign-in when an app/passkey exists: a stolen password and SIM would otherwise expose account data. No safe weaker route has been demonstrated.

With SMS as your sole factor, sign-in requires password plus SMS; reset requires the mailbox link plus a code to your already enrolled number. **Proposed:** a saved recovery code can replace that SMS proof. SMS alone never resets a password. Strongest-factor checks also govern handover, the three actions above, and factor/phone changes. Mailbox-only, password-only and old SMS sessions cannot downgrade protection. Ordinary password reset preserves factors.

Source reading in this branch, not runtime verification: [password-login.ts:95](../../../packages/registration/src/password-login.ts#L95) checks only the app, then issues its challenge. Without an app, even a passkey-only account currently gets a session from its password alone; [line 41](../../../packages/registration/src/password-login.ts#L41) consumes app-bound recovery codes. [Reset completion](../../../packages/registration/src/password-recovery.ts#L53) checks no factor; [line 76](../../../packages/registration/src/password-recovery.ts#L76) preserves factors and ends sessions. Both password login and reset must recognise enrolled passkeys and the strongest-factor rule. [Passkeys](../../../packages/registration/src/passkeys.ts#L170) already require user verification and [create a session](../../../packages/registration/src/passkeys.ts#L179). **Proposed:** issue saved single-use recovery codes for every factor type, including SMS/passkey-only enrolment; changing the factor set replaces old codes. These are new capabilities.

## Recover the same owner

First use an available factor or, as proposed above, a saved code. If all factors/codes are lost, the owner's rule permits an administrator signed in locally on the venue's currently paired box to approve recovery. The approving venue must currently belong to an organisation that the recovering account owns. Approval binds actual local administrator authority, current pairing, exact Cloud account, venue, country and reset request, expires and works once. Recheck ownership and these bindings when recovery completes. Email/browser claims cannot approve it.

**Proposed:** box approval replaces only the missing factor proof; the verified-mailbox reset link remains required. This prevents venue staff with box access alone taking the owner's account. This exceptional recovery invalidates lost factors and sessions, requires a new factor before account access, and notifies the verified address. It restores the same account, including its other organisations: one venue's box plus that account's mailbox can therefore recover all of them. It never assigns a different owner.

Cloud owns reset/binding checks; Waitron must supply the local administrator approval. That integration is unbuilt. Without a usable paired box/administrator, or without the mailbox, total loss remains unresolved and recovery unavailable. There is no support/operator override or identity service.

## Hand over one organisation

You sign in with your strongest factor and name the recipient's email. The recipient verifies that address, signs in, enrols their own factor and accepts the exact transfer. At acceptance one transaction replaces the sole owner and ends your organisation access. There is no later sender confirmation. First-time recipients need country account-only signup; [current signup](../../../packages/registration/src/signup.ts#L71) creates an organisation/business too.

**Proposed defaults:** one pending transfer per organisation, displayed 24-hour expiry, and either participant can cancel. Pending/cancelled/expired transfers leave you owner and give the recipient no access. Changing recipient requires cancellation. Security changes cancel affected pending transfers, except the recipient's required initial enrolment, which binds their fresh proof before acceptance. Completion rechecks exact parties, current ownership version, country, authentication and expiry after waits; competing acceptance/cancellation has one outcome. A lost reply resumes that outcome; private results require current authority.

[P3 section 3](../plans/2026-10-22-cloud-global-country-split.md#3-single-owner-authority-and-future-handover) supplies immediate revocation of former-owner sessions, approvals, support grants, consent and queued work, independent consent renewal, generic replies, attempt limits and notifications. Active recovery/replacement must reach a known outcome first. Unrelated organisations and independently authorised machine services remain. Taxpayer/legal-business identity stays unchanged; a different taxpayer needs separate Waitron handling. Ownership grants no Waitron staff, support, operator, fiscal or activation authority; P3's independent gates remain.

## SMS beside the app

SMS is weaker: SIM swapping can steal a number ([NCSC](https://www.ncsc.gov.uk/guidance/protecting-sms-messages-used-in-critical-business-processes)). **Proposed:** short-lived single-use codes, shared attempt/resend caps, and Cloud account-security SMS separate from venue messaging allowances so an exhausted allowance cannot block sign-in. This is no unlimited-send promise.

Public sources checked 2026-11-07: [SES](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html) “is an email platform”; Pinpoint SMS/MMS/voice “are now called AWS End User Messaging” ([AWS](https://docs.aws.amazon.com/sms-voice/latest/userguide/what-is-sms-mms.html)). AWS's [pricing page](https://aws.amazon.com/end-user-messaging/pricing/) and [CSV](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/business-applications/approved/documents/End-User-Messaging-SMS-Prices.ebc340b4d416d90832dd59629c4792b0deb6f8bc.csv) list Spain at US$0.07 per outbound SMS segment. One-segment code: US$0.07; retries/longer messages add cost. This is SMS delivery, not separate OTP verification.

For branded +34 messages, [AWS](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-spain.html) says “All alphanumeric sender IDs” “must be registered”. Create the AWS form for provider details, complete CNMC National Alias Registry registration with a qualifying digital certificate or authorised representative, then submit the AWS form. Match case exactly; generic names are forbidden; unregistered names have been blocked since 15 September 2026. No certificate/registration is assumed. No AWS account, sender, registration, spending or sending is authorised.
