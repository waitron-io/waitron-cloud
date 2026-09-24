# Local remote access

Programme task 4. The owner authorised local integration and delegated design decisions.
This is a new subsystem; use a concise architectural spec and plan, then implement inline.

## Outcome

Two actual Waitron servers share one local cell gateway. Staff use a stable assigned
hostname with TLS ending only at their venue. Public visitors use a distinct hostname
with HTTPS ending at Cloud and a bot challenge before an encrypted onward request.
Replacing the gateway preserves addresses and reconnects both venues. Revoking one
installation removes its route while leaving the other working. LAN access uses the
same staff certificate through a local DNS override even while the gateway is absent.

## Chosen approach

Use WireGuard per-venue peers and HAProxy's maintained TCP ClientHello routing. This
avoids inventing a TLS parser or extending Waitron's single-box test relay protocol.
An application tunnel could avoid kernel privileges but would introduce a new
multiplexing/authentication protocol; a managed cloud tunnel would make local tests
and provider portability depend on an external account. Linux peers are the initial
runtime; the test network lives entirely in Docker, without changing the host network.

Cloud owns the commercial gateway/provisioning code. Waitron owns certificate keys,
CSR creation, installing its certificate and reporting probe results. The local runner
uses a Linux peer bridge to the real Waitron server; an appliance tunnel installer
is a later deployment task. Control leases never grant gateway or storage access.

## Placement and authority

A trusted operator provisions a bounded cell in ES/aws (local test environment).
Persist the cell and each venue's placement/assigned hostnames in PostgreSQL. Enforce
unique hostnames and tunnel addresses. Stable addresses belong to the venue, while
peer keys belong to the installation. Use separate staff/public hostnames. Provisioning
is an operator CLI, not an arbitrary customer configuration API.

Cloud exports a signed gateway manifest with a distinct gateway audience, cell ID,
monotonic revision, issue/expiry times and active routes. Gateway trusts an operator
public key, accepts only its cell and a newer revision, and keeps only validated
configuration. Poll at most every 30 seconds; remove revoked routes within 60 seconds
when management works. During management failure retain the last valid manifest only
until its 10-minute expiry, then close routed connections and fail closed. A restart
must not extend expiry or accept an older manifest. Every export gets a durable increasing
cell sequence, including unchanged-route renewals, so replay cannot extend expiry. Local LAN HTTPS is independent.

Staff connections have global/per-source/per-venue connection ceilings and a five-second
ClientHello deadline. Public connections route to a separate HAProxy HTTPS frontend, which passes requests
to a loopback-only application gate. A PROXY-protocol hop preserves the client address;
HAProxy overwrites the client-address and SNI headers before the trusted loopback hop. Unknown SNI
is refused. Do not publish ECH configuration; encrypted ClientHello with an unrecognised
outer name is refused, because passthrough cannot inspect its inner hostname. Venue peers can address only the gateway /32; gateway forwarding between
peers is denied even if a malicious peer changes its routes. No general venue LAN
routes or SSH capability is granted.

## Names and certificates

Assign staff/public names under a configured operator-owned suffix; never infer ownership
of a customer-supplied hostname. Return CNAME instructions for a custom name and its
_acme-challenge delegation; activate only after DNS resolution proves the exact
expected target. Reject duplicate, wildcard, IP, mixed-case/noncanonical and unrelated
CSR names. The venue generates a private key and CSR; only the CSR goes to Cloud.
Cloud requests a DNS-01 certificate for exactly the assigned/verified staff name and
returns only the chain. Public certificate keys remain Cloud-owned.

Use an ACME client with Let's Encrypt-compatible endpoints. Local tests use Pebble with
real DNS-01 validation and a test root passed explicitly to the client. Never disable
certificate verification or enable always-valid challenges. Test certificate replacement
with a new serial and fresh connections. Run the operator certificate command daily; it renews with 30 days left (or in the
last third of a shorter certificate lifetime); atomically replace certificate files, retaining the last
valid certificate on failure. Load new TLS context without restarting trading.

The local test DNS resolver answers the staff name with the venue-side address and
continues after public DNS/gateway shutdown and a fresh client start. This demonstrates
the configured resolver path, not compatibility with every router or secure-DNS override.
The operator guide explains hostname overrides, resolver forwarding and rollback.

## Public boundary and bot controls

The first allowed public route is a deliberately small /public/availability response
from the real venue server. Menus/bookings are not built by this task. Default deny
all other paths and methods, including /manage, /management-api, /setup, sync, media
and internal /health. Match Host to the selected public SNI; never forward cookies,
authorization, forwarded headers, upgrades or arbitrary request headers to Waitron.
Use a fresh bounded HTTPS request with staff hostname validation on the private tunnel.

Before forwarding even the public route, require a short-lived signed challenge token
bound to hostname and client address. A browser solves a bounded proof-of-work in a
worker and submits the answer; verify before issuing a Secure host-only cookie. Add
per-IP rates, concurrent upstream limits, request/body/time limits and bounded memory.
This blocks unsolicited floods from reaching the venue, not all determined automation.
Expose counts for challenges, rejections, forwarded requests and failures without
recording request contents. Return a plain temporary-unavailability page on tunnel failure.

## Verification

Use actual Docker WireGuard/HAProxy, PostgreSQL, Pebble DNS validation, two actual
Waitron SQLite servers and real TLS clients. Assert certificate hostname validation
and staff keys absent from gateway files. Test unknown SNI, public management attempts,
Host mismatch, forged/expired bot tokens and cross-venue sessions, with upstream counts
unchanged on rejected public traffic. Broaden one peer's routes and prove peer-to-peer
traffic still fails. Run a planned gateway replacement and record recovery below 60s;
this is a local test target, not a production availability promise. Test manifest expiry
and revocation closing established streams. Show genuine probe observations in Cloud.

No AWS, live domain, customer data, Kubernetes, SSH support grant or fiscal activation.

## Implementation sources

The HAProxy 3.2 manual defines `req.ssl_sni` for unencrypted ClientHello inspection
and explains its ECH limitation: https://docs.haproxy.org/3.2/configuration.html .
WireGuard peer setup follows https://www.wireguard.com/quickstart/ .
ACME DNS validation uses the client API at https://github.com/publishlab/node-acme-client
and Pebble's challenge server at https://github.com/letsencrypt/pebble/tree/main/cmd/pebble-challtestsrv .
