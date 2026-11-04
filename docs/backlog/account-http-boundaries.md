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
