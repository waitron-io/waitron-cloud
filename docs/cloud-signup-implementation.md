# Cloud account signup

You can create a Cloud account independently of a venue. Use the
bilingual portal to verify your email, choose your business country and finish signup.

## Journey and boundary

1. Supply your email address. The backend commits a verification request and an
   encrypted pending email together. The request result is `accepted`, without
   contacting the mail provider. Verification records store the random 32-byte token
   as a SHA-256 hash; the queue holds its encrypted delivery copy until delivery ends.
   No account or password exists yet.
2. Follow the email and submit your password, organisation name, legal-business name
   and two-letter country code. The token lasts 30 minutes and can complete signup
   once. Reading a link does not consume it; submit it to the account API completion
   POST route. The linked portal screen submits these details.
3. Create the verified account, organisation, legal business and owner membership in
   one transaction. The owner can register venues but receives no platform permission.
   Sign in through the existing password/session API after completion.

Start with one organisation and one business. Keep both as separate records so later
businesses can have their own countries and tax identities. Your business country
must match the service’s `CLOUD_COUNTRY_CODE` (default `ES`).
Choosing France on Spain’s signup screen returns “Waitron Cloud isn't available in
France yet”. Choose Spain and retry the same email link before it expires and
within its attempt limit. The portal preselects Spain; other countries are not
configured end to end. The server returns HTTP 400
`{"error":"country_unavailable"}` before writing an account; the browser translates
the refusal in English or Spanish. Tax details and billing validation belong to
the later billing journey; a country code does not provision resources or promise
residency. Existing trusted setup records can retain missing profile fields until
their operators supply real values.

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
These account flows do not change Waitron or configure a production email provider.

The token and password rules follow the applicable guidance in the
[OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
and [single-use email token](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
checklists. Public ingress, browser behaviour and deployment checks remain separate gates.

## Hand over an existing business

When someone else takes over your business, open **Account → Hand over ownership**.
Verify it is you, select the business and enter the recipient’s email. The offer lasts 24 hours; either of you can cancel.
The invitation always uses the same wording, including for an unavailable address.
It does not tell you whether that address has an account.

The recipient signs in, enrolls an app or passkey if needed, verifies it is them
and accepts the displayed business and parties. Activating an app ends their
session, so they save their recovery codes and sign in again before accepting.
Acceptance removes your membership and gives them sole ownership together. Your
other businesses and the venue’s independently authorised machines remain.
Old support and email-relay approvals are revoked; translation consent and
queued or running translation work stop. Handing the business back does not
restore those approvals. Close any unfinished backup recovery or replacement first.

Refresh handovers if a reply is lost. The offer’s saved state shows whether
acceptance or cancellation won. Password, email and proof changes cancel pending
offers, except the recipient’s first required enrollment. Box-assisted account
recovery remains unavailable.

If you are receiving a business and have no account, follow the invitation’s
signup link and verify the same email address. Choose **I’m receiving a business**
and set your password. This creates your account without a new business. Sign in,
enroll an app or passkey and verify it is you before accepting the handover on
your account page. Creating an account attaches every live offer addressed to
you, including when you choose ordinary business signup, but gives you no access
to an offered business until you accept.

If no handover is waiting when you submit signup, your account is not created.
You can use the same verified link to create your own business or ask the sender
for another offer. Cancelled and expired offers do not allow account-only signup.

Once your account exists, you cannot use signup to create a business for that
address. If the handover is then cancelled or expires, ask the sender for a new
offer and accept it from your existing account. Resetting your password also
cancels any pending offers.

The focused local PostgreSQL and browser checks are:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/owner-transfer.test.ts
node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/owner-transfer-browser.test.ts
```
