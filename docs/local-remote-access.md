# Try remote access with two local venues

You can now run two real Waitron servers through one shared local gateway. Staff
HTTPS ends at their venue; public HTTPS ends at the gateway and passes a browser
challenge before reaching Waitron over a second verified HTTPS connection. This
milestone exposes only `/public/availability`. It does not publish menus or bookings.

## Run the proof

Use Docker with Linux WireGuard support, Node 24 or later, pnpm, and a Waitron
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
validation server, a gateway, two tunnel peers and a LAN DNS resolver. It pairs two
actual Waitron SQLite servers using authenticated manager requests. Staff keys are
generated inside each Waitron state directory; Cloud receives only signing requests.
The gateway holds its own public-site keys and WireGuard key, never staff TLS keys.

The run prints `PASS` checks and a JSON receipt with gateway replacement and revocation
times. It checks real staff logins, cross-venue cookie rejection, an actual browser
Worker solving the bot challenge, zero upstream calls for rejected public traffic,
peer isolation after malicious route expansion, live certificate renewal, removal of
an established revoked connection, cache expiry across restart and corrupt-cache
startup refusal. `node scripts/test-gateway-cache-loss.mjs` separately proves refusal
when a previously initialized gateway loses its accepted cache. A fresh DNS client then reaches trusted LAN HTTPS without valid
gateway authority. Normal exit removes every owned container and temporary state.

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

The local image runs `src/gateway-cli.ts` with `NET_ADMIN` inside its isolated network
namespace. Mount `/input` read-only and `/state` writable. Input holds `manifest.json`,
`issuer.pem`, `wireguard.key`, a 32-byte `bot.key`, and `public-certs/*.pem` containing
public-site chains and keys. Set `GATEWAY_CELL_ID`, `GATEWAY_SUBNET`, and, for a test CA,
`GATEWAY_UPSTREAM_CA`. The runner is the executable example for container arguments.
Its `peer-cli.ts` is a local bridge to `host.docker.internal`, not an installer for a
customer appliance. Neither component changes the host's network interfaces.

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
Gateway replacement and certificate reload may interrupt remote connections. The local
target is recovery within sixty seconds, not a production availability promise. LAN
access remains independent. Production DNS, provider credentials, appliance installation,
customer setup UI, external monitoring and deployment hardening still need their own
implementation and validation before customers can subscribe.
