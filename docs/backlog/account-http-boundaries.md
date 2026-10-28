# Account HTTP boundaries

## Account request proof and transport boundaries (D406)

The account request client selects one CSRF cookie for the connection protocol.
Missing or duplicate cookies send an empty proof, and public sign-in and passive
account reads do not inspect management cookies. Native tests cover request
payloads, credentials, refusals and private error redaction across account controls.
Real loopback HTTP checks cover the existing deadline while waiting for headers
or a response body; failed writes remain single attempts. Server authority and
live ingress qualification remain open; database/browser suites run in CI while
local Docker is unavailable.

## Session HTTP response validation (D412)

Malformed session lists cannot become revocation targets or confirm that a session
ended. Native HTTP/client/controller checks cover initial reads and reconciliation
after accepted or lost revocation replies. A failed reconciliation offers a
read-only retry without repeating the write; a valid list confirms removal only
when the selected session is absent. Lists retain exactly one current session,
including beyond 100 other sessions. Server authority and live ingress remain
separate qualification gates; database suites run in CI while Docker is unavailable.

## Session management transport refusals and retry waits (D432)

When a session list cannot be read, it cannot supply targets for revocation.
An uncertain removal uses a fresh read to check whether the selected session
still exists; a later retry reads the list without repeating the write. Native
HTTP/client/controller checks cover refused and unreadable replies, lost writes
and the supported sign-out reasons when the current session ends. Server retry
waits apply across account changes through the exact end of seconds and date
values, and a shorter read wait cannot shorten an earlier write wait. Runtime
and original assertions stay unchanged; server authority and live ingress remain
separate qualification gates. Database suites run in CI during the Docker outage.

## Session recheck ordering and disposal (D405)

When session checks overlap, a late reply cannot replace a newer accepted result,
change its retry wait or notify the app. An earlier result can still apply while
a newer read is pending. Ordinary checks share that pending read; completing an
older read cannot release it. Disposing an old session drops later replies,
removes visibility observation and cancels the scheduled expiry check.
Native controlled-fetch tests cover these boundaries without changing session
policy or server authority. Browser/database qualification runs in CI while local
Docker is unavailable; historical browser startup failures remain unattributed.

## Passkey HTTP replies before prompts and confirmation (D421)

Malformed passkey lists cannot supply removal targets. Native HTTP/client/controller
checks reject invalid sign-in and registration options before opening a browser
prompt. An unreadable verification reply leaves sign-in uncertain; adding or
removing a key uses a valid fresh list to reconcile a lost reply. A rejected list
retains the last usable choices and offers a read-only retry. Tests cover request
bodies, account-management CSRF and rate-limit waits without changing runtime or
permissions. Physical-passkey, database and live ingress qualification remain
separate gates; database suites run in CI while local Docker is unavailable.

## Passkey transport refusals and pending actions (D435)

When a passkey request fails, you can retry explicitly without replaying an
unconfirmed action. Native checks through the real HTTP client retain usable
keys after failed reads and reject refused ceremony options before opening a
browser prompt. Each pending list, options, verification and reconciliation
request blocks duplicate actions. Management waits accept seconds or HTTP dates
and survive account changes until their exact expiry. Disposable guard deletions
prove the HTTP, pending, wait and request-proof assertions. Runtime and existing
tests stay unchanged. Backward-clock handling belongs to the separate retry-clock
repair; physical passkeys, server authority and live ingress still need their own
qualification, with database suites running in CI while Docker is unavailable.
Run `node --test apps/portal/test/passkey-transport-boundary.test.ts`.

## Passkey management after account changes (D403)

Obsolete enrollment and sign-in browser prompts stop before verification after
account or route changes. Physical-passkey and live-provider qualification remain
open.

## Password and second-factor sign-in HTTP replies (D424)

Your password reply must distinguish a signed-in account from a second-factor
challenge before the portal can continue. Native checks through the real HTTP
client reject malformed account IDs, mixed account/challenge replies, malformed
challenge markers, tokens and expiry dates, and the wrong success status. A
second-factor completion accepts only its account reply. Refused, unreadable and
lost replies remain failures; a later explicit valid request can still succeed.
The checks preserve exact password and proof payloads, retry waits and one request
per action, including a recovery-code completion. Removing each exercised guard
in a disposable copy makes the checks fail. Runtime and original assertions stay
unchanged; browser, server authority and deployment keep their separate gates.

## Session activity replies across reads and sign-out (D439)

A delayed activity reply cannot replace a newer accepted session read, change
its retry wait or notify the app. An accepted expiry also discards a newer
pending read, so it cannot restore the expired sign-in. Sign-out discards activity
started during its preflight, even when the sign-out reply is lost or refused;
a disposed session ignores late activity results and refuses further activity
and session checks.
Run `node --test apps/portal/test/session-activity-ordering.test.ts` for these
native HTTP/client checks. Runtime and original tests stay unchanged. Trusted
browser activity, server-side session storage and production ingress retain their
separate qualification gates.

## Session HTTP replies and sign-out acknowledgements (D422)

Native tests exercise the real HTTP client and session manager with 44 controlled
responses. Malformed passive and activity replies leave the account unavailable;
a later valid read restores it. Server retry waits block explicit and visibility
reads until their boundary. Only the recognised expiry response adds the expiry
explanation, and uncertain sign-out replies never confirm that you signed out.
The tests also check sign-out preflight and secure/local CSRF cookie selection.
Run `node --test apps/portal/test/session-http-boundary.test.ts`.
Runtime, existing tests and authentication policy are unchanged. These local client
checks do not qualify the production ingress, server-side session storage or
browser activity; keep their separate qualification gates.

## Initial session lists after account changes (D407)

When you switch accounts, sign out or refresh the session view, an older session
list must leave the current view and its retry wait untouched. Native controlled
requests cover delayed successes and refusals while the current read is pending
or loaded, including switching away and back. Current reads still enforce retry
waits and normal sign-in rechecks. Browser and database qualification runs in CI;
physical-passkey and live-provider qualification remain open.

## Authenticator management transport and session rechecks (D431)

A credentials refusal during an authenticator change triggers one session read.
If that read cannot confirm your account, the portal asks you to check the outcome
without repeating the change. Native HTTP/client/controller tests cover current,
other, expired and unreadable session replies. Cancellation clears its setup
secret and proof inputs even when its reply is lost, so continuing requires an
explicit fresh setup. Seconds and date retry waits survive account changes and
block status and setup requests until their exact boundary. Runtime and existing tests stay
unchanged; server authority, browser and production qualification remain separate.

## Authenticator HTTP response boundaries (D418)

Malformed authenticator status and setup replies cannot replace a confirmed
factor state or expose a setup secret. Malformed activation, removal and
recovery-code replacement replies require you to check the current state before
continuing; they cannot return recovery codes or confirm a change. Native checks
exercise the real HTTP client and controller, including secret/URI matching,
unique recovery codes, cleared proof inputs, explicit valid retries and retry
waits. Runtime rules and existing tests are unchanged. Browser/session integration,
server authority and production release qualification remain separate gates.


## Authenticator replies after account changes (D399)

Delayed authenticator reads, setup, activation, removal, regeneration, cancellation
and follow-up session reads are covered across account changes and sign-out.
Old replies must preserve the current account's pending work and setup draft,
without returning old recovery codes or applying old cooldowns. These native
controller checks leave browser/session integration and production qualification
open; they do not change server authority or retry policy.
