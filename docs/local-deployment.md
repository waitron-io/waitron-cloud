# Run the complete Cloud stack locally

Starting each Cloud process by hand hides the order in which configuration, PostgreSQL,
migrations and workers become usable. The local Compose stack makes that order explicit.
It gives you one command for the implemented control plane and keeps every published port
on your own machine.

This stack is for development and deployment rehearsal. It does not create a public Cloud
service or model production secret custody.

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

You can override the public settings in `deploy/local-stack/local.env` before starting the
stack. Every published port remains bound to `127.0.0.1`.

| Service | Default host address | Purpose |
| --- | --- | --- |
| Account API and portal | `127.0.0.1:3000` | Account UI, API and health |
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
catch up pending work. It removes that project's containers, volumes, network and
image. These short settings are for the proof; they are not production targets.

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

This rebuilds the shared image, force-recreates the containers and reruns migrations while
preserving the four volumes. It proves the same-schema recreate path. It does not prove that
you can downgrade across incompatible migrations or recover PostgreSQL from a backup.

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
