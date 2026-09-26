# Try remote access with two local venues

You can now run two real Waitron servers through one shared local gateway. Staff
HTTPS ends at their venue; public HTTPS ends at the gateway and passes a browser
challenge before reaching Waitron over a second verified HTTPS connection. This
milestone exposes only `/public/availability`. It does not publish menus or bookings.

## Run the proof

Use Docker with Linux WireGuard support, Node 26 or later, pnpm, and a Waitron
checkout containing the Cloud certificate adapter. Install both repositories with
`pnpm install --frozen-lockfile`, then build Waitron's dashboard:

```sh
pnpm --dir /absolute/path/to/waitron --filter @waitron/dashboard build
```

From this Cloud checkout:

```sh
pnpm portal:build
docker build -t waitron-cloud-local-remote:dev -f deploy/local-remote/Dockerfile .
WAITRON_CHECKOUT=/absolute/path/to/waitron \
  REMOTE_RECEIPT=/tmp/cloud-remote-receipt.json \
  node scripts/test-postgres.mjs exec node scripts/test-local-remote.mjs
```

The runner starts PostgreSQL, a real ACME test certificate authority and DNS
validation server, two gateway cells, two tunnel peers and a LAN DNS resolver. It pairs two
actual Waitron SQLite servers using authenticated manager requests. Staff keys are
generated inside each Waitron state directory; Cloud receives only signing requests.
The gateway holds its own public-site keys and WireGuard key, never staff TLS keys.

The run prints `PASS` checks and a JSON receipt with gateway replacement, revocation and
monitoring-phase times. It checks real staff logins, cross-venue cookie rejection, an actual
browser Worker solving the bot challenge, zero upstream calls for rejected public traffic,
peer isolation after malicious route expansion, live certificate renewal, removal of
an established revoked connection, cache expiry across restart and corrupt-cache
startup refusal. `node scripts/test-gateway-cache-loss.mjs` separately proves refusal
when a previously initialized gateway loses its accepted cache. A fresh DNS client then reaches trusted LAN HTTPS without valid
gateway authority. Normal exit removes every owned container and temporary state.

The same proof runs Cloud's functional probe against both authorised placements through
the actual gateway. It solves the public challenge and verifies staff TLS passthrough,
records certificate validity/fingerprints and refuses unknown SNI. The machine-readable
receipt includes the two structured probe results. It then persists real observations and
drives the durable monitor, account portal and Mailpit through an isolated venue route
failure, stale evidence, invalid certificate trust, a full gateway outage and each recovery.
Run `node scripts/verify-remote-monitoring-receipt.mjs /tmp/cloud-remote-receipt.json` to
check the versioned phase list, timings, tenant-isolation flags and alert deduplication.
It finally stages one venue on the second cell, cancels an unreachable destination, then
tests and commits a fresh destination route. Run
`node scripts/verify-cell-movement-receipt.mjs /tmp/cloud-remote-receipt.json` to check
the manifest sequence advances, failed-apply rollback, stable names/certificates, source
revocation and other-venue isolation.

The test root is trusted explicitly by its test clients. It never installs a system
certificate authority, disables certificate verification or changes host DNS. The
Waitron fixtures bind their temporary demo servers to all host interfaces so Docker
can reach them; gateway ports bind to loopback. Run this on a development machine.
The fixture has no fiscal/payment provider and creates no invoices.

Run the smaller DNS validation proof independently:

```sh
node scripts/test-local-acme.mjs
```

It issues and renews a certificate against Pebble and verifies refusal when the DNS
challenge record is absent. Pebble images are pinned by digest in
`scripts/remote-fixtures.mjs`; challenge validation is never bypassed.

## Set up your venue in the account portal

Open **Your venues**, then **Set up remote access** for your venue. You must be an
organisation owner. Start with the assigned staff and public addresses; they avoid
changing your own domain. If no gateway has been assigned, the screen says so instead
of offering an address that cannot work.

To use a name such as `staff.your-cafe.es`, choose the address to change, enter the name
and select **Review DNS settings**. Create both displayed CNAME records at your domain
provider. The first directs traffic to your venue; the second delegates certificate
validation. Keep both records while you use the name. Use a subdomain because many DNS
providers cannot put a CNAME at the domain root.

Select **Check DNS and use this name** when both records are present. A failed check
leaves your current name unchanged. DNS can take time to propagate, so check the records
and retry. **Use assigned name** lets you review a switch back without custom records.
A concurrent configuration change requires refreshing and reviewing again. If the save
reply is lost, the portal reads the current settings instead of resending the change.

