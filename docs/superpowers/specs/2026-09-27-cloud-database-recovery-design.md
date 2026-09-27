# Cloud Management Database Recovery Design

## Purpose

The local Cloud stack proves that its database survives a container restart, but that is not a database recovery drill. You still need evidence that separately privileged services can continue from a physical copy after the database process and its client connections disappear.

This drill proves the recovery boundary without presenting a local Docker result as production high availability. It measures a controlled local recovery point and recovery time, records the privileges used, and leaves provider selection, automatic failover and production objectives open.

## Recovery model

The drill creates an isolated Docker network with PostgreSQL 18 primary and standby containers. The primary streams write-ahead log records to the standby through a login that has replication permission but no application or migration permission. A migration login owns the schema and runs the existing migration command. A runtime login receives only connection, schema-use, table, sequence and function privileges after migration.

The fixture creates two organisations and installations with the existing registration stores. It starts the packaged account server with the runtime login. A response-dropping TCP proxy forwards one signed installation renewal until the server has committed it, then closes the client side without returning the response. The operation ID therefore represents a real committed write whose caller does not know the outcome.

A separate worker process uses the existing email worker to claim a queued notification and then blocks in its transport. Once the operation result and worker claim have replayed to the standby, the drill records the primary write-ahead-log position, stops the primary and confirms the account API loses database readiness. It terminates the interrupted worker, promotes the standby, restarts the account service against the promoted database and retries the same operation ID.

## Assertions

The receipt is valid only when all of these checks pass:

- The migration, runtime and replication logins are distinct, non-superuser roles. Only the replication login has replication permission.
- The runtime login can use migrated application objects but cannot create schema objects or promote a standby.
- The standby has replayed the named primary log position before interruption. The receipt records the confirmed byte lag rather than translating it into a production recovery-point promise.
- The account API becomes unavailable after the primary stops and returns only after the standby is promoted and the service reconnects.
- Retrying the dropped renewal with the same operation ID returns the exact durable result and creates one operation row.
- The recovered lease remains usable. Reusing the operation ID with a different action is rejected.
- The interrupted email claim is reclaimed after its lease expires and the message reaches the local Mailpit fixture once.
- Each installation can read its own recovered configuration. A proof signed by one venue for the other remains unauthorized.
- A physical-copy control row written after the base backup but before failover survives, demonstrating that replay, not merely the original backup, supplied the recovery point.

## Boundaries

The drill uses disposable local containers, generated credentials and local Mailpit. It does not change production configuration, choose a database provider, configure automatic failover, or make an availability claim. Database backup permission remains separate from application secrets; email encryption and installation issuer keys are supplied again when services restart.

The receipt includes the exact Cloud commit, dirty-tree state, PostgreSQL image, role attributes, primary and replay log positions, confirmed lag, measured outage and recovery timings, and cleanup counts. The verifier rejects a dirty candidate, missing negative control, elevated runtime role, nonzero confirmed lag or incomplete cleanup.
