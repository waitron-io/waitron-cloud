# Identity and organisations

## Decisions and deliberate limits

The owner selected Amazon SES in an EU region on 2026-10-21, an explicit email
exception to Spain home storage. D102 selects Paris or Frankfurt and qualifies the
account, entities, processing/access locations, retention and tracking controls;
configure the sender and prove live delivery. This selection does not prove setup
or delivery, and does not move venue databases, logs or keys out of Spain.

## Requirements and remaining work

Password helpers and management-session behaviours
have been adapted with a pinned source map, PostgreSQL tests, hashed session/CSRF
tokens, passive polling and separate platform permission checks. Session-backed
Cloud approval derives the account from the live session in its transaction.
Native controller checks also hold business-list, inspection and approval replies
while you change account or connection request, including switching away and back.
Late success, lost replies and refusals leave the current private choices,
pending read, cooldown and feedback unchanged. The current account can still
read its businesses, inspect the request and approve its offered business.
These checks use controlled HTTP replies; server authority remains qualified in CI.
The signup backend now issues hashed, expiring email tokens with a shared per-address
cooldown and creates a verified customer account, named organisation, first legal
business and owner membership atomically. It grants no platform access. Account
and fiscal cooldowns use the singular word for the final second in English and
Spanish; `apps/portal/test/cooldown-browser.test.ts` exercises real 429 replies,
the two-to-one-second transition and expiry with a controlled browser clock.
Sign-in, signup requests and password recovery trim surrounding email whitespace
before validation and sending, including non-breaking spaces left by the browser.
Stubbed Chromium checks cover all three forms in English and Spanish, both themes
and phone/desktop widths; blank, internally spaced and overlong addresses stay
refused, passwords retain their exact bytes and login refusals keep the generic
credentials message. The portal email check follows the server's address grammar,
including local-part and domain-label boundaries, consecutive dots, non-ASCII
addresses and leading zero-width spaces. Sign-in, signup and recovery mark the
email field before sending an address the server refuses. A sign-in HTTP 400
shows validation feedback; wrong credentials keep their single generic answer.
Table checks compare the browser check with the unchanged server normaliser.
The email
adapter is tested with capture/failure adapters and SMTP through local Mailpit.
Password recovery now uses expiring single-use tokens bound to the account, email
and current password hash; completion invalidates older links and revokes all existing
sessions without changing permissions. Unknown/ineligible accounts and delivery
failures receive the same accepted result. Notifications follow commit and cannot
undo a successful reset. Recovery requires verified email and an existing password;
define recovery for legacy unverified and passwordless accounts separately.
Optional passkeys now use discoverable, user-verified WebAuthn credentials. You can
add or remove one only from a live session with your current password and CSRF proof.
You can sign in with a passkey without entering an email address, while password login
and email recovery remain available. Durable five-minute ceremonies are single-use,
exact-origin and exact-RP checks are enforced, and a real Chromium virtual authenticator
proves enrolment, sign-in, replay rejection, account isolation and removal in English
and Spanish. Passkey failures appear once in the relevant alert: beside your passkeys
on Account (including `/`), or in the sign-in error summary. When you cancel a passkey
sign-in prompt, one status message confirms that nothing changed; you can retry.
Starting password sign-in clears that notice. Cancelling Add a passkey also shows
one status message, including when the browser library wraps the cancellation.
Cancelling sends no credential verification request. You can try again; other
prompt failures keep their alert.
Controller and stubbed Chromium checks cover these enrollment outcomes.
Typing your current password enables Add a passkey immediately, so Tab reaches
it without waiting for the next refresh. Clearing the password disables it again.
Frozen-clock keyboard checks cover both languages, themes and phone/desktop widths;
enrollment still disables Add and its password field, keeps password bytes across language
changes and clears the password after success.
Removing a passkey with a blank password marks the password field and shows its
required message beside it, with one section alert and no removal request.
Stubbed Chromium checks cover both languages, themes and phone/desktop widths;
wrong-password alerts and server cooldowns keep their existing behavior.
If reading your passkeys fails, Account offers Retry and does not claim you have
none. Only a successful empty list shows that message. Retry waits for any server
cooldown and disables itself during the read. Navigation keeps the explicit retry
without restarting the read; account changes discard its old success and replies.
Controller and stubbed Chromium checks cover failure, empty-list retry and account
changes; the delayed session-activity wrong-password regression remains covered.
A failed refresh keeps the last-read rows alongside Retry. Stubbed browser
checks cover uncertain removal after a server failure or a lost reply: the
previous keys stay visible through a failed follow-up read and pending Retry.
Only a successful empty list removes them; Retry never repeats removal or
resends your password. These checks cover both languages, themes and widths;
backend authority and provider qualification keep their separate gates.
With two keys, a lost removal reply keeps both rows while the follow-up read
is pending. A successful read confirms removal of the selected key and keeps
the other row, without another removal request. Stubbed Chromium checks cover
both languages, themes and phone/desktop widths.
Lost enrollment replies also reconcile from the list: a newly listed key
confirms success and retains the existing key; an unchanged list keeps the
uncertain-change message. Native Chromium checks hold the follow-up read,
verify disabled controls and cleared password input, and refuse another
ceremony or verification request across both languages, themes and widths.
These stubbed HTTP checks do not qualify backend enrollment authority.
If the list read also fails after a lost enrollment reply, you retain your old
keys and can Retry. Native browser checks hold that retry, retain the old rows
while controls are disabled, then display both old and new keys. Retry neither
repeats enrollment nor resends your password; the failed follow-up clears it.
These checks cover both languages, themes and phone/desktop widths.
Direct controller checks also hold a passkey list read and reject repeated
reads, refresh, sign-in, enrollment and removal independently of disabled
buttons. Suppressed calls retain your password and last-read keys; completing
the read permits the next explicit action. Removing each pending guard makes
its check fail, including the refresh guard that prevents password clearing.
Unsupported browsers keep one help message. Stubbed Chromium checks cover both
languages, themes and widths, repeated cancellation and a later refused attempt.
Passkey and session
controls honour the server’s Retry-After wait, show its countdown and become available
when it ends. Navigation retains the wait; follow-up reads still reconcile uncertain
changes without shortening a longer wait. Stubbed Chromium checks
cover both languages, light/dark themes and phone/desktop widths, with a Chromium
virtual authenticator so the fixture offers passkeys on Linux too. Root-to-Account
navigation now finishes before startup reads begin, so the redirect cannot discard
their replies. A delayed session-activity reply no longer restarts the passkey list
and clears a wrong-password alert. A controlled Linux reproduction captured that
sequence across both languages, themes and widths; a separate browser regression
retains the alert after the activity reply, with the original error checks and
four-second waits unchanged. This addresses the repeated root-route timeout in
CI40062082033, CI40076659731 and CI40080920398; those historical runs did not capture
the request ordering themselves. A failed authenticator status read now keeps its
message and explicit Retry when session activity completes, instead of silently
restarting the read and clearing the error. Retry remains disabled during a read
or server wait; returning to Account refreshes status.
A failed session-list read also keeps its alert and explicit Retry when session
activity completes. Retry cannot duplicate a pending read or bypass the server's
wait. Returning to Account and changing accounts still start a fresh list read.
Stubbed Chromium checks cover both languages, themes and phone/desktop widths;
session revocation and uncertain-reply reconciliation keep their existing checks.
If revocation and its follow-up list read both fail, activity keeps the uncertain
message and Retry too. Retry reads the list without sending the revoke again.
A failed alert-preferences read also keeps its message and explicit Load action
when session activity completes, including after a server wait ends. Loading
cannot duplicate a pending read or bypass the wait. Navigation can retry failed
preferences while keeping a pending read and already loaded choices; changing
accounts discards old replies. A refused Save keeps its message after navigation
and activity; Load reads preferences without repeating the refused save.
Uncertain-save handling keeps its existing checks. Direct controller checks
complete old saves after switching accounts, including switching back to the
original account. Late success, transport failures, refusals and rate limits
leave the current pending read or edited draft untouched. Current reads and
saves still complete; stale replies cannot publish changes or impose a wait.
Stubbed Chromium checks cover both languages, themes and phone/desktop widths.
Sign-out browser checks now wait for startup to settle before opening a passkey
prompt and retain both enabled-button assertions. Held authenticator and
installation replies reproduce an open prompt with Sign out correctly disabled;
after those replies settle, the prompt alone permits sign-out. Direct handler
calls cannot bypass pending startup, and sign-out fences the unfinished prompt.
The real-server check records a bounded trace of fixed request paths and phases,
without bodies or credentials, for another failure. The exact pending operation
in CI40331684104 was not captured; its historical cause remains unconfirmed.
Production pending guards and the original five-second browser wait are unchanged.
A failed translation-consent read keeps its message and explicit Refresh when
session activity completes, including after a server wait ends. Refresh cannot
duplicate a pending read or bypass the wait, and never repeats a consent change.
Navigation retries failed reads while keeping pending and successful reads.
A navigation read blocked by a server wait may start on later activity after
the wait ends. Changing accounts discards old replies. Refused consent changes
retain their message until an explicit read. Consent authority still requires a successful
read. Stubbed Chromium checks cover both languages, themes and phone/desktop
widths; provider and real database behavior still require their separate checks. The authenticator-rotation lock probe now reads only this
fixture's uniquely named database sessions. A real competing `FOR SHARE` waiter
reproduces the old probe's false observation before rotation starts; the scoped
probe must ignore it and then observe rotation's own `FOR UPDATE` wait. The
account-before-child lock assertion, ciphertext reread checks and polling limits
are retained. Production rotation is unchanged. The earlier intermittent failures
did not capture session IDs, so their exact waiter remains unidentified. The account page
now lists only your live management sessions, marks the
current one and shows creation, last-use and effective-expiry times. You can revoke any
session with a CSRF-protected, account-scoped action; uncertain replies reconcile from
the passive list. Revoking the current session returns you to sign-in with the
signed-out notice once the session check confirms it ended. Lost replies still
reconcile; passive session loss stays quiet and expiry keeps its own notice.
Database-free English and Spanish browser checks cover both themes and widths.
Direct controller checks hold an old revocation reply or its follow-up list
across account changes, including switching away and back. Late success,
lost replies and refused requests cannot change the current list, its pending
state or cooldown, show feedback, request another list or recheck sign-in.
Both pending and completed reads for the current account still take effect.
These native checks use controlled HTTP replies; database authority stays in CI.
While your session is checked, the home page uses the account heading in the page
and browser tab. If the check fails, that heading stays above the retry message.
Stubbed Chromium checks cover both languages, themes and phone/desktop widths,
retries and the existing redirects to sign-in or Account.
Revoking your current session starts a fresh session check even if an older
read is pending, subject to the server's retry wait. An older snapshot cannot
replace a newer result. The sign-out notice requires the session check to
confirm sign-out; an unavailable check or an existing wait clears that intent,
so a later passive check stays quiet. Ordinary passive checks share their pending
read; expiry feedback, navigation and new-session fences stay in force.
Stubbed Chromium checks cover current-session revocation in both languages,
themes and phone/desktop widths. Additional light-theme phone checks in each
language cover lost replies, response ordering, waits and passive read sharing.
Database authority runs in CI.
Passkey rows
show their nullable last-use time. English and Spanish Chromium checks cover phone and
desktop layouts, stale authority, concurrent logout/revocation, account isolation and
lost replies. The [bounded history cleanup command](../history-cleanup.md) now previews and
removes ended/expired sessions and consumed/expired WebAuthn ceremonies only after an
operator supplies exact cutoffs; no retention period or automatic deletion is enabled.
The disabled-by-default temporary support grant core reuses these separate customer
memberships and platform permissions. It accepts only configured eligibility permissions
and actions, binds an optional venue, expires and revokes grants, rechecks authority around
protected PostgreSQL work and appends redacted immutable audit events. No HTTP route or
production action is configured. Define the platform role, eligibility and action catalogues,
customer approver policy, emergency route and any SSH session-termination contract before use.
The [optional authenticator-app design](../superpowers/specs/2026-10-12-cloud-authenticator-factor-design.md)
has approved email recovery and session policies: password reset keeps the factor, and
factor changes end every session. Its [implementation plan](../superpowers/plans/2026-10-12-cloud-authenticator-factor.md)
covers storage, account controls and browser acceptance. Storage, API and the bilingual
portal, operational key rotation and private stack configuration are implemented locally.
You can paste spaced authenticator or recovery codes into sign-in and factor controls.
The portal removes whitespace, preserves recovery-code hyphens and refuses empty proof
or activation codes before sending. Passwords and server validation stay unchanged.
`node --test apps/portal/test/authenticator-controller.test.ts` covers each request path.
Blank codes and missing passwords show the existing alert or sign-in summary and
mark only the missing password, proof or confirmation field in English or Spanish
before any request. Correcting and submitting clears the field marker; account
changes, leaving the flow and new requests clear it too. Sign-in, setup, replacement,
activation, removal and code regeneration
retain the entered values for correction; pending requests and cooldowns keep their
existing feedback. Stubbed-route Chromium checks cover correction and submission
in both themes and phone/desktop widths without changing server authority checks.
The populated 34-to-35 upgrade/restore rehearsal and packaged stack clean-install,
restart, rebuild/upgrade and cleanup proofs passed with 35 migrations for the
authenticator release. Current packaged proofs follow the selected release manifest.
The identity primitive
encrypts account/version/purpose-bound
secrets and returns every matching adjacent time step; migration 035 persists factor,
session-bound enrolment, challenge, hashed recovery and replay state. Focused PostgreSQL
and cryptography checks cover constraints, ciphertext binding and preserved upgrade data.
Password challenges now keep you outside a session until a valid authenticator or unused
recovery code completes the check. Focused PostgreSQL tests cover concurrent completion,
durable attempt limits, stale credentials, code reuse and expiry during database waits:
`node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test
test/password-login.test.ts test/identity.test.ts`. Account controls now require your live
session, current password and, for an active factor, fresh proof. Activation, replacement,
removal and recovery-code regeneration end every session together. Email reset preserves
the factor, unused codes and replay history but invalidates pending enrolments and login
challenges. Session cleanup retains factor-referenced rows until a separate retention
policy is approved. PostgreSQL checks cover concurrent changes, durable failed attempts,
passkey access during key outages, reset during password derivation and expiry after writes:
`node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test
test/authenticator-factor.test.ts test/password-recovery.test.ts test/passkeys.test.ts
test/history-cleanup.test.ts`. The account API now returns a cookie-free second-step
challenge after password proof, accepts a single-use factor completion, and exposes
strict session/CSRF-protected account controls. Explicit factor policy supplies shared
account, challenge and IP limits; IP refusals spend no account or challenge allowance.
Separate factor keys and malformed-configuration handling preserve ordinary password
login, passkeys and live account access during an outage. HTTP checks cover strict
bodies, all session-backed route families, independent instances, real server restart,
generic errors and cookie clearing after committed changes:
`node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test
test/authenticator-factor.test.ts test/account-http.test.ts test/passkeys.test.ts
test/account-security.test.ts test/rate-limit.test.ts test/server.test.ts`.
The portal keeps challenges, setup secrets and recovery codes in tab memory. Its QR code
is rendered locally. Successful changes show recovery codes once after signing you out;
lost replies check your session without automatically resending the consumed proof.
Browser checks cover English/Spanish, 390/1280 widths and light/dark themes: enrolment,
replacement, single-use codes, email reset with the factor retained, independent passkeys,
removal, cancellation, lost replies, keyboard focus, accessibility and temporary-state clearing:
`node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test
--test-timeout=120000 test/authenticator-browser.test.ts test/authenticator-rollover.test.ts test/passkey-browser.test.ts
test/account-security-browser.test.ts test/session.test.ts`.
The [operator guide](../authenticator-app.md) documents independent keys, explicit policy,
account-first re-encryption and retained-backup custody. Rotation tests preserve versions,
sessions and proof state, reject wrong/missing keys, and resume interrupted accounts:
`node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test
test/authenticator-keys.test.ts`. The populated 34-to-35 receipt preserves credentials,
sessions and synthetic passkey rows, proves migration rollback/retry and both incompatible
consumer refusals, and restores factor state with matching/wrong/missing-key checks.
`node scripts/schema-upgrade-receipt.mjs /tmp/cloud-factor-upgrade.json --old
65c13f1402041931bdb244007f3cbc267ae61483 --new <full-implementation-commit>`.
The historical upgrade defaults remain unchanged. The packaged stack proof passes
on the complete implementation tree:
`pnpm proof:local-stack`. Its receipt requires healthy services, retained data/identity,
the selected release's complete migration manifest and zero leftover containers,
volumes, networks or proof images.
No production factor policy or key configuration is selected.
Configure live email delivery and production factor policy,
and define the wider platform role catalogue before public use. Shared login/request limits, secure
cookies and Origin/CSRF checks are implemented in the account API. A local streaming
reverse-proxy test now exercises two real account instances with overwritten client
addresses, shared PostgreSQL rate limits, HTTPS cookie attributes, Origin/CSRF,
declared and streamed body bounds, and the slow-body deadline. Validate the selected
production ingress, TLS and bot controls before deployment. Choose
legal and operational cutoffs for sessions, signup requests and password-reset requests,
including reset records for unknown addresses, and measure the dry-run counts against
the expected deployment size before applying them. Signup and password-reset completion now use an optional
screening interface with a one-second failure deadline. Packaged production-server
startup requires an explicitly supplied local
SHA-256 corpus; compromised passwords are rejected in English and Spanish without
consuming the link, and unavailable screening leaves credentials and sessions unchanged.
No password or complete digest is sent externally. Choose, verify and operate the
production corpus update source; any external provider still requires a separate
processing-location and residency decision.
Rejected portal URLs now keep their exact 400, 404 or 405 status and show a bounded
English or Spanish error page. An expired session has its own fixed API code and a
bilingual sign-in explanation, while an admitted request during service shutdown gets
a distinct, retryable bilingual outage page. New connections can fail at the ingress,
so deployment-wide outage presentation remains an ingress responsibility.
Browser coverage completes a real Spanish password reset from a legacy query-token
link and proves the token is scrubbed before later requests. Before public use, decide
whether to accept tracking queries and trailing-slash/case aliases. The current exact
routes and query restrictions follow the approved portal plan.
Set the retirement point for legacy query-token links after every deployed sender
generates fragments and all remaining query tokens have expired; retain compatibility
until then. Direct development-mailer rendering failures now become rejected promises,
matching the mailer interface; a regression reproduces the former synchronous throw.
The PostgreSQL email queue now saves signup/reset messages and password-change
notifications with their state changes. It encrypts recipients and tokens, retries
at most eight times, expires links, fences late worker acknowledgements, and purges
encrypted payloads on completion. Tests cover rollback, concurrency, worker crashes,
lost keys, invalidated links and SMTP. The [production SMTP adapter](../production-email-implementation.md)
now uses verified TLS and authentication, closes timed-out/cancelled sockets, classifies
retryable/permanent failures and stores stable Message-IDs on acceptance. Production
requires explicit relay configuration; status checks need only database access.
Invalid optional receipt metadata is discarded after a successful send, avoiding
a repeat delivery; local tests cover cancellation before the socket opens.
Implement authenticated bounce/complaint ingestion, suppression reconciliation and delivery alerts for that
provider before public use.
Separately supplied email keys now have a read-only dependency and decryption preflight,
plus a local restart drill and documented rotation/restore order. Choose and operate the
production key store, and retain each database backup's matching key set. A send timeout
or crash after provider acceptance may duplicate an email. Terminal delivery metadata
has an explicit cutoff category in the cleanup command; choose its production cutoff.
Immutable customer security events now cover pairing approvals, installation credential
renewals/revocations and recovery/replacement approvals in the protected action's
transaction. Current organisation owners can export stable cursor pages through the
exact session/Origin/CSRF-checked API; the fixed event shape stores no request payloads.
This operational trail is not a complete compliance archive. Audit retention and
account-deletion handling remain separate from transient cleanup. The HTTP adapter applies
a 300 ms response floor to login/email requests, but deployment timing and load
measurements must still assess account/cooldown differences under contention.
Its rate key must be shared across instances; rotation starts new allowances.
Login now checks its IP allowance before charging the email allowance, so an
already-blocked IP cannot spend another person's address allowance. Admitted
attempts across IPs can still exhaust an address allowance; assess targeted
lockout mitigation with the public ingress policy before launch. A bounded local
two-instance contention run admitted exactly 10 of 12 same-IP logins and 30 of 31
same-address logins; the final correct-password attempt was refused. Across two
isolated runs, eight concurrent scrypt hashes took 23 to 52 ms each on an 18-core
Apple M5 Pro, while known and unknown failures remained above the 300 ms response floor.
The counters did not overshoot, and eight concurrent password-reset requests queued
one message under the shared cooldown. Keep these as local measurements, not
deployment promises. Targeted address-lockout mitigation still needs the ingress
policy rather than a blind quota change.
HTTP tests now accept a password at exactly 1024 UTF-8 bytes, reject 1025 bytes
without consuming the signup token, and reject a declared body over 16 KiB before
an incomplete client finishes sending it. Deleting both independent password guards
breaks the database-backed boundary test. Independent HTTP checks replace the store
boundary so its second password check cannot mask a missing HTTP guard. Signup,
login and password reset admit 1024 UTF-8 bytes and refuse 1025 before calling
their store, for ASCII and multibyte passwords. Deleting the HTTP guard, counting
characters instead of bytes or rejecting the exact limit fails these checks;
restoring the guard passes. Run `node --test
packages/account-http/test/http-password-boundary.test.ts` without PostgreSQL.
The original database-backed assertions and production guards are unchanged.
Deleting the declared-length guard breaks its early-refusal test;
the separate streamed-body bound remains covered.
Review the inherited password cost for deployment. The [identity source review](../identity-upstream-review.md)
classifies every mapped Waitron source and test change through `b9440c685e44`.
Cloud already covers generic refusals, asynchronous password checks and hashed sessions;
registration now pins the offered and accepted passkey algorithms, with real-library
regression tests. Run `node scripts/identity-upstream.mjs ../waitron` for later changes.
Browser credential synchronization and passkey provider-name display remain optional follow-ups.
Further reuse should take code and
behavioural tests from `pre-sqlite-migration`, pinned to
`c9d80c59a30ab1ae7a4acc0a6999e6a342de924e` in the registration plan. Adapt its
PostgreSQL schema and dependencies; add cloud memberships and permissions for
organisations that can contain several legal businesses across countries. Include Cloud staff logins
and explicit links between distinct Cloud and local identities; local till staff
need no Cloud account. Support one Cloud login managing several authorised venues
and separate platform permissions. The temporary support-grant core now implements
customer approval, configured eligibility, expiry, early revocation and redacted
immutable events, with every action disabled by default. Define the platform role and
action catalogues, emergency authorisation and the audit events not covered by the
customer security trail before enabling it. Review
database and module dependencies. Keep the source review current and port applicable
security fixes with failing regression tests in each affected repository.
Authenticator management checks its proof deadline after all changes, before
committing the transaction. The duplicate earlier clock query is removed; all
42 existing management tests pass unchanged. Two additional removal cases cover
proof expiry while waiting for another session's lock and after management
writes. Deleting the final check in a disposable checkout fails five late-expiry
cases; deleting savepoint rollback also fails both new cases. They check that
factor, recovery-code, replay, pending-operation and session changes are undone.
You can sign in immediately after an authenticator change even
when its ended-session read arrives late. The portal clears the old account from its
controllers before showing the login form, so that read cannot cancel your new sign-in.
Two controlled real PostgreSQL/Chromium cases show sign-in failing to complete
after removal with a password and after a lost regeneration reply with a passkey.
Removing the account reset restores both failures at the existing seven-second
browser wait. The earlier English/light/1280 journey timeout and the two later
CI failures were not traced to this precise reply ordering; keep that historical
attribution open. Run `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node
--test --test-timeout=120000 test/sign-in-session-race.test.ts`. Existing authentication
checks, browser assertions and deadlines remain. If another timeout occurs, capture
its request/locator stage and reproduce that cause before changing a check or deadline.
The authenticator browser matrix retains recent response paths/statuses, headings,
alerts, scoped IP counters and live session/factor counts when it fails, preserving
the original exception even if collecting diagnostics fails.

Return to the [backlog index](../backlog.md#platform-work-to-scope).
