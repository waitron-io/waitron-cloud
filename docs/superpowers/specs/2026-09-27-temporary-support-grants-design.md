# Temporary customer-approved support grants design

## Outcome

Cloud needs an authorization primitive for exceptional customer-approved support without turning customer ownership into platform eligibility. A current organisation owner can approve a named, already eligible platform identity for a bounded set of configured actions and an explicit period. The owner can revoke the grant early. Every successful grant, revocation and protected use appears in the existing customer security audit.

This change adds the durable grant and enforcement core. It does not add a customer screen, staff login journey, platform role catalogue, emergency route, SSH transport, unrestricted impersonation or any enabled production support action.

## Existing identities and explicit configuration

A support identity is an existing enabled `cloud_accounts` row. It is eligible only while it also has at least one `platform_permissions` row whose permission is present in the store's configured eligibility set. Grant approval never creates an account or permission. Removing the permission or disabling the account stops later use of every grant for that identity.

The store also receives the complete set of grantable action names. Both configuration sets default to empty. An empty eligibility set rejects every grantee, and an empty action set rejects every proposed or attempted action. This keeps the primitive disabled until the platform role and action policy is agreed and configured. Action names are opaque, bounded identifiers. The core does not infer roles or treat an action prefix as authority.

## Grant record

`support_grants` stores:

- a stable grant UUID supplied as the approval operation ID;
- the organisation and an optional venue target;
- the existing platform account;
- the approving customer account;
- a sorted, duplicate-free array of configured actions;
- a bounded customer reason;
- database creation and explicit expiry times; and
- optional revocation time and the current owner who revoked it.

An organisation-wide grant has no venue. A venue grant names a venue that belongs to the organisation. A later authorization must match the organisation exactly and, for a venue grant, the venue exactly. An organisation-wide grant can authorize an organisation action or an action for any venue currently in that organisation. The store does not move venues or carry a grant across an organisation transfer.

Approval uses a live customer session and CSRF token. The approving account must be an enabled current organisation owner. The store locks that membership through commit, checks the named platform identity and its configured eligibility, validates every action against the current configured action set, and requires an expiry later than PostgreSQL's wall clock. An identical retry returns the original grant. Reusing the same UUID with different content fails closed.

Any enabled current organisation owner can revoke a grant. Revocation is idempotent, records the first revoker and time, and cannot be undone.

## Enforcement primitive

`SupportGrantStore.authorize(input, action)` accepts the grant ID, platform account ID, organisation, optional venue, one configured action name and a stable action operation UUID. It starts a transaction and locks the grant before checking:

- the grant is not revoked and its expiry is later than `clock_timestamp()`;
- the requested identity, organisation, venue and action match the record;
- the requested action is still present in the store's configured action set;
- the platform account is enabled and still has configured eligibility; and
- the original approving account is enabled and still owns the organisation.

The supplied callback receives the same PostgreSQL client and performs the protected work in that transaction. After the callback returns, the store repeats the wall-clock expiry, approver and platform-eligibility checks. A grant that expires or loses authority during a database wait rolls the callback back. The successful transaction appends one `support.accessed` security event keyed by the action operation UUID and grant. Callers must put all protected database effects inside the callback; the primitive does not make an external side effect reversible.

## Customer audit and privacy

The existing immutable security audit gains three fixed events:

- `support.granted`, with the approving customer account as actor and the grant as subject;
- `support.revoked`, with the revoking customer account as actor and the grant as subject; and
- `support.accessed`, with the platform account as actor and the grant as subject.

The platform actor uses a distinct `platform_account` kind so an export cannot present staff access as a customer action. The fixed audit response contains IDs, tenant and venue, event kind and time. It does not contain the customer's reason, configured action name, request parameters, callback result, session material or raw errors. Owners can correlate the grant UUID with the durable grant record when a future customer interface is designed. This extends the operational audit trail; it does not create a compliance archive or choose retention.

## Failure rules

- Missing configuration, an unknown or disabled platform identity, absent eligibility, a foreign venue, a non-owner approver and a stale session all fail without a grant.
- Expiry uses PostgreSQL wall time after lock waits. Transaction-start time cannot keep an expired grant alive.
- Revocation, approver authority loss, platform eligibility loss and action removal deny later use.
- Losing any of those conditions during the callback rolls back both the protected database work and audit event.
- Grant and audit retries are idempotent. A conflicting retry never rewrites the earlier record.
- Tenant, reason and action data never enter another organisation's export.

## Verification

Real PostgreSQL tests cover disabled-by-default configuration, existing-identity eligibility, tenant and venue isolation, identical and conflicting approval retries, explicit expiry, early revocation, changed approver permission, removed platform eligibility, expiry during a lock wait, rollback of protected work, and one audit event for a retried successful use. Security-audit tests prove the new event shapes and redacted owner export. A disposable mutation removes the final authority recheck and must make the wait/permission test fail. Focused registration tests and affected typechecks are the local gate; Cloud CI owns the full workspace suite.
