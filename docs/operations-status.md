# Inspect Cloud operations

Use the operations status command to answer two questions without opening tenant data:

- Is the Cloud control plane ready to receive work?
- Which shared subsystem needs attention when it is not fully ready?

The command reads current PostgreSQL projections and probes the account API. It does not
change service state, run workers or repair a failure.

If you use the complete local Compose deployment, start with
`pnpm local-stack:status`. That command reports container and health state without printing
the generated database password. The aggregate command on this page is a separate inspection
surface for a deployment whose database URL is available to the operator. See the
[local deployment guide](local-deployment.md) for startup, restart, upgrade and reset.

## Configure the check

Set the management database and the origin of the account API:

```sh
export DATABASE_URL=postgresql://cloud:replace-password@localhost:5432/cloud
export CLOUD_CONTROL_API_URL=http://127.0.0.1:3000
```

`CLOUD_CONTROL_API_URL` must be an `http` or `https` origin without credentials, a path,
a query string or a fragment. The command probes `/api/health/live` and
`/api/health/ready` at that origin. Each response is bounded to 256 bytes and redirects
are not followed.

You can tune the bounded checks with these environment variables:

| Setting | Default | Accepted range | Meaning |
| --- | ---: | ---: | --- |
| `CLOUD_OPERATIONS_PROBE_TIMEOUT_MS` | 2,000 ms | 1 to 30,000 | Deadline for each account API probe |
| `CLOUD_OPERATIONS_QUEUE_WARNING_SECONDS` | 300 s | 1 to 86,400 | Age at which pending email is backlogged |
| `CLOUD_OPERATIONS_EVIDENCE_STALE_SECONDS` | 300 s | 1 to 86,400 | Age at which monitor or gateway evidence is stale |
| `CLOUD_OPERATIONS_SNAPSHOT_STALE_SECONDS` | 172,800 s | 1 to 31,536,000 | Age at which the latest verified snapshot is stale |
| `CLOUD_OPERATIONS_RECONCILIATION_STALE_SECONDS` | 300 s | 1 to 86,400 | Age at which usage reconciliation is stale |

An invalid setting, inaccessible database or incompatible schema stops the command with
exit status 1 and this fixed message on standard error:

```text
Cloud operations status failed; check database, migrations and health URL
```

No partial status is printed on that failure path.

## Read JSON status

Run the default mode for a diagnostic snapshot:

```sh
pnpm operations:status
```

The command prints versioned JSON and exits 0 when it could complete the inspection,
including when the reported state is `degraded` or `unready`. The top-level state means:

| State | Meaning |
| --- | --- |
| `ready` | Every component is ready. |
| `degraded` | Work can be accepted, but evidence is stale, missing or delayed. |
| `unready` | A required control-plane dependency or parked job needs intervention. |

The overall state is `unready` when any component is unready, then `degraded` when any
component is degraded or unknown, and otherwise `ready`. The `ready` boolean is true only
for the final state.

Each component includes a stable `code` and bounded counts or timestamps:

| Component | What it checks |
| --- | --- |
| `controlApi` | The live and ready account API probes and the slower probe duration |
| `monitoring` | Configured venues, due checks, stale evidence and open incidents |
| `email` | Current queue counts and messages beyond the delivery bound |
| `backups` | Due work and failed jobs that have been parked |
| `remoteConfiguration` | Enabled targets and due, running or failed reconciliation jobs |
| `gateways` | Expected public and staff probes, including missing, stale and failed evidence |
| `storage` | Latest snapshot evidence for installations using retained snapshots |
| `usage` | Whether every durable usage source has a current reconciliation receipt |

An empty configured service is ready and uses `no_targets`, `no_jobs` or `empty` as
appropriate. Historical terminal email failures remain visible in the counts but do not
keep the service degraded. Investigate the component's code before changing a threshold.

For a readiness gate, use:

```sh
pnpm operations:status --ready
```

This prints the same JSON. It exits 0 only for `ready`, exits 2 for `degraded` or
`unready`, and exits 1 when the inspection itself failed. That distinction lets a
scheduler retry infrastructure failures separately from a valid negative readiness
result.

## Export Prometheus metrics

Run:

```sh
pnpm operations:status --metrics
```

The command emits Prometheus text and exits 0 after a successful inspection, regardless
of the reported readiness. Scrape or redirect the output using your deployment's normal
collector. Important families include:

- `waitron_cloud_operations_ready`, which is 1 only when every component is ready;
- `waitron_cloud_operations_component_info`, with bounded `component`, `state` and
  `code` labels;
- `waitron_cloud_operations_control_api_elapsed_milliseconds`;
- `waitron_cloud_operations_monitoring_targets` and
  `waitron_cloud_operations_email_messages`;
- `waitron_cloud_operations_backup_jobs` and
  `waitron_cloud_operations_remote_configuration_jobs`; and
- `waitron_cloud_operations_gateway_checks`,
  `waitron_cloud_operations_storage_checks` and
  `waitron_cloud_operations_usage_sources`.

