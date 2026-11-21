# Cloud account signup

You can create a Cloud account independently of a venue. Use the
bilingual portal to verify your email and set your password.

## Journey and boundary

1. Supply your email address. The backend commits a verification request and an
   encrypted pending email together. The request result is `accepted`, without
   contacting the mail provider. Verification records store the random 32-byte token
   as a SHA-256 hash; the queue holds its encrypted delivery copy until delivery ends.
   No account or password exists yet.
2. Open the link and set your password. The link lasts 30 minutes and works
   once. Opening it displays the form. Submitting it creates your verified account.
3. Sign in. Open **Account** to register a business or accept a handover sent to
   your verified email. If you opened Cloud sign-in during Waitron setup, return
   to the original tab to continue setup on the box.

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
4. Check that concurrent links for the same email create a single account.

The backend now has an account HTTP adapter. The existing trusted account-provisioning path remains
responsible for its own email-ownership checks; it is not a public signup endpoint.
These account flows do not change Waitron or configure a production email provider.

The token and password rules follow the applicable guidance in the
[OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
and [single-use email token](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
checklists. Public ingress, browser behaviour and deployment checks remain separate gates.

## Manage your businesses

Open **Account** to see the businesses in each organisation you own, including
businesses without venues. Use **Register a business** to add its legal name,
tax number and country. Choose the organisation if you own more than one that
can register businesses. Retrying the same name and tax number keeps one
business. Cloud asks you to check the details if that tax number already
belongs to another business you own. If your account has no organisation,
registration names your new organisation after that first business. Choose a
country served by this Cloud. If it refuses the country, change your selection
and retry with the same details. An older account with one business and no
venues can fill its missing tax number using its existing legal name and country.

Use **Organisation name** to rename the group. Each business keeps its own
legal name and tax number. The [Account browser check](../apps/portal/test/account-businesses-browser.test.ts)
covers business registration and rename.

## Hand over an existing business

When someone else takes over your business, open **Account → Hand over ownership**.
Verify it is you, select the organisation and enter the recipient’s email. The offer lasts 24 hours. Either of you can cancel.
The invitation always uses the same wording, including for an unavailable address.
It does not tell you whether that address has an account.

The recipient signs in, enrolls an app or passkey if needed, verifies it is them
and reviews the organisation, its businesses and the parties before accepting. Activating an app ends their
session, so they save their recovery codes and sign in again before accepting.
Acceptance gives them sole ownership of the whole organisation and removes your
membership there. You keep your other organisations. The venue’s paired
machines keep their existing access.
Old support and email-relay approvals are revoked; translation consent and
queued or running translation work stop. Handing the business back does not
restore those approvals. Close any unfinished backup recovery or replacement first.

Refresh handovers if a reply is lost. The offer’s saved state shows whether
acceptance or cancellation won. Password, email and proof changes cancel pending
offers, except the recipient’s first required enrollment.

If you lose every sign-in method, open your reset-mail link and choose **Lost your
sign-in method?** Select a currently paired box from your business. A local
administrator approves or refuses the exact request in that box’s Cloud services
screen. Check the approval, set a new password and enroll a new app or passkey.
The original link’s 30-minute deadline includes finding the administrator.

Recovery limits your account to that organisation because the box proves access
only there. Later sign-ins, recovery codes and ordinary password resets keep that
restriction. Your other memberships and independently authorised venue services
remain intact. Without your mailbox or a usable box, recovery is unavailable;
there is no manual or support override. The [focused browser journey](../apps/portal/test/owner-recovery-browser.test.ts)
exercises enrollment and subsequent sign-in/reset paths.

Open the invitation to see what the handover includes and where to accept it.
Choose **Account** if you are already signed in, or **Sign in** if you have an
account. If you need an account, choose **Create an account** and verify the
email address the invitation was sent to.
Set your password and sign in. Open **Account**, enroll an app or passkey and
verify it is you before accepting the handover. Creating an account attaches
live offers sent to your verified address. Accept an offer to get access.

If the handover is cancelled or expires, ask the sender for a new offer and
accept it from your existing account. You can also register a business you
own from **Account**. Resetting your password cancels pending offers.

The focused local PostgreSQL and browser checks are:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/owner-transfer.test.ts
node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/owner-transfer-browser.test.ts
```
