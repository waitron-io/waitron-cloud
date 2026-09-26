# Account security controls plan

## Goal

Let a signed-in customer review their active management sessions and enrolled passkeys, identify the current session, and revoke a session without creating a new customer or staff permission model.

## Design

Migration 020 gives every session a generated UUID that is safe to expose. The identity package lists only unended, unexpired sessions for the authenticated account and calculates each effective expiry from the existing 30-minute idle limit and 12-hour absolute limit. The current row is identified by comparing the request token digest inside the database boundary; token hashes never leave it.

Session revocation is an account-scoped, CSRF-protected, idempotent write. The transaction serialises revocations for one account, validates the acting session, locks the requested target, and validates the actor again after that wait. This prevents two sessions revoking each other from deadlocking and prevents authority that expired during contention from committing. Missing, already-ended and other-account IDs all return the same confirmed result. Revoking the current session clears its cookies.

The existing passkey list gains its nullable last-use time. The portal adds a bilingual account-security area that shows active sessions, labels the current session, presents signed-in and last-used times, and reloads after every revoke. A lost success reply is reconciled from the refreshed session list; if the current session ended, the normal session check returns the customer to sign-in. Passive session and passkey reads do not extend activity.

## Implementation and checks

1. Add migration 020 and identity tests for opaque IDs, passive account isolation, effective expiry, current-session marking, idempotent cross-account revocation, concurrent logout/revoke, cross-revocation, and expiry during a target-row wait. Run the PostgreSQL identity tests red, implement the minimal identity API, and run them green.
2. Add exact `GET /api/account/sessions` and `POST /api/account/sessions/revoke` contracts. Test CSRF, strict bodies, passive reads, stale accounts, cross-account IDs, current-cookie clearing, concurrency and lost-reply reconciliation with real PostgreSQL.
3. Extend passkey summaries with `lastUsedAt`. Add strict portal response validators, a focused session controller and the account-security screen. Test English and Spanish at phone and desktop widths in light and dark themes, including stale authority and a lost successful reply.
4. Update the account HTTP and identity references plus the Identity and organisations and Self-service journeys backlog entries. Run focused package tests, affected type checks and portal build, then use the normal finish-branch and land-branch workflows.
