# One Cloud owner: handover and lost access (D608)

**Design only; nothing built.** Each organisation has one Cloud account owner in its country. A passkey signs you in alone; an enrolled app requires password plus its code. Password-only accounts need an email check on a new device. Risky actions ask for proof again. Before box connection, remote access or adding a payment method, you must enrol an app, passkey or SMS. Handover replaces you with one verified recipient at acceptance. Lost-proof recovery needs your mailbox and a local administrator on a currently paired box. The owner settled recovery limits, recovery codes, transfer defaults and recognised-device reset effects on 9 November 2026, as recorded below.

The owner’s settled 8 November 11:25 sign-in rules replace earlier sign-in/reset proposals. Watcher 13:13 approves this revision with the corrected 12:08 enrolment rule. The owner approved the five remaining choices on 9 November 2026; watcher 13:06 authorised recording them and landing this design. Nothing authorises implementation or verifies runtime behaviour.

## Sign in, then prove risky actions

A sign-in proof is an authenticator app code, SMS code or passkey verified by unlocking your device. Each country has its own account; two countries mean two accounts.

- A verified passkey signs you in alone. The browser offers saved passkeys; “Remember me” remembers that preference and goes straight to it. Never reveal whether an email has an account or passkey.
- With an app enrolled, password sign-in always asks for its code. Every owner with an app, passkey or SMS enrolled gets single-use recovery codes. A recovery code may stand in for any of those methods (owner, 2026-11-09).
- If you use a password instead of an unavailable passkey, ask for an app code when enrolled; otherwise email a code, with SMS only if you choose it. SMS cannot bypass an enrolled app.
- With neither app nor passkey, password alone works on a familiar device/browser. A new one needs email, or chosen SMS, then is remembered. Device recognition differs from remembering a passkey preference; its mechanism and expiry are unchosen.
- An administrator setting, off by default, can require everyone signing in to set up an app or passkey.

Before connecting a venue box, enabling remote access or adding a payment method, require at least one enrolled proof: app, passkey **or SMS**. Check every start and completion route, including after waits, for existing owners and recipients inheriting a connected organisation. This does not require an app or passkey when SMS is enrolled.

Ask for the sign-in proof again for handover; password, email or proof changes; downloading/restoring backups; payment methods; box connection; and remote access. Use a passkey, app code, or for a password-only account an email code, with chosen SMS where permitted. An alternative sign-in cannot bypass an action’s required proof. Password-only accounts rely on mailbox control for their reset and email checks.

A mailbox link resets only the password. Keep enrolled proofs; the next sign-in follows them. End sessions and cancel pending enrolments/challenges. Forget recognised devices: the next sign-in on each needs the email or SMS check again (owner, 2026-11-09). Email/SMS codes expire, work once, bind to one sign-in/action and limit requests and guesses; choose no new numbers here. These sign-in, recognition and action checks remain to build and test.

## Recover the same owner

First use an available proof or single-use recovery code. If all are lost, an administrator signed in locally on your venue’s currently paired box may approve recovery. Pairing registers that venue computer with Cloud. The venue must currently belong to an organisation your account owns. Establish actual local administrator authority and bind the current pairing, exact account, venue, country and reset request. Approval expires and works once. Recheck ownership and every relationship at completion; browser/email claims cannot approve recovery.

Box approval replaces missing proof; the verified-mailbox reset link remains required. Watcher 7 November 21:54 accepted this combination, subject to owner overrule, so box access alone cannot take your account. Invalidate lost proofs and sessions, require fresh enrolment before account access and notify your verified address. Restore the same account, never assign a different owner. Box-approved recovery reaches only the organisation of that venue’s paired box, never every organisation the account owns (owner, 2026-11-09).

Cloud checks the request and relationships; Waitron supplies local administrator approval. Integration is unbuilt. Without the mailbox or usable paired box, this route is unavailable. If you lose every usable recovery route, there is no manual or staff route back and no support or operator override (owner, 2026-11-09).

## Hand over one organisation

You sign in, provide fresh proof and name the recipient’s email. They verify it, sign in, enrol their own proof and explicitly accept the exact transfer. First-time recipients need account-only signup; current signup also creates a business. One database transaction replaces the sole owner and revokes your organisation access together, at acceptance; no later confirmation from you.

**Approved defaults (owner, 2026-11-09):** one pending transfer per organisation, displayed 24-hour expiry and cancellation by either participant. Completion remains at the recipient’s acceptance, with no later confirmation from the current owner. Pending, cancelled or expired transfers leave you owner and give no recipient access. Changing recipient requires cancellation. Security changes cancel affected transfers, except the recipient’s required initial enrolment, which binds fresh proof to that transfer.

After waits, completion rechecks exact parties, current ownership and its recorded version, country, authentication and expiry. Competing acceptance/cancellation has one outcome. A lost-reply retry returns that outcome; only currently authorised people may read private results. Avoid account-existence leaks; limit attempts and notify participants.

The [country-account plan](../plans/2026-10-22-cloud-global-country-split.md#3-single-owner-authority-and-future-handover) requires immediate revocation of former-owner sessions, approvals, support grants, consent and queued work. Renew consent independently. Recovery/replacement underway must reach a known outcome first. Unrelated organisations and independently authorised machine services remain. Taxpayer identity stays unchanged; a different taxpayer needs separate Waitron handling. Ownership grants no staff, support, worldwide operator, fiscal or server-activation powers; each retains separate permission checks. Customer authority and recovery stay in-country.

## SMS delivery stays separate

SMS confirms a phone or supplies a chosen second check through Cloud’s fixed templates. Registered includes 10 texts per venue/month; Connected 25; Hosted includes Connected (owner, 2026-11-09). Monthly figures start unenforced. D610’s draft `docs/superpowers/specs/2026-11-07-cloud-venue-sms-gateway-design.md` owns venue counting, the day-one daily cap, EU destinations, request/guess limits, warnings and delivery qualification. It replaces the old separate security/booking-capacity proposal; no provider access, sending or unlimited-use promise follows here.
