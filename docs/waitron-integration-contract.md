# Waitron and Cloud integration contract

Status: complete two-venue milestone proved locally, updated 2026-09-27. This translates the agreed
[product requirements](product-and-platform.md) into responsibilities and exchanges.
It does not declare endpoints implemented or replace Waitron's recovery rules.

The [Cloud hosting proposal](superpowers/specs/2026-10-21-cloud-hosted-venue-design.md)
adds a proposed coordination boundary for hosted primaries and Cloud standbys. Its
operations are design requirements, not implemented endpoints or activation authority.
Waitron and Cloud must agree the versioned contract before either builds that boundary.
The [public access and A951 proposal](#public-access-and-a951-proposed) below is the
single shared home for the added customer access and lasting appliance client boundary.
Its proposal status is separate from the completed local milestone.

The first milestone connects two test venues to one cell, proves remote-access
isolation, restores both backup types and replaces the gateway. Start with venue
registration; services can then use the same identities and permissions.

The owner confirmed that SQLite landed on 2026-09-23. Recheck its concrete
capture/restore interfaces before wiring backup operations to Waitron. The older
PostgreSQL source below remains a reference for historical contracts. Registration,
permissions and service configuration can proceed against the current SQLite application.

## Local implementation update, 2026-09-27

Pairing, lifecycle and the shared remote gateway now have executable local proofs.
The [managed-backup proof](local-backups.md) adds actual Waitron SQLite streams and archives,
protected key versions, scoped encrypted storage, immutable publication, verified
restore records, retention and owner-bound snapshot recovery. The catalogue exposes
snapshot capture times and signed continuous recovery times through the customer
catalogue and guided recovery screens.

The proof excludes actual source Cloud credentials/staff TLS keys and drops captured
backup destination settings on the disposable replacement. It invokes Waitron's
validation, SQLite restore/migration and module hooks without starting workers.
The same two-venue proof configures Waitron's stream supervisor, verifies each signed
pointer in Cloud, stops both originals, interrupts and retries Waitron's cold restore,
and matches the restored database head to its source. Deleting the other continuous
prefix leaves its neighbour unchanged and its verified snapshot still restores.
Owner-confirmed test-snapshot replacement now preserves the
venue and history, imports fresh installation credentials, retires old Cloud access
and updates the remote placement. The complete milestone runner composes the transfer,
real remote-access and managed-recovery phases into one strict receipt. A clean run
replaced the local gateway while both venues published encrypted snapshots before and
afterward, preserved route and venue separation, refused the old recovery authority,
used fresh recovery authority and restored a snapshot published by the replacement.
Its measured gateway, cell-movement, continuous-restore, snapshot-restore and managed-
replacement times are recorded in [the executable proof](local-backups.md#run-the-proof).

This is local evidence. Live provider storage and DNS, production deployment and secret
custody, automatic tunnel/certificate installation, management-database recovery and
trading activation remain outside this exchange. Cloud's recovery grant is not
permission to trade. The historical source map below
remains useful for ownership but does not describe the current SQLite runtime.

## What already exists

The source baseline is Waitron commit `4ce2db502173d87d14d2e1aad5dc92b19be38363`.
The entries below describe inspected source and designs. No runtime tests were run
for this document; behaviour must be verified during implementation.

| Source | Reuse boundary |
| --- | --- |
| [Archive manifest](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/backup-manifest.ts) | `BackupManifest` v1 records creation time, environment and applied schema version per module. It has no Cloud ownership, recovery-key reference or SQLite stream generation fields. Keep Cloud catalogue metadata outside this format until Waitron versions an extension. |
| [Module contributions](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/packages/module/src/module.ts) and [restore hook](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/packages/module/src/restore.ts) | Modules declare non-database state and restore hooks. Waitron owns collection, migrations and hook execution; Cloud does not recreate that logic. |
| [Storage interface](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/storage-backend.ts) | The archive interface provides put/get/list/delete; its destination type currently contains only local filesystem storage. Cloud storage and Litestream replication need their own integration work. |
| [Restore consumer](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/restore.ts) and [compatibility gate](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/restore-gate.ts) | The inspected archive consumer uses PostgreSQL. Its gate rejects environment mismatch and newer schemas for modules the target runs; absent target modules are ignored by that gate. Preserve behavioural tests while adapting to SQLite; do not infer a different policy from older prose. |
| [Backup status](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/backup-status.ts) | Freshness comes from destination object modification times. This does not establish the last recoverable transaction or prove restoration. Cloud needs separate recovery and verification evidence. |
| [Adoption](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/apps/server/src/adopt.ts) | This enrolls a standby through the primary's management credentials. It is not the new Cloud organisation-linking flow. Reuse appropriate identity checks without treating subscription as standby adoption. |
| [Waitron backlog, Cloud integration](https://github.com/clintongormley/waitron/blob/4ce2db502173d87d14d2e1aad5dc92b19be38363/docs/backlog.md#cloud-integration-and-sqlite-work) | Waitron owns local signup, first-contact trust and retirement of `@waitron/tunnel`. Use the inherited WireGuard direction as the integration baseline; the current package is not the default Cloud transport. Shared gateways and the public/staff TLS split follow the newer Cloud decisions. |

The [recovery design reconciliation](documentation-ownership.md#backup-and-recovery-design-reconciliation)
covers encryption, externally held vault keys, stream/archive identity rules and
the proposed hourly stream snapshots with 30-day retention.

## Identity and authority

Cloud owns organisation, legal-business, venue, installation and cell identifiers.
An installation is a registered machine with its own credentials; replacing one
does not create a new venue. Map these identifiers explicitly to Waitron's local
venue and node identifiers. Never derive permission from matching email addresses,
tax identifiers, hostnames or a caller-supplied venue id.

Linking requires both Cloud permission to add the venue and local administrator
approval. Bind both approvals to one expiring operation, the selected organisation,
the local venue and the installation's public identity. The normal owner completes
both in one guided action. Machine secrets stay outside the browser and logs.

Waitron owns the local approval check. Cloud verifies the Cloud permission and the
binding of the local approval to this operation. Specify and test the first-contact
trust exchange before production use: an arbitrary self-signed claim of local
administrator status is insufficient. Define the proof format, expiry, replay
protection and recovery from lost replies as part of the registration slice.

Cloud owns permission to use its services. Waitron owns permission to become the
active primary. A Cloud login, restore grant or fresh machine credential alone
must not activate trading or change fiscal identity.

## Hosted lifecycle and promotion (proposed)

The [Cloud hosting design](superpowers/specs/2026-10-21-cloud-hosted-venue-design.md#agree-one-shared-contract-before-building)
records the proposed boundary for a new Cloud-primary venue, a Cloud standby and
replacement of a failed Cloud host. This section is its shared contract home.
Cloud owns resources, service credentials, durable operation history and routing.
Waitron owns initial setup, node identity, activation, handover and return.
For predecessor replacement, the [A1018 direction agreement](#handover-between-local-and-hosted-machines-a1018)
below replaces the rejected external stop-proof model; owner approval remains pending.

Before implementation, both repositories must accept a pinned contract describing
identity binding, store and pointer versions, signatures and conditional writes,
read-only following, peer enumeration, scenario-specific handover evidence, activation outcomes and
uncertain retries. Agreement approves formats and expected behaviour; executable
joint receipts qualify the later implementation before enablement. They are
separate gates. Neither this proposal nor a backup verification result authorises
trading. The contract remains unagreed and unimplemented.

## Public access and A951 (PROPOSED)

This extends D88 and published #265 for the **Cloud step soon after go-live**, not
go-live itself. The owner requires `.local` as the default for venue devices and a
separate public interface for customer menus, bookings, online orders and table-QR
ordering. The design below is unapproved. No implementation or provider work starts
before owner design approval and bilateral acceptance of a pinned contract.

**A951 is the named Waitron dependency** for the lasting box tunnel/certificate
client. No accepted implementation or landing revision is established here. Cloud must obtain that dependency's accepted
scope and source pin before integration. This document does not change Waitron.

### Keep local, staff and public access distinct

Venue devices default to Waitron's `.local` address with its existing local CA and
client trust setup. That trust is a prerequisite to verify on supported devices,
not permission to bypass a certificate warning. Keep local access direct, without a
redirect to Cloud or a WAN dependency. Publicly trusted `.local` certificates are
not supported; a public certificate covers the registered DNS name instead.

You may select the certified Cloud **staff** hostname when it reaches an actually
active server, either on-premises through the tunnel or hosted through the private
cell path. Its TLS passes through Cloud and ends at Waitron, which holds the private
key and checks staff permissions. An optional router override can resolve that
registered name to the active LAN server with the matching certificate. It is not
the default. A Cloud-only primary has no local server for `.local` to discover;
neither name resolution nor a tunnel authorises a local competing writer.

Customers use a stable per-venue **public** registered hostname, including in table
QR links. Cloud owns live DNS, public certificate provisioning/renewal and public
HTTPS termination. For an active on-premises target, forward through scoped,
encrypted WireGuard transport with verified upstream HTTPS. A hosted target uses
the isolated private cell path with verified encrypted onward transport. Neither
path exposes the box directly to the WAN. Route movement requires confirmed active
authority and probes; a reachable restored standby is not an active target.

Reference boundaries: [RFC 6762 section 3](https://www.rfc-editor.org/rfc/rfc6762#section-3)
defines `.local` as link-local; Let's Encrypt describes [local certificate trust](https://letsencrypt.org/docs/certificates-for-localhost/)
and [DNS validation/delegation](https://letsencrypt.org/docs/challenge-types/).
These references do not prove Waitron browser trust, router setup or offline behaviour.

### Allow customer functions through a jointly pinned route manifest

The following are proposed **functional surfaces and method families**, not existing
API paths. Before implementation, Waitron and Cloud must pin a versioned joint
manifest of exact paths, permitted methods, required assets, request/response bounds
and authentication requirements against the real Waitron consumer. Required scripts,
styles, images and any session bootstrap must be enumerated; no public `/api`
wildcard, whole static tree or fallback proxy is permitted.

| Functional surface | Proposed method family | Waitron business check |
| --- | --- | --- |
| Published customer menu, venue information and required assets | GET; HEAD only for explicitly listed resources | Only content published for this venue; no internal catalogue, staff data or private media. |
| Booking/order availability and customer session bootstrap | GET for availability; POST for a specifically listed session/token exchange | Bind the session/token to this public host and venue; availability is advisory until a mutation commits. |
| Customer booking creation and own booking view/change/cancellation | POST create; GET own view; PATCH/DELETE only for listed change/cancel operations | Check customer session or scoped booking capability, ownership, capacity and permitted state transitions. No booking enumeration. |
| Customer basket, online order, table order and checkout submission/status | GET own state; POST submit; PATCH/DELETE only for listed editable basket/order operations | Check venue, session, object ownership, current prices/availability, permitted transition and any table scope. Customer input cannot choose fiscal authority or mark payment settled. |

Gateway and application both enforce method, identically normalized path, host,
tenant and applicable authentication/session binding. Reject malformed or ambiguous
encodings, encoded separators, traversal, method overrides, upgrades, unlisted
methods and routes; never allow parser differences to widen access. The gateway
checks the agreed public session/token envelope; Waitron rechecks its current
business authority and does not trust a forwarded tenant id. The exact envelope and
forwarded identity format remain a builder acceptance gate. Staff passthrough cannot
inspect encrypted methods or paths; those checks remain at the staff endpoint.

Use separate host-only public, staff and gateway-challenge cookies, with distinct
names, secure attributes and no shared parent-domain scope. Forward only the
manifest's customer credentials and trusted, overwritten routing context. Refuse
staff credentials on the public surface and scope response cookies to the public
host. A solved bot challenge is not a customer login or business permission.
Cookie-authenticated mutations require Origin/CSRF checks, which prevent another
site from acting through your browser, plus replay controls. Scoped tokens must
also reject cross-host, cross-venue, expired, revoked and inappropriate replay use.

Everything else is blocked on the public path, including staff login/dashboard,
manager/setup, sync, backups/restores, fiscal administration, printing and physical
payment-terminal ports. Customer checkout remains an intended public function;
terminal-port exclusion does not prohibit it. Payment providers, redirects and
webhooks require separately agreed authenticated scope and acceptance cases.
No provider integration or arbitrary webhook ingress is promised by this proposal.

Table QR links bind venue/table context with expiry and revocation. They confer no
staff role, bill ownership, payment authority or proof of physical presence; copied
links still need the permitted customer session/token and business checks. Exact
lifetimes and limits remain open. Cloud can inspect public submissions: minimise
forwarded/stored personal data, keep bodies, cookies and QR/session secrets out of
gateway logs, and prevent shared caches from exposing private state. Customer-data
retention and security product policy require owner approval, not defaults here.

Serialize customer mutations with staff work through the one authoritative Waitron
writer. If the box is unreachable, return temporary unavailability; Cloud accepts
no offsite booking/order queue. A lost reply leaves an uncertain outcome. Reconcile
through a venue/session-bound operation id and status result before retrying; never
blindly repeat a mutation or payment. Exact retry/status semantics are a joint gate.

### A951 configuration and certificate lifecycle

The proposed machine-authenticated exchange binds version, revision, installation,
venue, cell, active target, peer identities, allowed networks/ports, hostnames and
expiry to one configuration. Reject unsupported versions, stale revisions and foreign
bindings before applying. Persist the last accepted revision and intent across
reboot; acknowledge received, applied or failed revisions with bounded, redacted
status. A lost acknowledgement reconciles the same revision, not a new placement.
This is not a claim that today's gateway manifest is an appliance protocol.

Generate WireGuard and staff TLS keys at the endpoint that uses them; send only
public keys and CSRs. Scope each peer to its assigned `/32` and allowed service
destinations/ports, deny peer-to-peer and cross-venue forwarding, and expose no raw
device or management ports. Agree connect, reconnect, reboot, key rotation, staged
cell move and revocation with acknowledgements and expiry enforcement. A move must
retire the old route/peer and settle existing connections without resuming an old
writer. Tunnel reconnection itself grants no trading authority.

Reuse the landed [staff certificate exchange v1](#staff-certificate-exchange-version-1),
whose current Cloud handler is opt-in and test-installation-only. Waitron/A951 still
owns durable submission/polling, lease renewal, stale-result checks against local
installation/request/hostname/revision/CSR digest, atomic install and TLS reload,
including crash recovery. Do not widen v1 to production by implication. Its staff
chain is separate from Waitron's local CA/trust and the gateway's public certificate.

Failed DNS provisioning, issuance, renewal or apply retains a prior usable revision
and certificate without extending their authority. Expired/revoked authority or an
expired/mismatched certificate fails closed. Lost/corrupt established cache requires
authenticated recovery, not rollback acceptance or direct WAN bypass. Report
**active** (Waitron writer authority), **reachable** (fresh transport/application
probe), **DNS ready** (selected name resolves correctly) and **certificate ready**
(matching, valid chain actually installed/reloaded) separately, bound to revision
and observation time. No acknowledgement, DNS answer or successful issuance proves
all four; stale evidence is unknown.

### Acceptance before enablement

These are required future cases, not runtime receipts from this document.

| Case | Required joint evidence |
| --- | --- |
| Two venues and public boundary | Accepted functional operations and listed assets work only for the intended host/tenant/session; wrong SNI/Host, method, encoding, tenant, credentials, replay and CSRF attempts fail at gateway and application. Staff/setup/backup/device paths remain blocked. |
| Availability and uncertainty | Startup before active authority, WAN/box outage and lost mutation replies never acknowledge an offsite booking/order or duplicate an effect. Reconcile committed and uncommitted outcomes through real Waitron. |
| DNS, certificates and cache | Initial DNS/issuance failure, failed renewal, hostname/key change during issuance, expiry, restart and cache loss retain only usable authorised state and otherwise refuse; no warning bypass or WAN escape. Verify actual install/reload, not just issuance. |
| Appliance lifecycle and movement | Connect/reconnect/reboot/rotation, lost config acknowledgement, staged/cancelled/committed cell moves and revocation preserve the accepted revision, isolate the other venue, withdraw old peers/routes and reject the old writer. |
| Venue devices | Fresh LAN clients after WAN loss and DNS-cache expiry reach `.local` with Waitron trust and no Cloud redirect. Separately test the selected certified staff path to an actual active LAN/Cloud target; a Cloud-only target stays unavailable offline. Test any selected router override explicitly. |
| Customer privacy and QR | Copied/expired/revoked/wrong-table QR links, foreign sessions and cookie/cache/log checks cannot expose another customer's data or create staff/payment authority. Qualify any separately agreed payment flow independently. |

Owner design approval, named bilateral owners/source pins, exact Waitron route/assets
and session/retry contract, A951 implementation and qualification for appliance paths,
live DNS/certificate
and deployment evidence, and the existing recovery/fiscal gates remain open. No
pricing, retention, security product policy or implementation approval is supplied.

### A951 Cut A contract review, 2026-10-23

The owner approved Waitron's complete A951 plan and all five build cuts on
23 October, as recorded in its
[build intake](https://github.com/clintongormley/waitron/blob/9a016bb85ae0dab7d334b6fd52929f49d3cf042f/docs/developers/cloud-connection.md#a951-build-intake).
That approval permits the planned Waitron build. It does not fill the protocol
agreements below or authorise Cloud deployment, providers or customer services.
Read this dated review ahead of the older proposal's approval wording.

Lane G owns this Cloud response; Lane E owns the Waitron intake and client.
Lane D retains D88 and the Cloud gateway's deployment work. The source reviewed is
Cloud `b16f3ca630019f693d7db999aadc0167c0ef9027` and Waitron
`9a016bb85ae0dab7d334b6fd52929f49d3cf042f`. These are source pins, not a
qualified pair of running consumers. No A951 wire/helper/parser artifact is
accepted by this review. Its disposition is **amendments required**, with the
existing staff-v1 compatibility facts reaffirmed separately below.

Keep the owner's two interfaces: staff TLS ends at Waitron; customer TLS ends at
Cloud for filtering and continues through independently authenticated encrypted
transport. Keep `.local` independent. The connection enables no customer product.
Use the owner-revised A1018 controlled/emergency handover proposal for authority
coordination; the rejected external stop-proof design supplies no adapter here.
This review does not change handover or fiscal rules.

#### What each scoped agreement still needs

| Gate and consumer | Cloud response and concrete amendment |
| --- | --- |
| G1, T1 appliance codec | Return a separate, versioned appliance artifact with exact request actions and signed bytes, response trust anchors and rotation, installation/venue/endpoint/cell bindings, configuration revision, content revision and transport-grant sequence. Define equal-content grant renewal, same-revision changed-content rejection, certificate-intent invalidation, report/replay results and authenticated establishment/recovery epochs. Supply literal positive and rejection vectors and byte/duration bounds. Do not rename a gateway sequence into any of the three appliance counters. |
| G1, T3 local helper | Lane E owns the local process boundary. Return its exact authenticated framing, caller/socket ownership, fixed operations and owned-resource namespace, allowed source/destination address and service-port matrix, IPv4/IPv6 refusal or support, clock/skew/expiry rules and removal read-back. Cloud's generated peer `/32` alone does not define these rules. Unknown or unaccepted operations keep real admission closed. |
| G2, actual authority adapter | Obtain the actual A947 consumer pin and a current endpoint/writer result with freshness and withdrawal semantics from its Waitron owner. Installation control state, gateway authority, membership, a probe and `cloudPrimary()` cannot stand in for that result. Reconcile the revised A1018 model and D88 cold recovery without creating activation or fiscal authority in the network layer. |
| G3, T7/T8 staff client | Preserve the existing test-only v1 bindings below. Return explicit response-byte and request-time bounds, polling minimum/cap/jitter, retry-hint bounds, pending/reconciliation deadline, renewal margin/jitter and key-rotation policy before the adapter. The historical 5-second to 5-minute polling suggestion is not an accepted default. Cloud's issuer retry schedule is not the appliance's polling contract. |
| G4, T10 customer upstream | Return an independent issuer/purpose and gateway/box identity contract, trust distribution and bounded rotation overlap, submit/status actions and signed bytes, response bounds, renewal/revocation and closure of established connections. The present public gate verifies the staff hostname and has no independent mutual-TLS exchange. Do not add a public-upstream purpose to staff v1. |
| G5, T11 move/replacement | Return an appliance-facing operation/predecessor contract, stage/readiness/conditional-commit/cancel/status results, lost-answer recovery, old-route/peer withdrawal and connection-drain/expiry bounds. Bind fresh replacement secrets and authenticated recovery epochs to the actual Waitron authority result. Cloud's existing database placement operations are implementation evidence, not this joint appliance protocol. |
| G6, T4 shared parser | Return a versioned customer-route schema and exact canonical bytes/digest for an empty production manifest. Include shared raw-request normalization vectors, SNI/Host/authority rules, allowed forwarding headers and authenticated gateway/venue/endpoint/epoch context. Pin duplicate headers/query keys, malformed/double encodings, separators, traversal, absolute-form targets, port spellings, upgrades and method overrides. A fixture availability route is not a production customer route. |
| G6, T13 diagnostics | Return a closed field schema with per-field, message and collection bounds, redaction, readiness observations and export destinations. Keep active, reachable, DNS-ready and installed-certificate-ready independent. Obtain flow-scoped A980/D101 acceptance before real metadata processing, including staff transport metadata. No bodies, cookies, credentials, QR/session secrets or invented retention periods. |
| G7, enablement | Supply executable gateway/box pins, accepted helper/host rules, images and applicable DNS/issuer/device/origin receipts before opening the corresponding path. Source inspection and synthetic fixtures do not qualify a real installation. |

Lane G and Lane E must record the resulting artifact digests, both consumer pins
and allowed scope before the affected adapter starts. Unaccepted artifacts have
no acceptance digest; a hash of this review cannot substitute for one. Internal
foundation fixtures may continue under the approved plan with explicit injected
policy, no real admission and no customer routes. This is not another owner build
question. Resolve technical contract amendments between the named owners; escalate
only a concrete product or security choice left to the owner.

#### Existing staff-v1 compatibility facts

Use the existing [staff certificate exchange](#staff-certificate-exchange-version-1)
without changing its purpose or `revision`: that field is the **installation
configuration revision**, not appliance content or grant sequence. The exact
machine encoding is the JSON array
`["waitron-cloud-machine-v1",origin,action,installationId,operationId,issuedAt,lease,body]`.
`payload` and `signature` are canonical unpadded base64url; the Ed25519 signature
covers the encoded array bytes. `lease` and `body` are strings; the live control
lease binds origin, installation, venue, environment and machine public key.
Use the stored installation key and configured trusted HTTPS origin. A request
proof allows 60 seconds of clock difference; a control lease lasts at most one
hour. Neither is a transport grant or writer permission.

The two existing actions are `staff-certificate-submit` and
`staff-certificate-status`, at the POST paths in the staff-v1 section. Submit
retains its operation UUID and exact body bytes on a lost reply. Status uses a
fresh operation UUID to read that submission. A changed submit intent uses a new
UUID and the current predecessor request ID. Compare installation, request,
hostname, configuration revision and SHA-256 of CSR PEM bytes before installation.
There is no historical request-ID ledger or new `failed` wire state. Pending
includes work parked after eight issuer failures; operator status distinguishes it.

| Existing bound at the Cloud source pin | Value and unit |
| --- | --- |
| Outer JSON request / read deadline | 16,384 bytes / 5,000 milliseconds. |
| Encoded machine payload / signature | At most 12,000 base64url characters / exactly 86 base64url characters decoding to 64 signature bytes. |
| Signed lease string / signed body string | At most 4,096 JavaScript string code units each. These are not UTF-8 byte limits. |
| CSR | At most 4,096 string code units; valid signature, RSA at least 2,048 bits and exactly the authorised CN and DNS SAN. It must also fit the complete signed body. |
| Published certificate chain | At most 16,384 bytes. This is not a bound on the full JSON response after escaping. |
| HTTP rate rules | 60 requests per IP per 60 seconds, then 30 per authenticated installation per 60 seconds. |
| Ready-chain renewal eligibility | Outside the last `min(30 days, certificate lifetime / 3)` and matching hostname/key. This server eligibility rule does not define the client's renewal schedule. |

G3 remains open for the client limits listed above. Keep the opt-in flag and
installation issuer requirement, and refuse production installations. Treat
400/401/403/408/409/413/415/429/503 by their actual cause; oversized requests do not
become valid after lease renewal. Issuance never proves local install or TLS reload.

At the Cloud pin above, inspect
[installation-proof.ts](../packages/registration/src/installation-proof.ts),
[staff-exchange.ts](../packages/remote-access/src/staff-exchange.ts),
[staff-certificates.ts](../packages/account-http/src/staff-certificates.ts),
[request.ts](../packages/account-http/src/request.ts) and
[renewal.ts](../packages/remote-access/src/renewal.ts).
The existing [manifest](../packages/remote-access/src/manifest.ts),
[gateway renderer](../packages/remote-access/src/config.ts),
[public gate](../packages/remote-access/src/public-gate.ts) and
[placement operations](../packages/remote-access/src/placement.ts) explain the
remaining mismatches. The gateway manifest's audience is
`waitron-cloud-gateway`; its one sequence and ten-minute maximum lifetime do not
establish an appliance message or an accepted appliance expiry policy.

This review runs the existing pure manifest, CSR, renewal and public-gate tests,
plus machine-proof vectors. It does not run PostgreSQL, the A951 client/helper,
shared-parser interoperability, mutual TLS or physical-device qualification.
Docker is unavailable locally until 3 November; no deployment or provider action
is performed. Record any later executable qualification independently.

### A951 helper and routing response, 2026-10-23 (D130)

The local helper proposal now answers the process and network boundary requested
by D123. **Cloud accepts its engineering profile for T3 implementation with
isolated fixtures.** Record Lane E's matching acceptance and the focused T3 plan
amendment before that implementation. The complete routing proposal needs the
two amendments below; its empty manifest bytes are accepted separately. These
are technical contract decisions under the existing A951 build approval, with
no new owner build question. This later response supersedes D123 only for these
two submitted artifacts; its staff-v1 and other gate dispositions remain.

| Review material | Exact source and disposition |
| --- | --- |
| `waitron-a951-helper-v1`, `proposal-2026-10-23.1` | [Waitron `fc54735435bc88b5fe7ba376c074fe8010c63401`](https://github.com/clintongormley/waitron/blob/fc54735435bc88b5fe7ba376c074fe8010c63401/docs/superpowers/specs/2026-10-23-a951-local-helper-v1-proposal.md); SHA-256 `da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f`. Accepted for the local contract and fixture scope below. |
| `waitron-a951-routing-v1`, `proposal-2026-10-23.1` | [Waitron `2974b9a2fe5b8bb17fa744b84384226fcbba8a35`](https://github.com/clintongormley/waitron/blob/2974b9a2fe5b8bb17fa744b84384226fcbba8a35/docs/superpowers/specs/2026-10-23-a951-routing-v1-proposal.md); review SHA-256 `4f7c9d2e2648d9cc6e27fc858e724095501e1e9b70e1fb3591ab5dd52c80df7a`. Amendments required; this full proposal has no acceptance digest. |
| Empty production manifest, routing edition above | Accept the exact 83 ASCII bytes displayed in that proposal, with no final newline, and SHA-256 `271fefd892b2c0f10ffab42f8e4a832a163b244733285f08d5a0ea1dfab1b012`. This accepts no nonempty route schema or customer product. |

The full comparison pins are Cloud
`c0d0e800529ec6c1557fce9a4d68b9b43b7447dc` and Waitron's existing foundation
`72aed2e21705c9d02b6beda5ef248410ffc9b73a`. They identify actual source baselines,
not running helper/parser consumers. Neither contains an implementation of these
proposed artifacts. Before connecting implementations, record both resulting
consumer commits, the accepted artifact edition/digest and the allowed path in
Cloud's contract and Waitron's intake. Do not label the source comparison as an
interoperability receipt.

#### Helper checklist: accepted local choices

The following accepts every proposed helper topology and numerical choice as a
requirement to implement and test, not as measured host behaviour. All literal
identities, times, addresses, JSON responses and positive/adverse vectors in the
pinned proposal remain synthetic fixture values. They allocate no real host
identity, address, port, resource or authority.

| Checklist item | Cloud answer |
| --- | --- |
| Independent verifier, supervisor and caller trust | Yes. Keep application UID 991, verifier 992, separate staff/public workers 993/994 and the root helper with only `CAP_NET_ADMIN`; groups 9510/9512, socket and directory modes, fixed mounts and private state locations remain exactly as proposed. Accept the host network namespace, separate PID/mount namespaces, read-only image, private temporary filesystem and no user-namespace remapping. Authenticate service membership and process lifetime as well as peer credentials. The supervisor owns the socket and worker custody; the application cannot activate. The helper is trusted host-network code, not a sandbox against a malicious privileged helper. |
| Framing, operations and local records | Yes. Accept one `U32BE` length-prefixed UTF-8 request/response, mandatory request EOF, no ancillary input or second frame, exact closed schemas and the five fixed operations. Accept `H` as 32 lowercase hex characters, `D` as 64, `I` as 1–64 restricted ASCII characters, positive safe integers through `9007199254740991`, and the proposed timestamp rules. Accept all listed response enums/codes and literal vectors. No arbitrary command, path, PID, interface, route table or key input is added. |
| Byte, count and request-time bounds | Yes: request 1–16,384 bytes; response 1–8,192; 1,000 ms complete-request deadline; 2,000 ms effect/read-back; 500 ms response write. Accept two ordinary slots plus one removal slot, one serialized ordinary effect turn, ten ordinary requests/second with burst ten, depth six, 64 total members, arrays of 16 and strings of 1,024 bytes subject to narrower field limits. Removal uses the independent safety path. |
| State, generation and replay bounds | Yes: one candidate/peer/interface; 16 recorded network objects; eight cached complete replay results; 256 KiB journal and 64 KiB safety record. Accept the persisted random 128-bit ownership nonce, explicit first generation 1 and exactly-one generation advances naming verified predecessor removal. Keep each caller's durable high-water mark independently of cache eviction. Equal replay cannot renew time; unresolved effects block new ordinary mutations. An exhausted safe-integer counter cannot wrap or manufacture a new generation. |
| Owned namespace and network matrix | Yes to the proposed reserved interface, two nftables tables, routing table 51851, rule priority 31851 and route protocol 242. A reservation is not proof the resource is free or owned. Accept the exact IPv4 matrix: fixed outer UDP 51821 to gateway 51820; gateway TCP source ports 1024–65535 to staff 9443, independent public upstream 9444 or isolated probe 9445; only exact tracked reverse responses. No default/LAN/cross-venue/box-initiated route, NAT or global forwarding change is authorised. Accept MTU 1280, IPv6/mapped-family refusal, fragment/ICMP/unlisted-protocol refusal, tunnel-only listeners and both-family physical-port guards at the proposed hook priority -150. Foreign binds/addresses/rules must cause refusal without disturbing them. G7 must prove containment and path usability. |
| Clocks, scope floors and withdrawal | Yes to 600,000 ms maximum transport lifetime, 30,000 ms trusted wall-clock uncertainty subtracted from expiry, boot elapsed time including suspension, 5,000 ms authority/path observations and polling at most 1,000 ms apart. Accept independent 100 ms checks, supervisor plan observation within 100 ms and a 500 ms exact-plan acknowledgement bound. Kernel permission ends at least 1,000 ms before the effective deadline. Accept the 1,000 ms closure bound from acceptance of a complete authenticated withdrawal, and closure on a backward wall-clock movement exceeding 1,000 ms. Replays never extend deadlines. Keep the three appliance counters, local generations, per-caller sequences and each scope's stop/withdrawal floors distinct. |
| Proof mapping and recovery | Yes to immutable local references and independent verifier checking; no to treating their spelling or fixture digests as external proof. G1 must still define authenticated configuration, grant and establishment/recovery mappings; G2 must supply current A947 authority. Missing or unreadable established state, stale clocks, unaccepted gates and unknown custody remain closed. Only a separately accepted reconnect/recovery decision can clear a durable stop. G5 replacement remains closed; a changed candidate first needs verified retirement. |
| Removal and fault evidence | Yes to separate `observed_blocked`, `verified_removed`, `unknown` and `may_have_applied` outcomes, per-scope network state and separate listener-custody receipts. Removing `both` also removes probe; scoped removal preserves independently authorised scopes. A process exit, closed socket, command success or network rule is not listener closure. Custody remains unknown until its implementation is accepted and qualified. G7 must exercise helper/verifier/supervisor death and stall, suspend/reboot, expired clocks, partial persistence/effects, lost replies, resource collisions and concurrent foreign changes, removal during activation, and established-connection closure within the proposed bounds. |

The helper's local records do not accept an appliance wire format, gateway peer
registry provenance, issuer, machine-key encoding or A947 authority mapping.
Map real identities through those accepted adapters; never reinterpret their
bytes to fit `I` or replace a machine public key with a caller-chosen label.
The fixture address range is not Cloud's current address allocation.

For example, the helper's literal clock vector gives transport deadline
`100000 + (1590000 - 1000000 - 30000) = 660000` boot milliseconds. The earlier
5,000 ms authority/path limit gives 105000, so kernel permission ends at 104000
after the 1,000 ms closure reserve. This is arithmetic on a fixture, not a
measured kernel expiry receipt.

#### Routing checklist: agreed profile and two required amendments

Accept the empty-manifest literal comparison, closed extension rule and all
proposed parsing/forwarding choices as the profile for the revised artifact:
HTTP/1.1 only; original decrypted request bytes; identity-preserving target
validation; duplicate-header rejection before stripping; no body, credentials,
method override, upgrade, redirect, fallback or request reuse. Staff TLS remains
outside this parser. A fixture permission cannot be selected by a production
setting, request or environment variable.

Accept the proposed bounds explicitly: 5,000 ms TLS handshake, 5,000 ms complete
headers, 11,000 ms total socket lifetime shortened by binding expiry; 2,048-byte
request line, 1,024-byte target and header line, 8,192-byte complete header block,
32 header occurrences, method length 1–16 and header-name length 1–64. Accept at
most four unique ASCII-ordered query pairs, key length 1–32, value length 1–64,
and optional User-Agent length 1–256. Accept the specified ASCII alphabets,
refusal precedence, empty 400 response, exact authority mappings, two forwarded
headers and separate side-specific contexts. Every remaining literal fixture
number/identity and positive/adverse vector is accepted as a future test oracle,
subject to these two corrections:

1. **Use the helper's suspend-aware time basis for local contexts and request
   deadlines.** Retain `verifiedAtMonoMs` and `expiresAtMonoMs` as field names,
   but define their values as boot elapsed milliseconds including suspension.
   Add `boot:H` to both closed local context schemas. At dispatch, compare it
   with that side's current boot, check current connection/listener/generation
   and all deadlines again, and refuse if the clock cannot be trusted. These
   are local clock domains; never compare gateway and box boot IDs or elapsed
   numbers across hosts. Use fixture box boot `22222222222222222222222222222222`
   and gateway boot `33333333333333333333333333333333`. Add boot-change and
   suspend-across-expiry vectors: no handler/upstream call and closure after
   expiry. Keep the existing `now=2000` refusal at expiry. No timeout restarts
   after a suspend, retry, partial read or re-observation.
2. **Make the read-boundary vectors literal and unambiguous.** Replace the three
   concatenation-table rows with explicit byte constructions. One read
   `concat(P, 0x78)` and two reads `[P, 0x78]` have the same first-P verdict,
   including when the second read arrives before dispatch. One read
   `concat(P, P)` and two reads `[P, P]` never produce a second request. In the
   isolated fixture the handler runs once and the newly constructed upstream
   request is exactly the displayed positive upstream request; production
   calls no handler and returns `ROUTE_DENIED`. Discard suffixes without
   retaining an unbounded input chunk; do not forward their bytes.

Return a revised full routing artifact and its new digest with those schemas
and vectors before shared-parser implementation. The accepted empty manifest
bytes/digest need no change. Lane E records the response and revised artifact in
its intake; Lane G checks the returned corrections. G6/T13 diagnostic fields,
exports and flow-scoped A980/D101 acceptance remain separate requirements.

#### Current consumers and permitted next work

At the Cloud comparison pin, [the gateway manifest](../packages/remote-access/src/manifest.ts)
has one sequence, a `waitron-cloud-gateway` audience and one route port; its
addresses are restricted to `10.77.*`. [The renderer](../packages/remote-access/src/config.ts)
passes staff TLS through and forwards public HTTP through a loopback gate.
[That gate](../packages/remote-access/src/public-gate.ts) handles normalised Node
HTTP objects, issues a challenge cookie, admits `/public/availability` and uses
the staff hostname for upstream TLS. It supplies no independent mutual-TLS
customer context. These consumers are not implementations of either new profile.
Do not feed the new empty manifest into the old gateway verifier, map its one
sequence into an appliance counter or open port 9444 through the old staff route.

Eight existing manifest, renewal and public-gate cases pass with
`node --test packages/remote-access/test/manifest.test.ts
packages/remote-access/test/renewal.test.ts
packages/remote-access/test/public-gate.test.ts`. They verify existing consumers;
no proposed helper, kernel rules, raw parser or mutual-TLS interoperability was
run. Literal source hashes, manifest bytes and fixture arithmetic were checked
separately. Local Docker remains unavailable until 3 November.

The allowed next work is Lane E's recorded helper acceptance, focused T3 plan
amendment and isolated helper implementation, plus the two routing corrections.
G1 appliance proofs, G2/A947 authority, G3 client policy, G4 independent upstream,
G5 moves, G6 diagnostics/privacy and G7 executable/host/device receipts remain
required for their affected paths. Keep real admission closed, production routes
empty and `.local` independent. Nothing here enables publication, customer
authentication, payments, writer activation, fiscal or recovery authority, a
Cloud deployment, or a provider/host operation.

### A951 appliance response, 2026-10-23 (D132)

You need an agreed appliance protocol before a signed configuration can drive the
helper. **Amendments required:** the proposal supplies the requested separation
of content, transport and recovery, but its approval and trust-provisioning
mappings are still explicitly unresolved. The choices agreed below are the
profile for a revised artifact, not acceptance of this complete edition or
permission to connect real consumers. No new owner build question is needed.

Reviewed artifact: `waitron-a951-appliance-v1`, `proposal-2026-10-23.1`, at
[Waitron `c962f4e1c31cc6b325e41bc57ac3dd47306e073b`](https://github.com/clintongormley/waitron/blob/c962f4e1c31cc6b325e41bc57ac3dd47306e073b/docs/superpowers/specs/2026-10-23-a951-appliance-v1-proposal.md).
Its normative review-content SHA-256 is
`fede39bb64077167f145c942cc63599526ab48fae0274e4cc0b8a4e6efcca728`, using
its exact BEGIN/END boundary. Its complete publication SHA-256 is
`f97dbc1864e37911ecb9d16dd87b436d729fd43bbef220633c3b09cae7c93fb0`.
Neither is an acceptance digest. Accepted appliance digest: **NONE**; accepted
Waitron executable consumer: **NONE**; accepted Cloud executable consumer:
**NONE**; qualified runtime pair: **NONE**.

Full source comparison pins are Cloud
`1dc34b2e460ffcbf110fd11c9768d68a8704c0e9` and Waitron foundation
`72aed2e21705c9d02b6beda5ef248410ffc9b73a`. These identify existing code,
not implementations of the proposed actions. The Cloud machine verifier's
closed action list does not include any `appliance-*` action. Its 12,000-character
payload cap, 4,096-code-unit lease/body caps, machine signature and control lease
remain compatibility constraints; the proposal adds stricter appliance byte
checks without enlarging those existing limits. The gateway manifest still has
its own audience, sequence and address model. Do not feed appliance content into
that verifier or reinterpret an installation revision as a content/grant counter.

#### Appliance checklist: Cloud's item-by-item answer

| Proposal checklist item | Disposition and next action |
| --- | --- |
| Exact artifact, bounds, vectors and consumer pins | Return a revised edition after the amendments below. Agree the closed canonical encoding, all seven named POST actions, request/response/grant/trust domains and purpose-separated Ed25519 keys as the proposed profile. Agree its three independent installation/content/grant counters, separate request/report/trust/epoch floors, same-content renewal and certificate-specific projection. Preserve staff-v1 bytes, test-only scope and limits. No complete artifact or executable pair is accepted yet. |
| Before T1 codec code | Agree the fixed single-endpoint/cell/gateway/placement topology, exact content and binding types, UUID-to-32-hex node conversion when authenticated, SPKI-derived machine identity, local-only private keys and refused moves/replacements. Resolve the actual registration-to-local-node record, Permit approval channel, peer-registry provenance and issuer custody in the mapping amendment below before affected adapters. A matching spelling or machine proof alone is insufficient. |
| Before T2 state code | Agree HIGH WATER recovery as a closed-state operation that preserves every authenticated surviving maximum and complete trust-key history. Agree permanent retired/revoked-key records, refusal when complete evidence is lost, no missing-file bootstrap, and separate lasting stops and temporary closure. Return the exact helper/safety amendment below; no recovery result or higher counter clears a local stop. Preserve archive exclusions and independent ordinary local CA recovery. |
| Before T5 reconciliation code | Agree the eight-result request/report caches with independent permanent floors, one durable latest-fetch slot, exact predecessor supersession, signed status results, unknown rather than absent after eviction, and save-before-effect/report order. Use short control/apply locks; no network/helper wait inside them. Add the stated failing/passing/guard-removal cases, including stale replies, stop/reconnect races, recovery-history loss and equal-content CSR preservation. The expanded fixture corpus below must make these obligations executable. |
| Separate helper and routing agreements | Correct the proposal's blanket statement that helper acceptance remains open. D130 accepted the exact helper engineering profile for isolated T3 implementation after E's matching acceptance and plan amendment. It did not accept the new appliance-to-helper mappings here. D130 also accepted the 83-byte empty manifest; full routing still needs its two returned amendments. Neither acceptance changes silently through this appliance document. |
| G2 through G7 and processing gates | Keep the actual A947 current-authority mapping and withdrawal rules, G3 staff client policy, G4 independent public-upstream issuer/mTLS/exchange, G5 movement/replacement, G6 parser/diagnostic/privacy and G7 executable/host/device/origin evidence open for their affected paths. Keep A980/D101 processing/access/destination/retention agreements open, including staff metadata. A lifecycle report is no permission to export it. |
| Allowed present scope | Documentation revisions and already authorised isolated foundation fixtures with explicit injected policy only. Keep real admission closed, production customer routes empty and `.local` independent. D130's separately accepted isolated helper work retains its own scope. No customer adapter, deployment, provider/host operation, publication/pause control, move, replacement or fiscal change is authorised here. Preserve historical spec/plan bodies and record focused amendments through E's driver. |

Agree every numerical bound in the proposal's section 6 as a requirement for the
revised fixture profile, with no measured runtime claim: 16,384-byte outer
request; 12,000-character payload; 4,096-code-unit lease/body and 4,096-byte body;
32,768-byte response, 16,384-byte decoded payload, 4,096-byte content/trust and
2,048-byte grant; depth 12, 256 members, arrays 16 with the stated exceptions,
1,024-byte ordinary strings; eight request results, eight report results, one
pending report, 256 KiB journal and 64 KiB safety. Agree the 5,000/10,000/5,000 ms
connect/complete-response/request-read deadlines, 60/IP and 30/installation per
minute limits, local ten/minute burst two and one in flight. These are bounds,
not a promise that every maximally populated nested object fits; refuse the
complete escaped envelope when any enclosing cap is exceeded.

Agree 60,000 ms healthy refresh plus 0–10,000 ms jitter; retry base
`min(60000,5000*2^min(attempt,4))`, 0–1,000 ms jitter, integer Retry-After 5–60
seconds, maximum total delay 61,000 ms and attempt saturation 16. Agree the
600,000 ms grant/overlap bounds, 30,000 ms wall uncertainty, 1,000 ms backward
clock/closure/reserve bounds, 5,000 ms observations, 1,000 ms polling,
100 ms independent checks and 1,000/2,000/500 ms helper deadlines. Agree section
3's 86,400,000 ms trust lifetime, 2,592,000,000 ms key validity, eight bundle
entries, two active keys per purpose and 256 lifetime key-history entries;
agree section 8's 300,000 ms one-use Permit lifetime. Exhaustion refuses rather
than evicts safety history. Trusted-time and host performance remain G7 inputs.

#### Required revisions before appliance acceptance

1. **Name the real approval and provisioning consumers.** Add a mapping table
   for each establish/recover/reconnect approval: the current authenticated local
   actor check, Cloud venue/installation permission check, trusted transport of
   the decision, one-use decision storage, exact nonce/expiry binding and
   revocation/race check at consumption. Cite both full source pins and the
   relevant function/path, or mark a missing consumer as a named implementation
   dependency. Registration or a caller-supplied `localApprovalRef` grants no
   reconnect/recovery permission. Separately name who provisions and updates the
   origin/root policy and fixed peer registry, how the authenticated registration
   binds local venue/node/endpoint and how each response/grant/recovery private
   key is kept separate from the root, machine, lease and certificate keys.
   Return exact local records and positive/wrong-actor/wrong-binding vectors.
   Do not invent a new UI or reuse a current endpoint without that agreement.
2. **Amend helper custody and safety explicitly.** Publish a separately versioned
   mapping amendment linked to D130's accepted helper digest. Specify the
   verifier's production of closure-kind/cause records and complete trust
   history, their root-owned storage and integrity checks, the helper's checks
   before clearing a temporary closure, and how a latched stop consumes the
   exact reconnect decision. Define the all-store save/crash reconciliation
   order and demonstrate that the maximum permitted history plus every other
   safety field fits each 64 KiB safety cap; otherwise refuse before growing
   state and return an explicit amended bound for agreement. An intact reboot
   may revalidate only with complete consistent state, fresh boot-bound
   grant/time/G2/custody evidence and no latched stop. Damaged state takes the
   separate recovery path; no counter increase substitutes for either proof.
3. **Return a complete byte corpus.** Keep the printed B0/C0/Q0 and rejection
   oracles, but add fully expanded machine, response, nested grant, root Trust,
   Permit/result, Report and status fixtures with explicit test-only keys,
   canonical bytes, hashes and signatures. Label synthetic-verifier fixtures
   separately. Include equal-content renewal without CSR replacement, a signed
   same-revision conflict, lost/expired fetch supersession, report eviction,
   history union/reintroduction refusal, total-evidence loss and stop racing
   reconnect. Both codecs must consume the same corpus at recorded executable
   commits before a shared adapter is qualified. Templates with substituted
   symbols and M0's deliberately invalid empty lease do not prove that exchange.
4. **Carry the current agreement and owner direction forward.** Correct the
   helper/routing dispositions as above and name the exact amended plan tasks
   T1/T2/T5. Keep endpoint ID and actual current-authority target distinct. G2
   reconciliation must use the owner's latest A1018 direction: after takeover,
   M2 handles all AEAT communication, including returned M1 fiscal records and
   outcomes. This appliance response implements no filing rule; D133 owns the
   canonical handover correction after E publishes its revision. Do not take
   authority or filing permission from the earlier D122 predecessor holds.

The six printed canonical JSON literals, the duplicate-key rejection example,
both document digests and the fixture clock arithmetic can be checked without
an appliance implementation. Existing installation-proof and remote-access
checks exercise their existing consumers only. No proposed codec, signature
exchange, helper, kernel guard, approval channel or recovery protocol has been
run or qualified by this response. Lane E returns the revised artifact/digest
and focused plan/intake amendments; Lane G records its disposition and resulting
full consumer pins before the affected adapters. Lane D retains deployment/D88.

## Exchanges to implement

### Agreed connection journey

1. You open Cloud services while signed into the local Waitron administrator account.
2. Waitron creates a short-lived connection request tied to that installation.
3. You sign into Cloud, choose your organisation and confirm the venue.
4. The local server retrieves the approval through an outbound connection and completes
   registration. Cloud does not need an inbound route to the venue for this exchange.
5. Waitron shows remote-access and backup setup separately. Registration alone does
   not imply either service is ready.

Both approvals must refer to the same request. Expired or replayed approvals are
rejected. If a reply is lost, retrying must return the existing registration rather
than create another. The Cloud proof encoding and durable exchange now follow the
[pairing contract](superpowers/specs/2026-09-23-venue-pairing-design.md). The local
administrator adapter and real two-installation journey follow next. Until that adapter
lands, the local half is asserted by the installation signature; Cloud does not independently
verify a local administrator role. Public deployment remains gated on the complete flow.

### Operation boundaries

These are logical operations, not final HTTP paths. Version the wire contract
independently of the application release and reject unsupported capabilities before
changing either side. Each mutation carries an operation id scoped to its actor and
venue. Retrying the same request returns its recorded result; reusing the id for a
different request is rejected. Resume after failure from recorded progress.

| Operation | Input and authority | Result and responsibility |
| --- | --- | --- |
| Connect installation | Local venue identity, installation public identity, environment, supported contract version and both bound approvals | Cloud records the venue link and installation once. Return an operation id and service setup status. An existing link to another organisation is a conflict, not an implicit transfer. |
| Fetch service configuration | Authenticated active installation and its last applied configuration revision | Cloud returns its own venue/cell assignment, public and staff names, WireGuard peer configuration and permitted service capabilities. Waitron applies a revision and reports success or an actionable failure. Private keys should be generated at the endpoint that uses them. |
| Obtain storage access | Authenticated installation, venue and requested upload capability | Cloud supplies bounded access to the assigned storage location. Restore read access and snapshot deletion require separate authority. Direct uploads remain independent of gateway availability. |
| Report service status | Authenticated installation, configuration revision, observation time and progress | Cloud records tunnel state, backup progress and errors with a receive time. A stale report becomes unknown/out of date, not healthy. Scope usage reports to this installation and venue. |
| Publish recovery point | Upload completion, object identity, digest/size, capture time, backup kind, source identity, format/module versions and key-version references | Cloud verifies storage completion and records an immutable catalogue entry bound to the authenticated venue. An upload report alone does not make it a verified recovery point. |
| Start replacement | Authorised account, venue, planned/failure mode, selected continuous generation or snapshot and replacement installation identity | Cloud records one active replacement operation per venue and gives the replacement limited restore access. Return the recovery timestamp and progress; do not route traffic or activate trading yet. |
| Complete replacement | Waitron restore/compatibility results and activation evidence, with the required owner confirmations | Waitron applies its recovery rules. Cloud coordinates old-credential retirement and routing, recording each step. After an uncertain reply, query operation state before retrying activation. |
| Revoke installation | Authorised account, target installation and reason | Cloud withdraws its service permissions and reports enforcement progress. Define expiry and active-session behaviour for each credential type; do not promise instantaneous revocation of all provider credentials. Local offline trading is unaffected by this operation alone. |

The registration response must distinguish a linked venue from a ready service.
Remote access, continuous backup and retained snapshots each have their own setup
and health state. A failed backup setup must not be displayed as a working backup
because the tunnel connected successfully.

## Data and secrets crossing the boundary

| Item | Contract |
| --- | --- |
| Continuous replica | Waitron writes the Litestream replica directly to its assigned object-store scope. Cloud verifies Waitron's signed pointer and freezes that generation for recovery. Its `writtenAt` is the recoverable time; Cloud does not invent a time from an upload. The local SeaweedFS proof covers exact prefix isolation and recovery, while the selected production provider still needs the same conditional-write and recovery checks. |
| Retained snapshot | Waitron creates a consistent, independently recoverable artifact using its manifest and module contributions. Cloud retains, catalogues and verifies it under the agreed daily/monthly policy. Do not expose a raw SQLite file as a complete server backup unless all required state is accounted for. |
| Configuration and module-owned state | Waitron declares the exact captured contents and missing-optional-file rules. The current archive captures `backup.env` and `modules.json` when present. Managed archive restore discards `backup.env`, because a replacement must not resume the source destination. |
| Backup decryption and application vault keys | Cloud-managed recovery delivers only the required backup-key version to the authorised target. The encrypted Waitron state currently carries `secrets.env`, which holds the application vault key. The version 3 local receipt proves that this file does not contain the backup recovery key and that the vault state survives both restore paths. Preserve customer-managed archive key custody. |
| Machine and TLS keys | Issue fresh Cloud installation credentials. `cloud-connection.json` and the separate `cloud-staff.*` certificate files stay outside both the required and optional archive state. The local CA and server keys under `tls/` remain part of Waitron's recovery state; they are not the Cloud staff TLS key. |

Waitron's current [state-secret list](https://github.com/clintongormley/waitron/blob/005f791c239aae9ac21cb5a8f52895c604889611/apps/server/src/state-secrets.ts)
includes the application vault key, trading identity and local TLS CA/leaf files. Its
[optional-state list](https://github.com/clintongormley/waitron/blob/005f791c239aae9ac21cb5a8f52895c604889611/apps/server/src/backup-optional-state.ts)
includes backup settings. The managed restore consumer removes those settings before
placement. Cloud machine authority and staff TLS files are not members of either list.

The current stream and archive consumers both recover the source local node identity.
Waitron's restore hooks then mint the fresh fiscal series and chain required by that
recovery. This supersedes the older design split that expected a stream restore to
claim a new local node. Cloud still registers the replacement as a new installation
with a new machine key and tunnel key. A Cloud installation identity is not a Waitron
node identity, and neither one authorises trading by itself.

The version 3 managed-recovery receipt tests these boundaries with real Waitron
consumers. It restores an older key-version snapshot after rotation, compares the
application vault state byte for byte, proves both recovered local node IDs, and
checks that the replacement does not inherit `backup.env`, Cloud machine authority
or staff TLS material. The replacement then registers with a fresh installation and
machine public key.

### External vault archive compatibility dependency

No archive extension is needed for the current managed path because its encrypted
Waitron state contains the application vault key. A future hosted target that keeps
that key in an external secrets service needs the named `external-vault-archive-v2`
compatibility dependency before it can capture or restore an archive safely:

1. Waitron versions the manifest and marks `secrets.env` as externally supplied.
   The manifest carries only an opaque key reference and binding metadata, never key
   bytes or provider credentials.
2. Capture refuses an archive that both embeds `secrets.env` and declares it external.
   Restore refuses an external declaration unless its resolver supplies the exact
   venue-bound key before any database or identity placement.
3. Cloud authorises delivery separately from archive decryption, rewraps the vault key
   for the target installation and records the referenced version. Source Cloud
   machine credentials and staff TLS keys remain excluded.
4. Waitron keeps version 1 archives readable through their existing bundled-secret
   path. An on-premises archive moves to an external-key target only through an
   explicit re-encryption operation; ordinary download is not that operation.

`BackupManifest` v1 has no external-secret declaration. Do not infer one from a hosting
location or omit `secrets.env` without the versioned contract above.

## Recovery, verification and failure handling

Normal recovery selects the latest recoverable continuous state. A retained snapshot
recovers to its own capture time; it is not advanced by applying the stream afterwards.
Waitron validates compatibility and required secrets before changing the target,
then performs the migrations and module hooks appropriate to that restore path.
Inspection of an older recovery point must not roll back a live ledger.

For planned replacement, stop writes and confirm the final recoverable state reaches
the replacement before activation. For failure recovery, show the recovery timestamp
and obtain the existing confirmations about the old server and any other local
candidate primary. Interrupted activation needs reconciliation, not a second promotion.
Only move the public/staff routes after the new target is ready under Waitron's rules.

A verification record names the exact artifact/generation, digest where applicable,
key versions, verifier version, time and outcome. File presence or a matching digest
is insufficient to claim a successful restore. Define an isolated restore check
through Waitron's validation code; it must not activate a primary, contact fiscal or
payment services, or send customer notifications. The full replacement test separately
proves authorised activation. Until the required check passes, report verification
as pending or failed and preserve the previously verified snapshot.

The approved [non-activating verification design](superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md)
defines a separate Waitron-owned data restore check when ordinary restore hooks
require fiscal activation authority. Waitron A850 landed in
[#1939](https://github.com/clintongormley/waitron/pull/1939) at
`5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa`. Follow the
[Cloud implementation plan](superpowers/plans/2026-10-21-cloud-backup-verification.md)
for result admission, catalogue qualification and version-bound recovery.
The current local Cloud candidate pins the compatible A1004 revision
`ec91a9e34d2daba146f4ee61850ea4136ad5cfb7`. Genuine capture, signed publication,
strict module verification and committed admission pass together with no continuous
source. Worker threads remain denied. The same local scenario now uses the actual
pinned compiled v2 client for owner approval, target delivery and independent
archive checks before staging. Ordinary restore refuses absent fiscal authority;
it reports no restored state or replacement and leaves no first-start marker.
The same scenario returns the independently delivered archive to the existing
authorised disposable Waitron fixture, which completes ordinary recovery with
separate fiscal authority. The complete version 2 receipt retains both that
success and the primary client's unchanged refusal. All eleven same-run verifier
controls and confirmed cleanup are required before certification. This local proof
does not qualify a published image or permit Cloud activation. Keep the
affected snapshots unavailable until the implementation and evidence gates pass;
fiscal activation authority remains unchanged.

Automatic expiry keeps the last verified snapshot while the backup subscription is
active. Cleanup must recheck protection when deleting and tolerate concurrent new
snapshots or verification failures. Key deletion must respect the same retained
dependencies. Explicit deletion and cancellation policies remain open.

## First implementation slice and acceptance checks

Start with registration state and the approval exchange using two isolated test
installations. Define the proof format and first-contact trust in that slice before
adding public endpoints. Build durable operations, scoped identity checks and
configuration revisions before provisioning real customer services.
The [registration implementation plan](registration-implementation-plan.md) orders
that work and identifies which identity components can be reused.

Use failing behavioural tests first. The initial slice must prove:

- Missing, expired, replayed or mismatched approval cannot link an installation.
- Retrying after a lost reply returns the same link; concurrent requests cannot
  create duplicate links or move a venue between organisations.
- One installation cannot fetch another venue's configuration or credentials.
- Revocation prevents new service grants; replacement credentials do not activate
  Waitron or silently revive the old installation.

Then implement the gateway and backup exchanges against the agreed Spain/AWS target.
Prove both restore paths, missing continuous data, key rotation with an older snapshot,
failed verification, interrupted cleanup, gateway loss and a returning old server.
The integration with Waitron's SQLite capture/restore interfaces and source-side
networking work belong in Waitron;
do not replace them with a Cloud-only implementation of the engine.

## Staff certificate exchange, version 1

You can send a staff CSR to Cloud without sharing the appliance's TLS private key.
The account server exposes this local integration only when
`CLOUD_STAFF_CERTIFICATES=1`; it also requires an installation issuer and refuses
production-environment installations. Enable the database staff worker with it.
Both endpoints use the existing `waitron-cloud-machine-v1` signed envelope and a
current control lease. POST to `/api/installations/staff-certificate-submit` or
`/api/installations/staff-certificate-status`; the signed action is the final path
segment. Browser Origin headers are refused. Use HTTPS outside the loopback proof.
The existing 60-second proof window, one-hour lease, bounded body and per-IP and
per-installation limits apply. No provider credential or filesystem path is accepted.

For submit, use a durable UUID as the envelope's operation ID and sign this exact
JSON body (the envelope carries its JSON encoding as a string):

```json
{
  "version": 1,
  "hostname": "staff-v-00000000-0000-4000-8000-000000000001.example.test",
  "revision": 2,
  "csr": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----\n",
  "previousRequestId": null
}
```

Take hostname and revision from the current installation configuration. Generate the
CSR with Waitron's `cloud-certificate.ts csr STATE_DIR HOSTNAME FILE` command. Its
signature, RSA key size and single exact hostname must pass the existing Cloud CSR
checks. Keep the full submit body and operation ID until you know the result. After
a lost reply, sign that same body and ID with a fresh proof timestamp and live lease.
This does not create another request or restart issuance. The reply reflects the
current state, so a retry may already contain the finished chain.

Cloud keeps one request row per installation. For a later request, set
`previousRequestId` to the ID you are replacing and choose a new operation ID.
Only one concurrent replacement wins. Reusing the current ID with different input, colliding with another installation's
current ID, sending an old predecessor, or reading a superseded ID returns HTTP 409
`conflict`. Always generate a fresh UUID for new work. Cloud keeps no historical
ID ledger: deliberately reusing a superseded ID with the current predecessor is
a new request, and the retained chain must still match its current CSR key. A retry
of a superseded submission cannot restore it. Keep the old installed chain while a
new request is pending; Cloud also retains its previous chain internally until a
validated replacement commits, but does not return it for the new request.

For status, sign `{"version":1,"requestId":"<submission UUID>"}` with a fresh
operation ID. Both actions return this shape, with `certificate` present only when
state is `ready`:

```json
{
  "version": 1,
  "installationId": "00000000-0000-4000-8000-000000000002",
  "requestId": "00000000-0000-4000-8000-000000000003",
  "hostname": "staff-v-00000000-0000-4000-8000-000000000001.example.test",
  "revision": 2,
  "csrDigest": "<SHA-256 hex of the submitted PEM bytes>",
  "state": "ready",
  "certificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
}
```

Every read checks the stored installation key, lease binding, revocation, placement,
hostname and configuration revision again. Another installation cannot read this
request even if it knows its ID. Invalid action-body fields are HTTP 400. Malformed or oversized signed envelopes,
bodies beyond the existing 4096-character signed-body limit, and invalid proofs or
leases are 401. If the envelope is too large, reduce it; renewing a lease cannot fix
its size. Revoked, production-environment or unconfigured authority is 403; stale configuration is 409. Pending
includes work waiting, retrying or parked after the reconciler's eight failures.
Use operator reconciler status to distinguish these states; do not poll without a
backoff. A fresh predecessor-bound request can retry a parked target.

Before installing, the appliance must compare installation ID, request ID, hostname,
revision and CSR digest with its still-current local intent, then use the existing
`cloud-certificate.ts install` command. That command checks hostname, validity and
private-key matching and atomically replaces its certificate file. It does not
establish trust in an arbitrary supplied issuer; obtain the chain through the
trusted Cloud HTTPS origin. Cloud uses the configured ACME issuer and rechecks
hostname, key and validity before publication. Issuance does not mean the appliance
has installed or reloaded the chain.

The Cloud exchange and optional database staff reconciler mode are implemented.
The Waitron dependency is an adapter that persists pending request IDs, signs these
two actions, renews its lease, polls with backoff, discards replies after local
configuration/revocation/key changes, invokes the install command and reloads TLS.
Its process scheduling and crash recovery are not supplied by this Cloud change.
The local proof calls the existing Waitron commands explicitly.

## Fiscal allocation and reconciliation endpoint

Cloud now implements the [fiscal registry HTTP contract](fiscal-allocation-registry.md#call-the-account-service-and-recover-a-lost-reply).
Your full Cloud session can reserve, consume, abandon, inspect and import signed
paper facts through the six account POST routes. Missing production custody,
entitlement, independent continuity or signing capabilities still refuse.

An installation can report signed Cloud or paper evidence through
`/api/installations/fiscal-allocations/report`. Cloud verifies its current key and
active registration lease under revocation locks. The result records matching,
conflicting or previously unimported evidence; it never activates the installation
or releases an occupied identity. An exact retry recovers the retained result
when the outside append survived a failed PostgreSQL commit.

The [joint HTTP/client test](fiscal-allocation-registry.md#qualify-the-pinned-waitron-client)
now exercises the real Cloud PostgreSQL service with the separately pinned Waitron
adapter. Its consumed packet passes local manual preparation and its committed
result returns as a signed machine report. Waitron owns and lands its adapter
independently. Preserve the complete consumed
receipt and local authenticated recovery checks. Cloud operator attribution is
not local operator authentication, and no registry call belongs on the sale path.

## Translate all, version 1

Owner-approved design; Cloud store, worker and four HTTP routes are implemented, with
translation off by default. Submit has its separate 2,113,536-byte, 60-second reader
and admission limit. Current owner consent is enforced at submit and worker lease;
the account and portal consent controls and bounded retention sweeps are implemented.
The optional Compose worker and account switch are implemented on 2026-10-17.
Quality trials, pinned joint Waitron paging proof and launch decisions remain open.
Keep the operator flag off until those gates pass. The bounded-collect
prerequisite is documented on 2026-10-16 in the
[paging amendment](superpowers/plans/2026-10-16-translation-collect-pages.md).
The bound preserves the existing input limits;
design approval does not claim runtime qualification or release readiness. The product design is in
[the Cloud spec](superpowers/specs/2026-10-14-translate-all-design.md) and in Waitron's
`docs/superpowers/specs/2026-10-14-translate-all-design.md`. This section is the wire contract
both sides build against; both specs and both plans point here and do not restate it differently.
The paging amendment supersedes conflicting collect examples in the original Cloud plan.

Four machine actions use the existing `waitron-cloud-machine-v1` envelope and a current control
lease: POST to `/api/installations/translation-submit`, `translation-status`,
`translation-collect` and `translation-release`. The signed action is the final path segment.
The existing 60-second proof window, one-hour lease, per-installation and per-IP limits, and the
refusal of browser Origin headers apply. While Cloud's operator has the service switched off, all
four answer 503 `temporarily_unavailable`.

### Request limits

| Action | Whole HTTP request at most | Received within |
|---|---|---|
| submit | 2,113,536 bytes (twice the 1 MiB job, plus 16 KiB) | 60 s |
| status, collect, release | 16,384 bytes | 5 s |

Every other account body reader refuses a body over 16,384 bytes or one not received within
5 seconds. When translation is enabled, the server permits 60 seconds to receive a request;
the readers preserve the shorter deadline for other actions. Headers retain their five-second
deadline. Submit gets its own limits because `body` travels as a JSON string inside the envelope: the job is JSON text, and
escaping JSON text adds at most one backslash per character, so its escaped form is at most twice
its size. A request over its size limit is refused with 413 (`translation_job_too_large` for
submit, `invalid_input` for the others); one not received in time with 408.

The owner approved submit admission of **4 requests in flight, at most 1 per client address**,
outside the 8 places shared by other account requests. Refuse excess submits before reading their
bodies with 503 `temporarily_unavailable` and `Retry-After: 1`; existing rate limits still apply.

Every successful collect response is at most **16,777,216 UTF-8 bytes (16 MiB) for the complete JSON
body**, including every field, the UUID and `nextCursor`. Serialize compact JSON with no formatting
whitespace. Count bytes after decoding any HTTP content encoding; compression never increases the
allowance. Never drop fields, names or corrections, or truncate text, to make a page fit.

### Seeing the service

The default `configuration` reply returns exactly three services for existing callers. A `configuration` request whose signed body is exactly `{"servicesVersion":2}` receives four
services: the three it receives today and this one:

```json
{ "service": "content_translation", "state": "ready", "configuration": {}, "health": "unknown", "failure": null, "observedAt": null }
```

Services are matched by name; their order in the list is not significant. A `configuration` body
of `{}` keeps receiving exactly three; any other `configuration` body is an invalid proof (401).
`renew` and `report` replies are unchanged and always carry three, so the box keeps the
`content_translation` entry from its last version-2 `configuration` reply.

`state: "ready"` means the service is available to this installation; any other state means it is
not. Every connected installation has it `ready` until the allowance replaces free use. A ready
`content_translation` never makes a venue monitored, alerted or shown with services: every Cloud
reader that asks whether an installation has a service switched on, or lists its services to the
portal, counts only the three original services.

### Submit: a signed fingerprint of a larger body

A job body is larger than the 4,096-character signed body allows, so submit sends it beside the
envelope:

```json
{ "payload": "...", "signature": "...", "body": "<the job as a JSON string>" }
```

The outer request is read by the reader every account route uses: a request not sent as
`application/json` is refused with 415 `invalid_input`, and one whose body is not a JSON object
with 400 `invalid_input`. A JSON object must hold exactly those three keys, each a string; any other
object is an invalid envelope (401). The same rules hold for status, collect and release, whose
outer request holds `payload` and `signature` only. The signed body is the fingerprint, not the job, with exactly these keys:

```json
{ "version": 1, "jobSha256": "<SHA-256 hex of the UTF-8 bytes of body>", "jobBytes": 183402 }
```

`jobSha256` is lowercase hex; `jobBytes` is the whole number of UTF-8 bytes, not characters
(`Cigaló` is 7 bytes). Cloud checks, in this order:

1. the envelope, proof and lease (401);
2. `jobBytes` over 1,048,576: 413 `translation_job_too_large`, before anything is hashed;
3. `jobBytes` and `jobSha256` against `body`, before parsing it: a mismatch is 401 like any other
   invalid proof;
4. the job's fields (400 `invalid_request`), and more than 1,000 items (413
   `translation_job_too_large`);
5. a submit operation ID already used by this installation: with the same fingerprint, Cloud
   returns that job's submit reply (with its current state) and checks nothing further; with a
   different fingerprint, 409 `conflict`;
6. the installation's `content_translation` service is `ready` (else 403 `permission_denied`),
   the venue's consent (403 `translation_consent_required`), no open job for the venue (409
   `translation_job_running`), and the monthly cap (409 `translation_limit_reached`).

The job:

```json
{
  "version": 1,
  "country": "ES",
  "languages": { "default": "ca", "enabled": ["ca", "es", "en"] },
  "items": [
    {
      "ref": "variant:812",
      "kind": "variant",
      "family": "product:640",
      "category": "TAP BEERS",
      "staffName": "PINTA",
      "existing": { "en": "Pint" },
      "missing": ["ca", "es"]
    }
  ],
  "houseStyle": [
    { "kind": "product", "staffName": "CARAJILLO", "names": { "ca": "Cigaló", "es": "Carajillo" } }
  ]
}
```

Every key shown is required and no other key is allowed. Lengths are counted as JavaScript string
length. A job that breaks any rule below is refused with 400 `invalid_request`.

- `version` is 1. `country` is two capital letters naming a region.
- `languages.enabled` holds 1 to 20 distinct language tags (`ca`, `es`, `pt-BR`) and includes
  `languages.default`.
- `items` holds 1 to 1,000 entries, context items included; more is 413.
- `ref` is the box's own identifier for the item, 1 to 128 characters, unique in the job, opaque to
  Cloud.
- `kind` is one of Waitron's nine `TranslationGapKind` values: `product`, `variant`,
  `option_list`, `option_label`, `extra_list`, `menu`, `section`, `included_menu`, `unit`.
- `family`, 1 to 128 characters, names the item a variant, options label or menu section belongs
  to; it equals `ref` for an item that heads its own family. The box lists a family's head before
  its members.
- `category` is the family head's category, or `null`. A product has one category, so it is a
  product's own and a variant's product's; every other kind sends `null`. 1 to 500 characters.
- `staffName` is 1 to 500 characters.
- `existing` holds the venue's text in enabled languages that are not missing, each 1 to 500
  characters; the service never changes it.
- `missing` lists distinct enabled languages to write, none of them in `existing`.
- **Context items.** `missing` may be empty only for an item that heads the family of another item
  in the same job that has languages to write (its `ref` equals that item's `family`). The box sends
  a head this way when it sends a member of the family but not the head itself: a product whose
  names are complete while its variants' are not, an options list whose labels are missing, a menu
  whose sections are missing. Cloud gives it to the model as context and never returns names or a
  failure for it. At least one item in a job has languages to write.
- `houseStyle` holds 0 to 300 saved names, each with `kind`, `staffName` (1 to 500 characters) and
  `names`, mapping enabled languages to 1 to 500 characters.

`total`, `done` and `failed` count only items with languages to write.

**The cap.** The owner approved **US$5 per venue per calendar month (UTC)** as the temporary safety
cap. Pricing, the replacement monthly allowance and billing remain separate release gates.
Cloud estimates a job's cost from `total` at a stored rate per item. If the estimate
exceeds what is left of the venue's cap for the calendar month (UTC), submit is refused:

```json
{ "error": "translation_limit_reached", "fits": 6 }
```

Every account-http refusal is `{"error":"<code>"}` (`packages/account-http/src/app.ts:98`); this
one adds `fits`, the whole number (0 or more, below `total`) of items that would fit. The worker
also stops a running job once its actual cost reaches the cap (status `reason: "limit_reached"`).

Keep the full submit body and operation ID until the result is known. After a lost reply, sign the
same fingerprint with the same operation ID, a fresh proof time and a live lease: Cloud returns the
same job rather than making another.

The reply:

```json
{ "version": 1, "jobId": "00000000-0000-4000-8000-000000000010", "state": "queued", "total": 358 }
```

### Status, collect and release

Status and release each sign exactly `{"version":1,"jobId":"<uuid>"}` with a fresh operation ID.
Collect signs exactly those fields with an optional `cursor`, for example
`{"version":1,"jobId":"00000000-0000-4000-8000-000000000010","cursor":2}`.
Omitting `cursor` means 0. Other fields or invalid action bodies are 400 `invalid_request`.

After proof and lease validation, look up the job scoped to the signing installation before
checking cursor validity or range. An unknown or foreign job is always 404
`translation_job_not_found`, including with an invalid cursor. For an owned job, a supplied cursor
must be a JSON number that is a safe integer with `0 <= cursor < total`; null, strings, booleans,
fractions, negative, unsafe and out-of-range values are 400 `invalid_request`. Validate the cursor
before applying collect's state rules. `total` excludes context items. Any positive offset in range
is allowed; it need not be a previously returned page boundary. An opaque or encrypted token adds
no authority: the offset is already signed and installation-scoped.

**Status** returns:

```json
{ "version": 1, "jobId": "...", "state": "running", "total": 358, "done": 180, "failed": 0 }
```

`state` is one of:

- `queued` and `running`: not finished;
- `done`: every item with languages to write has a result;
- `partly_done`: some have a result and the rest failed;
- `failed`: none has a result;
- `collected`: released by the box;
- `expired`: the body and results were deleted 24 hours after the job finished, or 24 hours after
  it was submitted if it never finished.

A `partly_done` or `failed` status also carries `reason`, one of this list:

| State | `reason` | Meaning | Waitron shows |
|---|---|---|---|
| `partly_done` | `limit_reached` | The cap stopped the job. | `content.suggestion_limit_reached` (`fits` 0) |
| `partly_done` | `provider_failed` | Some batches failed at the provider. | how many could not be done |
| `failed` | `provider_unavailable` | Every batch failed at the provider. | `content.suggestion_service_unavailable` |
| `failed` | `consent_required` | Consent is unavailable when the worker leases or resumes the job. Earlier batches are withheld; cost already spent is retained. | `content.suggestion_consent_required` |
| `failed` | `limit_reached` | The cap was reached before any item was done. | `content.suggestion_limit_reached` (`fits` 0) |

Poll every five seconds at most.

**Collect**, by state: `done` or `partly_done` returns one page; `queued`, `running` or
`failed` is 409 `translation_not_ready`; `collected` or `expired` is 410 `translation_expired`.

```json
{
  "version": 1,
  "jobId": "00000000-0000-4000-8000-000000000010",
  "state": "partly_done",
  "results": [
    {
      "ref": "variant:812",
      "names": { "ca": "Pinta", "es": "Pinta" },
      "placeholder": false,
      "corrections": []
    },
    {
      "ref": "product:977",
      "names": { "ca": "Zurito", "es": "Zurito", "en": "Zurito (small draught beer)" },
      "placeholder": false,
      "corrections": [ { "field": "internal", "wrong": "ZURRITO", "right": "ZURITO" } ]
    }
  ],
  "failed": ["product:1021"],
  "nextCursor": null
}
```

The response has exactly `version`, `jobId`, `state`, `results`, `failed` and `nextCursor`.
Build one immutable terminal list from the original submitted items, filtered to those with
nonempty `missing`, in submit order. Each entry is either its complete result or its failed ref.
Worker completion order, batch order and object-key order cannot change that list. The cursor is
an offset into this filtered list, not into `results` alone or the unfiltered input.

Starting at that offset, return the **largest nonempty consecutive segment** whose complete
serialized response fits 16 MiB. Split that segment into `results` and `failed`, each preserving
submit order. `nextCursor` is the offset immediately after the segment, or `null` at the end.
Measure with the candidate's actual `nextCursor`, including `null` on the last page. An item is
atomic: its names, placeholder flag and corrections stay together and unchanged. The
[single-item bound](superpowers/plans/2026-10-16-translation-collect-pages.md#single-item-size-proof)
uses the existing 1 MiB job bound, without adding a language-tag length restriction. Never
drop data to make a page fit.

A complete walk starts at 0 and follows `nextCursor` until null. Every item with languages to
write appears exactly once across that walk, in `results` or in `failed`; context items appear in
neither. Repeating the same cursor returns the identical semantic page while the job is retained,
even with a fresh operation ID. Collect never deletes data or extends retention.

`names` holds only languages listed in the item's `missing`, each 1 to 500
characters. `placeholder: true` comes with empty `names`. An item carries at most 10
`corrections`; `field` is `internal` or an enabled language code, and `wrong` and `right` are 1 to
500 characters and differ. A correction to a language the venue entered is a suggestion only. The
box must drop:

- a result whose `ref` it did not send with languages to write;
- a name for a language that was not missing.

The box must read at most 16 MiB of decoded JSON per page, regardless of `Content-Length` or
compression, and reject an oversized or incomplete response. Do not concatenate response strings
or keep an unbounded in-memory collection. Persist each validated page into Waitron's existing
durable suggestion reconciliation, deduplicate refs per job, and save the next cursor with the
page's durable writes. Crash retries may safely fetch and reconcile the same page again. Mark
the walk complete only after the null-cursor page is durably stored and all `total` refs are
accounted for. A release or expiry between pages returns 410 `translation_expired` for the next
valid collect; retain the partial/incomplete distinction and never report those pages as a full
job or release on their behalf.

**Release** tells Cloud the box has durably stored **every page**, and is sent only after that
complete walk. A `failed` job has no collectable pages and keeps its existing release path. Cloud
does not infer durable client storage from a collect call. The release state rules remain:
`done`, `partly_done` or
`failed` deletes the job's body and results and returns
`{"version":1,"jobId":"...","state":"collected"}`; `collected` returns the same reply again;
`queued` or `running` is 409 `translation_not_ready`; `expired` is 410 `translation_expired`.

**Joint release gate:** Waitron's pagination loop and durable completion check landed in
[A689-21 #1901](https://github.com/clintongormley/waitron/pull/1901). The
[local interruption proof](local-pairing.md#prove-translation-survives-interruptions)
uses the real Waitron runner pinned to `a3be14ba4e59bc8104087624171ddabec4978de2`
and Cloud's real HTTP service with a fake provider. It exercises multi-page storage,
lost page and release replies, both restart signals, deduplication, release only after
durable completion, and expiry with retained suggestions and the real notification.
Record both source identities when you repeat it. Bounded decoded reads and the
remaining quality, commercial and deployment gates still need their own evidence;
these local cases do not authorise going live.

### Consent

The account owner agrees, or withdraws, on the portal's account page, `<Cloud origin>/account`,
in the venue's entry (owners only). Waitron's dialog links there when submit is refused with
`translation_consent_required`. The portal provides the owner consent control; keep translation off until the release gates pass.

The account API is `GET|POST /api/account/translation-consent`. Reads need your live
session cookie. Writes also need the portal `Origin` and the session's
`X-CSRF-Token`, so a page on another site cannot change your choice. For example,
using your own session cookie and CSRF token:

```sh
curl "$CLOUD_ORIGIN/api/account/translation-consent" \
  --cookie "__Host-cloud_session=$SESSION_TOKEN" \
  -H "Origin: $CLOUD_ORIGIN" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"venueId":"11111111-1111-4111-8111-111111111111","choice":"agree","consentVersion":"providers-2026-10-14"}'
```

The reply lists every venue you currently own, including venues without an installation:

```json
{"consents":[{"venueId":"11111111-1111-4111-8111-111111111111","consented":true,"consentedAt":"2026-10-17T12:00:00.000Z"}]}
```

Use your venue's id in the example. To withdraw, send
`{"venueId":"11111111-1111-4111-8111-111111111111","choice":"withdraw"}` without a
consent version. The reply has `consented:false` and `consentedAt:null`; the stored
agreement remains in history. Only a current, enabled, email-verified owner can
agree or withdraw. Unknown fields, another provider version and a version attached
to withdrawal return 400 `invalid_input`. A different organisation's venue returns
403 `forbidden`.

Reads and writes share 30 requests per minute per account, across client addresses;
excess requests return 429 `rate_limited` with `Retry-After`. Both leave your session's
activity time unchanged. The session is checked again after any database wait, so an
expired session rolls back the change. These account bodies retain the ordinary
16 KiB, five-second reader. You can manage consent while the translation machine
routes are switched off; recording consent does not enable them.

### Refusals

| HTTP | Code | When | Waitron's code |
|---|---|---|---|
| 400 | `invalid_request` | A job field, or a status, collect or release signed body, breaks a rule above. | `cloud.request_invalid` |
| 400, 415 | `invalid_input` (existing) | The outer request is not a JSON object (400) or not sent as `application/json` (415). | `cloud.request_invalid` |
| 401 | `invalid_proof` (existing) | The envelope, proof or lease is invalid, including a submit whose `body` does not match `jobSha256` or `jobBytes`. | `cloud.unavailable` |
| 403 | `translation_consent_required` | The venue's account owner has not agreed to the named language-model providers. | `content.suggestion_consent_required` |
| 403 | `revoked`, `permission_denied` (existing) | The installation is revoked, or `content_translation` is not `ready` for it. | `cloud.unavailable` |
| 403 | `forbidden` (existing) | The request carries a browser Origin header. | `cloud.unavailable` |
| 404 | `translation_job_not_found` | Another installation's job, or an unknown ID. | `content.suggestion_expired` |
| 408 | `invalid_input` (existing) | The request was not received within its time limit. | `cloud.unavailable` |
| 409 | `conflict` | A submit operation ID reused with a different fingerprint. | `cloud.request_invalid` |
| 409 | `translation_job_running` | A job is already queued or running for the venue. | `content.suggestion_job_running` |
| 409 | `translation_limit_reached` | The estimate exceeds what is left of the cap. Carries `fits`. | `content.suggestion_limit_reached` |
| 409 | `translation_not_ready` | Collect or release in a state listed above. | `cloud.unavailable` |
| 410 | `translation_expired` | Collect of a `collected` or `expired` job, or release of an `expired` one. | `content.suggestion_expired` |
| 413 | `translation_job_too_large` | Submit: `jobBytes` over 1,048,576, more than 1,000 items, or a request over 2,113,536 bytes. | `cloud.request_invalid` |
| 413 | `invalid_input` (existing) | A status, collect or release request over 16,384 bytes. | `cloud.request_invalid` |
| 429 | `rate_limited` (existing) | A per-installation or per-IP limit. | `cloud.unavailable` |
| 503 | `temporarily_unavailable` (existing) | Cloud has the service switched off. | `cloud.unavailable` |

### Shared test vectors

The first implementation task on each side adds the signing test vectors to this section, generated
from fixed keys:

- a valid submit;
- the same submit with one byte of `body` changed;
- a `jobBytes` that does not match;
- a replayed operation ID with a different fingerprint.

Waitron's signer and Cloud's verifier both test against them.

The vectors are one JSON document, generated by Cloud's
`packages/translation/test/make-submit-vectors.ts` and committed as
`packages/translation/test/submit-vectors.json`. Its inputs are the keys, issuer, lease, origin,
installation ID and proof time of `packages/registration/test/installation-vector.json`; Waitron's
`apps/server/test/cloud-installation-vector.json` is byte-identical to it (`cmp`, 2026-10-14), and
Ed25519 signatures are deterministic, so either side's signer reproduces the same bytes. The
document holds:

- `origin`, `installationId`, `operationId`, `issuedAt`, `publicKey`, `issuerPublicKey`,
  `issuerKeyId`, and `lease` as an object (the envelope signs `JSON.stringify(lease)`);
- `cases`, in this order, each `{ "name", "expect", "envelope": { "payload", "signature", "body" } }`,
  all signed as `translation-submit` with the one `operationId`
  (`52345678-1234-4234-8234-123456789abc`) and `issuedAt`:
  - `valid` (`expect: "accepted"`): the job example above, with staff name `PINTA`;
  - `changed_body` (`"401 invalid_proof"`): the valid envelope with `PINTA` changed to `PINTO` in
    `body`;
  - `wrong_length` (`"401 invalid_proof"`): the valid body, signed with `jobBytes` one more than its
    length;
  - `replayed_operation` (`"409 conflict after valid"`): the same job with staff name `CANYA`, its own
    fingerprint, and the valid case's operation ID.

The job text is `JSON.stringify` of the example's keys in the order shown, with no spaces. Cloud's
first task pastes the generated document below this paragraph as the section's only `json` block;
a test on each side compares its copy with it.

```json
{
  "origin": "https://cloud.example.test",
  "installationId": "22345678-1234-4234-8234-123456789abc",
  "operationId": "52345678-1234-4234-8234-123456789abc",
  "issuedAt": 1800000000000,
  "publicKey": "MCowBQYDK2VwAyEAiojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w",
  "issuerPublicKey": "MCowBQYDK2VwAyEAgTl3Dqh9F19Wo1Rmw0x-zMuNipG07jeiXfYPW4_Js5Q",
  "issuerKeyId": "R96ljqAPrpQX7hnXZ1W_72kImQIRMu_7BP4fnk8MgFk",
  "lease": {
    "payload": "WyJ3YWl0cm9uLWNsb3VkLWFjY2Vzcy12MSIsImh0dHBzOi8vY2xvdWQuZXhhbXBsZS50ZXN0IiwiUjk2bGpxQVBycFFYN2huWFoxV183MmtJbVFJUk11XzdCUDRmbms4TWdGayIsIjEyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjMyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsInRlc3QiLCJNQ293QlFZREsyVndBeUVBaW9qajNYUUo4Wlg5VXRzdFBMcGRjc3BuQ2I4ZGxCSWI4M1NJQWJRUGIxdyIsMTgwMDAwMDAwMDAwMCwxODAwMDAzNjAwMDAwLCJjb250cm9sIl0",
    "signature": "ox6VbdFkKUpIk_kcVJx22X_bo-zbhOFwEw9oXFJTwaj9so7ueA5xmk66vRnbMM22Q0Hx5pc9UG00I1ieO0lACQ"
  },
  "cases": [
    {
      "name": "valid",
      "expect": "accepted",
      "envelope": {
        "payload": "WyJ3YWl0cm9uLWNsb3VkLW1hY2hpbmUtdjEiLCJodHRwczovL2Nsb3VkLmV4YW1wbGUudGVzdCIsInRyYW5zbGF0aW9uLXN1Ym1pdCIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjUyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsMTgwMDAwMDAwMDAwMCwie1wicGF5bG9hZFwiOlwiV3lKM1lXbDBjbTl1TFdOc2IzVmtMV0ZqWTJWemN5MTJNU0lzSW1oMGRIQnpPaTh2WTJ4dmRXUXVaWGhoYlhCc1pTNTBaWE4wSWl3aVVqazJiR3B4UVZCeWNGRllOMmh1V0ZveFYxODNNbXRKYlZGSlVrMTFYemRDVURSbWJtczRUV2RHYXlJc0lqRXlNelExTmpjNExURXlNelF0TkRJek5DMDRNak0wTFRFeU16UTFOamM0T1dGaVl5SXNJakl5TXpRMU5qYzRMVEV5TXpRdE5ESXpOQzA0TWpNMExURXlNelExTmpjNE9XRmlZeUlzSWpNeU16UTFOamM0TFRFeU16UXROREl6TkMwNE1qTTBMVEV5TXpRMU5qYzRPV0ZpWXlJc0luUmxjM1FpTENKTlEyOTNRbEZaUkVzeVZuZEJlVVZCYVc5cWFqTllVVW80V2xnNVZYUnpkRkJNY0dSamMzQnVRMkk0Wkd4Q1NXSTRNMU5KUVdKUlVHSXhkeUlzTVRnd01EQXdNREF3TURBd01Dd3hPREF3TURBek5qQXdNREF3TENKamIyNTBjbTlzSWwwXCIsXCJzaWduYXR1cmVcIjpcIm94NlZiZEZrS1VwSWtfa2NWSngyMlhfYm8temJoT0Z3RXc5b1hGSlR3YWo5c283dWVBNXhtazY2dlJuYk1NMjJRMEh4NXBjOVVHMDBJMWllTzBsQUNRXCJ9Iiwie1widmVyc2lvblwiOjEsXCJqb2JTaGEyNTZcIjpcIjIyOTMyM2E2YjBhMzBlN2FmZWZhMTkzYjFmOTEyM2I3ZTc2NDFlYjcwYTMxYjBmMjQzZDVhNDMzY2UxNjUwNGRcIixcImpvYkJ5dGVzXCI6MzQ2fSJd",
        "signature": "9M2i_bRCLsDofwfGwSnXJR583jbjUPjGyOGzArliMcY_B4wgj4w_lLOog4SZFQG7isJxenH8IRflnMfHuZH5CA",
        "body": "{\"version\":1,\"country\":\"ES\",\"languages\":{\"default\":\"ca\",\"enabled\":[\"ca\",\"es\",\"en\"]},\"items\":[{\"ref\":\"variant:812\",\"kind\":\"variant\",\"family\":\"product:640\",\"category\":\"TAP BEERS\",\"staffName\":\"PINTA\",\"existing\":{\"en\":\"Pint\"},\"missing\":[\"ca\",\"es\"]}],\"houseStyle\":[{\"kind\":\"product\",\"staffName\":\"CARAJILLO\",\"names\":{\"ca\":\"Cigaló\",\"es\":\"Carajillo\"}}]}"
      }
    },
    {
      "name": "changed_body",
      "expect": "401 invalid_proof",
      "envelope": {
        "payload": "WyJ3YWl0cm9uLWNsb3VkLW1hY2hpbmUtdjEiLCJodHRwczovL2Nsb3VkLmV4YW1wbGUudGVzdCIsInRyYW5zbGF0aW9uLXN1Ym1pdCIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjUyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsMTgwMDAwMDAwMDAwMCwie1wicGF5bG9hZFwiOlwiV3lKM1lXbDBjbTl1TFdOc2IzVmtMV0ZqWTJWemN5MTJNU0lzSW1oMGRIQnpPaTh2WTJ4dmRXUXVaWGhoYlhCc1pTNTBaWE4wSWl3aVVqazJiR3B4UVZCeWNGRllOMmh1V0ZveFYxODNNbXRKYlZGSlVrMTFYemRDVURSbWJtczRUV2RHYXlJc0lqRXlNelExTmpjNExURXlNelF0TkRJek5DMDRNak0wTFRFeU16UTFOamM0T1dGaVl5SXNJakl5TXpRMU5qYzRMVEV5TXpRdE5ESXpOQzA0TWpNMExURXlNelExTmpjNE9XRmlZeUlzSWpNeU16UTFOamM0TFRFeU16UXROREl6TkMwNE1qTTBMVEV5TXpRMU5qYzRPV0ZpWXlJc0luUmxjM1FpTENKTlEyOTNRbEZaUkVzeVZuZEJlVVZCYVc5cWFqTllVVW80V2xnNVZYUnpkRkJNY0dSamMzQnVRMkk0Wkd4Q1NXSTRNMU5KUVdKUlVHSXhkeUlzTVRnd01EQXdNREF3TURBd01Dd3hPREF3TURBek5qQXdNREF3TENKamIyNTBjbTlzSWwwXCIsXCJzaWduYXR1cmVcIjpcIm94NlZiZEZrS1VwSWtfa2NWSngyMlhfYm8temJoT0Z3RXc5b1hGSlR3YWo5c283dWVBNXhtazY2dlJuYk1NMjJRMEh4NXBjOVVHMDBJMWllTzBsQUNRXCJ9Iiwie1widmVyc2lvblwiOjEsXCJqb2JTaGEyNTZcIjpcIjIyOTMyM2E2YjBhMzBlN2FmZWZhMTkzYjFmOTEyM2I3ZTc2NDFlYjcwYTMxYjBmMjQzZDVhNDMzY2UxNjUwNGRcIixcImpvYkJ5dGVzXCI6MzQ2fSJd",
        "signature": "9M2i_bRCLsDofwfGwSnXJR583jbjUPjGyOGzArliMcY_B4wgj4w_lLOog4SZFQG7isJxenH8IRflnMfHuZH5CA",
        "body": "{\"version\":1,\"country\":\"ES\",\"languages\":{\"default\":\"ca\",\"enabled\":[\"ca\",\"es\",\"en\"]},\"items\":[{\"ref\":\"variant:812\",\"kind\":\"variant\",\"family\":\"product:640\",\"category\":\"TAP BEERS\",\"staffName\":\"PINTO\",\"existing\":{\"en\":\"Pint\"},\"missing\":[\"ca\",\"es\"]}],\"houseStyle\":[{\"kind\":\"product\",\"staffName\":\"CARAJILLO\",\"names\":{\"ca\":\"Cigaló\",\"es\":\"Carajillo\"}}]}"
      }
    },
    {
      "name": "wrong_length",
      "expect": "401 invalid_proof",
      "envelope": {
        "payload": "WyJ3YWl0cm9uLWNsb3VkLW1hY2hpbmUtdjEiLCJodHRwczovL2Nsb3VkLmV4YW1wbGUudGVzdCIsInRyYW5zbGF0aW9uLXN1Ym1pdCIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjUyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsMTgwMDAwMDAwMDAwMCwie1wicGF5bG9hZFwiOlwiV3lKM1lXbDBjbTl1TFdOc2IzVmtMV0ZqWTJWemN5MTJNU0lzSW1oMGRIQnpPaTh2WTJ4dmRXUXVaWGhoYlhCc1pTNTBaWE4wSWl3aVVqazJiR3B4UVZCeWNGRllOMmh1V0ZveFYxODNNbXRKYlZGSlVrMTFYemRDVURSbWJtczRUV2RHYXlJc0lqRXlNelExTmpjNExURXlNelF0TkRJek5DMDRNak0wTFRFeU16UTFOamM0T1dGaVl5SXNJakl5TXpRMU5qYzRMVEV5TXpRdE5ESXpOQzA0TWpNMExURXlNelExTmpjNE9XRmlZeUlzSWpNeU16UTFOamM0TFRFeU16UXROREl6TkMwNE1qTTBMVEV5TXpRMU5qYzRPV0ZpWXlJc0luUmxjM1FpTENKTlEyOTNRbEZaUkVzeVZuZEJlVVZCYVc5cWFqTllVVW80V2xnNVZYUnpkRkJNY0dSamMzQnVRMkk0Wkd4Q1NXSTRNMU5KUVdKUlVHSXhkeUlzTVRnd01EQXdNREF3TURBd01Dd3hPREF3TURBek5qQXdNREF3TENKamIyNTBjbTlzSWwwXCIsXCJzaWduYXR1cmVcIjpcIm94NlZiZEZrS1VwSWtfa2NWSngyMlhfYm8temJoT0Z3RXc5b1hGSlR3YWo5c283dWVBNXhtazY2dlJuYk1NMjJRMEh4NXBjOVVHMDBJMWllTzBsQUNRXCJ9Iiwie1widmVyc2lvblwiOjEsXCJqb2JTaGEyNTZcIjpcIjIyOTMyM2E2YjBhMzBlN2FmZWZhMTkzYjFmOTEyM2I3ZTc2NDFlYjcwYTMxYjBmMjQzZDVhNDMzY2UxNjUwNGRcIixcImpvYkJ5dGVzXCI6MzQ3fSJd",
        "signature": "1c-X-l8TG37Zh7EsruFa9i7Fbshp4a3VJBLfv8ktHgsXNAiVvtq31w9DxgabzGYjd5Yzl5g1fWcNBW6geeklAg",
        "body": "{\"version\":1,\"country\":\"ES\",\"languages\":{\"default\":\"ca\",\"enabled\":[\"ca\",\"es\",\"en\"]},\"items\":[{\"ref\":\"variant:812\",\"kind\":\"variant\",\"family\":\"product:640\",\"category\":\"TAP BEERS\",\"staffName\":\"PINTA\",\"existing\":{\"en\":\"Pint\"},\"missing\":[\"ca\",\"es\"]}],\"houseStyle\":[{\"kind\":\"product\",\"staffName\":\"CARAJILLO\",\"names\":{\"ca\":\"Cigaló\",\"es\":\"Carajillo\"}}]}"
      }
    },
    {
      "name": "replayed_operation",
      "expect": "409 conflict after valid",
      "envelope": {
        "payload": "WyJ3YWl0cm9uLWNsb3VkLW1hY2hpbmUtdjEiLCJodHRwczovL2Nsb3VkLmV4YW1wbGUudGVzdCIsInRyYW5zbGF0aW9uLXN1Ym1pdCIsIjIyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsIjUyMzQ1Njc4LTEyMzQtNDIzNC04MjM0LTEyMzQ1Njc4OWFiYyIsMTgwMDAwMDAwMDAwMCwie1wicGF5bG9hZFwiOlwiV3lKM1lXbDBjbTl1TFdOc2IzVmtMV0ZqWTJWemN5MTJNU0lzSW1oMGRIQnpPaTh2WTJ4dmRXUXVaWGhoYlhCc1pTNTBaWE4wSWl3aVVqazJiR3B4UVZCeWNGRllOMmh1V0ZveFYxODNNbXRKYlZGSlVrMTFYemRDVURSbWJtczRUV2RHYXlJc0lqRXlNelExTmpjNExURXlNelF0TkRJek5DMDRNak0wTFRFeU16UTFOamM0T1dGaVl5SXNJakl5TXpRMU5qYzRMVEV5TXpRdE5ESXpOQzA0TWpNMExURXlNelExTmpjNE9XRmlZeUlzSWpNeU16UTFOamM0TFRFeU16UXROREl6TkMwNE1qTTBMVEV5TXpRMU5qYzRPV0ZpWXlJc0luUmxjM1FpTENKTlEyOTNRbEZaUkVzeVZuZEJlVVZCYVc5cWFqTllVVW80V2xnNVZYUnpkRkJNY0dSamMzQnVRMkk0Wkd4Q1NXSTRNMU5KUVdKUlVHSXhkeUlzTVRnd01EQXdNREF3TURBd01Dd3hPREF3TURBek5qQXdNREF3TENKamIyNTBjbTlzSWwwXCIsXCJzaWduYXR1cmVcIjpcIm94NlZiZEZrS1VwSWtfa2NWSngyMlhfYm8temJoT0Z3RXc5b1hGSlR3YWo5c283dWVBNXhtazY2dlJuYk1NMjJRMEh4NXBjOVVHMDBJMWllTzBsQUNRXCJ9Iiwie1widmVyc2lvblwiOjEsXCJqb2JTaGEyNTZcIjpcImY2NGQ5ZTdhNzU4MWMzZjUzZjk0MjgwYmFmNDVkYmY1NWVhZGZjMjkwZmE0N2U0NWNlZWUyODcyODA0YjFiNTlcIixcImpvYkJ5dGVzXCI6MzQ2fSJd",
        "signature": "vUNrsO7iA8YetktzhIoAzXMVToakQ4Erj6u3LlDJdFy5UwuA5Q_jfhMl2RsFrTgb-90rEYK2GFT9viUG8KoPCA",
        "body": "{\"version\":1,\"country\":\"ES\",\"languages\":{\"default\":\"ca\",\"enabled\":[\"ca\",\"es\",\"en\"]},\"items\":[{\"ref\":\"variant:812\",\"kind\":\"variant\",\"family\":\"product:640\",\"category\":\"TAP BEERS\",\"staffName\":\"CANYA\",\"existing\":{\"en\":\"Pint\"},\"missing\":[\"ca\",\"es\"]}],\"houseStyle\":[{\"kind\":\"product\",\"staffName\":\"CARAJILLO\",\"names\":{\"ca\":\"Cigaló\",\"es\":\"Carajillo\"}}]}"
      }
    }
  ]
}
```

<a id="hosted-writer-retirement-a1018-direction-agreed"></a>

## Handover between local and hosted machines: A1018

**Cloud direction agreement, 2026-10-23, including the owner’s 15:37 correction;
full owner design approval and build authority remain pending.** This supersedes
#312’s emergency M1 filing assignment and #300’s rejected external stop proof
(`6700d6f2319ff0b62b0ccc27e833487935ad2174`). The shared proposal is
Waitron's [simple handover design at
`d9252ac34f2b7e946e1154dd5af1a443c2c39ad4`](https://github.com/clintongormley/waitron/blob/d9252ac34f2b7e946e1154dd5af1a443c2c39ad4/docs/superpowers/specs/2026-10-23-a1018-simple-handover-design.md),
SHA-256 `5fabaad0ff946f410c68fd71f46cffa497c3f562ae7f8776c71f61de96265aa3`.
Cloud accepts its direction and the boundaries below. Waitron owns the one combined
owner design question, including the proposed policy defaults and both worked
examples. This is the shared Cloud home; pin its publication revision in Waitron
before building. No wire format or runtime behaviour is qualified by this agreement.
The broader [hosted lifecycle](#hosted-lifecycle-and-promotion-proposed) remains
proposed and unimplemented.

### One protocol, two scenarios, four directions

Call your old machine M1 and your selected replacement M2. Both scenarios work
local to local, local to Cloud, Cloud to Cloud and Cloud to local. Local to local
needs neither Cloud nor internet. Cloud supplies hosting, storage, connectivity and
its own resource journal; Waitron owns stepdown, final-copy comparison, signed
membership, activation, fiscal authority and return. Neither scenario requires an
outside stop authority, hardware/provider proof or a periodic sale lease.

**Controlled handover:** M1 durably records its handed-over restriction before
acknowledging stepdown, closes every business/module writer and bounds admitted
work and external requests by their existing deadlines. Keep uncertain payment and
filing outcomes with their original request identities; timeout is not reversal.
Stop remaining mutators, including backup/checkpoint writers, before capture. M1
stays stepped down across reboot or a lost reply; it cannot resume by timeout.

M2 verifies the complete frozen copy and M1-signed final-state indicator against
M1's enrolled key and the expected signed membership. M2 durably accepts the copy
before acknowledging it to M1. Only then may M1 durably relinquish filing to this
M2 in signed operation status bound to the indicator. M2 verifies and records that
assignment and its activation outcome before enabling work. M2 keeps its own node
identity and starts its own fresh fiscal identity, chain and series through the
existing module, authentication, clock and allocation gates. It files M1's copied
outbox in M1's recorded fiscal identity, without copying M1's private node key.
M1 starts no new communication with the Spanish tax authority, AEAT, while stepped
down and never resumes it after takeover. Handover does not wait for AEAT or for
the outbox to drain over the internet.

**Emergency handover:** a freshly authenticated authorised person declares that
M1 is shut down, no parallel recovery is in progress and the selected last copy's
unknown missing tail is accepted. For hosted M1, the person stops the exact resource
in the provider console and records its identity, confirming restart is prevented.
This is a human declaration, not an automatically verified provider fact. An alert,
missing heartbeat, route change or Cloud action approval cannot supply it.

Persist the declaration, M1’s restricted role and M2’s sole responsibility for all
AEAT communication before activation. M2 starts its own fresh chain under the same
activation gates and files unfiled old originals already in its copy, including
queues inherited from earlier nodes, in each record’s unchanged generating fiscal
identity. New sales use M2’s identity. No emergency predecessor ownership hold
prohibits M2 from filing copied records; missing originals remain an explicit gap.
On return M1 checks the current signed role before any business or fiscal worker
starts. It neither files nor consults AEAT; it transfers fiscal originals and received
evidence to M2. An emergency M1 unable to reach M2 or a till on boot waits for an
authorised human; a stale chart alone cannot clear that wait.

An isolated, already running M1 may still sell until it learns of the newer role.
Show the proposal's split-network warning: bills, payments, cash and stock can
diverge, and M2 may lack the final tail. Distinct fiscal chains avoid continuing
one writer chain; they do not merge divergent business histories. Each till binds
to one selected server and never repeats an uncertain payment on another. Preserve
existing payment recovery checks and A764's unqualified ownership dependency.

### Bind the complete copy and keep local identities separate

The indicator binds operation, venue, M1, selected M2, signed membership revision
and document digest, consistent snapshot digest, schema versions, enabled modules,
and every immutable fiscal chain's identity, head, count, outbox, received outcomes
and uncertain external requests with their original identities. Include committed
journal changes; a timestamp, single chain head or stream-lag value is insufficient.

The separate node-local manifest names durable role and handover/filing assignments,
recovery preparations, spent allocation choices, follower positions, required module
files and secret versions. Classify each item as transferred continuity data,
source-only data, destination-owned data or rebuildable data. M2 retains its own
node key, recovery verifier and role state. Source-only private identity stays on
restricted M1; shared credentials travel through approved secret/module transfer
paths. A DB copy alone establishes neither inventory completeness nor secret access.
A947's node-local identity separation and the actual module/file inventory and
comparison format must be qualified before build.

Compare the frozen payload before destination-local mapping; validate the declared
mappings separately. Store the indicator, copy acceptance, later relinquishment and
retry outcomes outside that payload. The captured filing map records ownership at
capture; signed operation status records the later assignment. Cloud cannot infer
final-copy equality from storage freshness or a backup verifier. This protocol
assumes cooperating, uncompromised machines; it does not prove process death or
resist an unknown old clone, rolled-back disk, copied private identity or root access.

### Map the person and the retry without granting new authority

**Recommendation included in Waitron's owner question:** venue permission
`node.promote`, exercised by the owner or an authorised manager with fresh passkey
or password plus enrolled authenticator code. A till PIN is insufficient. Cloud
account authority must be explicitly bound to that same venue actor and operation;
matching email, a hosting purchase, organisation ownership or a support grant alone
does not supply Waitron permission or the emergency declaration. If the binding is
unavailable, wait. A Cloud operator may execute a separately authorised resource
stop but cannot declare or activate for a venue without that venue authority.

Source inspection at Cloud `a886559aab6b4427ca3fb62ea8865c6f594ba5a0` found
organisation-owner service checks in `packages/account-http/src/backups.ts:35` and
scoped support grants in `packages/registration/src/support-grants.ts:68`. These
are not a `node.promote` mapping. That bridge, fresh authentication evidence,
expiry, revocation and replay refusal need a jointly pinned format and tests before
implementation; no current endpoint is claimed here.

Bind both machines' durable operation state and Cloud's resource journal to the
same operation, venue/installation mapping, M1, selected M2, expected signed
membership revision/digest, scenario and input fingerprint. Audit the actor, exact
declaration, accepted uncertainty, reason, selected copy and time, plus the hosted
provider resource where applicable. Same id and same inputs return the stored
outcome; changed inputs conflict. Serialise local competitors without claiming to
prevent independent promotions across a network split. A lost activation reply
queries that same M2 and operation, never selects M3 or allocates again by timeout.
Changing target after possible activation requires explicit resolution first.

If a controlled move crashes before final-copy acceptance, an explicit emergency
replacement on the same M2 is proposed only when retained history proves no final-copy
acceptance, no authorised relinquishment and no possible activation. Persist the
replacement, continued M1 restriction and sole M2 AEAT assignment before activation.
Accepted or unknown history keeps the original controlled
operation until its copy and filing assignment are recovered. A lost relinquishment
reply reads M1's durable record; it never permits both machines to file. This waiting
trade-off remains part of the combined owner question.

### Return fiscal facts, preserve the business gap

After either takeover M2 alone handles all AEAT communication. Returning M1 never
files, consults or otherwise contacts AEAT, even for an uncertain earlier submission.
It freezes and transfers missing immutable fiscal originals, required chain/filing
state, every received AEAT outcome including those for originals M2 already holds,
and unanswered request identities. A transfer filtered only to missing originals
would discard evidence. M2 files copied and later-returned old originals unchanged
in their generating fiscal identities; new sales use its own fresh identity.

Apply known results before deciding what remains to send. M2 uses existing recovery,
duplicate-handling and filing-case paths for uncertain sends, including a record M1
may already have sent. A duplicate response alone does not prove acceptance. Keep
conflicting terminal facts as an open case rather than letting the last arrival win.
Preserve the temporary per-chain filing pause while a return batch applies and
domain holds for unresolved filing cases; neither is a continuing predecessor
ownership hold. Source restriction and M2’s assignment persist through reboot,
claim reset, retry and reconciliation. Later evidence uses another frozen batch in
the same operation; a retry of one batch returns identical bytes.

Never replay old orders, payments, cash, drawer, stock, printing or other business
changes on M2. Keep them in a restricted consistent archive. The proposed visible
reconciliation list names source, chain/installation, series/number, original ids,
dates, taxable/tax/gross amounts and retained evidence. Show dated known and unknown
fiscal-versus-business gaps in cash-up and reports, with acknowledgement, responsible
person and resolution. A later correction is a new authorised M2 record, not an
imported payment total. An acknowledgement alone does not resolve the gap.

No wipe before record-level fiscal receipts, per-chain counts/heads, outbox coverage,
matching transferred fiscal totals, successor health and a verified archive all pass.
Keep originals and archive while filing or reconciliation remains unresolved; the
no-automatic-expiry recommendation awaits approval and A664's retention policy.
A lost disk leaves an explicit unknown missing-tail interval, with the existing
consultation/month-end operator follow-up, never invented invoices or business rows.
A947’s broader ledger-tail transfer/return rules and prototype controls need explicit
amendment for fiscal-only transfer before implementation; this agreement changes no
fiscal code or golden results. The relay direction follows [A947 §7.1](https://github.com/clintongormley/waitron/blob/d9252ac34f2b7e946e1154dd5af1a443c2c39ad4/docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md#71-the-tail-and-the-fix-for-the-failed-prototype-scenario)
and [asesor Q2](https://github.com/clintongormley/waitron/blob/d9252ac34f2b7e946e1154dd5af1a443c2c39ad4/docs/compliance/asesor-questions.md#q2-may-a-node-other-than-the-till-transmit-the-tills-records-to-aeat),
which requires the generating installation’s identity. This is source agreement,
not a new legal or runtime conclusion. E’s authorised A1034 must test old-tail
continuation after M2’s new chain starts, interleaving and an old-server-filed record
resent by M2 against AEAT’s test service; those checks remain unrun in this agreement.

In the revised Harbour Kitchen examples, controlled M2 files M1’s copied outbox
after relinquishment when AEAT is reachable. In the emergency, invoice `A-0CNNW/218`
is absent from M2’s 21:39 copy. Until M1 returns it, show an unknown interval, never
invented amounts. Returning M1 transfers invoice 218 and received outcomes without
AEAT contact. M2 reconciles those facts and files it if unfiled, preserving M1’s
identity. Only then can the list show its €100.00 taxable, €10.00 tax and €110.00
gross business gap; its cash payment and bill are not replayed. A missing disk leaves
that interval unknown. The remaining policy defaults and both revised examples
await E’s single short owner design question.

An explicitly selected cold restore remains separate: fresh chain, accepted tail
loss, existing source, recovery-key, node-recovery-key, operation and sole-recovery
gates, with no added hard-stop proof. A failed handover never silently becomes an
emergency or cold restore. P6, P7, D88 and production section 9 use these boundaries;
automation permission and regional recovery provide none of the missing venue
facts. All eight scenario/direction combinations and the proposal's adverse controls
remain UNRUN. Owner design approval, separate build authority, compatible pinned
consumers and runtime qualification precede enablement; no provider operation,
spending, live mail or production schema change follows from publication.

### A951 routing revision 2 response, 2026-10-23 (D136)

You can implement the shared request parser in isolated T4 fixtures against this
accepted revision. **Cloud accepts the complete routing engineering artifact**
`waitron-a951-routing-v1`, edition `proposal-2026-10-23.2`, at
[Waitron `4fbb76eafd7d426905d7e7561f85e807438fcbdc`](https://github.com/clintongormley/waitron/blob/4fbb76eafd7d426905d7e7561f85e807438fcbdc/docs/superpowers/specs/2026-10-23-a951-routing-v1-revision2.md),
with full-document acceptance SHA-256
`974c4e98eb7d583d82ad1c573f9dcec01c63b2cc4f6630d38aeda22775d198d0`.
This supersedes D130's pending routing disposition and D132's reference to its
outstanding routing corrections. It accepts requirements and future test
expectations, without claiming an implemented parser or a qualified connection.

The returned artifact makes D130's two technical corrections. Its other changes
record provenance, matching helper acceptance and remaining gates. The original
manifest, four literal request/response fences, grammar, bounds and unrelated
adverse vectors remain unchanged. The complete edition, including its closed
contexts and every numerical limit, is accepted for this scope.

| D130 requirement | Accepted revision 2 answer |
| --- | --- |
| Suspend-aware local clocks and boot binding | Both closed contexts add `boot:H`, identifying that side's boot with 32 lowercase hexadecimal characters. The retained `verifiedAtMonoMs` and `expiresAtMonoMs` fields and every request deadline use local boot elapsed milliseconds including suspension. Dispatch rechecks that side's current boot, live connections, listener/process custody, bindings, authority, trust and every lifetime. An unknown clock, changed boot or expired deadline closes the affected connection without handler or new upstream calls. No retry, read, observation or suspend resets a deadline; clocks are never compared across hosts. |
| Explicit boot and expiry controls | Accept box boot `22222222222222222222222222222222`, gateway boot `33333333333333333333333333333333` and changed boot `44444444444444444444444444444444`. Separate controls cover each side's boot change and suspend from `now=1500` to expiry at `now=2000`, with zero handler/upstream calls and closure. The original equality-at-expiry refusal remains. These are synthetic test expectations. |
| Literal delivery boundaries and forwarding | Accept one read `concat(P, 0x78)` versus two reads `[P, 0x78]`, and one read `concat(P, P)` versus two reads `[P, P]`. Every split has the same first-request verdict, including suffix arrival before dispatch. The isolated gateway emits exactly the displayed `P_box` once; the isolated box handler runs once with no further hop. Suffixes become neither a second request nor upstream bytes, and are discarded without retaining an unbounded chunk. Production's exact empty manifest yields `ROUTE_DENIED` with zero handler/upstream calls. |

The accepted manifest remains the exact 83 ASCII bytes in D130, without a final
newline: revision `proposal-2026-10-23.1`, SHA-256
`271fefd892b2c0f10ffab42f8e4a832a163b244733285f08d5a0ea1dfab1b012`.
The routing artifact's new edition does not change those manifest bytes or admit
nonempty routes. The injected availability fixture remains separate from
production policy and grants no customer product permission.

Lane E's [matching acceptance and focused plan amendment](https://github.com/clintongormley/waitron/blob/4fbb76eafd7d426905d7e7561f85e807438fcbdc/docs/superpowers/plans/2026-10-22-a951-connection.md#focused-d130d132-amendment-2026-10-23)
record the unchanged helper `waitron-a951-helper-v1`, edition
`proposal-2026-10-23.1`, SHA-256
`da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f`,
solely for isolated T3. Its independent verifier/supervisor, caller lifetime,
framed EOF, saved evidence, independent counters/floors, owned network matrix,
boot/deadline and scoped withdrawal requirements are carried into that plan.
This satisfies D130's matching acceptance and plan-recording condition; actual
host containment and listener custody still need G7 execution evidence.

Comparison sources remain Cloud `c0d0e800529ec6c1557fce9a4d68b9b43b7447dc`
and Waitron foundation `72aed2e21705c9d02b6beda5ef248410ffc9b73a`.
The existing Cloud manifest, renderer and public gate are byte-identical at the
D136 review base `6c031499cdb19e038994c89a6725998b49ae608f`; they do not
implement this raw parser or its independent upstream context. Accepted executable
Waitron consumer: **NONE**; accepted executable Cloud consumer: **NONE**;
qualified runtime pair: **NONE**. Record E's matching routing acceptance and this
exact edition/digest in its intake before isolated T4 code. Before connecting
consumers, record both resulting full implementation commits, accepted artifacts
and allowed path in both repositories, then qualify that pair. Source comparison
pins cannot substitute for those receipts.

No revised appliance edition was published at the reviewed Waitron pin. D132's
four appliance amendments remain open, with accepted appliance digest **NONE**:
actual approval/provisioning consumers, a separately versioned helper safety/custody
mapping, the complete signed-byte corpus and current agreement/A1018 references.
G2/A947 authority, G3 staff policy, G4 independent upstream trust/transport,
G5 moves, G6/T13 diagnostics and flow-scoped A980/D101 processing, and G7
host/device/runtime qualification retain their affected-path gates. Keep real
admission disabled, production customer routes empty and `.local` independent.
This agreement authorises no deployment, provider/host operation, publication,
pause, customer authentication, payment, writer, fiscal or recovery action.
