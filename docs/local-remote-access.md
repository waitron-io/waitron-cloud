# Try remote access with two local venues

You can now run two real Waitron servers through one shared local gateway. Staff
HTTPS ends at their venue; public HTTPS ends at the gateway and passes a browser
challenge before reaching Waitron over a second verified HTTPS connection. This
milestone exposes only `/public/availability`. It does not publish menus or bookings.

The [D88 public access/A951 proposal](waitron-integration-contract.md#public-access-and-a951-proposed)
adds menu, booking, online-order and table-QR scope for the Cloud step soon after
go-live, not go-live itself. It is unapproved and unimplemented. The existing
`/_cloud/*` challenge handlers stay local to the gateway; they are not upstream
business routes. Neither this local proof nor source reading qualifies the added scope.

If the venue cannot answer after the browser challenge, you see a short unavailable
page in English or Spanish, chosen from your browser language preferences. It follows
your light or dark theme and offers **Try again** on the same public route. The gateway
keeps the 503 response, sends `Retry-After: 30` and disables caching so you can retry
without keeping an old failure. A client requesting `application/json` receives
`{"error":"venue_unavailable"}` instead; neither response includes venue hostnames or
internal failure details. Run the focused HTTP checks with
`pnpm --dir packages/remote-access exec node --test test/public-gate.test.ts` and the
browser matrix with `pnpm --dir packages/ui-smoke exec node --test
--test-name-pattern="unavailable page" test.mjs`.

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

For release evidence, run this remote proof together with transfer and managed
recovery through the complete milestone command documented in
[the backup proof](local-backups.md#run-the-proof). That command rejects dirty or
mismatched Cloud and Waitron heads and writes one receipt only after all three phases
pass.

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

The existing screen's **Use the staff address on your local network** guidance
describes an optional registered-name DNS override, not the `.local` device default.
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
in Waitron. For an authenticated CSR/chain exchange without shared files, use the database staff
mode below. Automatic production appliance scheduling remains a Waitron dependency.

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

## Exchange staff certificates without shared files

Use the [version 1 machine exchange](waitron-integration-contract.md#staff-certificate-exchange-version-1)
when a test installation cannot share the reconciler filesystem. Set
`CLOUD_STAFF_CERTIFICATES=1` on the account service (also forwarded by the local
Compose account service); the default is disabled and returns 503. This opt-in
requires the installation issuer and currently refuses production installations.
Enable it together with the database staff worker. Add `"staffExchange": true`
to the trusted reconciler JSON and remove every `kind: "staff"` entry from its
`certificates` array. Public certificate files, route mappings, DNS adapter and ACME
credentials keep their existing configuration. Staff requests arrive through the
signed installation API and the worker reads and writes their bounded PostgreSQL
rows. Run one consistent mode across all workers; do not mix database staff workers
with filesystem staff workers against the same jobs.

A new predecessor-bound request changes the worker's desired state, so it becomes
due even if the preceding request is parked or scheduled for tomorrow. An exact
submit retry does not reset work. Publication checks the job lease, current request,
hostname, revision and revocation together. Failed issuance keeps the old chain;
a result completed after replacement, revocation, configuration change or shutdown
cannot replace it. A changed hostname requires a new CSR and request at the current
revision. Installation replacement also requires the new installation's own proof,
lease and request; it cannot read the old installation's chain.

Run the local two-installation proof against an isolated Waitron checkout:

```sh
WAITRON_CHECKOUT=/absolute/path/to/waitron \
  node scripts/test-postgres.mjs exec node scripts/staff-certificate-receipt.mjs \
  /tmp/cloud-staff-certificate-receipt.json
```

The proof uses real PostgreSQL, signed requests over loopback HTTP, local Pebble/DNS
issuance and Waitron's unchanged CSR/install CLI. It checks two separate owners,
lost-reply retries, cross-tenant refusal, failed renewal retention, successful
replacement, stale issuance and revocation. It verifies removal of its ACME
containers/network, temporary state and database schema before writing the receipt.
Loopback HTTP exercises the handler, not production transport security. The proof
does not deploy a live provider, test appliance polling/TLS reload or make a
production certificate-availability promise.

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
peer in 1,321 ms and 1,486 ms; the second receipt names clean head `e4f9356`. A clean
complete-milestone run on 2026-09-27 reconnected it in 1,570 ms. They kept the original
staff/public hostnames and certificate fingerprints, removed the cancelled stage, removed
the committed route from the source, and kept the other venue reachable only through that
source. This is one local Docker measurement, not a production recovery-time promise.
Repeat it with the selected gateway deployment,
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

The owner's 2026-10-21 requirement makes Waitron's `.local` address the default for
venue devices, using its existing local CA and client trust. Do not redirect that
path through Cloud, require the WAN or bypass certificate warnings. Fresh offline
clients still need qualification on supported devices; the recorded resolver proof
below demonstrates the optional registered-name path, not `.local` trust.

You can select the certified Cloud staff hostname for an actual active on-premises
or hosted server. Staff TLS ends at that endpoint with its private key. A Cloud-only
primary cannot be reached through link-local `.local` discovery or serve an offline
LAN client; a local follower needs separately approved fenced promotion to write.
Public certificates cover the registered DNS name, not `.local`. See the
[shared proposal and reference boundaries](waitron-integration-contract.md#keep-local-staff-and-public-access-distinct).

For the **optional registered staff hostname on the LAN**:

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
2026-09-25 local proofs, a mature unchanged WireGuard peer recovered after about 111 seconds:
its old kernel session was not available in the replacement gateway, so it reconnected at
the normal WireGuard rekey window. The clean 2026-09-27 complete-milestone run replaced the
same local gateway in 14,967 ms and published encrypted snapshots for both venues before
and after replacement while its peers were freshly established. The timing depends on rekey
state, so neither result is a production availability target. The
[paired gateway comparison](gateway-reconnection-measurements.md) now measures a
30-second-old peer handshake: unchanged-peer controls recovered in 105.912 and
105.845 seconds, a peer-originated packet in 19.189 seconds, and explicit peer
removal/re-addition plus a packet in 4.297 seconds. All trials preserve the gateway
key and endpoint and require fresh trusted HTTPS with the intended venue body,
unchanged certificate and newer handshakes. The versioned receipt records the
clean measurement source and empty fixture cleanup. Repeat with an authenticated
Waitron appliance trigger, active connections and the selected deployment before
choosing or promising a faster recovery target. LAN access to an active local server
remains independent on the qualified local path.
Live provider DNS and
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

## Measure shared public traffic limits

Two venues can keep their sessions separate while still sharing capacity. Run the
bounded traffic profile before choosing limits for customers behind a shared public
IP address, such as an office or mobile carrier. Use the same prerequisites, image
build and clean Cloud/Waitron checkouts as the remote proof above:

```sh
WAITRON_CHECKOUT=/absolute/path/to/waitron \
  PUBLIC_LIMITS_RECEIPT=/tmp/cloud-public-limits.json \
  node scripts/test-postgres.mjs exec node scripts/test-local-remote.mjs
node scripts/verify-public-gateway-limits-receipt.mjs /tmp/cloud-public-limits.json
```

This mode reuses the two paired Waitron servers, test certificates, HAProxy gateway
and WireGuard peers. It ends after the traffic measurements and cleanup; it does
not repeat the backup, movement or monitoring milestone. The version 1 receipt
names both code commits and venues, counts HTTP responses and connection refusals,
and records minimum, median, 95th-percentile and maximum request latency. It is
written only after cleanup succeeds and refuses dirty code checkouts.

The real gateway profile sends solved and unsolved challenges, checks cross-host
cookies, blocks staff paths and forged proxy headers, disconnects one venue while
calling the other, and recovers it. Reused HTTPS connections isolate the public
gate's request budget from HAProxy's connection budget. A separate burst opens 80
fresh connections across both venues. Restart checks demonstrate recovery, not a
persistent distributed allowance.

A companion profile uses the unchanged public gate and two controlled HTTPS
upstreams. It holds 64 requests until you can observe the other venue's refusal,
then releases them and checks recovery. It also verifies request and response
credential stripping, distinct venue bodies, expired challenges and access cookies,
and rejection without upstream calls. Only this companion advances an injected
clock; the Docker gateway uses wall-clock time. Run it and the receipt guards with
`pnpm test:public-gateway-limits`.

The [2026-09-30 receipt](receipts/public-gateway-limits-2026-09-30.json) records
Cloud `c612d9f7e87ff37d7153d193d7c4fe964fcfd6fe` and Waitron
`6cda93bae67467f81279c946f1842480b2fce9c5`, both clean. Each venue accepted all eight
solved requests, with maximum latency of 22.1 ms for A and 16.5 ms for B. After A
was disconnected, its request returned 503 in 5,007.5 ms while B accepted all four
requests within 14.1 ms. The fresh-connection burst returned 31 challenges and
refused 49 connections; its maximum latency was 68.4 ms. All owned gateway/ACME
containers and networks, Waitron child processes and fixture directories were gone
before the receipt was written. PostgreSQL and Mailpit belong to the outer runner,
which removed them after the proof exited successfully.

The current policy is shared: one source gets 120 gate requests per minute across
all venues, and the gate has 64 upstream slots across all sources and venues.
Challenge requests also spend that allowance. HAProxy separately permits at most
32 concurrent connections and a connection rate of 60 per ten seconds from a
source. Solving a challenge grants no separate allowance. A valid customer can
therefore receive a refusal because another customer shares their address or
because a different venue occupies the available slots. These are capacity
interactions; the session and credential checks still apply.

The profile retains those policy values. You still need to choose per-venue
fairness and an authenticated automated-client policy. These local synthetic
bursts do not establish a production throughput target, real-carrier false-positive
rate, multi-gateway coordination, browser/device mix, or acceptable customer latency.


## Exercise test free and paid plans

Keep `CLOUD_TEST_SERVICE_PLANS=0` for ordinary deployments. The isolated test
Cloud will use `1` after its remaining storage, LAN and client proofs pass. Both
remote operator commands and the reconciler validate this flag and pass the same
mode to their stores. The account server CLI also rejects malformed values and
passes its validated mode through lifecycle and remote certificate handlers.

With test enforcement enabled, a free organisation cannot provision remote
access, move cells, change hostnames, request DNS instructions or submit/read a
staff certificate. Machine requests return `403 permission_denied`; account
hostname requests return `403 forbidden`. You can still inspect public setup
metadata. A paid organisation needs a test venue and explicit remote provisioning;
the plan alone supplies neither a tunnel nor a certificate.

For a disposable organisation, set its plan with the
[organisation plan command](local-deployment.md#inspect-the-test-organisation-plan).
Run the permission and race checks with two test-file workers:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node \
  --test --test-concurrency=2 --test-timeout=30000 test/plan-permissions.test.ts
```

A downgrade clears paid setup and advances the installation revision. The next
signed gateway export excludes both its active route and any staged destination;
other paid venues stay routed. The reconciler uses the same eligible installation
set, disables unstarted certificate work and rechecks current permission before
publishing or completing a delayed job. A signing or DNS reply that arrives after
the downgrade cannot restore access. Publication holds organisation policy before
installation, cell and job locks, so an admitted file replacement finishes before
a competing downgrade commits. Gateway withdrawal is a later observation, separate
from the plan command's successful database update.

A single-cell export locks policies for its active placements and incoming staged
or ready moves, so an unrelated organisation's plan update can proceed independently. An organisation that arrives after those locks were chosen
waits for the next export. The reconciler's all-cell selection still locks the
global policy set. It reads active and incoming routes once each across all cells
and groups them by destination, so adding cells does not add route-read queries.
Empty cells still receive a route job to publish withdrawals. This bounds those
two reads, not the total work: certificate requests, job writes, policy scans and
current-work rechecks still need deployment-scale measurement.

If exports stop, the last signed gateway authority still expires within its
existing ten-minute maximum. Restarting a gateway does not extend that signed
expiry. This is a remaining authority window, not an immediate disconnection
promise. The later test-deployment integration proof must measure actual withdrawal.

After upgrading, run the existing `provision` operator command explicitly with
the original installation, cell, peer key and port. It restores the cleared setup
and advances the revision once; an unchanged repeated provision remains a no-op.
Old staged moves stay excluded by their old revision; cancel them before staging
a replacement. Retained placements, names and certificates are not permission to
resume service. Outside-home remote access still needs a separately approved
domain, certificates and deployment.


The 2026-10-18 disposable Mac gateway proof used two actual TLS upstreams and
WireGuard peers. After one plan changed to free, its route and peer disappeared
in 4,053 ms while its paid neighbour continued returning its own venue response.
A separate 2,500 ms signed lease expired on the wall clock; refusal was observed
689 ms after its expiry, and restarting with that expired cache restored no route
or peer. The shorter lease tests the existing expiry mechanism; it is not a
measurement of a ten-minute wait. All owned containers, network, image tag and
fixture directories were removed. This proves the local synthetic gateway
boundary, not LAN deployment or a connection to the quarantined Waitron venue.
