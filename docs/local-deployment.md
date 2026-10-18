# Run the complete Cloud stack locally

Starting each Cloud process by hand hides the order in which configuration, PostgreSQL,
migrations and workers become usable. The local Compose stack makes that order explicit.
It gives you one command for the implemented control plane and keeps every published port
on your own machine.

This stack is for development and deployment rehearsal. It does not create a public Cloud
service or model production secret custody.

The optional `translation` profile adds a menu-translation worker. It is absent from the
default stack and receives the provider key separately from the account service. Follow the
[translation worker guide](../packages/translation/README.md#run-the-worker-locally) for the
Compose command and account switch. Keep it off until the release gates pass.

## Start with empty local state

You need Docker with Compose, pnpm 9.15 and a GitHub package token that can read the private
`@waitron-io` packages. Export the token in your current shell so Docker BuildKit can use it
without copying it into the image:

```sh
export NODE_AUTH_TOKEN="$(gh auth token)"
pnpm local-stack:up
```

The command builds one Cloud image, creates the private local configuration, waits for
PostgreSQL and Mailpit, applies all migrations, starts the API and workers, and waits for
the API, storage and gateway to become healthy. It returns non-zero if bootstrap,
migration, a long-running process or a health check fails.

Open the account portal at [http://localhost:3000](http://localhost:3000) and captured mail
at [http://localhost:8125](http://localhost:8125). Check the whole process set with:

```sh
pnpm local-stack:status
curl --fail http://localhost:3000/api/health/live
curl --fail http://localhost:3000/api/health/ready
```

Use `localhost` for the API probes. The server rejects a different `Host` authority, even
when it resolves to the same loopback interface.

## Know what stays on your machine

### Inspect the test organisation plan

You can record a free or pretend-paid plan for an organisation without a billing
provider. This is an operator primitive for the separate
[LAN test deployment](superpowers/specs/2026-10-17-test-cloud-free-paid-design.md).
Service enforcement and that deployment are still being implemented. Keep the
deployment's plan flag off until every service boundary and the full integration
proof pass. Ordinary deployments keep their existing permissions and retention.

In an operator process inside the Cloud project, use its private database
configuration and explicitly set `CLOUD_TEST_SERVICE_PLANS=1` for the command:

```sh
CLOUD_TEST_SERVICE_PLANS=1 node packages/registration/src/organisation-plan-cli.ts show --organisation 11111111-1111-4111-8111-111111111111
```

For an existing organisation with no plan changes, the output is:

```json
{"organisationId":"11111111-1111-4111-8111-111111111111","plan":"free","revision":0,"changed":false}
```

Use that organisation's real ID to change its plan:

```sh
CLOUD_TEST_SERVICE_PLANS=1 node packages/registration/src/organisation-plan-cli.ts set --organisation 11111111-1111-4111-8111-111111111111 --plan paid
```

The first change returns `"plan":"paid","revision":1,"changed":true` in the
same JSON shape. Repeating it returns revision 1 with `changed:false`. Set
`--plan free` to change it back. Each actual change advances the organisation revision and each installation's
configuration revision once; the command prints its result only after the database
commits. A downgrade clears the three paid service configurations. In the opted-in
mode, backup permission and current machine replies now follow that policy; see
[backup plan checks](local-backups.md#exercise-test-free-and-paid-plans). Other service
boundaries and direct-storage withdrawal remain open, so keep deployment enforcement off.

Apply all migrations first. Missing or changed migration entries, unknown
organisations, invalid arguments and database failures return a non-zero exit
with `Organisation plan failed; check test mode, arguments, database and migrations`.
The command prints no database credentials. It does not create an organisation,
provision a service or enable fiscal operations. Plan eligibility alone never
replaces ownership, test-venue checks, consent or a service's release gate.

### Local service addresses

You can override the public settings in `deploy/local-stack/local.env` before starting the
stack. Every published port remains bound to `127.0.0.1`.

| Service | Default host address | Purpose |
| --- | --- | --- |
| Account API and portal | `127.0.0.1:3000` | Account UI, API and health |
| Optional operations collector | `127.0.0.1:9091` | Current status and metrics when enabled |
| PostgreSQL | `127.0.0.1:55432` | Local inspection and development |
| Mailpit SMTP | `127.0.0.1:1125` | Captured outbound mail |
| Mailpit UI | `127.0.0.1:8125` | Captured-mail browser |
| S3-compatible storage | `127.0.0.1:8333` | TLS local object storage |
| Gateway TLS | `127.0.0.1:8443` | Empty-route gateway listener |
| Gateway WireGuard | `127.0.0.1:51820/udp` | Empty-route tunnel listener |

Compose keeps state in four named volumes. `local-stack-config` contains generated private
keys, passwords, certificates and configuration. `local-stack-postgres`,
`local-stack-storage` and `local-stack-gateway` contain durable service state. Private files
are mode `0600` inside a mode-`0700` directory. They are generated once and reused. Do not
copy their values into `.env`, logs or source control.

The `bootstrap` and `migrate` containers should show `Exited (0)` in status output. They are
successful one-shot jobs, not failed services. The lifecycle command checks them separately
from the healthy long-running containers for this reason.

The `usage-reconciler` is a long-running worker. It reconciles immediately, then once
per minute by default. Set `CLOUD_USAGE_INTERVAL_MS` and `CLOUD_USAGE_BATCH_SIZE` in
the Compose environment to override the [bounded usage settings](usage-metering.md).
The process running is a startup check; use operations status to check whether its
scans are current. Repeated failures or stopping the service eventually make usage
freshness stale.

You can exercise this service in a disposable Compose project:

```sh
pnpm proof:scheduled-usage /tmp/cloud-scheduled-usage-receipt.json
```

The proof builds the local image and starts only bootstrap, PostgreSQL, migrations
and the usage worker. With a one-second interval and one event per source per pass,
it checks automatic reconciliation for separate organisations, stops the worker,
observes stale operations evidence at a two-second threshold, then restarts it to
catch up pending work. It then holds a PostgreSQL row lock on the final reconciliation
source, after earlier event writes have begun, and stops the service through Compose.
The version 2 receipt includes the observed lock, stop duration, container exit code,
unchanged event and freshness snapshots, and restart catch-up for two organisations.
A later pass must keep exactly one event for each installation, bound to its own
organisation and venue. An exit forced by Compose fails the proof even if it fits
the stop time limit.

The 2026-09-29 local run stopped the blocked service in 9,657 ms with
exit code 0, within its 15,000 ms grace period. Restart caught up both new organisations
in 5,003 ms, including Compose startup. All three previously committed events
survived, the blocked pass published nothing, and a subsequent pass kept five events
across five organisations. Extending both database deadlines to sixty seconds in a
disposable copy made the proof fail on exit code 137 after Compose forced the stop.
These measurements describe this local run, not a production shutdown guarantee.

The proof removes that project's containers, volumes, network and image on success
or failure, and checks for leftover resources. These short settings are for the proof;
they are not production targets.

## Collect operations evidence

Enable the optional collector when you want regularly refreshed status without running
workers or opening tenant data. Follow [Collect status in the local deployment](operations-status.md#collect-status-in-the-local-deployment)
for the commands, freshness fields and failure responses. The collector keeps its own
network endpoint through account API restarts and preserves the API's localhost authority
in its health requests. Set `COMPOSE_PROFILES=operations` for lifecycle commands if you want
startup and upgrade to include this opt-in service; the ordinary stack readiness check
still describes the core service set. Inspect `/status` separately for collection health.

Run `pnpm proof:operations-collection /tmp/cloud-operations-collection-receipt.json`
to create a separate disposable project. The rehearsal starts PostgreSQL, the account API
and the collector, then changes usage evidence from missing to current and stale. It
changes a migration digest, stops PostgreSQL, restores each dependency, restarts the
collector, and checks that failed collection never exports the old health metrics.
It also proves the collector's PostgreSQL settings refuse a write. No worker runs during
this fixture, so collection itself cannot make the usage evidence fresh.

The version 1 receipt records the observed states, collection times, bounded metric-label
count, restart result and exact-project cleanup. The [2026-09-30 receipt](receipts/2026-09-30-operations-collection.json)
ran on clean commit `8d50f22eb9e85dc47c2285e9562334040cd1821b` with a one-second
collection interval. It observed 26 distinct metric label combinations across healthy
and degraded samples, rejected the changed migration digest and database outage without
exporting the previous readiness metric, recovered after each, and stopped with exit 0.
The read-only write probe was refused. Cleanup found zero project containers, volumes
and networks. These are local checks; they establish
neither production capacity nor alert thresholds, incident escalation or an availability
objective. The collector keeps no history and cannot report its own process failure.

## Stop, restart and upgrade

Stop the containers without deleting their volumes:

```sh
pnpm local-stack:down
```

Keep `NODE_AUTH_TOKEN` exported and run `pnpm local-stack:up` again to rebuild and restart
the same local identity and data.
Bootstrap is idempotent, and migrations run before any database consumer starts.

After changing or updating the Cloud source, use the explicit upgrade rehearsal:

```sh
export NODE_AUTH_TOKEN="$(gh auth token)"
pnpm install --frozen-lockfile
pnpm local-stack:upgrade
```

This rebuilds the shared image, stops the existing containers, then force-recreates them
and reruns migrations while preserving the four volumes. Stopping first matters: Compose
startup dependencies do not stop an old worker while a new migration runs. Allow downtime
for this procedure; it does not support a rolling upgrade with mixed application versions.

Every PostgreSQL consumer launched by the packaged runtime checks the complete migration
ledger against its release's SQL names and content digests before starting. A missing,
changed or extra migration refuses startup. Migrations also refuse a database with unknown
migration names. Run the required forward migration and data conversion before admitting
traffic. For the 26-to-27 transition, follow the [pairing-key upgrade](pairing-code-keys.md#upgrade-existing-requests-without-losing-approval), including its separate key and conversion step.
For the 27-to-28 transition, follow the [recovery-code upgrade](recovery-code-keys.md#upgrade-existing-requests-without-losing-their-history). Stop old account writers, add the independent recovery key map and convert existing rows before restarting.

The original lifecycle receipt proves same-schema recreation. The separate
[schema upgrade rehearsal](#rehearse-a-schema-changing-upgrade) covers one pinned forward
upgrade and recovery of the old release from its own backup. Neither supports running old
code against an upgraded database as a downgrade.

Reset only when you intend to lose all local Cloud state:

```sh
pnpm local-stack:reset
```

Reset removes this Compose project's containers, network and named volumes. The next start
creates a new local identity, an empty database and empty object storage.

## Enable integration profiles deliberately

The default stack excludes two workers whose prerequisites cannot be generated safely.

The backup worker launches a disposable verifier for each snapshot. Build the verifier
from a compatible committed Waitron revision, with a package-read token supplied through
`NODE_AUTH_TOKEN` (the build uses a Docker secret):

```sh
WAITRON_CHECKOUT=/absolute/path/to/waitron \
  CLOUD_VERIFIER_IMAGE=waitron-backup-verifier:local \
  node scripts/build-backup-verifier.mjs
CLOUD_VERIFIER_IMAGE=waitron-backup-verifier:local \
  docker compose --env-file deploy/local-stack/local.env \
  --profile backups up -d backup-worker
```

Rebuild the Cloud stack image after updating its worker code. The trusted worker has the
Docker CLI and Docker socket; this grants it control of your local Docker daemon. The
untrusted verifier receives neither the socket nor any host mount. It has no network,
a read-only image, 1024 MiB total memory with swap disabled, and a 256 MiB scratch tmpfs.
You can set `CLOUD_VERIFIER_MEMORY_MIB` (128–2048) and `CLOUD_VERIFIER_SCRATCH_MIB` (1–512).
Scratch consumes the same memory budget; oversize restores fail instead of spilling to disk.
Use this optional profile only on your disposable local deployment host. See
[the verifier boundary and its proof](backup-verifier-containment.md) before interpreting
these limits as evidence about another host or image.

The remote-configuration reconciler needs a trusted directory containing `config.json`,
route signing keys, certificate requests, an ACME account key and a DNS provider module.
Paths inside `config.json` must use the container's `/run/reconciler` mount:

```sh
LOCAL_STACK_RECONCILER_DIR=/absolute/path/to/reconciler-inputs \
  docker compose --env-file deploy/local-stack/local.env \
  --profile remote-reconciliation up -d remote-reconciler
```

These profiles fail when their external inputs are missing. The default lifecycle proof does
not claim that a live Waitron checkout, DNS provider or certificate authority is configured.

## Rehearse the complete lifecycle

Run the proof from a clean Cloud checkout. It chooses a random Compose project and random
loopback ports, then removes that exact project's containers, network and volumes even after
a failure:

```sh
export NODE_AUTH_TOKEN="$(gh auth token)"
pnpm proof:local-stack /tmp/waitron-cloud-local-stack-receipt.json
pnpm verify:local-stack /tmp/waitron-cloud-local-stack-receipt.json
```

The receipt records the source revision, bindings, image IDs, migration count, redacted
configuration fingerprints, database and storage markers, phase timings and cleanup counts,
including removal of the proof image tag.
It contains no credentials. A clean run on 2026-09-27 applied 25 migrations and measured
14,818 ms for installation, 8,661 ms for restart and 19,114 ms for rebuild and recreation.
Those local timings describe that run only. They are not availability or capacity targets.

## Understand the production boundary

The stack does not provide provider infrastructure, public ingress, production certificates,
DNS, secret management, database backup or failover, external monitoring, alert routing,
worker sizing, high availability or rollback across incompatible schemas. Use it to validate
packaging and lifecycle behavior before you choose those production controls. The remaining
deployment work stays in the [Cloud backlog](backlog.md).

For a database created before keyed pairing-code storage, follow the
[pairing-key upgrade](pairing-code-keys.md#upgrade-existing-requests-without-losing-approval)
before restarting account workers. New local stacks create the independent key in
the private runtime configuration; existing volumes keep their current identity.

## Rehearse a schema-changing upgrade

Run the version-pair proof from a clean checkout with Docker running and access to the
private packages in the pnpm store or through your configured package token:

```sh
pnpm proof:schema-upgrade /tmp/cloud-schema-upgrade-receipt.json
pnpm verify:schema-upgrade /tmp/cloud-schema-upgrade-receipt.json
```

You get a version-1 receipt naming the proof driver's revision and both application
revisions: `9a56d0122bf6872a0200735a7b1e3a23ad4f825c` has 26 migrations;
`eafd97ad5ac51563e91c821d4c957ef996e5d3fb` has 27. Their SQL and application commands
come from independent history checkouts with locked dependencies. The receipt also names
the ledger digests, timings, individual checks and resource cleanup counts.

The proof starts two organisations and installations on the old version, retains a
pending encrypted email and pairing request, and takes a logical PostgreSQL backup.
With old consumers stopped, it interrupts the real pairing-schema migration at a database
lock, checks rollback, retries migration and converts the old pairing verifier with its
separate key. New account traffic then proves identity, completed-operation retries and
tenant isolation; the email worker delivers the retained message exactly once.

The current deployment gate refuses new consumers on the old or interrupted schema and
old consumers on the new schema. Historical binaries did not contain that gate. The proof
runs them through `deploy/local-stack/schema-consumer.mjs` from the current checkout;
it does not claim that invoking their old CLI directly has the same protection.
The packaged current runtime applies the same check to account, email, monitor, usage,
probe, backup and reconciliation roles. Storage, gateway and gateway-manifest roles do not use PostgreSQL.

The second half restores the old backup into a separate PostgreSQL container and starts
the old application with matching external keys. A wrong email key cannot decrypt its
pending message. The restored installation retries and tenant checks pass while the
original upgraded database stays unchanged. See [the recovery boundary](database-recovery.md#recover-an-old-release-after-a-schema-upgrade).

On 2026-09-29 one local run measured 1,768 ms for the interrupted-and-retried upgrade and
1,757 ms for recovery. Those phases exclude checkout and dependency setup. The proof
uses real host Node processes, PostgreSQL 18 and Mailpit; container packaging remains
covered by the separate lifecycle proof. It covers this version pair only, with stopped
consumers. Provider backups, online migration, production traffic routing, capacity and
recovery objectives still need deployment-specific evidence.

## Use the isolated LAN test deployment

Use the [test Cloud guide](test-cloud.md) for the separate HTTPS project, private CA, capture mailer and image-only deployment commands. The files and local proof are implemented; the test box is not deployed yet. Keep plan enforcement and translation off until their remaining integration gates pass. Your ordinary loopback stack keeps its existing origin and lifecycle commands.
