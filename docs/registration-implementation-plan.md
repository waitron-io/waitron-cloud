# First registration implementation

Status: implementation plan, 2026-09-22. The owner approved the connection journey
in the [integration contract](waitron-integration-contract.md#agreed-connection-journey).
Step 1 is implemented in the [internal registration package](../packages/registration/README.md),
with PostgreSQL tests for approvals, retries, concurrency, expiry and process restart.
The [identity slice](cloud-identity-implementation.md) now implements password sessions
and session-backed Cloud approval. Local administrator proof, the matching-code
pairing flow and the browser/end-to-end portions of steps 2 and 3 remain to be built.
There is no public registration service yet.

Waitron-side implementation is paused until its SQLite switch finishes. The
[Cloud signup backend](cloud-signup-implementation.md) proceeds independently and
now creates the first customer organisation and business after email proof. Finish
its Cloud delivery/web integration while waiting; resume local pairing afterwards.

## Outcome

Connect two test installations to their owners' Cloud organisations. Restart the
Cloud service during connection and finish the same requests without duplicate
venues or credentials. Each installation can read only its own service configuration,
and new services remain visibly unconfigured until provisioning succeeds.

## Cloud persistence

Confirmed choice: PostgreSQL for Cloud accounts, organisations, venues, permissions,
connection requests and durable job records. Start with one management database for
this registration slice. Use transactions and uniqueness constraints to coordinate
multiple Cloud workers, and test against PostgreSQL through separate connections.
Waitron's operational databases remain SQLite; backup files belong in object storage.

Country partitioning and each cell's own state storage remain deployment decisions.
Existing remote access and backups must not require a management-database query for
every request. Define and test continued operation during a management outage,
including credential expiry and revocation, before deploying those services.

## Identity reuse

Use Waitron's `pre-sqlite-migration` tag as the source for identity code and its
behavioural tests, pinned to commit `c9d80c59a30ab1ae7a4acc0a6999e6a342de924e`. Keep
distinct Cloud accounts and organisation memberships. Its [identity package](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/package.json)
depends on Waitron's database, shared errors and sync-enrolment packages. Avoid copying
that full dependency graph merely to get a login.

Inspect and adapt the [password/secret helpers](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/secret-hash.ts),
[management sessions](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/management-session.ts)
and the [secret-helper tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/secret-hash.test.ts)
and [session tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/management-session.test.ts).
The tagged [session schema](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/schema/management-sessions.ts)
already uses PostgreSQL. Session code is coupled to local person roles and
database transactions; Cloud needs its own membership and platform-permission checks.
Keep suspension/logout enforcement and distinguish background polling from human
activity. Record the source revision and copied tests so security fixes can be
checked in both repositories until a shared package is justified. This source audit
is not a security review or evidence that the copied code needs no changes.

## Build in three steps

1. **Registration state and persistence.** Add the pnpm application/package layout,
   TypeScript checks and focused test runner. Model a connection request, its local
   approval binding, Cloud approval, resulting venue/installation link and separate
   service states. Use database transactions and uniqueness constraints for completion;
   a process-local lock is insufficient for two running workers. Test restart and
   concurrent completion through separate PostgreSQL connections. Include schema
   migrations and test persistence after restarting the application.
2. **Identity and approval exchange.** Integrate real Cloud account sessions and
   permission checks with the local Waitron administrator flow. Bind the expiring
   request to its installation identity, local venue, environment and Cloud
   organisation. Specify initial trust, proof encoding, request-secret handling and
   challenge verification before exposing this as a public endpoint. A caller's
   assertion that it is a local administrator is not an approval proof. The owner
   reviews the bound venue/organisation in Cloud; the server completes through an
   authenticated outbound exchange. Protect browser approval from cross-site requests
   and never put machine credentials in browser URLs or logs.
3. **Configuration and end-to-end proof.** Return versioned configuration only to
   the registered installation. Show registration, remote access and backup states
   separately. Complete a connection through real local and Cloud sessions, repeat it
   after a lost reply, restart during the exchange, and attempt access from the other
   installation. Keep the first demonstration in a local test environment; gateway
   provisioning and actual storage upload follow this slice.

Use failing behavioural tests first in each step. A mocked identity check is useful
for the state module but does not discharge the real approval-exchange proof.

## Required failure cases

- Missing local approval or missing Cloud permission leaves the request unlinked.
- Expired, already-consumed or wrong-installation proof cannot create another link.
- A permission removed before completion is rechecked and completion is refused.
- Retrying the same operation with different organisation, venue or key is refused.
- Two completions create one registration; a restart does not lose its recorded result.
- Existing venue ownership cannot be changed through a connection request.
- A revoked installation cannot get new credentials or another venue's configuration.
- Failed remote-access or backup setup remains visible after registration succeeds.

The exact proof format, credential lifetime and public endpoint limits must be settled
and tested during implementation. Gate public deployment on the real two-installation
proof. The [broader contract](waitron-integration-contract.md) owns later backup and
replacement checks; re-read the incoming SQLite interfaces when that work lands.