The export deliberately omits timestamps, tenant identifiers, hostnames, provider
details, configuration and raw failure text. The labels come from fixed component,
state, code and status sets, so a growing customer population does not create an
unbounded series count.

## Collect status in the local deployment

To watch the local stack without running a command each time, enable its optional
collector after starting the stack:

```sh
docker compose --env-file deploy/local-stack/local.env --profile operations up -d operations-collector
curl --fail http://127.0.0.1:9091/status
curl --fail http://127.0.0.1:9091/metrics
```

The collector runs the status command's existing inspection implementation and defaults
immediately, then waits 60 seconds between completed inspections. It runs separately from the workers and does not schedule
or repair their work. Each inspection checks the release's complete migration ledger,
uses PostgreSQL's read-only transaction default, and has a 30-second process deadline.
The local runtime login still has write privileges; this setting prevents accidental
writes by the collector, rather than providing a separate database security boundary.

`/status` wraps the command's unchanged JSON in a version 1 document. Its `collection`
object gives you `state`, `attemptedAt`, `succeededAt` and `expiresAt`; `snapshot` holds
the successful inspection. `current` means collection succeeded, even when that
snapshot reports `degraded` or `unready`. Collection failures return HTTP 503 with
`state: "failed"` and `snapshot: null`. Before the first result, the state is `pending`.
If the last successful result ages beyond the interval plus the command deadline, the
state becomes `stale` and its snapshot is suppressed. `pending` and `stale` also return
HTTP 503; a completed degraded or unready inspection returns HTTP 200. This bound describes the collection
schedule; it does not set an alert threshold or a service availability promise.

`/metrics` remains available on a collection failure. It exports
`waitron_cloud_collection_success` as zero and omits all previous operations metrics,
so a broken database cannot leave a healthy sample in the current export. The
`waitron_cloud_collection_last_attempt_timestamp_seconds` and
`waitron_cloud_collection_last_success_timestamp_seconds` gauges identify the attempts
and last success without adding labels. When collection succeeds, the endpoint also
exports the status command's existing bounded-label metrics. An unreachable collector
must be treated as a scrape failure by the client; it cannot report its own disappearance.

Set `CLOUD_OPERATIONS_INTERVAL_MS` to an integer from 1,000 to 3,600,000 before creating
the service to change the interval. The default is 60,000. A very short interval competes
with other health probes for the existing account API rate allowance. Set
`LOCAL_STACK_OPERATIONS_PORT` to change the loopback port. The collector has its own
network endpoint, so restarting the account API does not hide collection failures. Its
local health requests connect to the account service with that service's required
`localhost:3000` Host header. No listener or reserved host port exists when the optional
collector is absent.

The collector keeps only the current result in memory and starts with no sample after a
restart. It does not retain a time series. You can stop it without stopping the workers:

```sh
docker compose --env-file deploy/local-stack/local.env --profile operations stop operations-collector
```

Run the disposable local rehearsal with `pnpm proof:operations-collection`. It requires
the same package-read token as the stack build and removes only its generated project.
It exercises changing readiness, incompatible migration contents, database loss,
recovery and collector restart. See the [deployment guide](local-deployment.md) for
its measured receipt and limits.

## Use the account API health routes

`GET /api/health/live` returns `200 {"status":"live"}` when the account process can
accept HTTP work. It does not query PostgreSQL, so it remains live when the database is
unavailable.

`GET /api/health/ready` checks PostgreSQL and every migration known to the running
server. It returns `200 {"status":"ready"}` or
`503 {"status":"unavailable"}`. It shares the API's 120-request-per-minute client-IP
allowance, and each process admits at most one readiness query at a time. Excess probes
receive the normal 429 or 503 response. Neither route returns migration names, database
errors or tenant data. Use liveness for process replacement and readiness for traffic
admission, and keep both behind the deployment ingress rather than exposing the Node
listener directly.

## Download a customer diagnostic

An organisation owner can choose **Download diagnostic** on a venue card in the account
portal. The portal downloads a versioned JSON document for that installation. It includes
the installation and venue IDs, environment, configuration revision, access dates,
redacted service health, monitoring incidents, public and staff check status, and latest
and verified snapshot times.

The document excludes account and organisation details, email addresses, hostnames,
provider locations, credentials, configuration payloads, certificate fingerprints and
raw errors. Evidence older than five minutes is reported as `unknown`. The read is passive,
does not extend the session and allows 30 requests per account per minute. Membership and
ownership are checked again inside the read transaction, so losing access while a request
waits does not release the document.

Ask the customer to review the downloaded file before sharing it. The redaction boundary
makes the artifact suitable for troubleshooting, but the installation and venue IDs still
identify their Cloud resources.

## Production limits

This status surface is local operational tooling, not a deployed monitor. The repository
offers opt-in local collection and a loopback metrics endpoint. It does not configure
production collection, alerts or a public status page. The checks reflect current database projections; they do not prove provider
capacity, restore success, regional availability or an end-to-end customer journey.

Before relying on it for production traffic or an availability promise, run it in the
selected deployment, set alert thresholds from measured behavior, add representative
external checks and connect collection to the deployment's incident process.
