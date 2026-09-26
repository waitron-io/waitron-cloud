# Customer security audit history

Waitron Cloud records the customer security decisions that change a venue's connection or recovery authority. The event and the protected action share one PostgreSQL transaction: both commit, or neither does.

This is an operational customer audit trail. It does not claim to be a complete compliance archive, and it does not contain authentication attempts, password changes, passive reads, staff activity or actions from services that have not been integrated with the writer.

## Recorded events

The first version records:

- Cloud and local-authority pairing approvals;
- installation credential renewals;
- owner and installation revocations;
- customer recovery approvals; and
- customer replacement approvals.

Each event contains a stable event UUID, timestamp, organisation, optional venue, fixed event type, actor kind and UUID, and subject kind and UUID. A local approval's actor is labelled `local_authority`; its UUID is the existing verified receipt reference, not a claim that Cloud knows the local person's identity.

The schema has no arbitrary details or payload field. Matching codes, session tokens, public keys, leases, storage credentials, recovery keys and raw errors therefore have nowhere to be copied. PostgreSQL rejects updates and deletes. Repeating a successful action returns the original event; reusing its source identity with different event fields fails closed.

## Read or export a page

Send `POST /api/account/security-audit/read` from the configured portal origin with the live session cookie and its `X-CSRF-Token`:

```json
{
  "organisationId": "00000000-0000-4000-8000-000000000001",
  "limit": 50
}
```

Only a current owner of that organisation can read the page. The read is passive and does not extend session activity. `limit` is optional and must be from 1 through 100. The response is newest first:

```json
{
  "version": 1,
  "events": [
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "occurredAt": "2026-09-26T04:00:00.000Z",
      "organisationId": "00000000-0000-4000-8000-000000000001",
      "venueId": "00000000-0000-4000-8000-000000000003",
      "type": "installation.revoked",
      "actorKind": "account",
      "actorId": "00000000-0000-4000-8000-000000000004",
      "subjectKind": "installation",
      "subjectId": "00000000-0000-4000-8000-000000000005"
    }
  ],
  "nextCursor": null
}
```

When `nextCursor` is not null, send it unchanged in the next request with the same organisation and limit. The cursor is an opaque position, not authority. Current ownership is checked on every page.

The JSON response is the export. Cloud does not create a server-side file or email it. Save it only in a location appropriate for customer security records.

## Retention boundary

The transient [history cleanup command](history-cleanup.md) never removes security audit events. No audit retention period or account-deletion rule is enabled. Choose those policies before production use, then implement them as a separate explicit lifecycle rather than adding audit rows to transient cleanup.

## Verify locally

Run the PostgreSQL-backed writer and HTTP tests:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/security-audit.test.ts test/pairing.test.ts test/installations.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/backups exec node --test test/recovery-request.test.ts test/replacement.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/security-audit.test.ts
```
