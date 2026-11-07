# One Cloud owner: handover and lost access (D608)

**Design only; nothing built.** Owner direction below is accepted; mechanics and displayed defaults await Claude/owner final review. First-draft review does not approve this revision. No implementation or landing is authorised.

Authority: watcher 2026-11-07 21:29 records five accepted owner rules, including “If the user has set up 2FA then we should require that for a login or to change a password”. Watcher 21:32 adds: “An account's strongest factor decides.” The earlier mailbox-independent handover question and SMS-reset recommendation are withdrawn.

## Your email and strongest factor

Without an enrolled factor, your verified email is your entire identity, as at signup. There is no personal/business identity to investigate or promise of protection against mailbox takeover before enrolment. You must enrol a second factor BEFORE connecting a venue box, enabling remote access or adding a payment method. Completion rechecks this; sessions, passkeys and alternate routes cannot bypass it. No platform permission is added.

If an app or passkey is enrolled, login, password changes and reset completion require strong proof. Sign in with your password plus the app or a saved one-use recovery code, or with a verified passkey. To reset, use your verified-mailbox link plus the app, passkey or recovery code. A passkey does not also need an app. The conservative interpretation excludes weaker SMS-only sign-in when an app/passkey exists: password/SMS access could otherwise reach security settings and replace stronger protection.

SMS as your sole factor satisfies required enrolment and counts for sign-in and reset. Reset requires BOTH the mailbox reset link and a code to your ALREADY enrolled number, never SMS alone. Strongest-factor checks also govern handover, risky-action approval and adding, removing or changing factors/phone numbers. Mailbox-only, password-only and old SMS sessions cannot downgrade protection; use current accepted proof or the paired-box reset below. Password reset must preserve enrolled factors.

Source reading at `601334260c7e`, not runtime verification: [password-login.ts:95](../../../packages/registration/src/password-login.ts#L95) issues the enrolled-app challenge; [line 41](../../../packages/registration/src/password-login.ts#L41) consumes recovery codes. [password-recovery.ts:53](../../../packages/registration/src/password-recovery.ts#L53) completes without checking a factor; [line 76](../../../packages/registration/src/password-recovery.ts#L76) preserves it and ends sessions. Factor-protected reset is a correction, not existing behaviour. Passkey user verification is required at [passkeys.ts:136](../../../packages/registration/src/passkeys.ts#L136) and [line 170](../../../packages/registration/src/passkeys.ts#L170), with session creation at [line 179](../../../packages/registration/src/passkeys.ts#L179). Audit every sign-in route against this strongest-factor rule; do not invent another factor standard.

## Recover the same owner

If app/passkey access is lost, a saved recovery code counts. If ALL usable factors and codes are lost, an administrator signed in locally on your venue's currently paired box may approve resetting the SAME Cloud owner's access. This proves venue control, not permission to reassign ownership. Approval must establish actual local administrator authority and bind the exact Cloud account, venue, country and request, expire and work once. Email or browser claims cannot approve it.

Cloud owns the reset and binding checks; Waitron must supply the local administrator approval. That integration is unbuilt. Without a usable paired box and administrator, total loss remains unresolved and recovery unavailable. Support and Cloud operators have no override; no recovery desk or identity service is introduced.

## Hand over one organisation

You sign in with your strongest factor and name the recipient's email. The recipient verifies that address, signs in, sets up their OWN factor and accepts the exact transfer. At acceptance, one atomic replacement removes your organisation access and installs the sole new owner. There is no later sender confirmation. First-time recipients need country account-only signup, without inventing an organisation/business; current [signup.ts:71](../../../packages/registration/src/signup.ts#L71) creates both.

Pending, cancelled or expired transfers give recipients no access and leave you owner. Draft defaults, not approved policy: one pending transfer per organisation and a displayed 24-hour expiry. Changing recipient requires cancellation. Security changes, including password reset/change and factor, phone or passkey changes, cancel affected pending flows. Completion rechecks recipient, current owner/version, country, authentication and time after waits; concurrent acceptance/cancellation has one outcome. A bounded retry after a lost reply returns that outcome without repeating replacement; private results require current authority.

Preserve [P3 §3](../plans/2026-10-22-cloud-global-country-split.md#3-single-owner-authority-and-future-handover): revoke affected management sessions, ownership operations, recovery/replacement approvals, support grants, relay/translation consent and queued private alerts/work before dispatch. Invalidate stale reset/enrolment/acceptance paths. Renew consent independently. Active recovery/replacement must reach a known outcome before transfer. Unrelated organisations/accounts and independently authorised machine services remain; shared-session termination may require signing in again. Completed external effects remain facts. Country history, generic replies, shared attempt limits and notices to both verified addresses protect the flow; mail links grant no authority.

Only one country organisation transfers. Taxpayer/legal-business identity stays unchanged; a sale to another taxpayer needs separate Waitron handling. Cloud ownership grants no Waitron staff, support, operator, fiscal or activation authority. P3's independent Waitron/fiscal gates remain.

## SMS beside the app

SMS is weaker: SIM swapping can steal your number, and phone changes can divert codes ([NCSC](https://www.ncsc.gov.uk/guidance/protecting-sms-messages-used-in-critical-business-processes)). SMS-only owners must keep recovery codes. Codes must be short-lived and single-use, with shared attempt/resend caps limiting guesses and spending.

Public facts supplied by the driver's 2026-11-07 checks: [SES](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html) “is an email platform”; Pinpoint SMS/MMS/voice “are now called AWS End User Messaging” ([AWS](https://docs.aws.amazon.com/sms-voice/latest/userguide/what-is-sms-mms.html)). [Pricing](https://aws.amazon.com/end-user-messaging/pricing/) and its [CSV](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/business-applications/approved/documents/End-User-Messaging-SMS-Prices.ebc340b4d416d90832dd59629c4792b0deb6f8bc.csv) list Spain at US$0.07 per outbound SMS segment: one-segment code US$0.07; retries/longer messages add cost. This is neither voice/RCS nor a separate OTP-verification price.

For branded +34 messages, [AWS Spain guidance](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-spain.html) says “All alphanumeric sender IDs” “must be registered”. Create the AWS form for provider details, complete CNMC National Alias Registry registration using a qualifying digital certificate or authorised representative, then submit the AWS form. Exact case must match; generic names are forbidden; unregistered names are blocked from 15 September 2026. No certificate/registration is assumed. Dedicated numbers require separate AWS registration/monthly charges and are outside this design. No account, registration, spending, sender or send is authorised.

Future acceptance examples: a mailbox thief cannot reset app-protected access; an SMS-only owner needs link plus code; recipient acceptance immediately ends former-owner access. These are unexecuted outcomes.
