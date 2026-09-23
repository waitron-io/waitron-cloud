# Connect Waitron to Cloud from the dashboard

Task 2 of the owner's five-task local integration programme. Decisions and execution
are delegated; finish and land each repository's branch without another approval pause.
The signed Cloud pairing API from task 1 is the wire boundary.

## Journey

In Waitron's Settings, open Cloud services. A manager with `system.manage` can start
connection. Show the local venue name, eight-digit code, expiry and an Open Cloud link.
The link opens the configured Cloud portal's `/connect#request=<uuid>` in a new tab;
it carries neither the matching code nor a machine secret. Cloud scrubs the fragment,
asks for sign-in if needed, and asks you to enter the code shown in Waitron. It lists
only the account's permitted businesses, choosing the only option automatically.
Show the confirmed venue identifier, organisation and business before Approve.

Return to Waitron and refresh connection status. Show the selected Cloud organisation
and business and require an explicit Connect this venue action. The server checks your
local management session again and signs completion with those exact IDs. Registration
then shows Connected, while Remote access and Backups each show Not configured.
The first slice uses explicit refresh instead of polling to avoid renewing unattended
sessions or creating a timer race. Background reads must remain passive.

Expired requests offer Start again. Network errors retain the current operation for
retry. A lost completion reply is reconciled through signed status, not a new request.
Code errors do not echo secrets. Do not redirect the browser to an arbitrary return URL.
Sign-in/sign-out within Cloud keeps any current pending connection in memory; reload
requires reopening the link from Waitron. Language switches preserve pending input.
Both applications use English and Spanish and their existing shared controls.

## Local server boundary

Use Waitron's existing management-cookie and `authorizeManager(system.manage)` checks.
Derive the local venue ID from the provisioned location, never a browser-supplied ID.
Only the serving primary starts/completes pairing; status remains a management read.
Map Waitron production to Cloud production, preproduction/dev to Cloud test explicitly.
Cloud origin is operator configuration, not request input; HTTPS is required outside
explicit loopback development. The local adapter follows redirects nowhere, bounds
response size and time, and validates every Cloud response before saving it.

Generate a distinct Ed25519 installation key locally, store under the protected node
state directory, and exclude it from managed recovery archives. Save the pending UUID,
code and binding before sending start so interruption can reuse the same request. Do
not sign completion merely because polling reports Cloud approval. Only a live local
manager's explicit final action can cause it. Recheck local authority after waiting for
Cloud status and immediately before signing. Never log Cloud bodies or local secrets.

The server implements the published canonical version 1 byte format directly; keep a
shared fixed wire-vector fixture in each repo to detect drift without importing Cloud's
PostgreSQL code into Waitron. Cloud login and password remain on Cloud's origin.

## Tests

Use real Waitron SQLite migrations and management sessions to deny anonymous, staff,
expired and suspended accounts at start and completion. Confirm the adapter derives
venue/environment, persists key/request before network sends, retries after process
restart, rejects mismatched Cloud replies, never auto-completes, and returns no private
key to the dashboard. Browser tests cover the local screen and Cloud `/connect` in both
languages with shared controls, failure/expiry paths and accessibility.

Run a local integration harness against the actual Cloud HTTP server and Waitron
adapter with two isolated SQLite installations and real Cloud accounts. Complete both,
restart during pairing, discard a completion reply and try exchanging proofs. Keep
fiscal/payment calls disabled. Each repo's focused tests and CI remain independent;
the cross-repo local harness records exact source revisions and commands.

Cloud deliberately reports a wrong code as pairing_unavailable, the same as expired,
unknown or exhausted. The screen must not invent a remaining-attempt count; offer
checking the code or starting again from Waitron. Refuse blank confirmation names.
