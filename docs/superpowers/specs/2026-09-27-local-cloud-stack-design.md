# Reproducible Local Cloud Stack Design

## Intent

Waitron Cloud needs one reproducible local deployment that starts the implemented control
plane without assembling commands from several guides. It is for development and operator
rehearsal, not production. Success means a clean machine with Docker can build the Cloud
image, create disposable local configuration, apply migrations, start the account API,
workers, PostgreSQL, Mailpit, S3-compatible storage and an empty-route gateway, then stop
and restart them without losing state.

The owner-approved D26 contract excludes Kubernetes, provider infrastructure and live
resources. Secrets remain outside images and source control. A local proof must establish
clean installation, restart and same-schema image upgrade behavior, and documentation must
state what this does not prove.

## Chosen approach

Use Docker Compose as the deployment contract. A single pinned Node/Alpine Cloud image
contains the workspace, built portal, Cloud CLIs and local fixture binaries. Compose gives
each long-running process its own container while reusing that immutable image. This is
preferred to a host-process supervisor because container health, dependency order, volumes
and resource ownership are then explicit and testable. It is preferred to separate package
images because the repository is still one private workspace and independent release images
would add packaging policy that D26 does not need.

A one-shot bootstrap container writes random local-only key material and fixture configuration
to a named configuration volume. Nothing secret is copied into an image, committed, printed,
or accepted through a command line. Bootstrap is idempotent: a restart reuses the same email,
HTTP, installation, gateway and storage authority. An explicit reset removes the Compose
project volumes and therefore the generated local identity.

## Stack shape

The default stack contains:

- PostgreSQL 18 with a health check and persistent data volume;
- a migration job that finishes before services start;
- the account API with the built portal on a loopback-published port;
- the durable email, monitoring, usage-reconciliation and remote-probe workers;
- Mailpit bound to loopback for local-only delivery;
- SeaweedFS 4.47 with TLS, static local fixture credentials and a persistent data volume;
- the existing HAProxy/WireGuard gateway with no tenant routes; and
- a small refresher that atomically publishes a new signed empty-route manifest before the
  previous ten-minute authority expires.

The backup worker is an opt-in Compose profile because its verifier must execute an explicitly
mounted Waitron checkout. The remote-configuration reconciler is also opt-in because it needs
operator-supplied ACME/DNS configuration. They use the same Cloud image and configuration
volume when enabled; their prerequisites must fail closed rather than silently degrade.

The gateway publishes its TLS and WireGuard ports only on loopback. An empty route set proves
the gateway process, signed authority, child supervision and persistent state can start; it
does not claim a venue is remotely reachable. Existing two-venue proofs remain the evidence
for routed traffic.

## Configuration and secrets

Public settings live in `deploy/local-stack/local.env` and support loopback port overrides.
Generated secrets and private keys live only in the Compose configuration volume with mode
`0600`; directories use `0700`. A runtime launcher reads that JSON file inside the container,
maps only the variables required by the selected process, and replaces itself with the real
CLI. It rejects unknown process names, missing keys and unsafe configuration permissions.

The storage certificate names `storage`, `localhost` and `127.0.0.1`. Cloud containers trust
only the generated fixture CA for storage. The generated SeaweedFS identity is scoped to this
local fixture. These credentials are not a model for production storage custody.

## Lifecycle and failure behavior

`pnpm local-stack:up` builds and starts the default stack with Compose dependency conditions.
PostgreSQL and Mailpit must be healthy, bootstrap and migrations must succeed, and the API,
storage and gateway must become healthy. Failed bootstrap or migration prevents dependent
services from starting. Long-running services use bounded graceful shutdown from their
existing CLIs. Compose restarts unexpected process failures but not intentional stops.

`pnpm local-stack:down` stops containers while preserving volumes. `pnpm local-stack:reset`
removes only this stack's containers, network and named volumes after an explicit command.
The proof always uses a random Compose project name and removes that exact project in `finally`.

An upgrade rehearsal rebuilds and force-recreates the immutable Cloud services, reruns the
idempotent migration job, and verifies a database marker, generated key fingerprints and
storage object survive. This establishes the packaged same-schema upgrade path. It does not
establish downgrade safety, rolling compatibility across different schemas, database backup
recovery, or production high availability; D27 owns database recovery.

## Verification

Contract tests first fail while the bootstrap, launcher, Dockerfile and Compose definition are
absent. They exercise strict process allowlists, idempotent secret generation, file permissions,
manifest signatures, expiry refresh, Compose interpolation and the absence of literal secrets.

The executable local proof builds with a random project name and host ports, starts from empty
volumes, waits for Compose health, checks API liveness/readiness and gateway/storage TLS, writes
a database marker and storage object, restarts the stack, then rebuilds/recreates it and checks
the same evidence again. Its versioned JSON receipt records image IDs, migration count,
fingerprints, restart/upgrade timing and cleanup. A verifier rejects missing phases, changed
identity, lost data, non-loopback bindings or dirty cleanup.

Focused checks are the contract tests, receipt-verifier tests, `docker compose config`, the
executable proof and workspace type checking. CI runs the cheap contract/verifier tests and the
repository's existing full suite; the full image lifecycle remains an explicit local receipt.

## Deliberate limits

This stack creates no provider account, DNS record, public certificate, customer email or live
deployment. It does not supply production secret custody, database backups/failover, horizontal
worker sizing, public ingress, production storage guarantees, monitoring collection, alert
routing or rollback across incompatible migrations. It is a reproducible local baseline for
those later decisions, not evidence that they are solved.
