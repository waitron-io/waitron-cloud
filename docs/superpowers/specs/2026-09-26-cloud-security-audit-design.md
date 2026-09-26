# Cloud customer security audit design

## Outcome

Cloud owners need a durable history of the customer security decisions that change venue access or recovery authority. The history must answer who approved or changed what, for which organisation and venue, and when. It is an operational customer audit trail, not a claim of a complete regulatory or compliance archive.

This change records the already implemented pairing, installation credential, revocation, recovery and replacement decisions. It also exposes a paginated JSON read/export API to current organisation owners. It does not add staff identities, support grants, retention periods, bulk deletion, live provider integration or a portal screen.

## Event model

`security_audit_events` is append-only application data. Each row has:

- a stable UUID event ID and database timestamp;
- the owning organisation and optional venue;
- one fixed event type;
- one fixed actor kind and existing actor/reference UUID;
- one fixed subject kind and UUID; and
- a source UUID that makes the event idempotent across retries.

The first event types are:

- `pairing.cloud_approved`, with the Cloud account as actor and the pairing request as subject/source;
- `pairing.local_approved`, with the existing local approval receipt as the local-authority reference and the pairing request as subject/source;
- `installation.credentials_renewed`, with the installation as actor/subject and a source UUID derived from both the installation and machine operation IDs;
- `installation.revoked`, with either the Cloud account or installation actor, the installation as subject, and the installation as source because it can be revoked only once;
- `recovery.approved`, with the Cloud account as actor, the recovery operation as subject/source; and
- `replacement.approved`, with the Cloud account as actor, the replacement as subject/source.

The local approval receipt identifies an existing verified approval, not a named human. The API labels it `local_authority`; it must not suggest Cloud knows the local person's identity.

There is no free-form details or payload column. This prevents a future caller from accidentally copying matching codes, public keys, leases, credentials, recovery keys or other request bodies into the audit trail. Fixed database checks constrain event, actor and subject kinds. A unique `(event_type, source_id)` key makes a repeated successful operation return the original event rather than append another row. A mismatched retry for the same key fails instead of rewriting history. Credential renewals derive that globally unique source from the installation and its installation-scoped operation ID, so two installations may legitimately use the same operation UUID.

Database triggers reject `UPDATE` and `DELETE`. Security audit data is explicitly outside the transient history-cleanup command. A future retention or account-deletion policy must address this table separately.

## Transaction and action boundaries

`recordSecurityAuditEvent(client, event)` accepts the existing PostgreSQL transaction client. Every event is inserted after the corresponding action has passed its authority rechecks, but before that transaction commits. If the action, final authority check or commit fails, both the action and event roll back. There is no asynchronous audit queue and no state where an action commits without its event.

Pairing records the Cloud approval when `PairingStore.approve` persists the selected organisation/business. Completion records the local-authority receipt in the same transaction that creates or reuses the installation. Installation renewal and both revocation paths record beside their durable operation/revocation result. Recovery request approval records beside creation of the recovery operation. Replacement approval records beside the completed replacement result and authority changes.

Read-only status, inspection, failed confirmation, rejected code, stale permission, replayed failure and machine reports do not create events. A replay of a successful operation returns its prior result and leaves exactly one matching audit event.

## Owner read/export API

`SecurityAuditStore.page(token, input)` provides the package boundary. Input is an organisation UUID, a limit from 1 through 100, and an optional opaque cursor returned by an earlier page. Rows are ordered newest first by `(occurred_at, id)`. The cursor carries that exact pair at PostgreSQL's full microsecond precision, so events with equal timestamps are stable and an append after page one cannot duplicate or skip older rows.

The store resolves the session without extending activity, checks a current `is_owner` membership while holding it through the read transaction, reads only that organisation, then rechecks the session before returning. A former owner, disabled account, malformed cursor or foreign organisation receives no data. The response contains schema version 1, event objects and a next cursor only when another row exists.

The HTTP boundary is `POST /api/account/security-audit/read`. POST avoids changing the repository's deliberate no-query-string policy. It requires the exact portal Origin, session cookie and CSRF token, consumes the normal account allowance, accepts only `organisationId`, optional `cursor` and optional numeric `limit`, and returns JSON. The response is itself the export; no server-side file, email or background job is created.

## Failure and privacy rules

- Audit insertion failure rolls back the protected action.
- A source-key collision with different organisation, actor, subject or venue fails closed.
- Event reads never touch session activity and never reveal another organisation's rows.
- Ownership removal serializes with an in-progress read; the next read is denied.
- No event or response stores or exposes matching codes, tokens, session secrets, public keys, leases, storage credentials, recovery keys or arbitrary error text.
- Existing registration and backup error mapping remains unchanged; unexpected database failures stay redacted at HTTP boundaries.

## Verification

Real PostgreSQL tests prove schema immutability, exact event coverage, one event after concurrent/repeated success, no event after rollback or failed authority, current-owner pagination, equal-timestamp cursor stability, cross-tenant denial and permission-change serialization. HTTP tests prove exact input, Origin/CSRF/session enforcement and secret-free JSON. Guard deletion in a disposable checkout must make coverage or authority tests fail. Focused registration, backups and account HTTP suites plus affected typechecks are the local gate; Cloud CI owns the full workspace suite.
