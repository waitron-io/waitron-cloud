# Cloud account signup

You can create a Cloud account while Waitron's SQLite switch is still in progress.
This slice builds the backend independently. Waitron pairing and shared UI extraction
wait until changes in the Waitron repository can resume.

## Journey and boundary

1. Supply your email address. The backend commits a verification request, then gives
   a delivery adapter a random 32-byte token. The public result is always `accepted`.
   The database stores only its SHA-256 hash. No account or password exists yet.
2. Follow the email and submit your password, organisation name, legal-business name
   and two-letter country code. The token lasts 30 minutes and can complete signup
   once. Reading a link must not consume it; completion belongs in a future POST route.
3. Create the verified account, organisation, legal business and owner membership in
   one transaction. The owner can register venues but receives no platform permission.
   Sign in through the existing password/session API after completion.

Start with one organisation and one business. Keep both as separate records so later
businesses can have their own countries and tax identities. Tax details, billing and
country-specific validation belong to the later billing journey; a country code here
does not provision resources or promise residency. Existing trusted setup records can
retain missing profile fields until their operators supply real values.

Do not accept a password before proving email ownership. This prevents a third party
from supplying a password for someone else's signup. Existing email accounts are
never replaced, joined or re-enabled by this flow. Completion with an existing email
fails without changing its password or memberships. After a lost completion reply,
sign in with the chosen password; replaying the link never issues a new session.

Allow one verification email per address per minute across workers. A later request
does not invalidate an earlier unexpired link. Whichever link first creates the
account wins. Other links cannot add organisations or reset its password. Delivery
happens after the transaction commits; a failed delivery can be retried with a new
request after the cooldown. A process crash between commit and delivery has the same
recovery. This slice has no durable delivery queue or live email provider.

Use the existing password hash format. New passwords require 15 characters and allow
spaces and Unicode, up to 1024 UTF-8 bytes. Public deployment also needs a compromised
password check, request/IP throttling, bot controls, secure cookies, Origin checks,
recovery and the chosen additional authentication factors. The email adapter receives
a bearer secret: do not return it to the requesting browser or put it in logs. The
future link must use a configured trusted HTTPS origin and avoid referrer leakage.

## Implementation and checks

1. Add a migration for verification requests, profile fields, email-verification
   evidence and owner membership. Keep prior migrations unchanged.
2. Write failing PostgreSQL tests for verification, generic request results, cooldown,
   expiry after contention, replay, existing-account protection and atomic creation.
3. Implement the signup store with an injected email adapter and existing identity
   helpers. Test delivery failures and login after signup with a capture adapter.
4. Prove concurrent links create one account and one organisation. Keep the existing
   identity and registration regressions, run types and CI, and complete branch review.

This is an internal API. The existing trusted account-provisioning path remains
responsible for its own email-ownership checks; it is not a public signup endpoint.
No Waitron files, browser screens, SES resources or production emails change here.

The token and password rules follow the applicable guidance in the
[OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
and [single-use email token](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
checklists. Full public HTTP protections remain a separate integration gate.