Changing a name returns the service to setup pending and can interrupt access until its
certificate and venue settings are updated. The local reconciler below can publish the
updated gateway route and issue a matching certificate after an operator changes the
trusted mapping. This screen does not
activate a live subscription or install a tunnel on a customer appliance. Once fresh
service observations confirm the selected configuration, the addresses become links.
That confirmation expires with the observation or connection lease, even on an open page.

Expand **Use the staff address on your local network** for DNS and offline-test guidance.
Cloud cannot configure your router or prove that a device uses its local DNS resolver.
The staff hostname must match the installed certificate and the local override.

The account API exposes only names, configuration revision and service status. It checks
current ownership again after DNS verification and records the account, selected name
and revision with the change. Customer requests cannot choose a gateway cell, tunnel key,
private network address or certificate provider.

## Keep a local gateway configured

The operator CLI takes trusted local JSON files and `DATABASE_URL`. Run migrations
first. These commands are internal operator tools; exposing their input directly to
a browser would grant placement and DNS authority that customers must not receive.

```sh
node packages/remote-access/src/operator-cli.ts cell /path/to/cell.json
node packages/remote-access/src/operator-cli.ts provision /path/to/venue.json
node packages/remote-access/src/operator-cli.ts export /path/to/export.json
```

A cell file contains `id` (UUID), `country: "ES"`, `provider: "aws"`,
`environment: "test"`, `suffix`, `subnet` (0–255), its WireGuard `publicKey`, and
`endpoint` (`hostname:port`). A cell holds at most 64 placements. A venue file contains
`installationId`, `cellId`, `peerPublicKey` and `port` (normally 443). Provisioning
returns the two hostnames, private tunnel address and public gateway configuration.
Retries with the same binding return the existing placement; conflicting bindings fail.

An export file contains `cellId`, `signingKeyFile` (Ed25519 PEM), `output` and optionally
`watch: true`. Watch mode exports every thirty seconds. The gateway reads the output
every second and accepts only increasing, signed sequences for its own cell. Exports
expire ten minutes after signing. Failed export keeps the previous file, whose original
expiry still applies. Preserve the whole state directory during replacement, including its initialization
marker and accepted configuration. Missing or corrupt established state needs operator
recovery; do not delete the marker to make an old export acceptable.
Keep the signing key outside the gateway; mount only its public key.

## Reconcile routes and certificates

Use the durable reconciler after migrations have run and placements have been assigned.
It projects current PostgreSQL state into signed, expiring gateway manifests and checks
public and staff certificates for renewal. Its leases survive a process restart, prevent
two workers from completing the same claim and retry failures with a bounded backoff.
After eight consecutive failures, a target is parked until its desired state changes or
the target is disabled and enabled again.

Create a trusted JSON file with these explicit mappings:

```json
{
  "routes": [
    {
      "cellId": "00000000-0000-4000-8000-000000000001",
      "output": "/absolute/gateway/input/manifest.json",
      "signingKeyFile": "/absolute/operator-keys/cell.pem"
    }
  ],
  "certificates": [
    {
      "installationId": "00000000-0000-4000-8000-000000000002",
      "kind": "staff",
      "csrFile": "/absolute/exchange/staff.csr",
      "output": "/absolute/exchange/staff.crt"
    }
  ],
  "acme": {
    "directoryUrl": "https://acme.example/directory",
    "email": "operations@example.com",
    "accountKeyFile": "/absolute/operator-keys/acme.pem",
    "dnsModule": "/absolute/adapters/dns.mjs"
  }
}
```

List every public and staff certificate target separately. The DNS module exports a
default object with async `present(name, value)` and `remove(name, value)` methods. All
paths must be absolute. A missing route or certificate mapping fails only that target;
the worker does not infer a path or reuse another cell's key.

Run one scheduling and work pass, inspect redacted status, or leave the worker running:

```sh
DATABASE_URL=postgres://... pnpm remote:reconcile /absolute/reconciler.json --once
DATABASE_URL=postgres://... pnpm remote:reconcile /absolute/reconciler.json --status
DATABASE_URL=postgres://... pnpm remote:reconcile /absolute/reconciler.json
```

