# First working milestone

The [combined local receipt](../launch-evidence.md#read-the-local-evidence-narrowly)
now verifies these steps with two test venues. Repeat them against the selected
deployment before treating the milestone as launch evidence:

1. Connect a venue through owner approval, assigned names and venue-scoped credentials.
2. Prove public cloud inspection and staff TLS passthrough, including isolation between
   venues and protection of staff functions from public routes.
3. Upload backups directly to object storage and show the latest recoverable time.
4. Restore onto a replacement from the continuous backup and from a retained snapshot,
   including with continuous data absent. Cover planned hardware replacement and
   recovery after failure through the agreed shared flow.
5. Replace the gateway, measure reconnection time with unchanged customer-facing
   addresses and verify that backups continue.

The [integration contract](../waitron-integration-contract.md) now maps the existing
interfaces to proposed connection, configuration, backup, replacement and revocation
operations, with ownership and acceptance checks. Registration persistence is implemented
with real PostgreSQL concurrency and process-restart tests. Password sessions and
session-backed Cloud approval are implemented. The independent Cloud signup backend
now verifies email tokens and creates the first organisation, business and owner
membership together. Password recovery now changes credentials and ends existing
sessions atomically. The same transaction queues encrypted emails for a worker that
retries failures and resumes after crashes. Local Mailpit tests cover SMTP delivery
and a separate worker process. Authenticated TLS SMTP now covers production transport,
bounded cancellation, retry classification and accepted-message receipts. Next: configure
and prove live provider delivery and validate production
ingress and deployment controls before exposure. The account HTTP adapter is implemented.
The owner confirmed the SQLite storage switch landed on 2026-09-23. Waitron-side
work can resume. The Cloud matching-code API now verifies signed installation requests and stores bound
Cloud approvals. Its [wire contract](../superpowers/specs/2026-09-23-venue-pairing-design.md)
uses local confirmation of the chosen business. Both confirmation screens and the
Waitron manager adapter now pass the [local two-installation proof](../local-pairing.md),
including restart and lost-completion recovery. You can paste a pairing code with
outer whitespace: the portal trims it before checking and sending the eight digits,
and shows the trimmed code. Internal spaces and malformed codes remain refused
locally. Controller and English/Spanish browser tests cover both exchanges and
preserve leading zeroes. Installation credential renewal,
configuration, observations and revocation now work through key-bound one-hour leases.
The account and Waitron screens show English/Spanish status and explicit stop-access
confirmation. PostgreSQL and real two-server tests cover renewal/revocation races,
lost replies, worker restart and venue isolation. The [local remote-access proof](../local-remote-access.md)
now uses real WireGuard/HAProxy, two Waitron servers, ACME DNS validation, browser bot
challenges, local DNS, gateway replacement, revocation and expiring route authority.
Operator placement and customer
remote setup now has owner-only English/Spanish screens for assigned names, custom DNS
changes, readiness and local-network guidance. After an uncertain save reply, the portal
reads the current settings once even during Retry-After; new saves and manual refreshes
keep waiting, so you can see whether the name was saved without repeating the change.
Custom names are limited to 237 characters in the portal, DNS instructions and save
validation, leaving room for the certificate record's `_acme-challenge.` prefix.
You can enter a custom name with one final dot; the portal removes it before DNS
review and confirmation. Two final dots, URLs, paths, IPv4 addresses and names over
237 characters still fail the existing validation. Focused controller tests cover
this input cleanup; the hostname validator and server checks remain unchanged.
A PostgreSQL-backed local reconciler now
publishes signed routes and renews public/staff certificates through explicit filesystem,
DNS and ACME adapters. Its receipt covers duplicate workers, expired-lease restart,
bounded failure, failed-renewal retention and hostname/lease fences; focused filesystem
tests cover atomic replacement while Waitron keeps the staff private key.
An explicitly enabled, test-installation-only version 1 signed exchange now carries staff CSRs and chains through
PostgreSQL without shared files. An opt-in reconciler mode fences replacement, revision,
revocation and expired claims; the two-installation local proof uses Pebble and
Waitron's unchanged CSR/install CLI. Live provider DNS, production key storage/deployment
and automatic appliance setup remain open. Waitron still needs a durable exchange client,
local stale-result checks, polling, lease renewal and TLS reload. The [local backup proof](../local-backups.md)
now provides encrypted scoped storage, protected key versions, an immutable snapshot catalogue,
restore verification, retention and owner-bound recovery operations. Two real Waitron
snapshots restore independently of deleted Litestream data, including after key rotation.
These remain local integrations. The customer snapshot catalogue and matching-code
recovery approval screens are implemented for verified test snapshots. The replacement
setup downloads and validates the selected archive, stages it and runs Waitron cold restore
without copying keys or inheriting the old backup destination;
installation-authenticated capture delivery, upload-credential renewal and scheduled
snapshots with durable local retries are implemented locally. Owner-confirmed replacement
now imports fresh Cloud credentials, retains installation history and updates remote
placement. Two real Waitron venues now stream into separate provider-owned prefixes;
Cloud verifies their signed pointers, freezes one generation and restores its exact
database head after an interrupted attempt. Deleting the other stream leaves its
neighbour unchanged and its verified snapshot fallback restores. The complete milestone
runner now composes the transfer, real remote-access and managed-recovery phases and
validates one strict receipt. Its clean 2026-09-27 run replaced the gateway in 14,967 ms,
reconnected a moved venue in 1,570 ms, restored continuous data in 1,743 ms and a retained
snapshot in 1,432 ms, completed managed replacement in 8,346 ms, refused the old recovery
authority and restored a fresh post-replacement snapshot. The phases use separately
isolated local fixtures; the receipt binds them to the same clean Cloud and Waitron heads
rather than pretending that their disposable installation identifiers are shared. These
are local measurements, not service objectives. Live provider and DNS checks, production
deployment and secret custody, provider-native management-database recovery, planned final-write handover,
automatic tunnel/certificate installation and activation remain open.
The [registration plan](../registration-implementation-plan.md) now sequences persistence,
identity reuse, the bound approval exchange and a two-installation connection proof.
The normal connection journey and PostgreSQL for Cloud management data are agreed.
The internal package uses one management database and tests concurrent completion
and restart against PostgreSQL. Proof encoding and user-mediated first contact are specified and implemented on the
Cloud side. The Waitron adapter checks live manager permission and serving-primary status before
completion. Public deployment remains gated by the [service-adapter and ingress work](../backlog.md#platform-work-to-scope). Country partitioning, database availability and per-cell storage
remain deployment work; existing services must tolerate a management outage within
the scoped credential and revocation rules defined in the installation lifecycle spec.

The [Cloud account HTTP API](../../packages/account-http/README.md) is implemented and
tested against PostgreSQL, Mailpit and real sockets. Shared account controls are
implemented in [Waitron PR #519](https://github.com/clintongormley/waitron/pull/519).
Cloud now pins the private shared UI release and verifies it in Chromium.
The [account portal design](../superpowers/specs/2026-09-23-account-portal-design.md)
is implemented with English/Spanish signup, login and recovery, simple business
setup, same-origin serving and real browser/email tests. The
[implementation plan](../superpowers/plans/2026-09-23-account-portal.md) records the delivery.
Email links use fragments; legacy query links remain accepted. Browser tests cover
committed writes with lost replies, session expiry, retry delays and account isolation.
Sign-in retry delays leave signup and password recovery usable. English/Spanish
browser tests cover both request and completion forms, retained sign-in deadlines
after navigation, and recovery's own visible retry countdown and expiry.
Recovery shows a failed session check as unavailable and lets you retry.
English/Spanish browser checks cover HTTP and network failures, the pending
message and retry to sign-in without exposing recovery controls.
Connect a venue and Recover offer Retry only after the session check fails.
While it runs, you see the checking message without an inactive retry action.
Browser checks cover both routes in English/Spanish, light/dark and phone/desktop,
including HTTP and network failures, retry to sign-in and Retry-After disabling.
Monitoring, Public website and Staff access are groups within each venue entry,
so two monitored venues do not repeat page-region names. Database-free browser
checks cover both venues, current and unknown health, evidence dates and disabled
monitoring in English/Spanish, both themes and phone/desktop widths.
Route pass/fail messages follow the latest external check, including the gap
before its incident opens or closes. Unknown evidence and certificate warnings
keep their separate rules. Database-free browser checks cover both routes and
those transitions in English/Spanish, light/dark and phone/desktop widths.
Installation, snapshot, monitoring and recovery dates spell out the month in
English and Spanish. Local time and seconds are retained, including the warning
about changes lost during recovery. Database-free browser checks cover both
recovery sources and the approved continuous source, light/dark and phone/desktop.
Next, configure live mail delivery and the [deployment/account-security controls](../backlog.md#platform-work-to-scope). Pairing
remains a separate exchange requiring both Cloud and local administrator proof.

