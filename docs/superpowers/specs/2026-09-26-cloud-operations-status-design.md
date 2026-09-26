# Cloud Operations Status Design

## Intent

Give an operator one bounded, read-only view of whether the Cloud control plane can serve traffic and whether its existing workers and external checks are keeping up. Give a venue owner a separate diagnostic download that is safe to share without exposing credentials, internal hostnames, provider configuration, raw errors, or another venue.

This closes the local operational-observability part of the Cloud backlog. It does not choose a production telemetry provider, add staff roles, publish detailed metrics over HTTP, or make an availability promise.

## Operator contract

A new `@waitron-cloud/operations` package owns the aggregate and its CLI. `pnpm operations:status` emits one versioned JSON snapshot. `--ready` emits that same snapshot and exits non-zero unless every required check is ready. `--metrics` emits a bounded Prometheus text representation with fixed metric names and low-cardinality state labels.

The aggregate probes the real account server's `/api/health/live` and `/api/health/ready` routes with a configured base URL, then reads PostgreSQL for:

- monitor scheduling, unknown observations, and open incidents;
- email queue counts and oldest outstanding delivery;
- backup jobs, persistent failures, and the oldest due job;
- remote route/certificate reconciliation work;
- current public/staff gateway observations for live placements;
- retained-snapshot coverage and verification state for live configured installations; and
- usage reconciliation freshness.

The account health routes return only `live`, `ready`, or `unavailable`. Liveness proves the HTTP process is accepting work without depending on PostgreSQL. Readiness checks database access and the complete migration ledger. Neither route returns configuration or per-tenant data.

Each component reports `ready`, `degraded`, `unready`, or `unknown`, a stable diagnostic code, counts, and timestamps. A failed control API readiness probe or a parked backup/remote-configuration job is unready. Stale or missing evidence and delayed queues are degraded or unknown, never healthy. Historical terminal counters remain evidence but do not permanently fail readiness by themselves. Thresholds are explicit CLI configuration with conservative defaults.

## Customer diagnostic contract

An authenticated POST route accepts one installation ID and rechecks current owner membership before and after the read. It returns a versioned JSON document containing only stable customer-facing identifiers and evidence already suitable for the portal: access state, service desired/observed state, monitor freshness and incident kinds, redacted public/staff result state and certificate expiry, and latest/verified snapshot times.

The route excludes account IDs, emails, keys, tokens, storage endpoints/buckets, route hostnames, certificate fingerprints, internal failure strings, worker rows, and every other venue. The portal adds an English/Spanish download action only where the signed-in account currently has owner authority. A lost or refused response changes no server state and can be retried safely.

## Error handling and bounds

HTTP probes use a short abort deadline, reject redirects, cap response bodies, and report only fixed codes. Database statements use the existing operator pool bounds. The status command emits no partial snapshot if the management database itself is unavailable; it prints one fixed error and exits non-zero. Readiness and metrics output have bounded cardinality and never include venue, organisation, installation, hostname, endpoint, email, or error-message labels.

Customer diagnostic requests use the existing session, CSRF, origin, and per-account rate-limit boundaries. Invalid, foreign, non-owner, revoked-authority, and permission-change cases are refused without revealing whether the target exists.

## Verification

PostgreSQL tests create healthy, stale, failed, cross-tenant, and permission-race fixtures. HTTP tests prove live/readiness behavior and the complete migration check. CLI tests prove status, readiness exit codes, fixed failures, redaction, and metrics cardinality. Portal controller/browser tests cover download, retries, English/Spanish copy, phone/desktop layout, supported themes, and accessibility.