Certificate publication rechecks the current hostname, ACME delegation name,
configuration revision and claim lease after ACME completes. A stale result is refused.
Files are replaced atomically, so a failed issuance or write keeps the prior usable chain
or manifest. Cloud reads the staff CSR and returns only the chain; the private key remains
in Waitron. Transporting that CSR and chain between a production appliance and Cloud is
not implemented by this local filesystem adapter.

On shutdown, the worker refuses to publish a result completed after the signal and returns
that claim without consuming retry budget. The current ACME client does not expose request
cancellation, so the process may still wait for an in-flight ACME request or backoff to
return before it exits. Choose and test the deployment grace and forced-termination policy
against the selected ACME provider before production rollout.

Run the local reconciliation receipt against clean Cloud and Waitron checkouts:

```sh
WAITRON_CHECKOUT=/absolute/path/to/waitron pnpm proof:remote-reconciler
```

The receipt uses PostgreSQL plus the local Pebble and DNS fixtures. It proves signed
two-venue route publication, expired-lease restart and duplicate-worker recovery, bounded
failure parking, initial public and
staff issuance, renewal after CSR-key changes, Waitron's existing staff install command,
retention after failed renewal, and hostname and expired-lease fences. It creates no live
DNS record or certificate.

The local image runs `src/gateway-cli.ts` with `NET_ADMIN` inside its isolated network
namespace. Mount `/input` read-only and `/state` writable. Input holds `manifest.json`,
`issuer.pem`, `wireguard.key`, a 32-byte `bot.key`, and `public-certs/*.pem` containing
public-site chains and keys. Set `GATEWAY_CELL_ID`, `GATEWAY_SUBNET`, and, for a test CA,
`GATEWAY_UPSTREAM_CA`. The runner is the executable example for container arguments.
Its `peer-cli.ts` is a local bridge to `host.docker.internal`, not an installer for a
customer appliance. Neither component changes the host's network interfaces.

## Move a venue between existing cells

Cell movement is a trusted operator workflow. It preserves the current staff and public
hostnames, but it does not provision a cell, change public DNS or install the venue peer.
Use one UUID as the durable operation ID and keep the installation revision returned by
the account/control API.

1. Run `move-stage` with `operationId`, `installationId`, `targetCellId`,
   `targetPeerPublicKey`, `expectedRevision` and optional `port`. The result contains the
   unchanged hostnames plus the source and reserved destination routes.
2. Export the destination cell. Apply that exact signed manifest, configure the venue
   peer for the destination gateway, and test both public HTTPS and staff TLS through the
   destination route. A failed apply is not readiness: run `move-cancel`, then export the
   destination cell again so its staged route is removed.
3. After a successful route test, run `move-ready` with the same `operationId` and
   `expectedRevision`, plus the sequence reported by the tested destination gateway. The
   command refuses a sequence that was not generated after this move was staged.
4. Run `move-commit` with the same operation and revision. Then export and apply newer
   manifests for both cells. The destination keeps the active route and the source removes
   it. Do not treat the move as complete while either gateway still reports the older
   sequence.

Exact retries return the durable stage, readiness, cancellation or completed result.
A competing move, changed installation revision, revocation or mismatched operation input
fails without changing the active placement. Cancellation never reuses an uncertain tunnel
address. If the commit reply is lost, retry `move-commit`; do not create a new operation.
The reconciler preserves route and certificate state across a move, but live public DNS
changes and production appliance automation remain separate deployment work.

Two 2026-09-26 local two-cell runs applied the destination route and reconnected a fresh
peer in 1,321 ms and 1,486 ms; the second receipt names clean head `e4f9356`. They kept the original staff/public hostnames and certificate fingerprints,
removed the cancelled stage, removed the committed route from the source, and kept the
other venue reachable only through that source. This is one local Docker measurement, not
a production recovery-time promise. Repeat it with the selected gateway deployment,
provider network, live DNS/certificate adapters and appliance configuration path before
setting an objective.

## Issue and renew certificates

Use Waitron's `apps/server/scripts/cloud-certificate.ts csr` command to create a CSR
with its local key. The Cloud command authorizes that CSR against the active placement:

```sh
node packages/remote-access/src/operator-cli.ts certificate /path/to/certificate.json
```

The current CSR contract uses an RSA key of at least 2048 bits, as generated by
Waitron. Elliptic-curve CSRs are not accepted by this first adapter.

The JSON contains `installationId`, `kind` (`staff` or `public`), `csrFile`, `output`,
`directoryUrl` (an HTTPS ACME directory), `accountKeyFile`, `email` and `dnsModule`.
The DNS module is a trusted local module exporting `default` with async
`present(name, value)` and `remove(name, value)` functions. Use a narrowly scoped DNS
provider credential when implementing the live provider adapter. The local runner
supplies a Pebble adapter. Customer input never selects this module.

