# Account HTTP boundaries

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

## Authenticator replies after account changes (D399)

Delayed authenticator reads, setup, activation, removal, regeneration, cancellation
and follow-up session reads are covered across account changes and sign-out.
Old replies must preserve the current account's pending work and setup draft,
without returning old recovery codes or applying old cooldowns. These native
controller checks leave browser/session integration and production qualification
open; they do not change server authority or retry policy.

## Signup and password-reset HTTP acknowledgements (D423)

Native account-client tests return an unsuccessful client result for malformed
signup and password-reset replies. They cover email-request acknowledgements,
signup account and business fields, reset completion, unreadable JSON, network
loss and refused replies. Uncertain operations remain single attempts; an explicit
retry can accept a valid reply. Exact request bodies preserve passwords, link
tokens and locale. Run `node --test apps/portal/test/signup-reset-response-boundary.test.ts`.
Production email delivery, browser and server authority remain separate
qualification gates. These client tests use controlled fetch responses. Exact
success status codes, empty organisation and business IDs, browser anti-forgery
headers and the 15-second request deadline are outside this file's proof.

## Session revocation replies after sign-out or view reset (D440)

When you sign out or reset the session view, earlier revocation replies cannot
restore rows, release a newer pending read, change feedback or retry waits, or
trigger sign-out callbacks or another request. Native controlled-fetch tests hold
revocation and reconciliation headers or bodies across both boundaries. They also
check that an unchanged account keeps its active revocation and blocks duplicate
actions. Run `node --test apps/portal/test/session-revoke-lifecycle.test.ts`.
Runtime and original assertions stay unchanged; server authority and live ingress
remain separate qualification gates. Database suites run in CI during the Docker outage.
