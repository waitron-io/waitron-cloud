# Temporary customer-approved support grants

A customer approval must not turn an arbitrary account into Cloud staff. The support-grant core keeps those decisions separate. A current organisation owner approves the request, while an existing platform permission makes the named support identity eligible. Both conditions must remain true when the support action runs.

Nothing uses this primitive in production yet. The default configuration contains no eligibility permissions and no grantable actions, so every approval and authorization fails closed. Choose the platform roles, eligible permissions and exact action catalogue before you configure an adapter.

## Configure an adapter

Supply exact permission and action identifiers when you construct the store. This example uses local adapter identifiers. It does not declare a production role or enable a route:

```ts
import {SupportGrantStore} from '@waitron-cloud/registration';

const supportGrants = new SupportGrantStore(pool, {
  eligibilityPermissions: ['support.diagnostics_eligible'],
  grantableActions: ['venue.diagnostic.read'],
});
```

The platform account must already exist, be enabled and have the configured `support.diagnostics_eligible` row in `platform_permissions`. `approve` never creates that account or permission.

Approve a grant with the customer's live session and CSRF token:

```ts
const grant = await supportGrants.approve(session.token, session.csrfToken, {
  id: '26f958ab-cf53-44b6-bacd-a64005ef9969',
  organisationId: 'e4d31a38-bfb6-4cb6-9f59-b339e3013ea7',
  venueId: '4da3daf3-85a1-411d-af74-0d3ee63ff124',
  platformAccountId: 'f0f768bf-50c7-4197-93a8-e5d706828431',
  actions: ['venue.diagnostic.read'],
  reason: 'Investigate the failed terminal',
  expiresAt: '2026-09-27T08:00:00.000Z',
});
```

The approving account must still own the organisation. The optional venue must belong to it. The UUID makes a lost-reply retry stable: an identical retry returns the original grant, while changed content fails with `grant_conflict`.

## Protect database work

Call `authorize` with the named platform identity and one stable operation UUID. Put every protected database change inside the callback:

```ts
const diagnostic = await supportGrants.authorize({
  grantId: grant.id,
  platformAccountId: grant.platformAccountId,
  organisationId: grant.organisationId,
  venueId: grant.venueId,
  action: 'venue.diagnostic.read',
  operationId: 'c6bcc85d-b2cd-42b3-8644-a0978d919a27',
}, async client => {
  return client.query(
    'SELECT state FROM installation_services WHERE installation_id = $1 ORDER BY service',
    ['ad00af20-cbf3-42cf-8bdf-402ce1cd13b5'],
  );
});
```

The store checks the grant, action, tenant, expiry, revocation, platform eligibility and original customer approval before the callback. It repeats the time and authority checks afterward. If authority disappears or the grant expires during a database wait, the callback's writes roll back. External side effects cannot be rolled back, so do not put network calls or shell commands inside this boundary.

An organisation-wide grant uses `venueId: null`. It can cover an organisation action or a venue that currently belongs to that organisation. A venue grant matches only its recorded venue.

## Revoke early

Any current owner of the organisation can revoke the grant:

```ts
await supportGrants.revoke(session.token, session.csrfToken, grant.id);
```

Revocation is permanent and idempotent. It prevents later authorization. The first revoker and database time remain on the grant.

## Read errors and audit events

`invalid_input` means the request shape, identifier, reason, expiry or action set is malformed. `not_configured` means the store has an empty eligibility or action configuration. `permission_denied` covers missing current customer or platform authority. `grant_unavailable` covers a missing or mismatched tenant binding without revealing another organisation's grant. `grant_expired` and `grant_revoked` describe terminal grant state. `grant_conflict` means the same approval UUID was reused with different content.

Grant, revocation and successful access append `support.granted`, `support.revoked` and `support.accessed` to the immutable customer security audit. The export identifies the platform actor and grant UUID, but omits the customer's reason, action name, request parameters, callback result and session material.

The remaining work is policy and transport, not another grant store. Define platform roles, the eligible permission catalogue, customer approver rules and concrete actions. Design the separately authorised emergency route. If SSH support is offered, add its explicit server target and terminate active sessions on expiry or revocation.