Run this command daily under your job scheduler. It renews within thirty days of
expiry, or the last third of a shorter certificate's life. `force: true` requests a
renewal for the local test. The existing output survives issuance failure. Recheck
placement after ACME finishes, then publish the chain atomically. Install the returned
staff chain with Waitron's `cloud-certificate.ts install` command; Waitron validates
its hostname and local key before replacing the file, then reloads future TLS
connections within ten seconds. Initial HTTP-to-HTTPS setup still needs a restart.

For a custom hostname, ask for the exact delegation instructions:

```sh
node packages/remote-access/src/operator-cli.ts dns /path/to/custom-name.json
```

The file contains `installationId`, `kind` and `hostname`. Create both returned
CNAME records, then add the current `expectedRevision` and run the `hostname` command.
Both CNAMEs must resolve to the assigned venue targets. Custom names cannot claim
any cell suffix, including names reserved for venues not yet provisioned. The command refuses an already
claimed name or stale revision, changes the active hostname and returns the placement
to provisioning. Reissue its certificate and update Waitron's management origin before
exporting routes with the changed name. This initial operator flow selects one active
staff and one active public name; it does not serve both custom and assigned aliases.

## Keep LAN access independent

Configure your local DNS resolver to return the server's reserved LAN address for the
staff hostname. Clients must actually use that resolver. Where a router cannot override
one name, point its DNS setting at a local resolver which handles this name and forwards
other queries. Devices using their own secure DNS may bypass it.

Test with the external gateway unavailable and a new client process so a cached answer
cannot hide a problem. You should still get the same valid staff certificate. If local
resolution fails, check the device's resolver setting and DHCP address reservation first.
To roll back, remove the local override and restore the router's prior DNS setting;
remote access then depends on the gateway again. The container proof demonstrates one
configured resolver path, not universal router support.

## Read failures and limits

A public 403 asks the browser to complete the challenge; a 429 means the source or
upstream concurrency limit has been reached. A 503 means the venue could not provide
its public response. Unknown names and expired route authority close the TLS connection.
`/state/status.json` reports process readiness, active route count, sequence and challenge/rejection/forward/failure
counters without request contents. Service health is separate from desired configuration;
the integration reports health only after the real HTTPS probes succeed.

The public allowlist rejects manager/setup/sync/media routes, upgrades and arbitrary
paths. Upstream requests discard cookies, authorization and forwarded headers. Staff
passthrough has connection limits but cannot inspect encrypted staff requests. Proof of
work adds a cost to automation; it does not identify humans or stop a determined client
with enough resources. IPv4/IPv6 addresses behind a shared NAT share a source quota.
ECH is not configured: an unrecognized outer ClientHello name cannot route.

A failed apply retries the exact persisted configuration without extending its expiry.
A dead HAProxy child restarts from still-valid authority; it cannot restart after expiry.
Gateway replacement and certificate reload may interrupt remote connections. In repeated
2026-09-25 local proofs, a mature unchanged WireGuard peer recovered after about 111 seconds: its
old kernel session was not available in the replacement gateway, so it reconnected at the
normal WireGuard rekey window. The runner allows up to three minutes to measure this case.
The earlier sub-minute result covered freshly established peers and is not a production
availability target. Define a launch target and test any explicit peer-side rekey strategy
before promising faster recovery. LAN access remains independent. Live provider DNS and
ACME credentials, production key storage, CSR/chain transport, appliance installation,
automatic customer appliance setup and deployment hardening still need their own
implementation and validation before customers can subscribe. The local account portal
and opt-in email queue now present redacted public/staff route incidents and recoveries;
live sender and deployment proof remain separate launch work.

Use `pnpm remote:probe --once` on a separate monitoring host once the configured names
resolve publicly to this gateway. The continuous form repeats every minute. It reads
authorised targets from PostgreSQL, uses system TLS trust and accepts no caller URL or
private-address override. See [local monitoring](local-monitoring.md#probe-remote-access-from-outside-the-gateway)
for its bounds, durable evidence and JSON-line result contract. The monitor records route
failure, stale-probe, certificate-expiry and recovery transitions. The portal shows the
latest redacted public/staff evidence, and opted-in owners receive bilingual incident and
recovery mail after current route authority is rechecked.
