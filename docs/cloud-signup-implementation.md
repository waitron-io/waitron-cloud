# Cloud account signup

You can create a Cloud account independently of a venue. This slice implements the
backend. Waitron's SQLite storage switch landed on 2026-09-23, so pairing and shared
UI extraction can now proceed against its current interfaces.

## Journey and boundary

1. Supply your email address. The backend commits a verification request and an
   encrypted pending email together. The request result is `accepted`, without
   contacting the mail provider. Verification records store the random 32-byte token
   as a SHA-256 hash; the queue holds its encrypted delivery copy until delivery ends.
   No account or password exists yet.
2. Follow the email and submit your password, organisation name, legal-business name
   and two-letter country code. The token lasts 30 minutes and can complete signup
   once. Reading a link does not consume it; submit it to the account API completion
   POST route. The linked browser screen remains to be built.
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
happens after the transaction commits. The [email worker](email-delivery-implementation.md)
retries failures and resumes abandoned work after a restart. You can request another
link after the cooldown if delivery exhausts its retries or the link expires. A
production email provider is not connected yet.

Use the existing password hash format. New passwords require 15 characters and allow
spaces and Unicode, up to 1024 UTF-8 bytes. Public deployment also needs a compromised
password check, ingress bot controls and the chosen additional authentication factors.
The [bilingual portal](../README.md#run-the-account-portal) now supplies the account screens. The [account HTTP API](../packages/account-http/README.md)
implements request limits, secure cookies, Origin/CSRF checks and recovery. The email adapter receives
a bearer secret: do not return it to the requesting browser or put it in logs. The
link must use a configured trusted HTTPS origin and avoid referrer leakage.

## Implementation and checks

1. Add a migration for verification requests, profile fields, email-verification
   evidence and owner membership. Keep prior migrations unchanged.
2. Write failing PostgreSQL tests for verification, generic request results, cooldown,
   expiry after contention, replay, existing-account protection and atomic creation.
3. Implement the signup store with a transactional email queue and existing identity
   helpers. Test delivery failures and login after signup with a capture adapter.
4. Prove concurrent links create one account and one organisation. Keep the existing
   identity and registration regressions, run types and CI, and complete branch review.

The backend now has an account HTTP adapter. The existing trusted account-provisioning path remains
responsible for its own email-ownership checks; it is not a public signup endpoint.
No Waitron files, browser screens, SES resources or production emails change here.

The token and password rules follow the applicable guidance in the
[OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
and [single-use email token](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
checklists. Public ingress, browser behaviour and deployment checks remain separate gates.
