# Exercise the management database recovery path

A PostgreSQL container restart proves that its data volume remains attached. It does not prove that you can recover the Cloud management database after the primary process and every client connection disappear. Use this drill when you need to test that boundary locally.

The drill takes a physical base backup, starts it as a streaming standby, writes more application state, then stops the primary and promotes the standby. The account server and email worker use the same code as the packaged local stack. Every container, volume, network and credential is disposable.

## Run the drill

Start from a clean Cloud checkout with Docker running:

```bash
pnpm proof:database-recovery
```

The command writes `/tmp/waitron-cloud-database-recovery-receipt.json` and verifies it before returning. You can verify a retained receipt again without starting Docker:

```bash
pnpm verify:database-recovery /tmp/waitron-cloud-database-recovery-receipt.json
```

The verifier rejects a receipt from a dirty checkout. This matters because the commit in the receipt must name the code that performed the recovery. The runner still removes its exact Docker resources if an assertion fails.

## Read the evidence

The runner creates three database logins:

| Login | Purpose | Deliberate limit |
| --- | --- | --- |
| `cloud_migrate` | Own the application schema and run the existing migrations | It cannot create databases or roles, replicate, or act as a superuser. |
| `cloud_app` | Run the account server and workers | It cannot create schemas, promote a standby, replicate, or administer roles. |
| `cloud_backup` | Take the physical base backup and stream write-ahead log records | It cannot read application tables or run migrations. |

`recovery.primaryLsn` is the primary's named write-ahead-log position after the lost-reply operation and worker claim. `recovery.replayLsn` is the standby position that the runner observed before stopping the primary. `confirmedLagBytes` must be zero for that named point. This proves the local standby contained the selected recovery point. It does not set a production recovery-point objective.

`promotionMs` measures the local `pg_ctl promote` call. `outageMs` runs from stopping the primary until the restarted account server uses the promoted database. These numbers help catch regressions in this fixture. They are not customer promises because the drill does not include provider detection, network routing, operator response or production data volume.

The operation section proves more than row survival. A TCP proxy discards a successful renewal response after the server commits it. After promotion, the caller retries the same operation ID and receives the exact stored lease result. A different action cannot reuse that ID. Both installations can read their own configuration, while a request signed by one installation for the other remains unauthorized.

The worker section starts a real email worker, waits for it to claim an encrypted notification and interrupts it with the primary. The promoted database retains that claim. Once its deliberately shortened test lease expires, the packaged worker reclaims it and Mailpit receives exactly one message.

## Keep secrets outside the database recovery

PostgreSQL contains encrypted mail payloads and signed operation results, but it does not supply their application keys. The runner generates the email encryption key, installation issuer key and HTTP rate key separately, then supplies them again when it restarts the services against the promoted database.

Do the same in production: recover the database and the secret store as separate systems, then prove that their retained versions work together. A successful database promotion with missing or wrong application keys is not a recovered Cloud service.

## What remains before deployment

Repeat this drill with the selected managed PostgreSQL service and its real backup, replication, routing and credential model. Define who or what detects failure and authorizes promotion. Measure realistic data volumes and failure modes before setting recovery-point or recovery-time objectives.

You also need provider-native monitoring, tested secret custody and rotation, and a rollback procedure for releases whose schema cannot run on the previous application version. This local drill deliberately does not choose those policies or automate failover.

## Recover an old release after a schema upgrade

An upgraded database may contain values the old application cannot read. Recover the
old version into a separate database from its pre-upgrade backup, with that version's
external keys. Preserve the upgraded database for investigation and a later forward
recovery. Do not try to repair compatibility by deleting migration ledger rows.

Run the [schema upgrade rehearsal](local-deployment.md#rehearse-a-schema-changing-upgrade):

```sh
pnpm proof:schema-upgrade /tmp/cloud-schema-upgrade-receipt.json
pnpm verify:schema-upgrade /tmp/cloud-schema-upgrade-receipt.json
```

For the pinned 26-to-27 migration pair, it stops consumers, takes `pg_dump -Fc`, upgrades
the original database, then restores the dump with `pg_restore --exit-on-error` into a
fresh PostgreSQL container. It starts the old account server and email worker with the
retained email and installation keys, proves retries and tenant isolation, and checks
that the original upgraded fixture did not change. The backup does not contain these
external keys. The proof explicitly refuses decryption with a wrong email key.

This recovers the named pre-upgrade point. Writes accepted after that backup are absent
from the restored old version. The local proof does not switch production traffic or
choose whether losing those writes is acceptable. Define that decision, your provider's
backup procedure and secret recovery before using an old-release recovery in production.
