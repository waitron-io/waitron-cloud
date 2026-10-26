# Operations

The [local operations status](../operations-status.md) now combines
control API liveness/readiness, queued work, monitoring, gateway, snapshot and usage
evidence into versioned JSON, readiness exit states and low-cardinality Prometheus
metrics. It reveals fixed component codes without tenant, provider or raw failure
details. The [reproducible local deployment](../local-deployment.md) now packages the API,
durable workers, PostgreSQL, Mailpit, TLS object storage and empty-route gateway in one
loopback-only Compose stack. Its executable receipt proves clean installation, restart,
same-schema image recreation, the current release migration manifest, stable generated identity, retained database
and storage markers, and exact-project cleanup. The [database recovery drill](../database-recovery.md)
separately proves a physical standby promotion under restricted local credentials, exact
operation replay, worker-claim recovery and tenant isolation, with zero owned resources
left after the run. Production deployment, provider selection, public ingress, secret
custody, provider-native database recovery, automated failover,
realistic recovery objectives and provider-specific recovery across incompatible schemas
remain open. The [schema upgrade rehearsal](../local-deployment.md#rehearse-a-schema-changing-upgrade)
now covers pinned revisions 9a56d012 (26 migrations) to eafd97ad (27), interrupted
migration rollback/retry, stopped-consumer schema gates, identity/tenant checks, pending
mail and completed-operation retries, and isolated recovery of the old version from its
pre-upgrade logical backup with matching external keys. The original upgraded fixture is
preserved. Historical binaries require the current deployment gate; no online upgrade,
downgrade migration, post-backup-write recovery or production traffic switch is proved.
The physical standby drill reads its expected migration count from
the release manifest for both migration and runtime logins. Focused tests cover
complete manifests of different sizes, missing migrations and extra migrations.
The original 2026-09-27 promotion receipt above remains historical; the new drill
receipt is recorded in [database recovery](../database-recovery.md). This remains
separate from logical-backup recovery.
Customer and operator portals, audit, budgets,
quotas, staged releases, maintenance and recovery controls remain broader work.
Customer portal login and account recovery must work when the venue server is
unavailable, so customers can manage services and recovery independently.
