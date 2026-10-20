# Waitron Cloud backlog

Updated 2026-10-17. The repository has a pnpm workspace and internal PostgreSQL
registration state, internal password sessions, session-backed Cloud approval and an
email-verification signup backend that creates the first organisation and business.
Cloud password recovery and an encrypted PostgreSQL email queue are implemented
internally, with a retry worker, authenticated TLS SMTP delivery and Mailpit for local
email capture. The account HTTP API now provides signup, login, session activity,
logout and recovery with shared request limits, Origin/CSRF checks and bounded
network handling. The bilingual account portal now covers signup, sign-in, sign-out
and password recovery, served by that API with real browser and Mailpit tests.
The account venue overview groups one organisation at a time, shows business context,
connection/service state and separate latest/verified snapshot capture times. Verified
snapshots older than 48 hours are labelled out of date. Owners can browse paginated snapshot history, verification and retention details, including
protected copies. The local durable worker now verifies real Waitron restores, retries failures and
cleans expired snapshots and abandoned captures. The local monitor now persists contact,
snapshot and remote-route incidents, shows stale checks as unknown, and queues opt-in
bilingual alerts with permission and current-route rechecks.
Live provider/sender configuration and public deployment remain open.
No public cloud service is deployed. This file owns cloud product and platform work;
Waitron's backlog owns the on-prem application and its side of the integration.

Start with the [product discussion](product-and-platform.md). The
[launch evidence boundary](launch-evidence.md) separates the completed local milestone
from the provider, policy and live tests still required before public exposure. The
[inherited inventory](reference/2026-08-29-cloud-services-inventory.md) holds the wider
candidate list and previous commercial reasoning. Remote access and backups are the
agreed initial services. The first integration milestone is complete locally; the
production release scope remains open.

## Repository licence

The root `LICENSE` is copied byte for byte from Waitron's Elastic License 2.0 text.
All eleven workspace and root manifests identify it with `SEE LICENSE IN LICENSE`.
Waitron's separate grants are not included. The owner and watcher control the repository's
visibility; this change does not switch it or alter settings and workflows.

## First working milestone

The [combined local receipt](launch-evidence.md#read-the-local-evidence-narrowly)
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

The [integration contract](waitron-integration-contract.md) now maps the existing
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
Cloud approvals. Its [wire contract](superpowers/specs/2026-09-23-venue-pairing-design.md)
uses local confirmation of the chosen business. Both confirmation screens and the
Waitron manager adapter now pass the [local two-installation proof](local-pairing.md),
including restart and lost-completion recovery. Installation credential renewal,
configuration, observations and revocation now work through key-bound one-hour leases.
The account and Waitron screens show English/Spanish status and explicit stop-access
confirmation. PostgreSQL and real two-server tests cover renewal/revocation races,
lost replies, worker restart and venue isolation. The [local remote-access proof](local-remote-access.md)
now uses real WireGuard/HAProxy, two Waitron servers, ACME DNS validation, browser bot
challenges, local DNS, gateway replacement, revocation and expiring route authority.
Operator placement and customer
remote setup now has owner-only English/Spanish screens for assigned names, custom DNS
changes, readiness and local-network guidance. A PostgreSQL-backed local reconciler now
publishes signed routes and renews public/staff certificates through explicit filesystem,
DNS and ACME adapters. Its receipt covers duplicate workers, expired-lease restart,
bounded failure, failed-renewal retention and hostname/lease fences; focused filesystem
tests cover atomic replacement while Waitron keeps the staff private key.
An explicitly enabled, test-installation-only version 1 signed exchange now carries staff CSRs and chains through
PostgreSQL without shared files. An opt-in reconciler mode fences replacement, revision,
revocation and expired claims; the two-installation local proof uses Pebble and
Waitron's unchanged CSR/install CLI. Live provider DNS, production key storage/deployment
and automatic appliance setup remain open. Waitron still needs a durable exchange client,
local stale-result checks, polling, lease renewal and TLS reload. The [local backup proof](local-backups.md)
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
The [registration plan](registration-implementation-plan.md) now sequences persistence,
identity reuse, the bound approval exchange and a two-installation connection proof.
The normal connection journey and PostgreSQL for Cloud management data are agreed.
The internal package uses one management database and tests concurrent completion
and restart against PostgreSQL. Proof encoding and user-mediated first contact are specified and implemented on the
Cloud side. The Waitron adapter checks live manager permission and serving-primary status before
completion. Public deployment remains gated by the service-adapter and ingress work below. Country partitioning, database availability and per-cell storage
remain deployment work; existing services must tolerate a management outage within
the scoped credential and revocation rules defined in the installation lifecycle spec.

The [Cloud account HTTP API](../packages/account-http/README.md) is implemented and
tested against PostgreSQL, Mailpit and real sockets. Shared account controls are
implemented in [Waitron PR #519](https://github.com/clintongormley/waitron/pull/519).
Cloud now pins the private shared UI release and verifies it in Chromium.
The [account portal design](superpowers/specs/2026-09-23-account-portal-design.md)
is implemented with English/Spanish signup, login and recovery, simple business
setup, same-origin serving and real browser/email tests. The
[implementation plan](superpowers/plans/2026-09-23-account-portal.md) records the delivery.
Email links use fragments; legacy query links remain accepted. Browser tests cover
committed writes with lost replies, session expiry, retry delays and account isolation.
Next, configure live mail delivery and the deployment/account-security controls below. Pairing
remains a separate exchange requiring both Cloud and local administrator proof.

## Fiscal allocation registry

The [shared registry plan](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/plans/2026-10-12-cloud-fiscal-allocation-registry.md)
defines the implemented Cloud service. The
[contract and storage stage](fiscal-allocation-registry.md) defines strict signed
receipts, complete series and binding snapshots, separate paper custody trust,
explicit unavailable capabilities and append-only migration 038. Local tests
exercise the actual fiscal validator, populated concurrent 37-to-38 upgrades,
interrupted migration rollback, namespace uniqueness, retained runtime history
and exact schema gates. Production authority is unavailable.

The current-history stage adds challenged signed journal reads, signed expiring
writer grants, exact full-history replay and permanent unknown outcomes. Local
PostgreSQL dump/restore and independent Node workers prove that missing C000042
cannot be reissued, the previous writer is refused, and lost replies or failed
database commits reconcile the same signed result. The external fixture survives
process restart; no production continuity provider is supplied.

The authenticated store stage adds current session, venue ownership, custody and
entitlement rechecks; terminal consumption and abandonment; signed bounded receipt
pages; and monotonic signed S/P imports with complete venue-transfer chains. Local
PostgreSQL tests cover independent authenticated workers, authority lost during a
wait, omitted full series, ended entitlement with retained reads, old uploads,
forged or consumed transfers, partial transfers and matching exact retries.
Account HTTP routes require a full session, CSRF and current venue authority;
shared PostgreSQL limits protect account and authorized namespace budgets. A
durable routing hint recovers the exact outside receipt after a first-projection
rollback. Machine reports verify the current installation key and active lease
under revocation locks, retain exact retry results and record matching or
conflicting paper evidence without activation or name issuance. Real listener
tests exercise factor challenges, shared limits, revocation and expiry waits,
discarded TCP replies, independent authority restart and failed PostgreSQL commits.
Indexed venue/operation queries avoid whole-table tenant scans. Current custody
checks protect both receipt pages and post-append consumption; fresh signed machine
authentication recovers the same immutable operation after a proof expires. Paper
import status records completion without inventing a Cloud receipt.
Registration tests run in five CI file shards. Every case and the 30-second
test deadline remain; work jobs stop after eight minutes.
The phone journey at `/fiscal-allocations` now reserves and explicitly consumes
identities, reconciles uncertain replies using the same operation, exports the
complete signed manual packet, pages retained receipts and imports existing signed
paper history. Local real-server/browser tests cover English and Spanish, light
and dark, 390 and 1280 pixels, with accessibility checks in ready, uncertain,
error and retained states. On-prem venues need no managed backup to use the journey.
Browser validation checks structure; local recovery must verify cryptographic
trust and authority before activation. Cloud now preserves the exact person or recovery-key event operator through
reserve validation, consumption approval, signed manual packets and retained
browser receipts. Tagged key operators must match the recovery event and target
node; malformed objects and person substitutions refuse. Focused contract and
real HTTP tests cover those boundaries, and eight browser cases cover retained
key-event packets in both languages, themes and widths. The actual PostgreSQL joint test now pins Waitron adapter candidate
`2293a60a311e20b227029782ba75048ee1fff241`. Its 15 cases cover real account status,
independent verification of Cloud's signed packet, source/target/event/operator and
full-purpose refusals, missing trust, reserved-state refusal, retained read access,
session/CSRF refusals, complete manual activation and a matched machine report.
A lost committed report reply retries the same operation with fresh authentication;
the independent journal returns a retained result without sending again and refuses
changed evidence. These are local synthetic fixtures, with no production policy enabled.
The test uses an explicitly pinned installed Waitron checkout, or fetches and installs
that public commit in its own temporary directory. Waitron
owns the adapter and its delivery. The joint fixture now observes actual HTTP
401/403 responses and checks that a conflicting report leaves its retained result
usable without another send. Its report cases share one activation; independently
runnable name-filter cases and removal of the temporary port's release/rebind
interval remain fixture follow-ups. The installed-checkout override verifies the
tracked tree; its dependencies and untracked files are developer supplied.
Production continuity
storage, taxpayer custody and operator attribution, subscription policy and the
signing-key custodian remain owner enablement gates. Before enabling recovery,
qualify how the service discovers custody-approved namespaces when an old database
backup lacks both allocations and routing hints, and measure full-journal replay
and indexed paging with launch-scale history. Exhausted identity space and
unverified signed evidence now direct you to your custodian in English and Spanish,
alongside the original uncertain-result warning when a write is unresolved.
The page retains status checking and exact-request resends; temporary continuity
failures still suggest a later retry. Controller checks and real-server Chromium
journeys cover both themes at 390 and 1280 pixels. The exhaustion browser response
is synthetic; the untrusted-paper response comes from the real signed-evidence check.
The retained receipt's disabled draft purpose selectors display Standard for
all three bases in the D72 key-event browser captures, while the signed receipt
list correctly displays Standard, Full and Rectificative. Qualify and correct
that draft display separately without changing signed bases or purposes.
Duplicate adjacent status authority calls remain a small follow-up; no production defaults are
selected. Fiscal records, invoice hashes and Waitron's allocation code stay outside
this Cloud change.

**Fiscal session-expiry test ordering.** The store test now expires its session
on the reservation's own PostgreSQL client after the real external append commits.
Both the normal case and a 350 ms pre-reservation pause retain the strict
`session_expired` refusal, one permanent name and zero projected events. Boundary
diagnostics record database time, expiry and authorization/append stages without
credentials. Boundary assertions run after reservation settles, so append
reconciliation cannot swallow them. The earlier 300 ms setup deadline failed under the controlled pause:
it expired before authorization and the append never began. Twelve unchanged
isolated runs and a diagnostic full run did not reproduce that original failure;
its exact historical cause remains unproved. If this test fails again, use its
boundary diagnostics before changing authority checks or deadlines.

**Continuity fixture diagnostics.** A package-only CI-selection control passed
131 of 133 fiscal tests: `continuity.test.ts` reached an absent worker receipt in
the replacement-fence case, and the 150 ms witness case did not observe its
projection waiting on the held PostgreSQL lock. The same fiscal tree passed all
133 tests in the candidate gate. An isolated diagnostic run passed both cases
and observed the lock after 15 ms, then refused projection after 192 ms. These
passes do not explain the original failures. The machine also ran concurrent
review mutations; resource pressure is an assumption, not an established cause.
Before changing either check, capture the worker's returned code before receipt
access and the witness-verification, projection, lock and refusal times. Keep the
writer/witness policies, lock observation, identity and refusal assertions intact.
Do not overlap a large review mutation batch with full package qualification.
A later local full fiscal run also reached the old-backup case's 30-second
deadline and missed the same lock observation. A diagnostic-only run completed
that backup case in 5,238 ms, observed the lock after 25 ms and refused expired
history after 206 ms. These passes do not resolve the failures. Keep the dump,
restore and worker-result stages when that case fails again; preserve both
the 30-second deadline and the 150 ms witness policy.
The two cases are `a restored old PostgreSQL backup cannot reissue C000042 and
complete reconciliation permits C000043` and `a verified history that expires
during a PostgreSQL lock wait cannot project`, both in
`packages/fiscal-allocation/test/continuity.test.ts`. That run overlapped review
and other local qualification work; resource pressure remains an assumption.
The 16 October five-shard qualification also passed 132 of 133 fiscal checks:
the same 150 ms witness case did not observe its held lock. The fixture and
fiscal sources match the preceding main tree. An isolated diagnostic run observed
the lock and passed; a separate 200 ms pause before projection reproduced the
assertion after the witness had expired and projection returned `history_uncertain`.
This establishes an early-expiry mechanism, not the precise cause of the original
failure. Retain verification, client-acquisition, projection and lock-observation
ages on recurrence. Evidence is under
`~/waitron-campaign-d/receipts/d69/registration-shard-budget/fiscal-*.log`.
The 150 ms policy, lock assertion and 30-second deadline remain unchanged.
The retained local evidence is under
`~/waitron-campaign-d/receipts/d69/dependency-fixtures/`: the failures are in
`gate-packages-fiscal-allocation.log`, the stage observations and diagnostic-only
patch are `fiscal-diagnostic.log` and `fiscal-diagnostic.patch`, and the later
133-case passing run is `fiscal-final.log`. Use those stages to investigate the
next failure; a passing repeat does not resolve this defect.

**Maximum-hour lease fixture timing.** Full main CI `39247738663` failed
`staff-certificates.test.ts` before its production-installation HTTP 403 check:
the issuer refused a fixture built from two clock reads. Advancing only lease
construction by one millisecond reproduces `invalid_proof` through real PostgreSQL.
The fixture now derives expiry from one issuance timestamp; its permanent advancing-clock
case verifies the signed lease lasts exactly 3,600,000 ms and retains the HTTP 403.
The outage proof's live retired-key control had the same two-clock construction.
Its complete PostgreSQL/SeaweedFS/HTTP journey also reproduces the refusal under
that clock control and passes after the same correction, retaining key-removal,
expiry and revocation checks. Both corrections leave production code, existing
assertions and individual deadlines unchanged. CI did not record its clock values,
so the exact historical timing remains unproved.
Separately qualify expired-lease fixtures that subtract an hour from one clock
read and one millisecond from a later read. A two-millisecond advancing-clock
experiment reproduces the same issuer refusal in the staff test's revision/revocation
case. The same construction appears in `relay-messages.test.ts`,
`relay-operator-stop.test.ts` and `captures.test.ts`; those sites remain untested
under that clock control. Preserve their expiry, permission and HTTP checks when
correcting them.

## Translate all: approved design, implementation still open

The [Cloud design](superpowers/specs/2026-10-14-translate-all-design.md) and
[24-task plan](superpowers/plans/2026-10-14-translate-all.md) are owner-approved. Design is
complete for the agreed translation flow: signed background jobs, missing-name suggestions,
language-neutral first/review passes, consent, usage and retention. The owner approved the
temporary **US$5 per venue per calendar month (UTC)** safety cap and submit admission of
**4 in flight, at most 1 per client address**, outside other account requests' shared places.
Task 1 now provides UTF-8 job fingerprints, the four signed translation action names and
deterministic shared signing vectors published in the canonical contract. Focused checks cover
changed bytes, malformed fingerprints, the 1 MiB bound and action/signature separation.
Task 2 adds append-only migration 039 for jobs, separately retained bodies, consent history,
prices and the spending policy. PostgreSQL checks constrain job bounds, reasons, one open job
per venue and repeat operations. A composite foreign key also binds each job to its
installation’s own venue. Usage metering accepts four translation quantities with
per-job replay checks and keeps its existing accounting guards. The service name is allowed
in the schema. Task 17 adds its ready row to existing, newly registered and replacement installations.
Historical receipt-selector fixtures use their saved migration module and directory membership,
so new migrations still exercise the original omission and refusal assertions. Production receipt
audits remain unchanged and retain work for the new schema.
Task 3 adds transaction-scoped venue locking, repeat-submit lookup, exact integer UTC-month
spending checks, installation-scoped job reads and release. Collection reconstructs filtered
submit order from retained outcomes and measures complete compact UTF-8 pages, including the
actual continuation, against the 16 MiB limit. PostgreSQL tests cover concurrent submits,
rollback, repeated collection, release locking and a multi-page walk; serializer tests cover
exact byte boundaries, Unicode and complete outcomes. These foundations are consumed by the signed translation
routes described below.
Task 4 adds the contract parser and family/category batch planner. Offline checks cover exact
field shapes, language and text bounds, the 1,000-item boundary, context-only heads, all nine
name kinds and house-style examples. Batches keep families whole, including context heads and
families larger than 90 items; small categories stay together. Batch order does not change the
collect contract’s filtered submit order.
Task 5 adds the country and language templates, house-style and family context, first-pass
reply checks and review merging. Offline checks pin both approved templates and cover missing
and duplicate outcomes, name and correction bounds, placeholders, context omission and review
changes limited to missing names. Malformed review entries are dropped and counted without
interrupting valid changes. Venue-entered names remain unchanged; spelling corrections stay
suggestions. These are offline checks, not a measurement of translation quality.
Task 6 adds the OpenAI Responses client and a local fake provider. Real HTTP checks cover the
pinned model and effort, `store: false`, redirects refused, timeout and caller cancellation,
4 MiB response sizing, token validation, retry hints and sanitized errors. Valid token counts
survive unusable replies so spending checks can account for them. HTTP errors are classified
before their bodies are read, so an oversized refusal cannot become retryable. The fake provider
accepts the actual assembled first-pass and review prompts. Retry hints reject malformed dates;
base URLs reject even empty query and fragment delimiters. Connection-close checks protect
both response cancellation paths, and real HTTP checks pin the default byte limit. No real provider request or quality
measurement is part of these checks.
Task 7 adds the two-pass batch runner. Loopback HTTP checks cover four calls per pass,
2/8/30-second backoff or bounded provider hints, refusal handling and review fallback.
Every billed reply reaches the spending callback, including unusable text and incomplete
responses; every attempt reaches the lease callback once. The cap is checked before each call.
Shutdown during either pass, a callback or retry waiting returns an abort without a batch
result. Storage and lease callback failures escape without repeating paid work. These
callbacks now reach the durable worker in Task 8. If spending and lease renewal both fail,
an aggregate error retains both failures without retrying the paid call; Task 18 still needs
to qualify retention and its command diagnostics.

Task 8 adds the durable worker: exclusive job leases, four concurrent batches, saved-batch
recovery, integer token/cost accounting, cap checks and transactional finish/usage records.
Real PostgreSQL and loopback-provider checks cover shutdown during connection waits, body
loading and either provider pass; stale leases cannot save outcomes or update spend. A failed
usage write rolls back completion, and the next lease finishes saved batches without a new
provider call. An expired lease or a crash before a batch is saved can repeat provider work;
recovery only skips durably saved batches. The command keeps the production lease longer
than one bounded provider attempt. A greater-than-16-MiB result walks pages in filtered submit order despite family
regrouping and reversed completion. Names and corrections retain escaped control characters
and lone surrogates. Append-only migration 040 changes retained results from JSONB to JSON;
release-39 upgrade, cancellation rollback, repeat/concurrent migration, manifest and recovery
count checks preserve retained results and existing job/ledger rows. Automated translation tests
fetch the pinned earlier release so the upgrade proof also runs in GitHub. Historical receipt-selector
fixtures retain their audited workflow bytes when current checkout settings change; production
audit guards and their original behavioral assertions stay unchanged. Provider activation and routes remain open. Consent enforcement is described under Task 13 below.

Task 9 adds `pnpm translation:worker` and its `--once` mode. Startup checks the
expected migration names, required settings, provider URL and whether the key can form an
HTTP authorization header. Fatal failures print one fixed diagnostic without private values;
recoverable pass failures print a separate fixed retry line.
PostgreSQL and loopback-provider process tests cover silent idle and single-job runs,
stored results and usage, two simultaneous jobs with ten-minute leases, and SIGTERM/SIGINT
shutdown during provider work or idle polling. Interrupted batches save no partial results,
and successful shutdown returns leases without using an attempt. Borrowed-client and
real disconnect checks cover fixed fatal output; a failed lease return exits 1 in both modes.
When the database cannot accept that return, the lease remains until its original expiry.
Signals before module loading installs the handlers still use the operating system’s default
termination. The command installs its handlers before opening the database pool. Direct Node
runs are quiet on success; the root pnpm
script can report a missing optional `.env` file. No real provider request is part of
these checks; activation and retention remain later tasks.

Task 10 adds the four signed machine actions at the store boundary. Each execution
checks the installation proof, revocation and current lease under an installation lock.
Submit verifies the fingerprint before parsing, then returns a repeated operation before
checking entitlement, open jobs or spending. Concurrent retries create one job.
Status, collect and release reject repeated fields and alternate version spellings,
then validate lowercase job UUIDs before reading jobs scoped to the signing installation. Collect checks ownership before cursor validity,
then applies state rules. PostgreSQL checks cover crossed and expired leases, revocation
during a lock wait, rollback after a body insert fails, mixed outcomes and a signed multi-page walk
larger than 16 MiB with unchanged text. Collection retains results; release deletes them.
These store methods are now used by the HTTP routes below, with the consent checks described under Task 13.

Task 11 adds the four translation HTTP routes, off by default. The account server
accepts only `CLOUD_TRANSLATION=0` or `1`; enabling requires an installation issuer.
The routes preserve proof/lease checks, installation-scoped job reads, retry ordering,
shared request allowances and security headers. Submit validates its three outer fields
before passing only the signed two-field envelope to authentication. Real-listener
checks prove compact collect replies at exactly 16,777,216 UTF-8 bytes, splitting at one
byte over, stable cursor retries and unchanged names/corrections across multiple pages.
Task 12 gives submit its own 2,113,536-byte, 60-second reader and four simultaneous
places per process, at most one per canonical client address, outside the eight
ordinary account places. Excess submits receive 503 before reading or rate charging.
Real-listener checks cover large escaped jobs, exact request-byte boundaries, slow
delivery, address grouping, refusal/abort recovery and readiness during stalled submits.
Admission uses the router's decoded submit path so encoded aliases cannot spend ordinary places.
Status, collect, release and other account readers keep 16 KiB and five seconds.
Task 13 requires current consent before accepting a new submit and after leasing a job.
Only an enabled, email-verified owner can agree or withdraw. Consent names OpenAI,
Anthropic and Google at version `providers-2026-10-14`; withdrawal keeps its history.
A former owner's consent no longer counts, and a new agreement closes that stale record.
Agreement and withdrawal share a venue lock so withdrawal also closes a concurrently
replaced record. Recording consent locks account, credential and membership authority
through the transaction, in account, credential, membership and venue order.
This avoids the reproduced deadlock with account changes that also update ownership.
PostgreSQL tests cover authority changes during lock waits,
repeat and concurrent agreements, rollback, history and account-scoped listing.
A worker without current consent finishes with `consent_required` before provider traffic
or usage writes; a replacement worker's lease cannot be failed by the old worker.
Submit still checks entitlement before consent and returns an existing operation before
either gate. Real HTTP tests cover the 403 reply and retry after withdrawal.
Task 14 adds `GET|POST /api/account/translation-consent`. You can list your owned
venues, agree to the exact provider version or withdraw while retaining history.
Writes require the portal Origin and your session's CSRF token, which proves that
this browser started the request. Reads and writes share 30 requests per minute per
account and never renew a passive session. The route resolves the live session
before charging, then before and after the database change; expiry during a lock
wait rolls the change back. PostgreSQL HTTP tests cover that rollback for agreement
and withdrawal, a session ended during body delivery, strict bodies, owner isolation,
and machine refusal before agreement and after withdrawal.
Task 15 adds the owner-only menu-translation control in each installation's entry
on `/account`, with draft English and Spanish wording. You can agree, withdraw or
retry a failed read; an unanswered write keeps the last confirmed choice and asks
you to retry in that venue's control. The controls are groups within their venue
entries, so multiple venues do not create identically named page regions. Account changes and refused sessions clear that choice, and late
replies cannot restore it. The browser sends the session's security token on writes
and validates complete consent replies. Real PostgreSQL/Chromium tests cover
agreement, persistence, withdrawal after a lost response body and owner-only display
in both languages, themes and phone/desktop widths. The wording awaits the owner.
The manual-retry browser fixture holds its successful session-activity reply until the
retry read returns. A controlled reply before click reproduces the five-second missing
retry-button failure: the session update automatically reloads consent and replaces that
button after pointerdown. Holding the reply passes the same 500 ms delayed-click control;
removing the hold restores the original timeout. Every existing assertion and deadline
remains. The two natural failures retained no request ordering, so their exact trigger stays
unproved; bounded path/status events now accompany any future failure. Portal production
code is unchanged by this fixture correction. Task 21 also reproduces a different gap:
an initial activity result can be accepted after the clock advance even though the manual
phase holds new activity requests. A controlled real PostgreSQL/Chromium run delays only
that valid session body's acceptance. It triggers an automatic consent read and the same
five-second missing-retry-button failure seen in CI. The fixture now completes initial
activity and its forced unavailable consent reload before advancing time; the original
manual 503/429/200 path, all permission and outcome checks, the 61-second advance and every
deadline remain. That controlled schedule passes with the precondition and fails when it
is removed in a disposable installed checkout. The natural CI trace did not record JSON
acceptance, so its exact scheduling remains unproved. Earlier response-listener timeouts
also lack complete ordering; capture clock-return, listener registration and activity
acceptance on recurrence rather than claiming all intermittent failures are resolved.
Task 16 keeps translation out of the three-service configuration, account and diagnostic
lists, monitoring targets, incident display and alert delivery. A ready translation row alone
cannot enable those services. PostgreSQL regressions insert that row explicitly and cover
schedule refusal, stopped-service incident suppression, queued-mail cancellation and
operations status.
Task 17 appends migration 041 and creates the ready translation row for new and replacement
installations. Its backfill preserves existing service rows, configuration, revisions and revocation.
A configuration request with the exact signed body `{"servicesVersion":2}` receives four services;
`{}`, renewal, reports, revocation and account lists keep the original three. Retried configuration
operations replay their original result after a configuration change, while new reads reflect the
current revision. PostgreSQL and HTTP checks cover exact bytes, invalid versions, lease bindings,
revocation, replacement and upgrades from an existing schema.
Task 18 deletes submitted menus and stored results in bounded 24-hour retention passes.
Finished jobs age from completion; queued or running jobs age from submission. Each pass
expires at most 100 jobs by default (an explicit limit may be 1–1,000), clears their leases
and preserves job accounting and usage events. Both the worker and, when translation is on,
the account server sweep at startup and every minute, so cleanup also runs without a worker.
PostgreSQL checks cover concurrent sweeps, locked collect rows, rollback, lost worker leases,
repeat-page retention, release waiting for collect and expiry between real bounded pages.
A fake-provider flow submits, finishes, durably stores collected pages and releases through
both real commands; neither command writes submitted names, generated names, the key or an
authorization header.
Cleanup failure keeps the approved startup/work gate closed: the enabled account command
exits before listening, and the continuous worker pauses new jobs, retries cleanup once per
minute and stops promptly during that wait. Both use fixed diagnostics. This also makes the
portal unavailable if its enabled startup cleanup fails; review that availability policy before
enabling translation. The `--once` regression proves an old queued job never reaches the fake
provider before its startup sweep.
The review's 50,000-retained-row probe used a sequential scan (5.4 ms locally). The per-pass
job limit does not bound rows scanned. Measure retained-history growth at launch volume and
qualify an append-only indexing migration if needed. The worker's lease query still has no age
predicate; provider dispatch for a job aging between bounded sweeps remains unverified and
must be qualified before activation. These are separate from deleting an expired body.
Task 19 adds the optional `translation` Compose profile and runtime role. The default stack
omits the worker; only it receives provider settings, while account receives the translation
switch, default off. Compose and runtime checks cover the profile, migration dependency,
private configuration mount and exact environment boundaries. The package guide documents
the worker, fixed diagnostics, cap overshoot and bounded retention. CI scope checks retain
translation package selection. A real disposable Compose/PostgreSQL regression starts the
worker, then refuses a changed migration digest before dispatch. Deleting only the launcher
schema gate makes that assertion fail. The local source-mounted proof also checks exact child
environment names and normal idle shutdown (0.27 seconds); its project is removed.
A built release image and active-provider Compose shutdown still need qualification.
This does not establish full-stack translation delivery,
quality, joint Waitron paging or production provider approval.
Task 20 preserves the original trial scripts, grading template, both product and shown-name
sets, all 141 owner grades and six Luna-review result files byte for byte. The offline scorer
reproduces the original totals: tuning 252 names, 6 needing work and 10 wrong; blind 243 names,
5 needing work and 6 wrong. Unseen names are counted and listed as ungraded, never accepted.
Command checks refuse missing input, failed or wrong-set runs, malformed values and repeated
files before printing a table, and warn about incomplete products and names. A multi-file
check preserves the complete ungraded list. The copied shown-language keys match the saved
grading pages, apart from unchanged given names that scoring excludes. These offline checks run in the
ordinary package suite without a provider or key; they do not measure the templated prompt.
Task 21 adds the trial runner and grading page below. Owner Tasks 22–24 and the joint proof remain open.
A controlled client-error event followed by cleanup-query rejection reproduces a fatal
line followed by a misleading cleanup-retry line. The worker now stops that retry path
after a fatal failure; the original exact-output assertions remain. The new subprocess
case and ordinary cleanup retry/recovery checks cover this ordering. CI exposed the
same duplicate output without retaining its exact query stages, so the historical
database timing remains unproved. The runtime reviewer later saw this original disconnect
case fail once among ten two-file runs, but its output filter discarded the assertion diff.
Twenty driver repeats then pass all 580 cases, including 60 original idle disconnections,
with complete logs retained. These passes do not explain that uncaptured failure. A real
PostgreSQL self-termination during cleanup passes three times with the guard and fails
with the guard deleted. Treat that as qualification of the fatal-then-retry mechanism,
not proof that every intermittent disconnect failure is resolved. On recurrence, keep the
complete assertion output, selected backend ids and termination results before changing
the original check. Active-job failure ordering at direct pool queries remains separately
unqualified; the reviewed idle scenario leases no job.
A later CI disconnect failure retains the reverse output: a pass-retry line before
that fatal line. A local real PostgreSQL lease-query termination reproduces this
ordering when the client error event arrives later. The query reports `57P01`,
PostgreSQL's code for an administrator stopping a connection. The worker now treats
that query rejection as fatal before the event in both the cleanup loop and the
lease pass, so it prints the existing single fixed failure line without promising
a retry. The original disconnect and ordinary retry assertions remain unchanged.
Two new process tests retain the real error code and force query rejection before
the client event at each stage. The exact query stage and
backend identifiers from that CI failure remain unavailable; the local ordering
proof does not establish them or classify every other connection error.
Keep translation off until the remaining runtime and joint qualification are complete.

The owner requires [bounded collect before go-live](superpowers/plans/2026-10-16-translation-collect-pages.md).
The [canonical contract](waitron-integration-contract.md#translate-all-version-1) now specifies
compact full-body replies of at most 16,777,216 decoded UTF-8 bytes, signed optional cursors in
filtered submit order, atomic unchanged results, stable retries and release only after every page
is durably stored. A conservative singleton size calculation uses the existing 1 MiB job bound
and preserves accepted language tags. Store-level sizing and HTTP serialization are tested; the real Waitron caller still needs joint proof.

Task 21 adds the hand-run production-path trial and new-name grading page. Fake-provider
checks cover usage, both passes, failed trials and strict command input; a failed review
keeps diagnostic names but is refused as a successful quality run. The builder filters
marked, shown, given and placeholder names, keeps run provenance, and escapes embedded
text. Its separate maintained template preserves the original experiment assets.
Chromium checks cover English/Spanish, light/dark, phone/desktop, exact mark writes and
deletions, failed saves and disabled controls without a grading store. Later snapshots
preserve a save result; both initial snapshots are required, pending choices lock and a
disconnected store cannot re-enable controls with a late update. These use a local
controlled store; the external grading bridge and owner measurements remain unqualified.
The new browser cases register through the original UI test entry point and keep its
workspace test command unchanged, preserving historical receipt-fixture discovery.
No real key or provider call is part of this implementation.

Remaining work:

- **Cloud qualification:** Tasks 1–21 are implemented, including the paging amendment's
  replacements for Tasks 3, 8, 10, 11 and 18. Preserve proof/lease and installation isolation,
  consent, cap/usage accounting, context omission, worker recovery and 24-hour deletion.
  Complete lock-order qualification across worker, release and installation revocation. The
  controlled revocation wait is covered; a mixed-traffic probe samples only one ordering.
  Before enabling submit, jointly qualify language recognition and canonical duplicates. The
  approved parser accepts unknown primary codes with subtags such as `xx-BR`, non-language
  codes `mul`/`zxx`, and case variants as distinct tags. The actual Waitron language validator
  refuses the unknown/non-language probe inputs and normalizes ordinary regional variants,
  but direct signed input still needs a policy decision before activation. Preserve the
  approved accepted-tag set until that contract decision; claim no complete recognition gate.
  The command rejects keys that cannot form an HTTP authorization header before leasing work.
  Direct client consumers still own their configuration validation.
  Consent rows retain history after membership removal. Current, enabled, verified ownership
  is checked when consent is recorded and used; a stored account ID alone grants nothing.
  The worker checks consent once after leasing. Withdrawal after that check does not cancel
  a job already in flight; it prevents new submits and subsequent leases. A resumed
  job without consent withholds previously saved batches and keeps cost already spent,
  as the contract now states. Listing currently reads consent once per owned venue;
  measure this path before optimizing it for large accounts.
  Append migrations at the then-current next numbers without editing landed migrations.
  Task 8 retains two defensive checks whose independent role in normal worker runs is not
  proved: refusing an already-saved batch write, and refusing finish before all batch entries
  exist. Preserve them without claiming they are unreachable. Parallel infrastructure failures
  currently expose one error; both failures from one call's spend/renew callbacks are retained.
  An ordinary failed run keeps its lease until expiry and uses a lease attempt; only caller
  shutdown returns it immediately when the database accepts the update. Task 18 now tests
  fixed failure diagnostics and no names in process output; broader traffic qualification remains open.
  The page-walk fixture now holds the specifically named first batch until the second batch
  is saved. A controlled second-before-first request schedule reproduced the original failure:
  the fixture had incorrectly treated the first arriving HTTP request as the first batch.
  The corrected test preserves every original outcome assertion and deadline, adds the actual
  request-order check, and proves durable completion in the opposite order before walking pages.
  The earlier review M17 failure had no retained arrival trace, so that historical trigger
  remains unproved; the current CI ordering-precondition failure is independently reproduced.
  Keep Task 12's whole-request bound ahead of the fingerprint helper: a small declared
  size with a large actual body still hashes that body before refusing the mismatch.
  A cheap byte-length refusal can be considered there; Task 1 exposes no HTTP route.
- **Waitron and joint qualification:** Waitron's paging caller landed in
  [PR #1901](https://github.com/clintongormley/waitron/pull/1901) at
  `93de9902c53734dc89b1bd9b440669bc25f4c020`. The
  [interruption-proof design](superpowers/specs/2026-10-19-translation-interruption-proof.md)
  and [three-task plan](superpowers/plans/2026-10-19-translation-interruption-proof.md)
  define a local Cloud script against the real Waitron server and a fake provider.
  The opt-in Cloud fixture now pages at 512 bytes, pauses collection outside
  transactions, drops a chosen real HTTP reply and awaits release checks before
  deletion. Its six real-listener tests pass, including streamed writes, independent
  fixture budgets and cancellation. The production page limit stays at 16 MiB;
  invalid internal limits are refused. Removing the guards and reply controls in
  a disposable checkout makes their tests fail. The baseline script now has tested
  trace and child-cleanup checks. Its paired healthy walk passes against clean
  Waitron `a3be14ba4e59bc8104087624171ddabec4978de2` (fixture repair #1903): three
  one-item pages, three unique durable suggestions before release, and no retained
  Cloud body. An injected setup failure also cleans up its process, Cloud and root.
  The [interruption command](local-pairing.md#prove-translation-survives-interruptions)
  now passes all five independent fault executions: lost page reply retries the same
  cursor with identical content; graceful and forced restarts resume saved cursor 1;
  lost release retries once after body deletion without moving the collection time;
  expiry retains page one's suggestion, reports one success and two failures, and
  shows the real partial-result bell notice before suggestions are opened. Every
  release checks durable completion first. A deliberate early suggestions read
  clears the notice and fails qualification. The combined five-case command passes;
  fourteen independent guard removals are caught by behavioral checks. Keep bounded
  decoded reads and the wider release gate open; these synthetic cases do not qualify
  production. Keep generation tags limited to the controlled single-runner restart.
  Before adding long-running release checks, give those callbacks cancellation:
  closing currently stops waiting and subsequent machine execution, while callbacks
  must stop their own work. Bundle-marker preflight checks required UI strings;
  the actual bell check remains mandatory.
- **Owner quality trials:** Tasks 22–24 remain owner-only after **2026-11-02**, using their
  preserved commands. Templated-prompt non-regression on both graded sets, house-style effects
  and the other kinds of name still need measurement and owner grading. Run no real-key trials
  as part of this documentation prerequisite or autonomous implementation.
- **Commercial and production gates:** pricing, billing and the replacement monthly allowance
  remain required before the first live venue. Provider processing/residency and retention
  decisions, consent wording, production key custody and deployment remain open. Suggestions
  still require a person to save them before diners see a change. Design approval enables none
  of these production capabilities.

Implement routine work inline with failing behavioral tests first. Before every push, run the
full touched-package and dependent-package suites; run the whole workspace only for shared
configuration changes. Require normal hooks and current-head CI. The amendment records the
approved contract; the partial runtime above does not complete joint proof or release qualification.

## Initial focus

- Launch first in Spain on AWS. AWS documents Europe (Spain) as `eu-south-2` and
  lists candidate services for the initial architecture, but no Waitron account or
  resource has been configured. Use the [launch evidence boundary](launch-evidence.md)
  to select each service against the adopted residency policy before provisioning.
  Preserve support for other countries and Google Cloud in the design; implement and
  validate those deployments later.
- Make routine customer journeys self-service, aiming to operate without a dedicated
  support team. Cover setup, account management, billing, troubleshooting, backup
  recovery and cancellation with clear status, actionable errors and safe retries.
  Reserve staff intervention for exceptional cases; avoid required manual support steps.
- Build around one owner connecting one venue, or adding several venues in the same
  city. Keep the usual connection flow to one action that verifies both Cloud and
  local permissions.
- Remote access covers owners and staff plus customer-facing pages such as menus
  and bookings. Temporary unavailability is acceptable when the venue server or its
  internet connection is down. The public gateway now returns a concise English or
  Spanish unavailable page, with light/dark and phone layouts, a retry link, a
  30-second retry hint and no caching. Clients requesting JSON receive a generic
  error with the same 503 status. Real HTTP and Chromium tests cover failed venue
  responses, lost connections, language/content preferences and all eight visual
  states. Wider route permissions, cloud copies and offline booking acceptance
  remain open.
- Complete self-service recovery onto a replacement server without routine staff assistance.
  The local continuous and verified-snapshot paths now share a matching-code owner
  approval flow. Continuous recovery freezes verified pointer evidence and releases a
  bounded recovery kit; snapshot recovery uses scoped download authority. A separate
  owner-confirmed Cloud replacement issues fresh installation and tunnel keys.
  Production activation remains separate work.
  Use Cloud-managed recovery keys by default for the stream and managed snapshots:
  an authorised owner must not need the original server or a separately saved backup
  key. Preserve the existing owner-held key model for customer-managed archives.
  Normally restore the latest recoverable continuous Litestream backup. Retained
  snapshots provide point-in-time archives and recovery if continuous backup data
  disappears. Start with daily snapshots retained for 30 days and monthly snapshots
  for 12 months, plus longer paid retention for selected snapshots. Validate costs and
  define prices, schedule details and continuous-backup retention. Show backup health
  and alert on interruption.
  While the backup subscription is active, protect the last verified snapshot from
  automatic expiry and mark it as out of date when backups stop. Verify a new snapshot
  before allowing it to replace the protected copy.
- Terminate public HTTPS in Cloud for bot and request inspection, then encrypt the
  onward connection. Keep staff traffic encrypted to the venue through a separate
  hostname using TLS passthrough, with network and connection controls in Cloud.
  Test that the public route cannot expose staff functions; define limits and monitor
  false positives. Staff application-level filtering remains at the venue.
- Provide assigned or customer-owned hostnames and automatic Let's Encrypt certificates.
  The durable local reconciler now issues and renews both certificate kinds through the
  existing DNS/ACME adapter contract and publishes signed cell routes. Repeat this with
  live provider DNS, production key storage and deployed workers. The signed Cloud
  CSR/chain transport and database staff reconciler are implemented locally; Waitron
  still needs the durable client and automatic install/reload path described in the
  integration contract. The private key remains in Waitron.
  Prefer local DNS overrides so the registered staff hostname and venue certificate
  work on both LAN and internet paths. Define router-specific setup, address stability,
  resolver recovery and initial bootstrap. Test fresh local connections without internet.
  Google Wifi may require a local custom DNS service, adding a network-wide DNS dependency.
- Evaluate Plex-style public DNS names resolving to private LAN addresses as an option
  that can reduce customer configuration. Test certificate trust, local/remote address
  selection and router rebinding protection. Require a verified offline connection
  path after restart and DNS-cache expiry; local DNS overrides remain the preference.
- Place venues independently in cells, with a shared remote-access gateway per cell
  and separate venue tunnels and credentials. Keep customer-facing addresses stable
  when moving venues. A short remote-access interruption during cell replacement is
  accepted; define the recovery-time target and prove the replacement procedure.
- Keep stored backups and portal recovery independent of gateway machines. Test
  recovery with the gateway absent. Keep account management separate from traffic
  handling so a portal outage does not immediately interrupt established connections
  or backups; define credential expiry and revocation during that outage.
- Keep support for multiple legal businesses and countries in the underlying model.
  Detailed international administration, separate-approver workflows and ownership
  transfers can wait until needed. Each venue belongs to one organisation at a time.

## Free services for open-source Waitron

Provide address lookup and transactional email delivery to open-source Waitron users
with a Cloud login, without requiring a paid subscription. Keep setup self-service.
These services should make ordinary account and address tasks easier even when a
venue does not subscribe to remote access or backups.

- **Address lookup.** Offer free geographic address lookup and completion to help
  fill out addresses correctly. The [2026-09-30 scope note](address-lookup-scope.md)
  compares provider terms, cost scenarios, Waitron field mapping and account metering.
  Its 2026-10-16 Spain measurement fixes 40 public/synthetic cases before testing:
  Google selects 22/28 supported cases, Geoapify autocomplete 17/28 and CartoCiudad
  3/28 under a conservative first-result mapping. None reaches the proposed 95%
  gate. The item counters are 78 Google, 80 Geoapify and 41 CartoCiudad attempts,
  including one conservative documentation probe; no retries or customer data.
  The harness, corpus, per-case scores and component/latency tables are retained;
  raw provider responses are local-only and deleted at landing. The later
  [terms check](address-lookup-scope.md#google-can-propose-an-address-you-must-confirm-what-you-keep)
  identifies Address Validation's conditional confirmation route for merchant
  fields; Places selection alone does not establish durable storage permission.
  The owner approved a larger residential/rural comparison. Its fixed
  60-address regional corpus compares unchanged and postcode-free queries, supplied
  versus postcode-derived provinces, and the first result versus presence in a
  bounded list. It retains the original request counters and manual-entry rule;
  its 120-query results retain the original reference fields and a separate rural
  municipality sensitivity check. With postcodes, complete drafts occur in a
  five-result list for Google 48/60, Geoapify autocomplete 36/60, geocoding 40/60 and
  CartoCiudad 0/60; the rural municipality alternative raises Geoapify geocoding to
  47/60 without new requests. Postcode omission gives CartoCiudad one complete draft.
  These regional, field-mapping results do not select a provider or prove setup
  integration. Cumulative attempts remain Google 363, Geoapify 320 and CartoCiudad 161,
  below 1,499 each, with no errors or retries in the second run. The owner's next
  preference is Google with Geoapify fallback. Its
  [proposed design](superpowers/specs/2026-10-16-address-suggestions.md) and
  [plan](superpowers/plans/2026-10-16-address-suggestions.md) specify explicit whole-address
  confirmation, provider-specific attribution, no shared response cache, ten
  confirmed selections per account per month and a zero-paid-usage budget. These
  are proposed defaults, not approved production allowances or configured key caps.
  Effective billing terms, accounted shared usage, operator quotas, Geoapify Free
  eligibility/storage rights, locality policy and joint Waitron setup acceptance
  remain release gates. The retained CartoCiudad audit agrees with published
  scores and the earlier parser fix; a new raw-response re-score is unavailable
  because both landings deleted those replies. No further provider call or
  product route/UI is added.
  The offline evaluation client now waits a full spacing interval when created,
  including after reopening its durable journal. A controlled 150 ms reservation
  delay reproduces a restart dispatch less than the original 90 ms test bound;
  the new guard passes that bound without changing allowance, retry or deadline
  checks. CI run 38950506223 failed the original restart-spacing assertion, but
  retained no write/dispatch stages, so its exact trigger remains unproved.
  No provider request is needed for this fix. Further offline timing qualification
  remains: a review probe with a journal timestamp 500 ms ahead waits 607 ms, but
  a 30-day offset overflows Node's timer and dispatches after 15 ms (7 ms with the
  old constructor). A forward five-second clock jump after client creation also
  shortens a 100 ms interval to 43 ms. Add an automated future-timestamp assertion
  and qualify clock shifts, oversized timer waits and overlapping calls before
  reusing this sequential measurement client for broader dispatch work. These
  follow-ups do not change the request budget or permit new provider requests.
  Keep manual entry and correction available when lookup is unavailable or wrong.
- **Transactional email.** Offer managed SMTP delivery for password resets and other
  account administration emails from on-prem Waitron. Scope the relay to these
  messages, authenticate requests and handle delivery failures and abuse. The existing
  Cloud email transport is a starting point. The [version 1 relay contract](transactional-email-relay-contract.md)
  now scopes installation/account grants, fixed templates, encrypted admission,
  retry versus uncertain acceptance, abuse limits, metering and customer status.
  The disabled local-proof grant and account reservation core is implemented, with
  PostgreSQL concurrency, revocation, rollover and process-restart tests. The trusted
  origin-verifier boundary has synthetic evidence tests only; implement and prove
  production domain/HTTPS verification before enablement. Signed submit/status/cancel
  and an encrypted queue now have opt-in local HTTP/PostgreSQL proof for retries,
  concurrent account reservations, key rotation/loss, cancellation and transaction
  rollback, including admission racing installation revocation/replacement. Normal
  startup keeps the routes absent. The separate local relay worker now handles
  bounded claims, expiry, keyed suppression and terminal ciphertext removal, with
  state/reason constraints. Its loopback-only SMTP proof covers temporary/permanent
  refusal, two-worker fencing, cancellation, key rotation/loss and uncertain delivery
  after disconnect or process death. Normal startup leaves it off. Retention policy,
  authenticated provider suppression events and provider spending controls remain
  open. Shared keyed recipient and stable-grant counters now enforce explicitly
  configured local budgets across independent HTTP processes. Migration 034 accounts
  for actual retained encrypted payload bytes, including sending and delayed work;
  clearing payload releases bytes without refunding message counts. Exact retries
  spend nothing extra. Local PostgreSQL proofs cover races, rollback, key rotation,
  deadline expiry during lock waits, worker cleanup and populated upgrades, including
  interrupted migration and separate pre-upgrade backup restore with external keys.
  See the [admission-bounds design](superpowers/specs/2026-10-12-relay-admission-bounds-design.md)
  and [local acceptance commands](transactional-email-relay-contract.md#exercise-shared-admission-bounds).
  Choose production budgets and recipient-key custody before enablement; normal
  startup still has no relay configuration. The immutable local policy deliberately
  refuses mismatched limits rather than resetting budgets. Policy replacement remains separate work. The
  [reviewed operator-stop design](superpowers/specs/2026-10-13-relay-operator-stop-design.md)
  and [implementation plan](superpowers/plans/2026-10-13-relay-operator-stop.md)
  cover durable local control. The stored flag and transaction API now pass
  focused PostgreSQL checks for committed stop/resume, missing-state refusal and
  shared-reader ordering. Migration 036 preserves populated release-35 account,
  factor and relay state through concurrent/repeated upgrade and interrupted
  rollback/retry. The trusted local stop/resume/status command validates every
  migration name and digest, returns one JSON line after commit and bounds database
  waits. Its subprocess/PostgreSQL checks cover failed commits, cancellation,
  preserved queue state and silent root/package forwarding. Two running HTTP
  processes now refuse new message IDs while stopped without relay spend, then
  admit after resume without restarting. Exact retries, status and cancellation
  retain current authority and byte accounting. Admission and stop races keep the
  shared control lock through commit or rollback, including a reader proceeding
  while stop waits. Two persistent local workers now pause claims and handoff
  independently, resume without restarting and retain paused queue rows and spend.
  A stopped handoff releases only its own queued claim. Messages already committed
  as sending retain their real SMTP result, even if the connection starts after
  stop succeeds. Stopped recovery still clears expired sending as uncertain and
  fences late replies; Cloud verification, password reset and venue alerts still
  deliver. The focused worker/account-mail command passes 125 checks, including
  observed lock waits, process restart, cancellation and held SMTP replies; 19
  deliberate breakages fail inspected assertions in a separate checkout.
  The explicit 35-to-36 rehearsal now passes all 28 version-3 checks: interrupted
  migration rolls back, every populated old row and complete ledger survives,
  stop persists across restart, and a separate stopped backup restores stopped.
  Matching external keys permit status, cancellation and exact retries; wrong or
  missing keys refuse, and resume delivers only to local Mailpit. A separately
  restored pre-stop backup initializes not-stopped after upgrade; the stopped source
  stays unchanged. Fifteen receipt/parser and eight real database/key breakages fail
  their assertions; restored proof passes with zero owned resources remaining.
  Packaged local install, restart and rebuilt upgrade also pass with 36 migrations
  and zero leftover resources.
  See the [trusted stop command](transactional-email-relay-contract.md#stop-and-resume-the-local-relay)
  and [version-3 rehearsal](database-recovery.md#rehearse-the-relay-stop-upgrade).
  Run `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec
  node --test --test-timeout=120000 test/relay-operator-stop.test.ts
  test/relay-messages.test.ts test/relay-admission-bounds.test.ts
  test/relay-disabled.test.ts` for the local admission checks.
  Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
  node --test test/relay-control.test.ts test/relay-control-migration.test.ts
  test/relay-control-cli.test.ts`. Measure admission-lock contention
  before production enablement: status, cancellation and retries share that lock.
  Separately queue Waitron's durable caller/status work before a joint
  local proof.
  Decide provider, processing location, account consent, allowance/debit policy and
  password-reset-limit behaviour before production. The source trace also found
  Waitron's profile-email catch logs raw exception text (`apps/server/src/me-api.ts`
  at `0fbcde001`); actual secret exposure is unverified. The Waitron caller item must
  use bounded diagnostics and test secret-bearing exceptions before integration.
- **Mobile notifications (candidate).** Consider a free allowance for mobile phone
  notifications. Choose the delivery channel and validate its costs before committing
  to inclusion; push notifications and SMS need separate cost estimates.
- **Per-user allowances.** Meter each service against the Cloud user account, enforce
  limits and show usage and remaining allowance. Define the allowance sizes, reset
  periods and behaviour at the limit, including password-reset delivery. Settle how
  venue-generated requests count against an account and prevent multiple installations
  from bypassing its allowance. The relay contract proposes one unit per admitted
  message. Shared account reservations now exist behind explicit local-only policy
  configuration; no production allowance is approved. Policy-version changes require
  a separately specified account upgrade path. Keep provider credentials in Cloud.

Low operating cost is an assumption to validate against provider pricing and expected
usage. Estimate costs and abuse exposure before setting allowances, and apply the
existing Spain-first residency preference when selecting providers. Next: resolve the
[address lookup scope note's](address-lookup-scope.md) storage, quality, cost and
account-allowance gates, then the authenticated email relay; evaluate mobile
notifications separately.

## Decisions in progress

| Decision | Next step |
| --- | --- |
| Customer model | Support an organisation with several legal businesses and tax identities across countries from the outset. A venue belongs to one organisation at a time. Focus signup on one owner with one venue or several venues in the same city; defer the ownership-transfer workflow. |
| Cloud staff access | The disabled-by-default [temporary support grant core](temporary-support-grants.md) now records a current owner's approval for a named, separately eligible platform account, exact configured actions, an optional venue, explicit expiry and early revocation. Transactional enforcement rechecks expiry, the original approver and platform eligibility around protected database work, while fixed audit events omit reason and request data. No route or production action is configured. Define platform roles, eligible permission and action catalogues, customer approver policy and the separately authorised emergency route. Possible on-prem SSH support still requires explicit server approval, a limited period and active-session termination on expiry or revocation. |
| Residency | Spain is the first deployment country. AWS documents the intended `eu-south-2` region, but region availability is not a residency promise. Define the policy for operational data, backups, archives, analytics, identities, logs, keys, messages and support access; map roles, providers, subprocessors, access locations, contracts and transfer safeguards before provisioning or making customer claims. See the [launch evidence boundary](launch-evidence.md). |
| Cells | Venues are independently placed, with a shared gateway per cell and stable customer-facing addresses on movement. The local two-cell workflow now stages a revision-bound destination, cancels a failed apply without replacing the source, requires a tested destination manifest sequence before commit, preserves hostnames/certificates and publishes newer source/destination manifests. Two 2026-09-26 Docker runs reconnected the fresh destination peer in 1,321 ms and 1,486 ms; the second receipt names clean head `e4f9356`, while the other venue stayed source-only. These are not production targets. Define group size, availability-zone layout and recovery-time objective; repeat movement with the selected gateway deployment, provider network, DNS/certificate reconciler and appliance automation. Keep backups and portal recovery independent of gateway machines. |
| Provider support | AWS is the first provider and `eu-south-2` is the verified regional candidate. Select the exact RDS, S3, compute, ingress, DNS, certificate, key and monitoring configuration in the real account; SES currently has no Spain endpoint, so administrative email needs a separately approved relay. Keep Google Cloud Madrid (`europe-southwest1`) as a future target that must pass the same service-by-service gate. Decide separately whether cross-provider failover is wanted. |
| Product packages | Remote access and backups are the initial paid services. Address lookup and transactional account email are planned free services for open-source Waitron with a Cloud login and per-user limits; mobile notifications remain a candidate. Define their release scope, bundles, usage limits, trial terms and cancellation behaviour after modelling operating costs. |
| Usage policy | Define lookup and other usage units, customer visibility, allowances and excess-use behaviour. Decide which measurements affect pricing and how retries, failed calls, cached results and batches count. |
| Waitron boundary | Signup inside Waitron, distinct Cloud and local staff logins, explicit identity linking and an independent Cloud portal are agreed. The signed matching-code exchange now requires live Cloud and local authority, binds one organisation per venue, handles retries and existing links, and issues renewable installation credentials. Keep the versioned contract and compatibility gates current; production configuration delivery, diagnostics and deployment remain open. |
| Server lifecycle | One guided replacement flow covers planned upgrades and server failure, preserving venue, subscription and customer-facing addresses. Use fresh installation credentials, verify restored data before trading, retire old credentials and follow Waitron's activation rules. Specify final-backup handover, concurrent requests, interrupted replacement and a returning old server. Define connection and standalone revocation, including the latter's effects on subscriptions, retained backups and reconnection. |
| Recovery promise | Specify tolerated data loss, recovery time and promotion authority for each service. Existing Waitron designs use human promotion; automation is not approved by this discussion. |
| Backup recovery | Self-service restoration is agreed; staff intervention is an exceptional fallback. Use continuous backups for the latest recoverable version and retained snapshots for archives or missing continuous data. Start with daily snapshots for 30 days, monthly snapshots for 12 months and longer paid retention for selected snapshots. Preserve the last verified snapshot against automatic expiry while subscribed, marking it out of date when backups stop. Use Cloud-managed recovery without a saved owner key; validate the inherited hourly stream snapshot/30-day retention baseline and define verification, schedule details, extended-retention terms and prices, and independent storage/deletion controls. Test recovery with continuous data absent. |

## Platform work to scope

- **LAN test Cloud with free and paid organisations.** The
  [test deployment design](superpowers/specs/2026-10-17-test-cloud-free-paid-design.md)
  and [implementation plan](superpowers/plans/2026-10-17-test-cloud-free-paid.md)
  describe a separate Cloud Compose project on the owner's test box, with an
  operator-set pretend plan and service checks enabled only for this test deployment.
  The organisation plan store and operator command now persist free/paid metadata,
  advance revisions only on changes and refuse incompatible migration ledgers.
  Real PostgreSQL checks cover concurrent updates, rollback and separate organisations;
  paid status leaves the disabled fiscal API unavailable. See the
  [operator commands](local-deployment.md#inspect-the-test-organisation-plan).
  The opt-in backup boundary now checks paid permission before provisioning,
  capture/publication, rotation, stream authority, recovery reads and replacement
  completion. Plan changes advance installation revisions atomically; downgrades
  clear paid setup and cached machine replies use current configuration. Explicit
  reprovisioning restores an existing location/stream binding without discarding
  objects or key versions. Test-mode expiry pauses while free, and admitted expiry
  holds policy through deletion. The backup worker CLI validates and forwards the
  test plan flag; ordinary completed replacement replies retain their original
  authority rules. Metadata/status/close and admitted verification
  remain available. Ordinary deployment permissions and retention stay unchanged.
  The [backup guide](local-backups.md#exercise-test-free-and-paid-plans) describes
  these checks and their lock order. Real PostgreSQL barriers cover provider waits,
  pairing, multiple installations, replacement and rollback. Keep organisation
  writes in the setter; two shared policy readers that both update their organisation
  can still deadlock while upgrading locks. No current service caller does that.
  CI also exposed an enabled Sign out button whose handler refused clicks while
  authenticator startup was pending. The three Sign out views now share the
  handler's existing pending-work gate. A held-response browser check covers both
  languages, themes and screen sizes without changing the original assertions or
  three-second waits. No fiscal policy changed.
  Opted-in remote permission now covers placements, moves, names, certificate
  submit/status, authorization and publication. Active/staged gateway routes and
  reconciler jobs share the current paid/test/provisioned eligibility set. Delayed
  signing/DNS results recheck policy; publication holds policy through the file
  replacement. Upgrading alone restores no route; explicit existing-placement
  provision restores cleared setup once. Public setup metadata remains readable.
  The account server CLI now validates and forwards the same mode; real listener
  tests cover free lifecycle masking and staff refusal, ordinary defaults and
  malformed-flag startup refusal. Fresh-health and direct-store forged-proof
  checks cover the account/status and authentication boundaries too.
  Remote eligibility currently scans the placed organisations and rebuilds target
  lists for current-work checks. Its array lookup and broad policy locking have no
  production-scale measurement; narrow that work before claiming larger capacity.
  A real two-peer Docker gateway proof withdrew the downgraded route/peer in
  4,053 ms while its paid neighbour still served its own body; wall-clock short-lease
  expiry and an expired-cache restart restored no access. This is local synthetic
  gateway evidence, not test-box deployment or the later client acceptance proof.
  A barrier test also excludes a new placement whose organisation was absent from
  that export's locked policy set; the next export includes it.
  The signed manifest schema and ten-minute authority maximum are unchanged.
  See the [remote test guide](local-remote-access.md#exercise-test-free-and-paid-plans).
  The isolated LAN HTTPS override, persistent private CA/leaf bootstrap, fixed
  capture mailer and dedicated test runtime are implemented. The runtime validates
  and forwards plan mode explicitly while translation stays off. Rendered Compose
  checks keep the backend unpublished, replace bindings and cap all container
  limits at 1,824 MiB. Real native-Mac Docker proofs cover trusted HTTPS signup,
  captured canonical links, independent proxy Host/Origin/header checks, restart
  identity, account replacement without restarting its proxy and owned stop with preserved volumes. They do not prove amd64 box
  deployment. The image-only driver checks platform, capacity, ports, network
  overlap, rendered bindings and recorded IDs; startup monitoring checks resource
  floors and existing Waitron health once per five seconds. Interrupted state with unrecorded IDs is refused; scoped Docker discovery and stop attempts survive a failed host inventory or state write. Cleanup that cannot reach Docker is reported as incomplete. See the [test Cloud guide](test-cloud.md).
  The owner-approved
  [backup-verification contract](superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md)
  separates data recovery checks from permission to activate a fiscal server.
  Its five worked cases and acceptance checks are a design, not runtime evidence.
  Waitron's separately owned interface is queued as A850 after A679; Cloud adapter,
  catalogue and recovery-version integration follows after A850 lands. Snapshots
  remain unavailable on this test deployment, and enforcement stays off until the
  implementation, evidence and release gates pass.
  The thirty-day leaf and one-year CA currently fail closed on expiry; same-CA
  in-volume renewal remains a maintenance follow-up. Continuous box supervision,
  coordinated image/schema upgrades and volume-to-volume rollback still need the
  final deployment slice; the driver refuses an image change meanwhile.
  Deployment enforcement is still off. Three remaining implementation slices,
  actual direct-storage withdrawal/fresh writers, LAN deployment,
  two-organisation acceptance and measured headroom remain open. The existing
  Waitron venue is quarantined; use a separate disposable Waitron test venue and
  leave its running containers and data untouched. Keep address providers disabled
  and the existing translation release gates in place. A free plan permits a
  service only after that service's independent prerequisites pass.
- **Translation worker lock-probe timing is now independently exercised.** The
  existing review-totals case put a PostgreSQL lock probe inside its fake HTTP
  response while the real client allowed 100 ms. A controlled 150 ms probe on
  landed base `050084752f1c57b00183582a2d16d33b0555f5e8` produces a provider timeout
  and three requests instead of the expected two. The probe now runs at the
  worker's provider-call boundary before starting that same HTTP deadline, with a
  deliberate 150 ms database delay. The original done/review totals, NOWAIT lock
  check and exact two-request assertion remain; both provider calls are probed.
  The earlier unexplained observations remain separate unless their exact trace
  matches this reproducer. No provider retry policy, production code or deadline
  changed.
- **Password-login recovery-row expiry setup.** The recovery-row test now starts
  its unchanged 500 ms challenge expiry after acquiring the row it will hold.
  A deliberate 650 ms setup delay reproduces the earlier missing-lock assertion
  with the old ordering and passes with this precondition. The 550 ms held-row
  wait, lock observation, zero sessions, one spent attempt, unconsumed recovery
  code and 30-second test deadline remain unchanged. No authentication code or
  policy changes. [Run 39112504573](https://github.com/waitron-io/waitron-cloud/actions/runs/39112504573)
  did not capture expiry/setup stages, so its exact historical ordering remains
  unproved. Capture those stages if the same assertion fails again; do not extend
  its authority window or test deadline to hide a failure.
- **Local package validation must avoid concurrent full-package groups.** Four
  two-file-worker groups overlapped during D79 and the registration control CLI
  exceeded its unchanged five-second command bound. A landed-base phase probe
  completed every node/root/package command in under 700 ms after reducing the
  overlap; acknowledgement-to-close took at most a few tens of milliseconds.
  This does not prove the cause of the earlier nine-minute stall. Run local full
  package suites sequentially with two file workers and retain the five-second
  assertion. Capture process/phase timings if it fails under that arrangement.
- **Local registration run stalls after earlier failures.** In the test-plan
  review checkout at `cc99eef378bd9db2716a2325cd07fbe491ab06c9`,
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration test`
  emitted failures and left its sole `relay-control.test.ts` child alive for more
  than nine minutes despite the 30-second test timeout. The driver stopped that
  recorded child. An isolated run of the same command on landed base
  `f56b4c8595ed3cb81d0931352c0bac2880648e18` reproduces PostgreSQL
  `out of shared memory` within seven seconds; it was stopped after that observed
  failure. This proves a baseline resource failure, but not the cause of the
  nine-minute child stall. Neither interrupted run is a pass.
  The review's default-concurrency account suite also emitted failures. Complete
  registration/account suites passed all 679/382 tests with two file workers on
  the corrected PR2 branch. PR3 passes 679/384 and runs full packages sequentially. Capture the full output of both default-concurrency commands,
  without piping it through `head`, and diagnose failure cleanup and resource
  contention. Preserve every assertion and deadline; do not treat a rerun as a fix.
- **Operating cost.** The [cost-model design](superpowers/specs/2026-10-14-cloud-cost-model-design.md)
  and [implementation plan](superpowers/plans/2026-10-14-cloud-cost-model.md) define
  how you can compare the AWS platform cost with no venues and the additional cost
  at 1, 10, 100 and 1,000 venues. Production resource sizes and availability choices
  remain assumptions. The priced model, offline calculator, private local sales
  replay, measured storage and remote traffic, and synthetic-only AWS comparison
  remain to be implemented. Keep raw venue data on the Mac, distinguish measured
  usage from extrapolation, and compare list-price usage separately from credits.
  Storage-only evidence cannot validate the fixed infrastructure or fleet capacity.

- **Future remote DNS lost-reply browser failures.** The reproduced reconciliation
  stall is resolved by [PR #102](https://github.com/waitron-io/waitron-cloud/pull/102).
  If the saved-name assertion fails again, use the bounded request/status events,
  injection stages and setup-screen diagnostics to identify and reproduce the cause.
  Keep the four-second assertion and fault-injection ordering checks unchanged;
  passing repeats alone do not explain a failure. See [the ordering receipt](#portal-lost-reply-test-ordering).

- **CI execution budget.** You can read one summary job and the individual package
  and receipt jobs to check a candidate. The summary also checks the plan's
  package allocation against the planner's registered package names and shard
  counts. Registration uses five partitions; account HTTP and portal use three
  each, and backups uses two. The summary requires every registration partition
  and rejects the former six- and seven-partition allocations. A Node subprocess
  check partitions copies of every current registration filename plus a new
  filename and requires each to execute exactly once. Its file workers run one
  at a time; overlapping fixture bodies fail on a shared scratch-directory lock.
  This checks file discovery; real package jobs must still report every test case.
  The reminder-worker cases live in `email-reminders.test.ts`, with their complete
  test bodies unchanged. The name places them before the worker-loop tests in
  Node's file allocation. Each file prepares its own disposable schema; every
  case and the 30-second deadline remain. Earlier five- and six-job layouts took
  313 and 348 seconds respectively and were not adopted. A later six-job split
  reached 259 seconds but used the same 23 rounded registration minutes as seven
  jobs, and its backup job failed the strict native-memory OOM check. The start
  ordering fix below addresses a reproduced mechanism for that failure.
  Matched case durations guide the five-job allocation; they do not prove its
  elapsed time or a saving. Require every registration job within 300 seconds
  and fewer than 23 rounded registration minutes on the exact candidate head.
  The wider target of 55 rounded minutes for a full run remains open.

  The relay-capacity test keeps its four SMTP deliveries open until all four
  competing worker attempts return without work. Its unchanged sending, queued
  and total-delivery assertions then describe one concurrent batch. A delayed-start
  control reproduces extra later deliveries when that synchronization is removed;
  the production worker limit and original deadline are unchanged. The original
  CI log did not record the worker schedule, so the exact host delay remains
  unmeasured.

  A shard is one partition of a package's tests. Removing a partition
  from both the plan and the job list cannot turn incomplete work green.
  Unknown packages, altered counts, invalid partition numbers and extra row
  fields fail; complete partitions and the existing short-package groups remain
  accepted. Each package in a short-package group must also emit a nonempty,
  consistent Node test summary and exit successfully. The runner reports its
  test, pass, skip and todo counts, keeps all output and continues with later
  packages after a failure. A zero exit without a summary, an all-skipped run,
  or a failed or cancelled test cannot pass. Plain and colored TAP and spec output are
  exercised with real Node test subprocesses; the package commands, deadlines
  and treatment of individual skipped or todo cases are unchanged. These counts
  establish executed work, not that the selected package contains every required
  test. An independent summary policy checks the execution contract; tests
  feed it every real planner package allocation and the full grouped plan, and
  compare its package names with the complete workspace inventory. Adding,
  removing or renaming a package, or changing its partition count, requires
  updating that policy. This validates allocation for selected packages;
  independently proving that every affected package was
  selected and resolving wider input selection remain open. No grouping or
  cost reduction is claimed by this guard. The reviewed
  [precise-selection design](superpowers/specs/2026-10-14-precise-ci-selection.md)
  and [implementation plan](superpowers/plans/2026-10-14-precise-ci-selection.md)
  define how documentation, scripts, configuration, resolved lockfile changes and
  receipt inputs can select their actual checks. The first implementation selects
  one Markdown check for a documentation-only change under `docs/` (excluding
  receipts) or at the repository root when both immutable trees match the audited
  non-document input inventory in `scripts/ci-input-audit.json`. The check reads the
  selected git blobs and requires valid UTF-8, no NUL and a final newline; deleted
  regular documents are accepted. Package Markdown, receipt data, mixed changes
  and missing or stale audit evidence retain the existing selection or full fallback.
  Adding, changing or removing an executable, configuration or other tracked input
  invalidates the exemption until you audit the readers again and renew the
  certificate. The planner now emits a prominent GitHub warning on every run when
  that audit is unavailable or stale, including non-document changes, with the
  [review and renewal procedure](ci-documentation-audit.md).
  The renewed audit covers CI reader/execution changes through #180; #144 was
  the first unrenewed input change. Fixture-only checks had missed the real-tree
  mismatch. Both immutable-tree checks and the conservative full fallback remain.
  The identity source map and gateway JSON reader remain covered by
  their existing full checks. When its input audit is current, an isolated change
  to `scripts/identity-upstream.mjs` or its behavioral test can select only syntax
  checks and that test, without
  package, receipt or compiler work. Both saved Git trees must match the complete
  other-input digest in `scripts/ci-input-audit.json`; a new reader, changed
  installation input, missing test, symbolic link or stale audit retains full work.
  The gateway-reconnection validator and its behavioral test have another
  audited exemption. Their script job checks both files and the measurement
  generator for syntax, then runs the unchanged validator tests. It does not
  launch the measurement generator. Both saved trees must match the gateway
  other-input digest, including the published receipt and generator. Changed
  readers or installation inputs retain full work. Each family pins the other
  family, so changes spanning both families also retain full work. The script
  inventories now share one strict policy, so renewing a fixed reviewed tree no
  longer makes peer certificates stale. Each mode keeps its existing content
  exemptions; damaged fields, stale base or head evidence, unknown paths and mixed
  changes retain full work. The
  [coordinated-audit design](superpowers/specs/2026-10-16-coordinated-ci-audits.md)
  and [implementation plan](superpowers/plans/2026-10-16-coordinated-ci-audits.md)
  describe explicit staged generation and committed four-mode checking.
  Historical receipt fixtures retain their independently pinned nine-manifest
  certificate and exact metadata assertions. Production validation independently
  discovers all ten current manifests, including translation and licence metadata.
  Saved dependency, execution, schema and deployment inputs are unchanged.
  Focused reader, fixture and renewal tests cover malformed policy fields, real
  file modes, symbolic links, submodules, missing manifests, staged/unstaged drift
  and committed-only checking. Complete committed-tree controls qualify all four
  inventories together, execute isolated document/script checks, and select the
  isolated lock importer with every receipt and compiler check retained. Mixed,
  unknown and changed-reader controls retain full work. The explicit generator
  never stages its output or follows a live policy link. Wider path selection,
  remaining receipt-audit renewal and job-duration work stay open. The planner
  still has unused API/fetch wrappers from historical merge reuse; remove those
  CLI-only wrappers while preserving its public function signature. Generation
  is a repository-root command; subfolder invocation refuses without writing.
  Its final generated-policy recheck remains defensive validation without an
  independent failure control; input-schema and admission guards are covered.
  Mixed changes also retain the existing fallback. The script job verifies the
  exact checkout and changed paths, and the summary requires its successful result.
  The identity audit covers that helper's only executable consumer, its own spawned test;
  the source-map default still takes the existing full route. Other root scripts,
  configuration and their real controls remain open. The immutable package graph
  also follows quoted references through shared JavaScript and TypeScript helpers
  outside package directories, including helper chains and cycles. It retains
  readers from both saved revisions, resolves directory index helpers and maps
  emitted JavaScript and JSX helper paths to TypeScript sources. Matching quote
  delimiters retain paths after apostrophes while the broader scan preserves
  paths embedded in generated fixture programs. Only reached helpers add package
  links. Every tracked JavaScript or TypeScript source is read as evidence, so an
  unreadable, linked or oversized source keeps all package tests even when it is
  not reached. Reading only reached sources remains an efficiency follow-up.
  This is not a complete resolver for computed inputs or root-file selection. A lockfile PR now reports
  which workspace dependency sets changed by comparing both saved revisions.
  The bounded version 9 parser follows indirect, optional and workspace-linked
  dependencies, retaining separate peer variants and their package metadata.
  Duplicate keys, missing or unused records, unsupported syntax and incomplete
  evidence cannot produce a partial comparison. YAML separation uses ordinary
  spaces; other Unicode spaces remain part of scalar values. The direct parser
  accepts at most two MiB, while production Git reads retain their one-MiB cap.
  Shared records are hashed once. The graph has a 500,000-visit limit and the
  complete comparison hashes at most 32 MiB of serialized input per lockfile.
  A lockfile PR, alone or with workspace manifest dependency edits, can select the
  affected packages and their saved source/helper
  consumers when both revisions match the complete other-input audit in
  `scripts/ci-input-audit.json`. Version 2 pins each manifest with its four dependency fields removed and every
  other tracked file, including installation policy, root readers and documentation. Any
  change to those inputs invalidates it until you review them again; follow the
  [lockfile audit procedure](ci-lockfile-audit.md). The selected packages
  include consumers from both saved revisions; all compiler and receipt checks
  still run. Root dependency changes, changed workspace membership, formatting-only
  locks, unrelated mixed paths, missing evidence and stale audits retain full work.
  Every changed manifest selects its package and its old/new consumers even if
  that edit does not change a resolved importer. Manifest scripts, package identity
  and every nondependency field stay audited. Version 1 remains supported for
  lock-only updates. This route still requires explicit reader review before
  renewing complete-input certificates. Receipt-selector test fixtures seed eleven
  saved audited dependency inputs, so an unrelated manifest or lock edit does not
  invalidate their positive test setup. Their original omission and refusal
  assertions remain; a separate real-clone regression changes every workspace
  manifest and the lockfile before running the four positive checks sequentially.
  It requires all four test names, so a passing file with no matching test cannot
  substitute for coverage. The saved manifest metadata must match its reviewed
  nondependency fields in the audit. The fixtures also seed the saved audited
  package runner and package-path resolver from
  `scripts/fixtures/ci-execution-inputs.json`. Separate real-clone checks change
  each live input and require all five original positive receipt tests to execute.
  Their assertions and the production audit pins stay unchanged; changing either
  real input still retains receipt work. Actual
  dependency changes still retain every receipt in the production planner.
  Fourteen root-test fixtures now disable automatic Git maintenance for their
  temporary repositories. Real-child checks trace each named original test,
  require that exact test and its commit to execute, and reject automatic
  maintenance or garbage-collection children. The original receipt, selection
  and reuse assertions remain unchanged. The checking process owns a separate
  process group and stops that group's remaining descendants when the check ends;
  a deliberately stalled test proves its worker is stopped after a timeout.
  In [run 38824736788](https://github.com/waitron-io/waitron-cloud/actions/runs/38824736788),
  262 of 263 root checks passed before database-input fixture cleanup failed
  with `ENOTEMPTY`. Local tracing confirms detached maintenance launches in the
  original fixtures, but does not establish that they wrote into the directory.
  Sixteen concurrent original-file review runs did not reproduce the failure.
  The change removes a confirmed detached background Git process from these
  fixtures; it does not establish the historical cleanup cause. Capture that
  directory's remaining entries and process activity if cleanup fails again.
  Four receipt-selector fixtures now use the planner's existing batch reader
  against their own temporary repositories. The local-stack and nested dependency
  checks previously launched 1,021 and 1,094 individual source-read processes.
  Tracing now requires zero individual source reads and exactly two batches per
  checked plan, while every original omission, refusal and maintenance assertion
  remains. Positive checks also reject a package-evidence fallback, so a broken
  batch cannot silently substitute a full package plan.
  Three concurrent complete root-suite runs reproduced both outer checks' former
  30-second timeouts. With batching, the local-stack check completes in 27.0 seconds
  under the same load. The nested dependency check completes in 58.2 seconds;
  its outer deadline is now 90 seconds because its four sequential workers already
  have a 60-second budget, plus repository setup and cleanup. Other outer checks
  retain 30 seconds, and the deliberately stalled worker still has five seconds.
  These are local stress measurements, not a guarantee under arbitrary host load.
  The same three-root overload still triggers the unchanged 35-second bootstrap
  observer in all three runs and the inner 60-second dependency-worker limit in
  one run. These are separate stress follow-ups, not resolved by the outer budget
  correction; retain their diagnostics and avoid overlapping full qualification.
  A later default-concurrency root run passed 322 of 324 checks and hit both
  limits again: the bootstrap observer after 35.18 seconds and the dependency
  worker after 65.34 seconds including its outer setup. Review controls and
  package qualification overlapped that run. The precise cause remains unproved;
  retain both limits and their original assertions when investigating recurrence.
  A later review of the five-shard change also missed the 60-second dependency
  worker twice with the new discovery check, while its base and skipped-check
  comparisons did not. That small sample does not establish causality. The new
  discovery fixture now permits one file worker at a time; overlapping bodies fail
  on an exclusive scratch-directory lock. Keep the 35-second and 60-second limits
  and capture stages on recurrence; bounded fixture workers do not prove that the
  historical root timeouts are resolved.
  The original historical failures did not retain these exact stages; the controlled
  reproduction establishes the timeout mechanisms rather than their precise history.
  Evidence, earlier partial fixes and complete load-run outcomes are retained under
  `~/waitron-campaign-d/receipts/d69/fixture-child-timeouts/`.
  A separate forced-color package probe also exposed two strict CLI checks in
  `packages/remote-access/test/operator-cli.test.ts` and `reconciler-cli.test.ts`:
  Node's warning about conflicting `NO_COLOR` and `FORCE_COLOR` settings changes
  their expected error output. Running those files directly, without the grouped
  runner, reproduces both failures. Keep their exact error assertions; establish
  one consistent color environment before promising forced-color package runs.
  The parser's current-lock inventory check still pins 215 package/snapshot
  records and the original importer counts. A new dependency record needs an
  explicitly reviewed inventory update. The disposable
  [dependency-only control #164](https://github.com/waitron-io/waitron-cloud/pull/164)
  replaces the portal's resolved axe-core version with unchanged inventory counts
  and passes a frozen install. Its
  [exact-head run 38823958615](https://github.com/waitron-io/waitron-cloud/actions/runs/38823958615)
  runs only three portal groups (196 cases), all compiler checks, 263 root checks
  and all five receipt suites (225 cases). All seven successful jobs check out the
  exact head; documentation and script jobs skip. It uses 19 rounded job-minutes,
  a 320-second job span and a 288-second longest job, compared with 69, 352 and
  322 in the [full baseline](https://github.com/waitron-io/waitron-cloud/actions/runs/38817784178).
  That baseline's complete tree equals the scratch target. Planner, workflow,
  runner, summary and audit evidence are identical between target and control.
  The scratch PR is closed without merging, and its branches and worktree are
  removed. These are timestamp-based estimates, not invoices or a completed
  full-run budget claim. Broader dependency additions, other controls and
  wider lock/root
  selection, package precision and their real scratch controls remain open. Review follow-ups: the
  audit-version and inner path filters lack independent removal controls; other
  refusals currently mask their removal. The regular-file defenses have a paired
  removal control. Keep the refusal assertions when simplifying these redundant
  checks. Keep the renewal recipe's explicit manifest patterns aligned with
  discovered workspace members; a mismatch currently retains full work. Add
  changed manifest owners to the lock-specific reason when improving diagnostics;
  the preceding selected-package list already includes them. The plan also requires measured
  grouping to reduce the full run toward 55 rounded job-minutes while keeping
  each work job near five minutes. The historical D66/D67 full-run samples used 72 and
  73 minutes; these are timestamp-based rounding estimates, not invoices.
  CI still selects changed workspace packages and every package that depends on them,
  including test dependencies and direct sibling source/fixture reads absent from
  manifests. Package-only PR selection now reads source and manifest dependency links from both
  immutable Git revisions, preserving removed links and committed readers hidden
  by local edits. The existing quoted-path discovery also retains named, root-relative
  and uncertain sibling-template readers. Missing blobs, incomplete inventories,
  changed workspace membership or test commands, checkout attributes, links and
  tracked dependency overrides keep all package suites with a reason. Initial package
  selection remains a conservative floor; an independent receipt audit may still omit
  a receipt when its own immutable evidence holds. Workspace discovery
  currently recognises only the repository's two explicit package-directory patterns;
  other policies keep full work. The planner reads the required policy, manifests and source
  blobs in one Git batch per saved revision, deduplicating identical objects. It checks
  each object's identity, byte length, separator and content hash before using the source.
  The old one-MiB per-file limit remains; each batch also has a 64-MiB output limit
  and a 30-second deadline. Missing, malformed, oversized, slow or corrupt batch
  evidence keeps all package suites with a reason. Existing callers without a
  batch reader retain individual reads.
  Named shared subdirectories now retain every saved JavaScript or TypeScript
  descendant as a possible helper input. Directory readers can therefore keep
  their package consumers through helper chains and cycles, including files
  added or deleted between the two revisions. Exact directory boundaries avoid
  pulling in similarly named siblings; equivalent dotted and repeated-slash
  directory paths resolve to the same saved inputs. A real Node directory scan reproduces
  the formerly omitted portal consumer; saved-revision and batched-read checks
  cover old and new helper files, dirty local sources and paths with spaces.
  The actual portal-only and all-nine identity selections stay covered.
  Root-relative file paths also normalize dotted segments and repeated slashes
  before looking up package owners or shared helpers. Real Node imports prove
  that equivalent package and helper spellings load the same input; selection
  checks retain their direct and transitive consumers from both saved trees,
  even when local helper files have changed. The live workspace graph applies
  the same normalization to direct package paths. When `..` leaves an earlier
  package prefix, selection follows the actual destination and drops that false
  dependency. If an unresolved root-relative package template has no constant
  package owner after normalization, every package remains a possible input.
  Real imports and selection checks cover both directions across package
  boundaries and this uncertain template case. Both graphs use slash-based
  normalization. Every earlier assertion and reader-audit certificate is unchanged.
  This is a conservative source dependency rule, not evidence that every quoted
  directory is read at runtime. A bare quoted folder name such as `scripts` can
  select extra consumers even when it names a data field. Qualify actual reader
  operations before narrowing that rule. Direct `readdirSync(new URL(relativePath,
  import.meta.url))` calls without options now retain immediate root-level source
  helpers when the URL names the repository root. A real Node scan proves the
  loaded helper keeps its package consumer; saved-tree checks retain added and
  removed helpers, transitive consumers and dirty-checkout independence. A root
  command working directory alone adds no helper inputs, and a nonrecursive root
  scan does not traverse nested directories. The same rule now follows a simple
  `const`, `let` or `var` assignment of that URL to a raw JavaScript identifier passed
  directly to `readdirSync` without options, including a `: URL` type annotation
  or a later comma-separated binding in the declaration. Raw names now include
  accented and astral letters and the two join-control characters JavaScript allows
  within identifiers. Executed Node scans cover all four directory APIs. Saved
  readers retain immediate helpers and transitive consumers when reader and helper
  coexist in either saved revision, including added or removed helpers despite
  dirty local files. Root options still
  retain every package, including for audited lock changes. Unused bindings,
  different identifiers and non-root scans keep narrow selection in the controls.
  URL-variable names also retain those consumers when declarations or uses contain
  fixed-width or braced Unicode escapes. Different spellings of the same name are
  compared after decoding the escapes. Executed scans cover all four directory
  APIs, and saved-tree checks cover removed or added helpers, former transitive
  consumers and dirty local files. Recursive root options retain full package work,
  including audited lock changes. Unused bindings, different names, local scans and
  a command working directory alone stay narrow in the controls. The `URL`
  constructor and optional type label now also accept fixed-width and braced
  Unicode escapes, including mixed spellings and leading zeroes. Executed scans
  cover all four directory APIs; saved-tree checks retain old and new helpers,
  transitive consumers and dirty-checkout independence. Recursive root options
  keep every package, including for audited lock changes. Unused bindings,
  local reads, different variable names, unrelated constructors and a command
  working directory alone remain narrow in the controls. Simple declaration
  aliases of these URL bindings now retain immediate helper consumers too.
  The scanner follows alias chains in either declaration order, decodes escaped
  names and bounds cycles with a visited set. Executed controls cover all four
  directory APIs, comma-separated declarations and the supported URL type label.
  A trailing line or block comment can carry the line break that ends the
  declaration without a semicolon; those aliases retain consumers too. Both sides
  of an alias decode identifier escapes in the controls. Comments followed by an
  expression continuation can conservatively select extra work.
  Saved-tree controls retain old and new helpers, additions, deletions and
  transitive consumers despite dirty local files. Root alias reads with options
  retain full package work, including audited lock changes. Unused aliases,
  different scanned names, local reads and working-directory values stay narrow
  in the controls. Names are combined conservatively across scopes; this does
  not resolve binding identity, destructuring or other type labels. Bare later
  assignments now preserve these URL aliases too, including separate and chained
  transfers, escaped names, comments and parentheses around a bare assignment
  such as `(directory = original)`. Executed
  controls cover all four directory APIs, old and new saved helper readers,
  transitive consumers and dirty-checkout independence. Recursive root options
  retain full package work, including audited lock changes. Unused transfers,
  different scanned names, local reads, expression prefixes and working-directory
  values remain narrow in the controls. Assignment order and reused names are
  combined conservatively, so overwritten values can select extra work. Direct
  constructor assignments such as `let directory; directory = new URL(...)`
  now retain immediate helper consumers, including assignment chains, escaped
  names and constructors, comments and parentheses around an assignment such as
  `(directory = new URL(...))`. Executed checks
  cover all four directory APIs, saved old and new transitive consumers, dirty
  local files and audited lock changes. Root options keep every package; unused
  inputs, local reads and identifier suffixes stay narrow in the controls.
  Parentheses around a URL constructor or alias value now preserve immediate
  root-helper consumers, including nested parentheses, declaration and later
  assignment chains, comments, escaped names and the supported URL type label.
  Executed checks cover all four directory APIs, both saved revisions, transitive
  consumers, dirty local files and audited lock changes. Root options retain
  every package; unused inputs, local reads and alias property suffixes keep
  narrow selection in the controls. The scan combines names across scopes and
  can select extra work from overwritten values or inert text; it does not parse
  general expressions. TypeScript `as URL` and non-null `!` assertions,
  destructuring and logical assignment still need resolution. Executed probes
  in the preceding task loaded a helper through `as URL` and `!`, while both
  its captured base and candidate scanner omitted that consumer. Those forms
  remain explicit D69 gaps. Property assignments, inert comments or strings and
  unused default parameters can add a direct root input or alias edge and select
  extra work without a runtime directory consumer. Used default parameters and
  declaration assignment chains retain their consumers in executed controls.
  Planning cost for malformed comment-heavy sources remains unverified; this task
  qualifies the existing large valid-source scaling controls.
  Binding identity remains unverified, and reused names or inert text can retain
  extra work. An out-of-range escape inside an inert comment, such as
  `// readdirSync(\u{110000})`, also makes both scanners throw while Node accepts
  the comment. The package planner catches that error and keeps full package work;
  the probe does not qualify the audited-lock path for this malformed input.
  Storing a root command working directory alone adds
  no helper inputs. An existence check alone also adds no root helpers, and a
  shared helper scanning its own directory does not scan the repository root.
  This bounded scan can keep extra consumers when identifiers are reused; it does
  not resolve directory aliases precisely, other type annotations, computed
  assignments or other directory APIs. A reachable source mentioning `glob` or
  `globSync` now keeps every package. Package-only planning names that source
  in its fallback reason; lockfile planning can report a generic full fallback.
  Glob patterns, options and the default working directory remain unresolved,
  so these calls cannot justify dropping consumers. Executed Node scans cover
  direct/stored root directories, default working directories, absolute patterns,
  optional calls, `.call` and import aliases. Saved shared-helper readers in either revision keep this fallback
  despite dirty local files. The bounded source scan can retain extra packages
  for inert text or unrelated functions with these names; indirect scans without
  a named glob reference and precise input resolution remain open. Block and line
  comments now separate tokens in the supported directory calls and URL bindings
  just as whitespace does. Executed Node scans and saved-tree checks retain the
  loaded helper, its package consumer and transitive consumers from either
  revision despite dirty local helpers. Nonrecursive scans still exclude nested
  helpers, and comments cannot hide the full fallback for explicit root options.
  Line comments end at each JavaScript line terminator. Whitespace and comments
  between the tokens of `import.meta.url` now retain immediate root-helper
  consumers for all four directory APIs, directly or through a supported URL
  declaration. Executed Node scans cover block comments and every line-comment
  terminator; saved base/head and unchanged readers retain transitive consumers
  despite dirty local files. Audited lock changes retain those consumers too.
  Recursive root options keep full package work; non-root options and root
  command directories stay narrow in the controls. This remains a bounded source
  scan; other unsupported URL expressions still need qualification. The immediate-entry rule also covers `readdir` from
  `node:fs/promises`, `opendir` and `opendirSync`, directly or through a supported
  URL declaration. Executed scans retain the loaded helper consumer without
  traversing nested directories; saved shared-helper readers from either revision
  retain former transitive consumers despite dirty local files. A reachable
  `readdirSync`, `readdir`, `opendir` or `opendirSync` of a literal repository-root URL,
  directly or through a supported URL declaration, now selects full package work
  whenever explicit options are supplied. The same fallback covers ancestor scans
  and URL text containing query, fragment or percent-encoded syntax that this path
  resolver does not interpret. When this prevents narrow selection, the planner
  names the source path:
  unresolved options may enable recursion and cannot justify dropping a nested
  helper's package consumer. Real recursive, directory-entry, encoding and computed
  option calls, saved readers from either revision and shared-helper directory
  depth are covered. Query, fragment, encoded-dot and ancestor runtime checks keep
  enumeration inside an owned directory. Calls without options retain their immediate-entry rule;
  options on a helper's own non-root directory do not imply a root scan. Resolving
  options precisely remains open. A reachable `readdirSync`, `readdir`,
  `opendirSync` or `opendir` renamed with `as` now keeps all package suites and
  names the source path in the planner's reason. The renamed call can load a
  helper without spelling a directory API at its call site. Executed Node scans
  prove that consumer, while saved-tree and batched-read controls cover readers
  from either revision despite dirty local helpers. Unreachable alias helpers
  retain narrow package selection. Block and line comments before `as` also keep
  the fallback. Quoted import names and escaped alias tokens also keep all package
  work; real Node checks cover both quote forms, Unicode and hexadecimal escapes
  and a quoted line continuation. The scan does not decode or execute source text.
  Escaped tokens are consumed before checking their adjacent `as` suffix, avoiding
  repeated scanning of ordinary backslash-heavy strings. The saved-source regression
  reproduces the earlier five-second timeout; a local fixed run completes in 0.48
  seconds with 100,000 backslashes. Unrelated later `as` text does not turn a token
  into an alias.
  It can select extra work for inert text, unrelated names or an escaped alias
  for a different import. Reachable directory API names followed by optional
  access, member access or computed member access now retain all package suites
  and name the saved source when the package-revision branch falls back.
  The lockfile path also retains full work, with its existing generic reader reason.
  Real Node calls cover optional
  invocation, `call`, `apply`, `bind`, computed `call` and comment-separated access
  for all four directory APIs, including TypeScript non-null assertions.
  An unchanged-reader lock control retains every package; its reader-free control
  still narrows selection. Saved-helper controls retain both revisions and
  transitive consumers despite dirty local files. An unchanged saved helper also
  triggers the package planner guard; unused helpers keep narrow work.
  This conservative rule can also select extra work for inert text or unrelated
  members. Direct TypeScript non-null calls such as `readdirSync!(directory)`
  now also retain every package suite: an assertion does not change the function
  Node invokes, but previously prevented the direct-call resolver from seeing its
  directory. Executed Node checks cover all four APIs, repeated assertions and
  block comments before and after assertions. Saved-reader checks cover either
  revision and unchanged shared helpers, transitive consumers and dirty local
  files; the lockfile control retains full work while its reader-free control
  still narrows selection. Unreachable helpers keep narrow package work.
  Precise alias resolution, assignment/destructuring aliases, escaped
  bare API identifiers and other unsupported calls remain open. Directory reader names
  wrapped directly in parentheses now retain every package suite because wrapping
  the function leaves its runtime readers unchanged. Executed Node controls cover all four APIs,
  nested parentheses, TypeScript assertions, optional invocation and comments.
  TypeScript `satisfies` and generic-type references, including unparenthesized
  generic calls, also retain full package work because Node erases their types.
  Saved-helper controls cover either revision, unchanged readers, transitive
  consumers and dirty local files; lockfile controls keep full work for the reader
  and narrow work without it. Unreachable helpers still keep narrow selection.
  The closing-parenthesis fallback is conservative: inert text and passing a
  reader as an argument can also select extra work. Directory readers stored as
  the first, final or simple middle array element now retain every package suite; indexing the
  array preserves the function that Node invokes. Real Node checks cover all four
  APIs, nested arrays, comments, trailing commas, TypeScript assertions and `at`.
  Saved-helper controls cover either revision and unchanged transitive consumers
  despite dirty local files. Audited lockfile controls retain full package work
  with these readers and narrow work without them; unused helpers stay narrow.
  These guards can also select extra work for inert text or unrelated names.
  Simple middle elements retain full work with all four APIs, comments, TypeScript
  assertions and indexed or `at` calls. Saved-helper controls cover either
  revision and unchanged transitive consumers; audited lock changes keep full
  work with a middle reader and narrow work without it. Unreachable helpers
  remain narrow. The middle-element guard requires an array opener so ordinary
  named imports preserve existing package isolation. Inert text can still select
  extra work. Logical and conditional operands adjacent to a directory reader
  now retain full package work: either branch can preserve the function for a
  later call. Executed Node scans cover all four APIs on either side of `&&`,
  `||` and `??`, both conditional branches, comments and TypeScript assertions.
  Simple namespace references such as `null || fs.readdirSync` also keep full
  work, including a comment-separated member in a conditional branch.
  Saved-helper controls retain both revisions and unchanged transitive consumers
  despite dirty local files; audited lock changes keep full work with these
  readers and narrow work without them. Unreachable helpers and ordinary named
  imports still keep narrow work. This bounded guard can select extra work for
  inert text, unrelated names and direct calls inside a branch or right operand;
  it does not evaluate branch conditions or resolve these calls precisely.
  Middle readers immediately after a nested array or object now retain full
  package work, including simple namespace references, comments, non-null
  assertions on the reader or namespace and optional namespace access. Executed
  Node controls cover all four directory APIs. Saved-reader
  controls cover either revision and unchanged transitive consumers despite dirty
  local files; audited lock changes retain full work with these readers and narrow
  work without them. Unused helpers and ordinary multi-name imports stay narrow.
  This closing-delimiter guard can also select extra work for inert text,
  unrelated names or function arguments. It does not parse arbitrary expressions:
  other nested predecessors and delimiter-bearing comments or strings remain
  unresolved. A directory reader reached through one namespace name after a
  simple array value, such as `[0, fs.readdirSync, null][1]`, now retains every
  package suite. The member may use `.`, optional `?.` access and non-null `!`
  assertions. Executed Node
  controls cover all four directory APIs, comment-separated members, non-null
  assertions and optional namespace access. Saved-helper checks cover either
  revision and unchanged transitive consumers despite dirty local files; audited
  lock changes retain full work with these readers and narrow work without them.
  Unused helpers and ordinary named imports still keep narrow work. This bounded
  guard can select extra work for inert text and unrelated names. Middle-array
  readers now also retain full package work through chains of plain member names,
  including `[0, fs.promises.readdir, null][1]` and a reader immediately after a
  nested array or object. Executed Node controls cover all four APIs through two
  and three member segments, comment-separated tokens, optional access and
  non-null assertions, plus native `fs.promises.readdir` and `opendir`. Saved
  helpers retain base, head and unchanged transitive consumers despite dirty
  local files. Audited lock changes retain full work with these readers and
  narrow work without them; unreachable helpers stay narrow. These guards do
  not resolve member identities and may select extra work for unrelated names
  or inert text, including multi-segment function arguments after a closing
  array or object delimiter. Middle-array namespace segments now also retain
  package work for Unicode, escaped and private names, such as
  `[0, ñs.readdirSync, null][1]` and `[{}, 0, this.#fs.readdirSync, null][2]`.
  Executed Node controls cover all four APIs, astral letters, join-control
  characters, fixed and braced escapes, optional access, comments and erased
  non-null assertions. Saved helper controls retain base, head and unchanged
  transitive consumers despite dirty local files. Audited lock changes retain
  full package work for simple and nested predecessors; unused helpers and
  ordinary Unicode namespace values stay narrow in the controls. These scans
  still do not resolve bindings or arbitrary expressions; inert text and
  unrelated members with directory API names can select extra work. Logical
  and conditional operands now retain full package work through Unicode,
  escaped and private namespace chains, including `null || ñs.readdirSync` and
  `false ? null : this.#fs.readdirSync`. Executed Node controls cover all four
  directory APIs, astral letters, join-control characters, fixed and braced
  escapes, comments, optional access and erased assertions. Saved readers from
  either revision and unchanged transitive helpers retain consumers despite
  dirty local files. Audited lock changes retain full work with these readers
  and narrow work without them; unused helpers and ordinary Unicode operands
  keep narrow package work in the controls. This conservative scan does not
  evaluate conditions or resolve member identities, so inert text and unrelated
  members with directory API names can select extra work. General expression
  parsing and precise directory resolution remain open. Quoted and commented
  predecessors now retain stored readers too, including
  `[';', ñs.readdirSync, null][1]` and `[[], 'a;b', ñs.readdirSync, null][2]`.
  Executed Node controls cover all four directory APIs, single/double/template
  strings, escaped quotes, comments and regular-expression character classes.
  Saved base/head and unchanged transitive helper checks retain consumers despite
  dirty files; audited lock controls retain full package work with these readers
  and narrow work without them. Unused helpers and ordinary values stay narrow.
  The additional scan masks punctuation inside complete literal-like tokens and
  preserves the original text as a separate scan. Repeated-regex and long quoted
  array checks bound the planner child; an isolation control prevents fragments
  crossing between the two copies. The first CI run passed all 1,336 root
  checks but hit the eight-minute job limit. The new reader fixtures now use
  their explicit four-package metadata and batched saved Git reads, avoiding
  repeated pnpm discovery without dropping cases or changing deadlines.
  That fixture optimization did not leave enough margin: the independent full
  merge run [39291389992](https://github.com/waitron-io/waitron-cloud/actions/runs/39291389992)
  passed all 1,336 root checks in 445.258 seconds, then cancelled the compiler
  five seconds after it started at the unchanged eight-minute job limit.
  The preceding green head took a similar amount of time. No assertion failure
  or platform cause was established. The unchanged local baseline passed all
  1,336 checks in 392.259 seconds with two file workers.
  Root checks now run in four separate jobs, using Node's round-robin file
  partitions and two file workers per job. They retain the original selectors,
  every case and every individual deadline; the compiler runs independently.
  The existing planner decision selects both the compiler and all four root
  jobs. The summary requires each root job exactly once, completed and successful,
  plus the successful matrix result. Missing, repeated, cancelled, skipped or
  unfinished work cannot establish success. Controlled workflow execution covers
  a future matching file, both additional selectors and failing checks.
  Each work job retains its eight-minute cap. Whole-run timing and the owner's
  five-minute work-job/about-ten-minute total goal remain D69 acceptance checks;
  a passing local run does not establish hosted-runner duration.
  It does not resolve template substitutions, division
  versus regular expressions, array membership or receiver identities. Unrelated
  expressions and inert text can select extra work; unsupported expressions can
  still hide real readers. Executed base/head planner probes cover division
  between the quoted value and stored reader, but do not establish completeness.
  Logical assignments (`||=`, `??=` and `&&=`) and awaited logical or
  conditional operands now retain every package suite. These operators can
  preserve a directory function until its later call, including
  `scan ||= ñs.readdirSync` and `null || await ñs.readdirSync`. Executed Node
  controls cover all four directory APIs, bare and private readers, comments,
  optional access, escaped namespace names, repeated `await` and erased assertions.
  Saved base/head and unchanged transitive helpers retain consumers despite
  dirty local files. Audited lock changes retain full package work with these
  readers and narrow work without them; unused readers and ordinary values
  preserve narrow selection in the controls. The scan remains conservative:
  it does not evaluate assignment conditions, resolve bindings or interpret
  arbitrary expressions, so inert text and unrelated API-named members can
  select extra work. Direct async calls after a logical operator, an object
  property colon or a switch-case colon can also select full package work;
  executed base/head planner controls confirm that additional work. Other
  expression positions and arbitrary predecessor expressions remain unqualified.
  Dot-member namespace readers stored as the first array element now retain
  every package suite, including `[fs.readdirSync, null][0]` and
  `[fs.promises.readdir, null].at(0)`. Executed Node controls cover all four
  directory APIs, one to three namespace segments, comments, optional access
  and erased non-null assertions. Saved-helper checks retain base, head and
  unchanged transitive consumers despite dirty local files; audited lockfile
  changes keep full package work with these readers and narrow work without
  them. Unused helpers, ordinary namespace values and named imports stay
  narrow in the controls. The scan does not resolve member identities or
  parse arbitrary expressions; inert text and unrelated members with these
  names can select extra work, including a reader used as a computed key.
  First-element namespace segments also cover Unicode identifiers, fixed and
  braced Unicode escapes, and private members such as `this.#fs`. Executed Node
  controls load real helper consumers through all four directory APIs, including
  `[ñs.readdirSync, null][0]`, astral letters and join-control characters.
  Comment-separated members, optional access and erased assertions retain that
  fallback. Saved base/head helpers and audited lock changes retain consumers;
  unused helpers and ordinary Unicode member values stay narrow in the controls.
  This lexical scan still does not resolve identities or arbitrary expressions;
  inert text and longer lookalike names such as `readdirSyncñ` can select extra
  work because its word boundary does not follow Unicode identifier rules.
  Other expression positions remain unqualified.
  Quoted computed members such as `fs['readdirSync']` now retain full package
  work for all four directory APIs, including double-quoted and plain template
  keys, comments, optional access, assertions on the object, key or result,
  parenthesized keys and stored references. Executed
  Node controls cover loaded consumers; saved-helper checks cover either revision
  and unchanged transitive consumers despite dirty local files. Audited lock
  changes keep full work with these readers and narrow work without them;
  unreachable helpers stay narrow. This guard does not resolve member identities
  and can select extra work for unrelated keys, arrays of API names or inert text.
  Keys whose first quoted token contains an escape before the next matching
  quote now retain full package work too: Unicode, hexadecimal escapes and
  line continuations can spell a reader without its literal name.
  Executed Node controls cover all four APIs, all three quote forms, comments,
  parentheses and erased assertions. Saved-reader checks retain either revision
  and unchanged transitive consumers despite dirty local files; audited lock
  changes retain full work with a reader and narrow work without one. Unused
  helpers remain narrow. The guard does not decode keys, so unrelated escaped
  member keys and inert text can also select extra work. A receiver check keeps
  plain escaped array values narrow, including arrays after `of` and `return`.
  Receiver matching covers plain names and closing call/index delimiters, with
  comments, optional access and non-null assertions; arbitrary receiver
  expressions remain unqualified. Computed keys without a literal API-name prefix
  or an escape in that first token remain unresolved. Executed base/final probes
  still miss consumers when the escape appears in a later concatenated string,
  a comma expression or a template nested inside the key's template.
  Parenthesized dot-member receivers such as `(fs).readdirSync` now retain
  full package work when the four directory API names are written without escapes.
  Executed Node controls cover
  optional access, comments, erased assertions, deeper namespace receivers and
  stored array references. Saved-helper controls retain either revision and
  unchanged transitive consumers despite dirty local files; audited lock changes
  retain full work with these readers and narrow work without them. Unused
  helpers stay narrow. The guard does not resolve receiver identities, so unrelated
  objects with these member names and inert text can also select extra work.
  Deeper member chains such as `(fs).promises.readdir` now also retain full
  package work when intermediate names use identifier characters, Unicode escapes
  or private names (the `#` prefix used inside a class). Executed Node controls
  include accented characters, `𐐀`, an invisible character allowed inside a name,
  both Unicode escape forms (including extra leading zeros inside braces) and
  private members, across all four directory APIs.
  This includes optional access, comments, non-null assertions,
  erased receiver assertions and stored reader references. Executed Node controls
  cover all four directory APIs and actual loaded consumers. Saved-reader checks
  cover either revision and unchanged transitive consumers despite dirty local
  files; audited lock changes retain full work with these readers and narrow work
  without them. Unused helpers stay narrow. Receiver and member identities remain
  unresolved, so unrelated objects and inert text with the same member spelling
  can also select extra work. Parenthesized chains now also retain full package
  work through bracket members such as `(ns)['nested'].fs.readdirSync`,
  `(ns)[key].fs.readdirSync` and ``(ns).nested[`fs`].readdirSync``.
  Executed Node controls cover all four directory APIs, optional access,
  comments, non-null and erased assertions, concatenated keys and adjacent
  bracket members. Saved-helper controls cover base, head and unchanged
  transitive consumers despite dirty local files; audited lock changes retain
  full work with these readers and narrow work without them. Unused helpers
  stay narrow. Keys are not evaluated, so unrelated objects and inert text
  can also select extra work. Closing brackets now also retain full package
  work through member chains, including `(ns)[keys[0]].fs.readdirSync`,
  `(ns)['nest[ed]'].fs.readdirSync` and unparenthesized indexed receivers.
  Starting at the closing bracket avoids interpreting nested keys. Executed Node
  controls cover all four directory APIs, optional access, comments, erased
  assertions and stored readers. Saved-helper checks retain base, head and
  unchanged transitive consumers despite dirty files; audited lock changes
  retain full work with readers and narrow work without them. Unused helpers
  and ordinary indexed access stay narrow. Receiver identities and keys remain
  unresolved, so unrelated objects and inert text can also select extra work.
  Intermediate bracket segments still exclude embedded brackets, but a later
  closing bracket can independently retain the reader. Other expression positions
  remain unqualified; this is not a general expression parser. Closing template
  backticks now also retain full package work through member chains: a tagged
  template calls a function with a template string and can return a directory
  reader, as in ```ns[key]``.fs.readdirSync(directory)```. Executed Node controls
  cover all four directory APIs, bare and indexed tags, parenthesized tags,
  comments, optional access, non-null assertions, substitutions, escaped backticks
  and chained tags. Saved-helper checks retain base, head and unchanged transitive
  consumers despite dirty files; audited lock changes retain full work with readers
  and narrow work without them. Unused helpers and ordinary tagged values stay
  narrow. The scan also matches opening backticks and backticks in comments.
  Template contents and receiver identities remain unresolved, so inert text
  and unrelated objects can select extra work. General template parsing and
  other expression positions remain unqualified.
  Nested array or object predecessors separated from a stored reader by
  ordinary elements now retain full package work too, including
  `[[], 0, readdirSync, null][2]`. Executed Node controls cover all four
  directory APIs, multiple intervening elements, namespace access, comments
  and erased non-null assertions. Saved base, head and unchanged helper
  checks preserve transitive consumers despite dirty local files; audited
  lock changes retain full work with readers and narrow work without them.
  Unused helpers, ordinary arrays and named imports stay narrow in the
  controls. The additional literal/comment scan now crosses punctuation inside
  complete quoted strings, comments and regular-expression-like tokens. Brackets,
  braces and semicolons outside those matched tokens still bound it. A division
  pair can be mistaken for a regex token and carry the scan across actual
  statement or array boundaries. It does not resolve array
  membership, template substitutions or receiver identities. Arbitrary expression
  parsing remains open. Inert text and unrelated
  expressions can select extra work, including text after a function body
  without a semicolon. An ordinary object expression and a semicolon
  before that inert text have separate package-isolation controls. The
  bracket exclusion still lacks an independent omission control; the earlier
  array guard also retains inert text inside arrays. General
  expression parsing and the wider reader inventory remain unqualified.
  Unicode escapes in dot-member names, such as `fs.re\u0061ddirSync`,
  now retain full package work. Node execution controls cover all four directory
  APIs, escapes at the start and end of a name, zero-padded brace escapes,
  comments, optional access and erased TypeScript assertions. Saved helper
  controls cover base, head and unchanged transitive consumers despite dirty
  local files; audited lock changes retain full work with these readers and
  narrow work without them. Unused helpers and plain escaped array strings
  stay narrow. The guard does not decode names or resolve receiver identities:
  any dot-member name with a Unicode escape, including unrelated names and
  inert text, can select extra work.
  Escaped bare names such as `re\u0061ddirSync(directory)` now retain full
  package work too. Executed Node controls cover all four directory APIs,
  fixed-width and zero-padded brace escapes at the first or last character,
  stored references, comments and erased TypeScript assertions. Saved-helper
  checks cover base, head and unchanged transitive readers despite dirty local
  files. Audited lock changes retain full work with these readers and narrow
  work without them; unused helpers and plain escaped string values stay narrow.
  The guard decodes names without resolving their bindings, so unrelated namesakes
  and inert text spelling a directory API can also select extra work. Other escaped
  identifiers and Unicode text stay narrow. It excludes an opening
  quote immediately before the name; strings with more complex contents and
  other expression forms still need separate qualification.
  Adversarial repeated delimiter/comment
  text can increase scan time; comprehensive parser performance remains unqualified.
  Semicolon-terminated stored references now retain full package work, including
  `const scan = fs.readdirSync;` followed by a later call. Executed Node controls
  cover all four directory APIs, bare and namespace references, comments, optional
  access and erased non-null assertions. Saved base, head and unchanged helpers
  retain transitive consumers despite dirty local files. Audited lock changes keep
  full work with these readers and narrow work without them. Unused helpers,
  ordinary named imports and ordinary stored values stay narrow in the controls.
  This lexical check does not resolve bindings or general assignment expressions;
  inert text spelling an API followed by a semicolon can select extra work.
  Stored assignment references now retain full work across line endings and
  comma-separated declarations, including `const scan = fs.readdirSync` followed
  by a newline and `const scan = fs.readdirSync, unused = 1;`. Executed Node
  controls cover all four APIs, bare and namespace references, comments, optional
  access and erased non-null assertions (`!`), plus CRLF, lone carriage returns
  and Unicode line endings. These controls exercise both the assignment check
  and existing reader checks. Saved base,
  head and unchanged helpers retain transitive consumers despite dirty local
  files; audited lock changes retain full work with readers and narrow work
  without them. The assignment check leaves ordinary named imports narrow.
  An exported reader also retains full work when the assignment ends at the end
  of its file, without a semicolon or final newline. Executed Node controls cover
  all four APIs, bare and namespace references, comments, optional access and
  erased non-null assertions. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes keep all
  package work with these readers and narrow work without them. Unused helpers
  and ordinary exports stay narrow.
  Inert assignment text can still select extra work; these lexical controls do
  not establish complete JavaScript or TypeScript parsing.
  Default-exported reader references, including awaited values, now retain full
  package work at the end of a file or across a line ending. Awaited assignments
  that export the stored reader later also retain full work in the controls.
  Executed Node controls cover all four directory APIs, bare and namespace references, comments, optional access and
  erased non-null assertions. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes keep full
  work with these readers and narrow work without them. Unused helpers, ordinary
  default exports and resolved directory calls keep narrow selection in the
  controls. These lexical checks do not resolve bindings; an unrelated namesake
  or inert text can select extra work. Precise resolution, general assignment
  and destructuring aliases, and other unresolved reader forms remain open.
  Class fields ending before `}` and arrow functions with a single expression
  now retain full package work when they store a reader. Executed Node controls
  cover all four directory APIs, bare and namespace references, static fields,
  comments, optional access
  and erased non-null assertions. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes retain
  full work with readers and narrow work without them. Unused helpers, ordinary
  fields and arrow values, and resolved directory calls keep narrow selection in
  the controls. The scan does not resolve bindings or parse arbitrary expressions;
  inert text and unrelated namesakes can select extra work.
  Block returns also retain full package work when a function or method returns
  the reader before its closing brace, including `return ns.readdirSync }`.
  Executed Node controls cover all four directory APIs, block-body arrows,
  ordinary functions, instance and static methods, awaited values, bare and
  namespace references, comments, optional access and erased non-null assertions.
  Saved base, head and unchanged helpers retain transitive consumers despite dirty
  local files; audited lock changes retain full work with these readers. Unused
  helpers, ordinary return values and resolved directory calls keep narrow selection
  in the controls. These lexical checks do not resolve bindings or parse general
  expressions; inert text, unrelated namesakes or a call continued on the next
  line can select extra work. General assignment, destructuring aliases and other
  unresolved reader forms remain open. Generator yields now retain full package
  work when they yield the reader directly, including `yield ns.readdirSync }`.
  Executed Node controls cover all four APIs, bare and namespace references,
  comments, optional access, erased non-null assertions, generator methods and
  awaited async-generator values. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes keep full
  work with readers and narrow work without them. Unused helpers, ordinary yielded
  values and resolved directory calls stay narrow in these controls. The scan does
  not resolve bindings or parse general expressions; inert text and unrelated
  namesakes can still select extra work. Object shorthand now retains full
  package work when it stores a directory reader, including
  `yield {readdirSync}`, `yield {readdirSync, n: 1}` and `return {readdirSync}`.
  Executed Node controls cover all four APIs, first/middle/final properties,
  nested preceding values and comments. Saved base, head and unchanged helpers
  retain transitive consumers despite dirty local files; audited lock changes
  keep full work with readers and narrow work without them. Static named imports
  are excluded from this shorthand check, including default-plus-named and
  type-only imports, comment-separated forms and the executed quoted-program
  controls. Generated objects still retain consumers in those controls. Unused helpers, ordinary objects
  and resolved directory calls stay narrow in these controls. This lexical scan
  does not resolve bindings or parse general expressions; inert text and unrelated
  namesakes can still select extra work. General aliases, destructuring and precise
  object/binding resolution remain open. Destructured reader bindings, named
  reader exports, quoted text such as `'{readdirSync}'` and generated import text
  with escaped quotes can still select extra work. Executed base/final probes
  record these conservative cases; precise binding and generated-code resolution
  remain D69 work. Call arguments ending in a comma now retain full package
  work when they transfer a directory reader. Executed Node controls cover all
  four APIs, first/middle/trailing-comma arguments, nested preceding values,
  namespace members, comments, optional access, erased non-null assertions and
  awaited values. Saved base, head and unchanged helpers retain transitive
  consumers despite dirty local files; audited lock changes retain full work
  with these readers. Generated programs, a transfer inside division tokens
  and division in neighboring arguments retain their executed consumers.
  The same context rule retains object shorthand between division-valued
  properties. Executed controls cover all four APIs there and a division followed
  by a path-string argument. Unused helpers, ordinary arguments, static
  named imports and resolved directory calls keep narrow work in the controls;
  separate inert quoted fragments cannot combine into a transfer. This lexical
  scan does not resolve bindings or distinguish parameter declarations and
  inert program text from executed calls, so those can select extra work.
  General alias, binding and generated-input resolution remain open; these
  controls do not establish complete JavaScript reader discovery.
  A broad review run reported one child-status assertion with `null` instead
  of zero, but its output filter lost the test name and child diagnostics.
  A later 1,600-check run passed; that does not establish the first failure's
  cause. Preserve complete TAP, the named test, child error/signal and output
  before changing any assertion or deadline on recurrence. The complete
  reader/object controls pass separately; no broad-load reliability claim is made.
  The object check requires a brace
  context, so array readers keep their existing diagnostics and comma-only text
  stays narrow. Each quoted program has its own delimiter context; separate inert
  fragments cannot combine into a reader. A division-like token can contain live
  code, so its body is also checked for a stored object reader. A valid
  12,000-import control executes in Node and keeps five repeated saved-revision
  plans, using the production batched Git reader, within one five-second child budget. The initial source-masking scan
  reproduced a timeout; ordered import ranges, token contexts and skipping
  ordinary quoted values without reader names pass that same bound. This does
  not qualify arbitrary parser inputs, nested generated programs or host load.
  A final element's trailing comma also keeps full work, including multiline and
  comment-separated forms. Saved-helper and lockfile controls independently exercise
  final elements, so the first-element guard cannot mask a missing final-element guard.
  TypeScript `as` wrappers already retain full work; the diagnostic can name an
  import alias or an indirect call, depending on the surrounding expression.
  Precise resolution and clearer reasons remain open.
  Existing assertions and reader-audit
  certificates are unchanged. Repository-root working directories, computed
  inputs, non-source directory contents and broader root-path selection remain
  unresolved. This does not complete the plan's dynamic input and directory rules. Identity still selects all nine packages in the current graph;
  portal alone remains isolated. Unaudited root, unknown and empty changes run everything.
  Type checking stays whole-workspace. The root command compiles the shared
  backend configuration once, then runs the portal and UI-smoke configurations.
  The seven backend package commands use the same root configuration, so repeating
  them does not check additional sources. The package-revision checks run in separate
  files discovered by the existing CI command, preserving every test
  body, assertion and fixture while allowing Node to run the files in parallel.
  This follows an eight-minute job cancellation after all 671 root checks and
  compiler checks completed; the test step alone took 457.9 seconds. The roughly
  five-minute job target still needs qualification. Real-compiler controls retain errors in
  every backend package, a newly added package, portal source/tests and UI
  declarations. A workspace inventory check refuses an unaccounted compiler
  command or configuration. Individual package commands remain available. Measure
  the full CI job before attributing any billed saving; the new behavioral checks
  also take time. The disposable real-tree review confirms backend test files
  still fail compilation when broken. Add that test-directory probe to the
  automated controls, which currently inject backend source errors only. Missing
  package compiler scripts and the equivalent `--project` spelling already fail
  the inventory or trace checks, but need clearer test diagnostics. Bootstrap setup now gives npm
  registry requests 15 seconds with one retry after one second, so a stalled
  tarball fetch cannot consume minutes before tests start. A real local `npm ci`
  against a held tarball request exceeds 35 seconds under the defaults and fails
  in about 31 seconds with these settings, after two attempts. The setup action
  receives this policy in every CI job; project installation, auditing and all
  test/job deadlines stay unchanged. This is a per-request limit, not a total
  bootstrap deadline. In run 38803777952, bootstrap npm reported a five-minute
  installation and the account shard was later cancelled before completing.
  Its log does not identify the slow request, so do not attribute it to a
  particular registry endpoint or to a product test. Preserve bootstrap timing
  and npm diagnostics if setup overruns recur. Package-only changes omit the two-venue milestone receipt when both immutable
  revisions retain its audited regular-file inputs, test command and CI wiring.
  These tests exercise validators and receipt composition; their guarded CLI
  blocks do not launch backend proofs when imported. Changed, missing or linked
  readers and unsupported evidence keep that receipt. Package-only changes also
  omit the backup-capacity receipt when both revisions retain its audited TLS
  fixture, two backup source files, validators, installation inputs and CI wiring.
  Root installation files and all tracked package manifests must match the complete
  audited inventory, so nested manifests, new install hooks or packages keep the
  receipt. Tracked dependency overrides under `node_modules` also keep it. Changed storage
  or transfer code still runs the real TLS checks. Package-only changes also omit
  the database-recovery receipt when both revisions retain its audited syntax-check
  targets, validator, migration-count helper, migration module, transaction helper,
  installation inputs and CI wiring. The suite checks syntax and validators; it
  does not execute the physical recovery drill. Changed imports or missing evidence
  keep the receipt. Any tracked `.gitattributes` file also keeps capacity and
  database-recovery checks: checkout encoding can change a reader without changing
  its stored Git hash. A fresh-clone control proves the UTF-16 import failure.
  The shared installation check preserves the earlier capacity guards.
  Package-only changes also omit the public-gateway receipt when both revisions
  retain its audited seven-module test closure, installation inputs and CI wiring.
  The tests exercise the real TLS gate, its fallback page and strict receipt
  validator. Changed gate/page code, helpers, test roots, commands, manifests,
  checkout attributes, install hooks or dependency overrides retain the checks.
  Package-only changes also omit the local-stack receipt when both revisions
  retain its audited deployment helpers, package readers, root script/test files,
  installation inputs and CI wiring. Whole deployment and migration directory
  hashes preserve wildcard test discovery and new directory entries. The tests
  exercise configuration, manifests, migration compatibility, operations metrics
  and validators; their child probes use controlled failures or supplied fixtures.
  They do not launch the deployed service stack. Changed or missing readers,
  new directory entries, installation hooks, attributes or overrides keep the checks.
  Unknown/full changes retain all five;
  portal source changes also omit local-stack when its audit holds, otherwise they
  retain it. Isolated ui-smoke needs no receipt. Registration
  uses five file shards, account HTTP and portal use three each, and backups uses
  two. Selected identity, operations and remote-access suites share one job when at
  least two are needed. Each keeps its full package command and deadline, runs
  once in sequence, and reports its own result. One PostgreSQL/Mailpit setup
  serves the group; a failure fails the job while later suites still run. The
  summary refuses malformed groups and overlapping package execution. Other
  packages keep one job each. Selected receipt suites share one
  setup and run in one job. The runner validates every selected suite before
  execution, runs each once and continues after a failure so later results remain
  visible. Any failed suite fails the job; the summary requires that job to
  complete successfully. The existing receipt-input audits also pin the grouped
  runner and its suite registry, because they now control execution. Changed or
  missing execution inputs retain the affected receipt. The five receipt commands
  and all their assertions stay intact. Compare actual rounded minutes with the
  preceding five-job sample before claiming a saving; the full-run budget and other grouping work remain
  open. Each file runs once, with its original
  assertions and test deadline. The authenticator clock-rollover case has its own
  portal file so sharding can separate its two real clock waits from the main
  authenticator journey. All work jobs have an eight-minute limit; the target is
  at most five minutes per job and about ten minutes for the whole run, including
  setup and queueing. Measure both the candidate and its merge before claiming the
  target is met.
  Browser packages install Chromium with at most two attempts, each bounded to
  120 seconds plus ten seconds to stop it. Main pushes use a unique concurrency
  group per run so a later merge cannot cancel an earlier merge's checks;
  superseded pull request runs still cancel. The workflow text guard checks shard
  completeness and deadlines. The summary checks actual job records against the
  plan, refusing missing, duplicated, cancelled, unfinished or failed required
  jobs, and any unexpected executed job. Unused job families must finish skipped.
  Every PR job checks out its exact
  head SHA. Every push to main runs the complete package, receipt and compiler
  suites, even when the merge tree equals a green pull-request head. This follows
  the owner's 2026-10-18 decision; daily-only main testing is withdrawn. Local
  regressions exercise the real planner and summary commands and both equal-tree
  and advanced-main squash merges without depending on the pull-request API.
  The reuse helper and its evidence checks remain historical controls.
  The planner explicitly disables setup-node's automatic package cache because
  it does not install dependencies. The lockfile control selected all 20 package
  jobs, then reproduced a missing-store failure in the cache-saving cleanup step
  ([run 38546606743](https://github.com/waitron-io/waitron-cloud/actions/runs/38546606743)).
  setup-node describes its input as “Set to false to disable automatic caching”
  ([action definition](https://github.com/actions/setup-node/blob/v5/action.yml), read 2026-10-14).
  Historical Actions controls proved portal-only selection (three nonempty shards,
  180 tests), identity's complete consumer set (all nine packages), and lockfile
  fallback (then all 20 package jobs and five receipts). The corrected cold-lockfile
  [run 38548997181](https://github.com/waitron-io/waitron-cloud/actions/runs/38548997181)
  passes all 28 jobs and all 1,477 package tests, including the added usage case.
  The [current scratch merge](https://github.com/waitron-io/waitron-cloud/actions/runs/38547672978)
  reuses its green head with only planner and summary work; the
  [behind scratch merge](https://github.com/waitron-io/waitron-cloud/actions/runs/38547920473)
  refuses reuse and passes the full suite. The portal head and its merge use
  18 + 2 = 20 rounded job-minutes, compared with the previous full-run pair's
  70 + 70 = 140. These are timestamp-based rounding estimates, not invoices.
  That historical backlog-bearing PR took the full route because mixed docs and
  code changes remain outside the narrow selectors. Its observed full head uses 72 minutes; adding the measured
  two-minute reuse gives a 74-minute pair estimate. The final production pair is
  recorded in the [PR evidence](https://github.com/waitron-io/waitron-cloud/pull/124).
  The simultaneous proof runs queued behind each other: identity took 13m54s
  overall, while every executed job stayed within 4m14s. Treat queue time separately
  from test duration and keep measuring normal runs.
  [Run 38500339948](https://github.com/waitron-io/waitron-cloud/actions/runs/38500339948)
  on `9bb8e8644d5ce9993fffa3f7ec13170d81de5ae4` took 9m45s in portal and
  9m02s in account HTTP before this split. The package logs counted 1,476 tests;
  compare the sum of every shard's count with each package's original count.
  Whole-package coverage must remain whole-package if a package later enables it.
  Before you push, run the complete suites of every changed package and its
  dependents locally; changes to shared configuration need all package suites.
  On an 18-core local runner, the unsplit registration suite exhausts PostgreSQL's
  shared lock table while resetting disposable schemas (`53200: out of shared
  memory`). For a full local package run, put `--test-concurrency=2` before the
  file list, for example
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-concurrency=2 --test-timeout=30000 'test/*.test.ts'`.
  The full unsplit account HTTP suite also reports PostgreSQL `53200` during
  disposable migration setup on this Mac: the D72 run completed 292 cases with
  82 failures, including the unchanged signup, origin, session and rate-limit
  fixtures. Use the same two-file limit for full local database package runs;
  retain every file, original deadline and portal build. A later parallel local Task 21 run
  also killed the unchanged npm-bootstrap probe at its 35-second deadline without
  retaining npm output. An isolated run passed in 31.36 seconds; that does not
  explain the earlier deadline. Capture process startup and request timestamps on
  recurrence, and preserve the original budget. A later D69 focused CI-script
  run passed 970 of 971 checks and reached that same unchanged 35-second
  bootstrap limit with no child output. The test and workflow match its base.
  An isolated instrumented copy passes in 31.4 seconds, with tarball requests at
  0.4 and 16.4 seconds. A controlled five-second npm startup delay reproduces
  the unchanged timeout assertion. This demonstrates that startup time can
  consume the remaining budget; the original run recorded no request stages,
  so its precise cause remains unproved. No bootstrap assertion or limit changes.
  Retain startup and request timestamps on recurrence. Local receipts are under
  `~/waitron-campaign-d/receipts/d69/nested-predecessor-readers/`.
  A failed fiscal HTTP
  fixture setup also left its local continuity-authority child open after the
  last test; the run printed its final failures after that recorded child was
  stopped. Make fixture construction close acquired resources on setup failure
  in `packages/fiscal-allocation/test/store-fixture.ts` and its HTTP wrapper.
  Keep the package's original test deadline and any build step. Appending the
  concurrency option to the package script leaves it after the files and does
  not limit this runner. The fixture's default lock capacity for a full local
  parallel run remains open; preserve every assertion when addressing it.
  A later bare `node scripts/test-postgres.mjs` run repeated `53200` in registration
  schema reset/migration, including authenticator setup; it reported 576 passes and
  72 failures among 648 result entries. The last relay-worker test process remained
  open with no remaining test-database sessions. Stopping its recorded process ID
  allowed the failure report and wrapper cleanup to finish. Qualify that fixture's
  failed-setup/resource cleanup separately; the exact remaining handle was not
  identified. The documented two-file command keeps every original assertion and
  deadline; the bare run's failure remains recorded.
  The residential-comparison bare run repeated `53200` in authenticator schema
  reset and reported 377 passes and 273 failures among 650 registration result entries.
  Its remaining `test/relay-operator-stop.test.ts` worker also needed an owned-PID
  stop before failure reporting and wrapper cleanup completed. The exact open
  handle remains unproved. The complete documented two-file suite then passes
  all 646 registration cases; that qualification does not close the unsplit-resource
  or failed-setup cleanup follow-ups. Diagnostics: `~/waitron-campaign-d/receipts/d76/`.
  The migration batch-size fixture now confines its database-wide DDL trigger
  to its own schema. A second populated fixture proves that other tests can
  migrate while it is active; the original 103-recipient and 100-row batch
  assertions remain.
  The usage privacy fixture now uses an owned organisation identifier distinct
  from the foreign-count marker `999`. A valid identifier containing those digits
  reproduces the old false privacy alarm; an added HTTP case proves that such an
  owned identifier remains allowed while foreign totals and credentials stay out.
  Every original privacy and ownership assertion remains unchanged. The natural
  local failure did not record the matching value, so its exact cause stays unproved.
  The pairing lock/expiry fixture prepares five seconds of valid authority, then
  waits on the database clock until that deadline passes before releasing its
  observed membership lock. A controlled 200 ms call delay reproduces the old
  100 ms fixture failure and passes with this setup. Every original refusal,
  observed-lock and rollback assertion and the 30-second deadline remain.
  Removing both mutually masking post-wait expiry checks fails the owning test;
  restoring them passes. The natural CI failure did not record entry timing, so
  its exact cause remains unproved. Production expiry rules are unchanged.
  The Cloud-approval session-expiry fixture also starts its five-second deadline
  after setup. It identifies the approval waiting behind its membership blocker,
  checks that the session is still valid, then waits on the database clock before
  releasing the lock. An outside expiry update would wait on the session row
  already held by approval. A controlled 200 ms setup delay reproduces the old
  observed-lock assertion failure; the corrected fixture retains that slow setup
  and passes. All
  original session-refusal, observed-lock and absent-approval assertions and the
  30-second execution deadline remain. Main run `39209023087` did not capture
  these timing boundaries, so its exact scheduling remains unproved.
  Other pairing expiry fixtures still observe any lock wait in their schema;
  identify their actual blockers before claiming that observation proves a
  membership-lock wait.
  This budget is separate from intermittent fixture failures; more time is not
  a diagnosis of a failing assertion.
  **Two fixture failures reproduced after the authenticator merge.**
  [Run 38373683976](https://github.com/waitron-io/waitron-cloud/actions/runs/38373683976)
  on docs-only `7860981` failed registration and portal. Advancing each clock read
  by one millisecond makes the relay worker fixture reject its lease: its separate
  `issuedAt` and `expiresAt` clock reads can exceed the one-hour limit. The worker
  fixture now reads the clock once. Its advancing-clock regression passes and
  restoring the separate reads fails; the production maximum and every existing
  worker assertion remain. The Spanish/dark/390 authenticator journey also failed
  at its first factor sign-in. A controlled rollover after enrolment reproduces the
  same timeout with a real 401: the journey's previous-step code then names the
  already-consumed enrolment step. The first sign-in fixture now uses a valid
  code for the next 30-second period, which the existing verification window
  accepts. A real browser/PostgreSQL regression observes the clock advance
  after enrolment, signs in with that fresh code, refuses the consumed enrolment
  code, then accepts an unused code from the previous period after the next clock
  advance.
  It fails with 401 before the fixture correction and passes afterward. All original
  journey assertions and the seven-second waits remain. The failed CI did not record
  its factor response or steps, so the reproduced mechanism does not establish that
  historical run's exact cause; collect the failing response on any future failure.
  **Server-startup fixture grouping.** The plan merge's
  [run 38375993173](https://github.com/waitron-io/waitron-cloud/actions/runs/38375993173)
  timed out in the single server CLI settings/missing-migration test after 30 seconds.
  Its unchanged local run takes 14.9 seconds; adding one second to each real child
  startup reproduces that timeout. Each missing migration now has its own named test,
  keeping all original refusal/ledger assertions and the existing 20-second child
  and 30-second test deadlines. The controlled slow-start run passes all 31 cases. Individual startup timings were absent from CI,
  so its exact failure cause remains unproved; use the named case on a future failure.


  **HTTP authenticator replay fixture.** The management journey retains the exact
  activation code for its replay refusal, instead of computing a potentially fresh
  code after the 30-second period changes. A previous-step enrolment variant
  reproduces the old `200 != 401` failure and passes with that correction. All
  existing replay, session, recovery-code and cookie assertions and the 30-second
  test deadline remain. The complete HTTP authenticator file passes 16 checks;
  bypassing replay refusal in a disposable checkout fails both management variants
  at their unchanged 401 assertions. Run
  `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec
  node --test --test-timeout=30000 test/authenticator-factor.test.ts`.
  [Run 38419110801](https://github.com/waitron-io/waitron-cloud/actions/runs/38419110801)
  failed that assertion. CI did not record the two code periods, so its exact cause
  remains unproved. Production authentication code and accepted code periods stay
  unchanged.

  **Registration authenticator replay fixture.** The registration-store enrolment
  test now retains its exact accepted activation code for the replay refusal,
  matching the HTTP fixture and the approved authenticator spec. A previous-step
  enrolment variant reproduces `Missing expected rejection` with the old fresh-code
  expression. The refusal code, every original assertion and the 30-second test
  deadline remain. No production authentication or accepted-window rule changes.
  PR run `39237311621` failed at `authenticator-factor.test.ts:86`; it did not
  record both code periods, so this reproduces a mechanism rather than proving
  that historical run's precise cause. Keep the explicit replay variant and
  investigate any recurrence with the consumed time-step evidence.

  **Local registration suite lock capacity.** Running the complete registration
  suite with this Mac's default 18 test-file workers exhausted PostgreSQL's shared
  lock table (`out of shared memory`, with `max_locks_per_transaction` hints).
  That run reported 486 passes and 198 failures across 684 reported cases; two
  stalled test processes and their recorded descendant required termination.
  The wrapper then cleaned up its owned database and mail containers. Qualify
  high-core local harness defaults separately; do not raise test deadlines or
  database limits to conceal this run. A bounded four-file full-suite run uses
  the same files, assertions, database settings and individual test deadlines.

  **One-second relay budget fixture.** The key-retirement and rollover tests now
  retry setup admissions at most ten times when the budget window ends before
  admission commits. They keep the one-second window and every existing assertion.
  A permanent PostgreSQL 1.1-second first-insert delay proves setup recovers only
  after the expired attempt rolls back; the complete relay-bounds file passes 34
  checks. Removing the production expiry guard in a disposable checkout fails both
  the slow-insert rollback assertion and the original rollover-refusal assertion.
  Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
  node --test test/relay-bounds.test.ts` for these checks.
  The design-only [merge run 38415818412](https://github.com/waitron-io/waitron-cloud/actions/runs/38415818412)
  failed at that expiry guard during first admission. A controlled delay reproduces
  the failure, but CI did not record window timestamps, so its exact cause remains
  unproved. Production guards and timing policies are unchanged.

- **Shared UI.** [Waitron PR #519](https://github.com/clintongormley/waitron/pull/519)
  implements `@waitron/ui-core` in Waitron with seven account controls, theme tokens
  and common helpers. Existing `@waitron/ui` imports re-export the same implementation;
  venue controls and brand delivery remain in Waitron. The runtime package depends on
  Lit rather than `@waitron/shared`. A built tarball installs outside the workspace and
  passes declaration, Chromium form, theme and accessibility checks. Both UI packages
  retain coverage and weekly mutation gates. The [approved design](superpowers/specs/2026-09-23-shared-ui-extraction-design.md)
  and [execution plan](superpowers/plans/2026-09-23-shared-ui-extraction.md) record the boundary.
  The [release workflow](shared-ui-release.md) published private `@waitron-io/ui-core@0.1.0`
  from Waitron `0a93f4d3557b669661ac8f589aad866e2cd9653f`. Cloud pins it in its
  manifest and lockfile; a Chromium fixture checks the installed controls and themes,
  and declaration checking uses `skipLibCheck: false`. Local installs use GitHub CLI
  authentication; CI uses its package-read token. The portal now uses these controls for signup, login and recovery. Read the first weekly mutation scores
  after the split in Waitron; the extraction verifies the wiring and coverage, not the
  new full mutation scores. The portal's primary-button hover override in
  `apps/portal/src/styles.css:13` keeps opacity at 1. English/Spanish light/dark
  accessibility checks pass 4/4 with
  `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 test/accessibility.test.ts`.
  A 2026-10-12 Chromium hover probe confirms axe checks the rendered primary button:
  the portal has no contrast violation in either theme, while restoring the shared
  0.85 hover opacity reproduces 3.61:1 in both light-theme languages. The workaround
  is already in Cloud; fix and release the shared hover style in Waitron before
  removing the override or claiming the private package itself is fixed.
- **Identity and organisations.** Password helpers and management-session behaviours
  have been adapted with a pinned source map, PostgreSQL tests, hashed session/CSRF
  tokens, passive polling and separate platform permission checks. Session-backed
  Cloud approval derives the account from the live session in its transaction.
  The signup backend now issues hashed, expiring email tokens with a shared per-address
  cooldown and creates a verified customer account, named organisation, first legal
  business and owner membership atomically. It grants no platform access. The email
  adapter is tested with capture/failure adapters and SMTP through local Mailpit.
  Password recovery now uses expiring single-use tokens bound to the account, email
  and current password hash; completion invalidates older links and revokes all existing
  sessions without changing permissions. Unknown/ineligible accounts and delivery
  failures receive the same accepted result. Notifications follow commit and cannot
  undo a successful reset. Recovery requires verified email and an existing password;
  define recovery for legacy unverified and passwordless accounts separately.
  Optional passkeys now use discoverable, user-verified WebAuthn credentials. You can
  add or remove one only from a live session with your current password and CSRF proof.
  You can sign in with a passkey without entering an email address, while password login
  and email recovery remain available. Durable five-minute ceremonies are single-use,
  exact-origin and exact-RP checks are enforced, and a real Chromium virtual authenticator
  proves enrolment, sign-in, replay rejection, account isolation and removal in English
  and Spanish. The account page now lists only your live management sessions, marks the
  current one and shows creation, last-use and effective-expiry times. You can revoke any
  session with a CSRF-protected, account-scoped action; uncertain replies reconcile from
  the passive list, and revoking the current session returns you to sign-in. Passkey rows
  show their nullable last-use time. English and Spanish Chromium checks cover phone and
  desktop layouts, stale authority, concurrent logout/revocation, account isolation and
  lost replies. The [bounded history cleanup command](history-cleanup.md) now previews and
  removes ended/expired sessions and consumed/expired WebAuthn ceremonies only after an
  operator supplies exact cutoffs; no retention period or automatic deletion is enabled.
  The disabled-by-default temporary support grant core reuses these separate customer
  memberships and platform permissions. It accepts only configured eligibility permissions
  and actions, binds an optional venue, expires and revokes grants, rechecks authority around
  protected PostgreSQL work and appends redacted immutable audit events. No HTTP route or
  production action is configured. Define the platform role, eligibility and action catalogues,
  customer approver policy, emergency route and any SSH session-termination contract before use.
  The [optional authenticator-app design](superpowers/specs/2026-10-12-cloud-authenticator-factor-design.md)
  has approved email recovery and session policies: password reset keeps the factor, and
  factor changes end every session. Its [implementation plan](superpowers/plans/2026-10-12-cloud-authenticator-factor.md)
  covers storage, account controls and browser acceptance. Storage, API and the bilingual
  portal, operational key rotation and private stack configuration are implemented locally.
  The populated 34-to-35 upgrade/restore rehearsal and packaged stack clean-install,
  restart, rebuild/upgrade and cleanup proofs passed with 35 migrations for the
  authenticator release. Current packaged proofs follow the selected release manifest.
  The identity primitive
  encrypts account/version/purpose-bound
  secrets and returns every matching adjacent time step; migration 035 persists factor,
  session-bound enrolment, challenge, hashed recovery and replay state. Focused PostgreSQL
  and cryptography checks cover constraints, ciphertext binding and preserved upgrade data.
  Password challenges now keep you outside a session until a valid authenticator or unused
  recovery code completes the check. Focused PostgreSQL tests cover concurrent completion,
  durable attempt limits, stale credentials, code reuse and expiry during database waits:
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test
  test/password-login.test.ts test/identity.test.ts`. Account controls now require your live
  session, current password and, for an active factor, fresh proof. Activation, replacement,
  removal and recovery-code regeneration end every session together. Email reset preserves
  the factor, unused codes and replay history but invalidates pending enrolments and login
  challenges. Session cleanup retains factor-referenced rows until a separate retention
  policy is approved. PostgreSQL checks cover concurrent changes, durable failed attempts,
  passkey access during key outages, reset during password derivation and expiry after writes:
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test
  test/authenticator-factor.test.ts test/password-recovery.test.ts test/passkeys.test.ts
  test/history-cleanup.test.ts`. The account API now returns a cookie-free second-step
  challenge after password proof, accepts a single-use factor completion, and exposes
  strict session/CSRF-protected account controls. Explicit factor policy supplies shared
  account, challenge and IP limits; IP refusals spend no account or challenge allowance.
  Separate factor keys and malformed-configuration handling preserve ordinary password
  login, passkeys and live account access during an outage. HTTP checks cover strict
  bodies, all session-backed route families, independent instances, real server restart,
  generic errors and cookie clearing after committed changes:
  `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test
  test/authenticator-factor.test.ts test/account-http.test.ts test/passkeys.test.ts
  test/account-security.test.ts test/rate-limit.test.ts test/server.test.ts`.
  The portal keeps challenges, setup secrets and recovery codes in tab memory. Its QR code
  is rendered locally. Successful changes show recovery codes once after signing you out;
  lost replies check your session without automatically resending the consumed proof.
  Browser checks cover English/Spanish, 390/1280 widths and light/dark themes: enrolment,
  replacement, single-use codes, email reset with the factor retained, independent passkeys,
  removal, cancellation, lost replies, keyboard focus, accessibility and temporary-state clearing:
  `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test
  --test-timeout=120000 test/authenticator-browser.test.ts test/authenticator-rollover.test.ts test/passkey-browser.test.ts
  test/account-security-browser.test.ts test/session.test.ts`.
  The [operator guide](authenticator-app.md) documents independent keys, explicit policy,
  account-first re-encryption and retained-backup custody. Rotation tests preserve versions,
  sessions and proof state, reject wrong/missing keys, and resume interrupted accounts:
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test
  test/authenticator-keys.test.ts`. The populated 34-to-35 receipt preserves credentials,
  sessions and synthetic passkey rows, proves migration rollback/retry and both incompatible
  consumer refusals, and restores factor state with matching/wrong/missing-key checks.
  `node scripts/schema-upgrade-receipt.mjs /tmp/cloud-factor-upgrade.json --old
  65c13f1402041931bdb244007f3cbc267ae61483 --new <full-implementation-commit>`.
  The historical upgrade defaults remain unchanged. The packaged stack proof passes
  on the complete implementation tree:
  `pnpm proof:local-stack`. Its receipt requires healthy services, retained data/identity,
  the selected release's complete migration manifest and zero leftover containers,
  volumes, networks or proof images.
  No production factor policy or key configuration is selected.
  Configure live email delivery and production factor policy,
  and define the wider platform role catalogue before public use. Shared login/request limits, secure
  cookies and Origin/CSRF checks are implemented in the account API. A local streaming
  reverse-proxy test now exercises two real account instances with overwritten client
  addresses, shared PostgreSQL rate limits, HTTPS cookie attributes, Origin/CSRF,
  declared and streamed body bounds, and the slow-body deadline. Validate the selected
  production ingress, TLS and bot controls before deployment. Choose
  legal and operational cutoffs for sessions, signup requests and password-reset requests,
  including reset records for unknown addresses, and measure the dry-run counts against
  the expected deployment size before applying them. Signup and password-reset completion now use an optional
  screening interface with a one-second failure deadline. Packaged production-server
  startup requires an explicitly supplied local
  SHA-256 corpus; compromised passwords are rejected in English and Spanish without
  consuming the link, and unavailable screening leaves credentials and sessions unchanged.
  No password or complete digest is sent externally. Choose, verify and operate the
  production corpus update source; any external provider still requires a separate
  processing-location and residency decision.
  Rejected portal URLs now keep their exact 400, 404 or 405 status and show a bounded
  English or Spanish error page. An expired session has its own fixed API code and a
  bilingual sign-in explanation, while an admitted request during service shutdown gets
  a distinct, retryable bilingual outage page. New connections can fail at the ingress,
  so deployment-wide outage presentation remains an ingress responsibility.
  Browser coverage completes a real Spanish password reset from a legacy query-token
  link and proves the token is scrubbed before later requests. Before public use, decide
  whether to accept tracking queries and trailing-slash/case aliases. The current exact
  routes and query restrictions follow the approved portal plan.
  Set the retirement point for legacy query-token links after every deployed sender
  generates fragments and all remaining query tokens have expired; retain compatibility
  until then. Direct development-mailer rendering failures now become rejected promises,
  matching the mailer interface; a regression reproduces the former synchronous throw.
  The PostgreSQL email queue now saves signup/reset messages and password-change
  notifications with their state changes. It encrypts recipients and tokens, retries
  at most eight times, expires links, fences late worker acknowledgements, and purges
  encrypted payloads on completion. Tests cover rollback, concurrency, worker crashes,
  lost keys, invalidated links and SMTP. The [production SMTP adapter](production-email-implementation.md)
  now uses verified TLS and authentication, closes timed-out/cancelled sockets, classifies
  retryable/permanent failures and stores stable Message-IDs on acceptance. Production
  requires explicit relay configuration; status checks need only database access.
  Invalid optional receipt metadata is discarded after a successful send, avoiding
  a repeat delivery; local tests cover cancellation before the socket opens.
  Prefer Spain for administrative email processing. SES has no Spain endpoint in the
  checked endpoint list; Acumbamail is a Madrid-hosted candidate, not a selected account.
  Next, select the provider and verify its processing locations, retention and tracking
  controls; configure the sender and prove live delivery. Implement authenticated
  bounce/complaint ingestion, suppression reconciliation and delivery alerts for that
  provider before public use.
  Separately supplied email keys now have a read-only dependency and decryption preflight,
  plus a local restart drill and documented rotation/restore order. Choose and operate the
  production key store, and retain each database backup's matching key set. A send timeout
  or crash after provider acceptance may duplicate an email. Terminal delivery metadata
  has an explicit cutoff category in the cleanup command; choose its production cutoff.
  Immutable customer security events now cover pairing approvals, installation credential
  renewals/revocations and recovery/replacement approvals in the protected action's
  transaction. Current organisation owners can export stable cursor pages through the
  exact session/Origin/CSRF-checked API; the fixed event shape stores no request payloads.
  This operational trail is not a complete compliance archive. Audit retention and
  account-deletion handling remain separate from transient cleanup. The HTTP adapter applies
  a 300 ms response floor to login/email requests, but deployment timing and load
  measurements must still assess account/cooldown differences under contention.
  Its rate key must be shared across instances; rotation starts new allowances.
  Login now checks its IP allowance before charging the email allowance, so an
  already-blocked IP cannot spend another person's address allowance. Admitted
  attempts across IPs can still exhaust an address allowance; assess targeted
  lockout mitigation with the public ingress policy before launch. A bounded local
  two-instance contention run admitted exactly 10 of 12 same-IP logins and 30 of 31
  same-address logins; the final correct-password attempt was refused. Across two
  isolated runs, eight concurrent scrypt hashes took 23 to 52 ms each on an 18-core
  Apple M5 Pro, while known and unknown failures remained above the 300 ms response floor.
  The counters did not overshoot, and eight concurrent password-reset requests queued
  one message under the shared cooldown. Keep these as local measurements, not
  deployment promises. Targeted address-lockout mitigation still needs the ingress
  policy rather than a blind quota change.
  HTTP tests now accept a password at exactly 1024 UTF-8 bytes, reject 1025 bytes
  without consuming the signup token, and reject a declared body over 16 KiB before
  an incomplete client finishes sending it. Deleting both independent password guards
  breaks the boundary test; deleting only the HTTP guard remains masked by the store's
  defence-in-depth check. Deleting the declared-length guard breaks its early-refusal test;
  the separate streamed-body bound remains covered.
  Review the inherited password cost for deployment. The [identity source review](identity-upstream-review.md)
  classifies every mapped Waitron source and test change through `b9440c685e44`.
  Cloud already covers generic refusals, asynchronous password checks and hashed sessions;
  registration now pins the offered and accepted passkey algorithms, with real-library
  regression tests. Run `node scripts/identity-upstream.mjs ../waitron` for later changes.
  Browser credential synchronization and passkey provider-name display remain optional follow-ups.
  Further reuse should take code and
  behavioural tests from `pre-sqlite-migration`, pinned to
  `c9d80c59a30ab1ae7a4acc0a6999e6a342de924e` in the registration plan. Adapt its
  PostgreSQL schema and dependencies; add cloud memberships and permissions for
  organisations that can contain several legal businesses across countries. Include Cloud staff logins
  and explicit links between distinct Cloud and local identities; local till staff
  need no Cloud account. Support one Cloud login managing several authorised venues
  and separate platform permissions. The temporary support-grant core now implements
  customer approval, configured eligibility, expiry, early revocation and redacted
  immutable events, with every action disabled by default. Define the platform role and
  action catalogues, emergency authorisation and the audit events not covered by the
  customer security trail before enabling it. Review
  database and module dependencies. Keep the source review current and port applicable
  security fixes with failing regression tests in each affected repository.
  **Review follow-ups.** An early deadline check in
  `packages/registration/src/authenticator-factor.ts` duplicates the final check;
  deleting the early check leaves all 41 management tests passing, while deleting the
  final check fails three late-expiry tests. Keep those behaviour checks when simplifying
  the redundant guard. You can sign in immediately after an authenticator change even
  when its ended-session read arrives late. The portal clears the old account from its
  controllers before showing the login form, so that read cannot cancel your new sign-in.
  Two controlled real PostgreSQL/Chromium cases show sign-in failing to complete
  after removal with a password and after a lost regeneration reply with a passkey.
  Removing the account reset restores both failures at the existing seven-second
  browser wait. The earlier English/light/1280 journey timeout and the two later
  CI failures were not traced to this precise reply ordering; keep that historical
  attribution open. Run `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node
  --test --test-timeout=120000 test/sign-in-session-race.test.ts`. Existing authentication
  checks, browser assertions and deadlines remain. If another timeout occurs, capture
  its request/locator stage and reproduce that cause before changing a check or deadline.
  The authenticator browser matrix retains recent response paths/statuses, headings,
  alerts, scoped IP counters and live session/factor counts when it fails, preserving
  the original exception even if collecting diagnostics fails.
- **Subscriptions and billing.** Service catalogue, checkout, invoicing, permitted
  services, usage accounting, trials, failed payment and cancellation.
- **Venue and node registration.** The agreed Waitron signup and connection journey is
  implemented locally. The Cloud account backend creates a new customer's organisation
  and first legal business. Signed matching-code pairing requires current Cloud approval
  to add venues and current local administrator approval, supports one person holding both
  permissions, enforces one organisation per venue, and handles existing links, renewable
  installation credentials, replacement and revocation.
  Keep venue identity stable across replacement and issue fresh installation credentials.
  Test that restoring data alone does not grant primary authority and that a returning
  old server follows Waitron's recovery rules. Cloud revocation alone does not establish
  that an offline server has stopped trading.
  The shared replacement flow for planned upgrades and failure recovery is implemented
  locally. Add the final-backup handover after stopping writes during a planned move.
  Failure recovery already shows the selected snapshot time or continuous recovery
  point and potential data loss. Approval requires confirmation that the old server
  is unavailable and acceptance of data loss; replacement separately requires explicit
  confirmation. PostgreSQL and HTTP refusal tests cover the server-side checks in
  `packages/backups/test/recovery-request.test.ts` and `replacement.test.ts`.
  These confirmations do not prove an offline server has stopped trading. Preserve
  Waitron's recovery rules; production activation and route-switch interruption
  checks remain open.
  Registration persistence now records bound approvals and results with transactional
  completion, expiry, retries, permission rechecks and separate service states. Real
  PostgreSQL tests cover concurrent workers and process restart. The Cloud pairing verifier and HTTP exchange now bind Ed25519 installation proof,
  matching code and session-backed approval, with durable guess limits and retries.
  The Waitron adapter and both browser screens now connect two real SQLite installations
  in the local integration runner. Renewable signed control leases and key proofs now
  authenticate machine operations; owner or local-manager revocation records its actor,
  reason and result. Desired revisions and stale health remain separate. Scoped storage/gateway adapters and owner-confirmed test-snapshot replacement are implemented locally; production rollout remains open. The owner approved matching-code confirmation between
  signed-in local Waitron and Cloud. The [pairing contract](superpowers/specs/2026-09-23-venue-pairing-design.md) fixes
  proof format, expiry, attempt limits and binding. Local tests refuse swapped installation
  proofs and recheck manager permission and serving-primary status after network waits. Installation history now retains superseded rows with one current installation per venue. Replacement binds the restored local venue and source node to the approved snapshot, uses fresh keys and has separate local-manager and Cloud-owner confirmation. Ordinary pairing refuses an unrelated installation, including a revoked current one. Expand diagnostics and planned-handover support before production rollout.
  Before public exposure, choose exact retention cutoffs for installation operation
  results and pairing requests, and define revocation-audit retention separately.
  The cleanup command handles completed/expired pairing and registration results in
  bounded chunks but enables no category automatically. Pairing approvals, credential
  renewals and revocations now have immutable customer audit events. Installation lease
  consumers now accept an operator-configured overlap of old and new issuer public keys,
  while new leases use only the active private key. The local control-plane outage drill
  proves overlap, cutover, expiry-before-removal and revoked-lease refusal without logging
  keys. Choose audit retention, rehearse the coordinated rotation in the selected deployment,
  and measure per-IP denial-of-service behavior
  for venues sharing NAT and known request IDs. Pairing codes now use versioned, request-bound keyed verifiers with an external
  secret and an explicit legacy upgrade; see [key configuration and rotation](pairing-code-keys.md).
  PostgreSQL/HTTP tests cover preserved approvals/history, restart, expiry, concurrent
  guesses, request binding and key overlap/refusal. Local business confirmation stays
  required. Old backups remain sensitive; no new retention policy is chosen.
  Backup-recovery request codes now have their own independently configured,
  request/machine-bound keyed verifier and explicit legacy upgrade; see
  [recovery key configuration and rotation](recovery-code-keys.md). PostgreSQL/HTTP
  tests cover storage, cross-request reuse, machine retry/status, owner approval,
  five concurrent-guess limits, expiry, process restart, rotation, absent/wrong keys
  and preserved pending/completed history. Upgrade rollback, bounded batches and
  row-lock waits and the actual CLI lock timeout are exercised; HTTP/CLI/audit
  checks disclose no code or secret. English/Spanish recovery browser tests pass.
  Before production, provision the separate keys, execute the stopped-writer upgrade
  and apply the existing retention policy to legacy backups. External proxy logging
  and production secret custody remain deployment responsibilities.
  Terminated database connections and lost replies have regression tests. The
  [local management-database recovery drill](database-recovery.md) now uses separate
  non-superuser migration and runtime logins plus a replication-only login. It takes a
  physical PostgreSQL 18 base backup, waits for a streaming standby to replay the named
  recovery point, stops the primary and promotes the standby. The clean 2026-09-27
  receipt at Cloud `072b2c0` confirmed zero lag at that point, a 158 ms local promotion
  and a 934 ms local outage on that run. It recovered the exact result and lease after a discarded
  committed reply, reclaimed an interrupted worker message once, preserved both tenants
  and rejected a crossed installation proof. These are fixture measurements, not service
  objectives. Repeat the drill with the selected provider's deployment credentials,
  backups, replication, routing, monitoring and realistic data volume before launch.
  Pairing and replacement now use venue locks compatible with monitoring's incident
  inserts. PostgreSQL race tests run the real monitor worker while a new pairing
  request waits on its installation lock: matching keys retain the existing link,
  and different keys return a registration conflict while the incident commits.
  A real PostgreSQL probe of two approved operations sharing one key and a genuinely
  new venue completed with one shared link, so the proposed race was not reproduced
  and gained no speculative regression. The adjacent existing-but-unlinked venue path
  did expose a coverage gap: a new test pauses the first installation insert, and
  deleting the venue lock reproduces a `registration_conflict` in the second operation.
  A separate bounded abuse run admitted exactly 10 of 12 concurrent new pairings behind
  one shared address across two API instances. Five guesses with unrelated UUIDs did not
  spend the target request's failure budget; five concurrent wrong codes against its
  known UUID serialized to five and closed it. That known-ID denial remains a deliberate
  guess-limit trade-off. Keep request UUIDs out of logs and choose ingress or reissue
  mitigation before changing the five-attempt rule.
- **Provisioning and placement.** Use Kubernetes for orchestration when needed;
  cluster provisioning and manifests are deferred until there is a service to deploy
  and a concrete operational need. Country/provider/cell registry, repeatable resource
  creation, recovery from partial failures, capacity and customer movement. The local
  movement state machine now reserves a destination without replacing the source, rejects
  competing/stale operations, retains durable retry results and revokes the old route only
  after the destination manifest was applied and tested. The two-cell proof preserves the
  venue's hostnames and certificate fingerprints, isolates the other venue and measures
  fresh-peer reconnections of 1,321 ms and 1,486 ms; it also proves failed-apply cancellation leaves the
  source healthy. The local DNS/certificate reconciler now preserves usable material,
  fences stale external work and republishes signed routes after restart. Repeat the full
  path with provider-native cells, live adapters and appliance configuration before
  choosing an explicit recovery-time target.
  Define how established connections and
  backups continue during a portal outage, including credential expiry and revocation.
  The [local control-plane outage drill](control-plane-outages.md) now stops the real account
  API process while a gateway HTTP route and TLS SeaweedFS transfer continue under their
  existing signed authority. It proves that cached gateway restart does not extend expiry,
  expired storage credentials are refused, recovery restores management access and a fresh
  manifest removes a revoked route. Repeat the drill with the selected deployment database,
  gateway reconciler and provider-native storage before setting an availability promise.
- **Provider integration.** Storage, compute, email, notifications, jobs, keys and
  telemetry, with AWS and Google implementations where needed. The local SeaweedFS
  storage contract now covers venue-scoped access, live key rotation, issued-credential
  expiry, versioning, interrupted uploads and concurrent conditional create/replace.
  The [Stockholm AWS sandbox rehearsal](aws-storage-rehearsal.md) now exercises those
  storage boundaries with real assumed-role credentials, PostgreSQL-backed archive
  publication/key rotation and real Waitron/Litestream restores. New S3 buckets need
  explicit SSE-C enablement for the existing stream format. Cloud must extend its
  managed-stream credential contract to carry and renew session tokens, coordinated
  with Waitron, before using assumed roles through that adapter. Repeat the deployment
  qualification in Spain and separately for Google; production custody, credential
  delivery, web identity, retention, monitoring and activation remain open.
- **Operations.** The [local operations status](operations-status.md) now combines
  control API liveness/readiness, queued work, monitoring, gateway, snapshot and usage
  evidence into versioned JSON, readiness exit states and low-cardinality Prometheus
  metrics. It reveals fixed component codes without tenant, provider or raw failure
  details. The [reproducible local deployment](local-deployment.md) now packages the API,
  durable workers, PostgreSQL, Mailpit, TLS object storage and empty-route gateway in one
  loopback-only Compose stack. Its executable receipt proves clean installation, restart,
  same-schema image recreation, the current release migration manifest, stable generated identity, retained database
  and storage markers, and exact-project cleanup. The [database recovery drill](database-recovery.md)
  separately proves a physical standby promotion under restricted local credentials, exact
  operation replay, worker-claim recovery and tenant isolation, with zero owned resources
  left after the run. Production deployment, provider selection, public ingress, secret
  custody, provider-native database recovery, automated failover,
  realistic recovery objectives and provider-specific recovery across incompatible schemas
  remain open. The [schema upgrade rehearsal](local-deployment.md#rehearse-a-schema-changing-upgrade)
  now covers pinned revisions 9a56d012 (26 migrations) to eafd97ad (27), interrupted
  migration rollback/retry, stopped-consumer schema gates, identity/tenant checks, pending
  mail and completed-operation retries, and isolated recovery of the old version from its
  pre-upgrade logical backup with matching external keys. The original upgraded fixture is
  preserved. Historical binaries require the current deployment gate; no online upgrade,
  downgrade migration, post-backup-write recovery or production traffic switch is proved.
  The physical standby drill reads its expected migration count from
  the release manifest for both migration and runtime logins. Focused tests cover
  complete manifests of different sizes, missing migrations and extra migrations.
  The original 2026-09-27 promotion receipt above remains historical; the new drill
  receipt is recorded in [database recovery](database-recovery.md). This remains
  separate from logical-backup recovery.
  Customer and operator portals, audit, budgets,
  quotas, staged releases, maintenance and recovery controls remain broader work.
  Customer portal login and account recovery must work when the venue server is
  unavailable, so customers can manage services and recovery independently.
- **Self-service journeys.** Define completion and failure paths for setup, account
  and billing changes, diagnostics, restore and cancellation. Verify customers can
  complete routine flows without staff, including recovery from interrupted operations.
  Give exceptional failures useful diagnostics for investigation under the support policy.
  Account security is now self-service: the portal shows active management sessions and
  passkey last use, identifies the current session, and lets you revoke a session without
  staff access. It refreshes the list after every attempt so a lost successful reply does
  not encourage a second write. Owners can now download a versioned diagnostic for one
  installation. It reports redacted access, service, monitoring, remote-check and backup
  evidence without account, provider, hostname, configuration, credential or raw-error
  data. Stale health is shown as unknown and the permission is rechecked before release.
- **Service monitoring.** Check representative operations from outside the affected
  cell; track errors, response times, queued work, backup freshness and capacity.
  Optional quiet periods and one still-open reminder are implemented with both timings
  disabled by default. Each incident opening captures its original recipients and fixed
  database deadlines. The portal remains immediate; brief incidents recover silently.
  Local PostgreSQL and independent-process tests cover concurrent delivery, current
  authority/evidence, late accepted-opening recovery, replacement/suppression/reopening,
  protected bounded cleanup and rollback of a second 100-recipient batch. Encrypted mail
  retains English/Spanish rendering and retries use one durable notification identity.
  A populated 36-to-37 rehearsal proves interrupted migration rollback, repeated/concurrent
  retry, unchanged old account/factor/relay state and both pre-upgrade and post-upgrade
  backups. Restored deadlines/recipients remain fixed and wrong/missing email keys refuse
  delivery. SMTP uncertain acceptance can still duplicate sends. The
  [design](superpowers/specs/2026-10-13-monitoring-quiet-escalation-design.md) and
  [plan](superpowers/plans/2026-10-13-monitoring-quiet-escalation.md) record the scope;
  the local packaged install, restart and rebuilt upgrade each use all 37 migrations
  and leave no project containers, networks, volumes or image. Production quiet/reminder
  thresholds, external checks, wider escalation and rollout policy remain open.
  The [local monitor](local-monitoring.md) now records missing contact, stale snapshots
  and failed verification for configured test installations. The portal shows incident
  evidence and stale monitoring; owners can opt in to English/Spanish email alerts.
  Durable transition records prevent repeated scans from enqueueing duplicates, with
  live ownership/preference checks before delivery and recovery notices for prior
  recipients. Queued notices use the current email language. Locked installations and
  failed observations defer their next check while other venues continue. SMTP uncertain-acceptance duplicates remain possible. A separate bounded
  functional probe now derives current authorised placements, solves the real public
  challenge, verifies staff TLS/hostname trust and persists revision-bound evidence
  with certificate validity while refusing private production targets. The monitor rejects
  late results after hostname changes, replacement or revocation, treats stale evidence as
  unknown, and records deduplicated route-failure, certificate-expiry and recovery
  transitions independently from installation contact. The local two-venue gateway proof
  now persists real observations while breaking one venue route and the whole gateway,
  proves recovery, stale/invalid-certificate handling, current control contact, portal and
  Mailpit evidence, cross-venue isolation and delivery deduplication, and emits a versioned
  timing receipt. The [paired gateway comparison](gateway-reconnection-measurements.md)
  now preserves key and endpoint while replacing a gateway with a 30-second-old
  peer handshake. Its unchanged-peer controls recovered in 105.912 and 105.845 seconds;
  one peer-originated ping recovered in 19.189 seconds, and explicit peer removal/re-addition
  plus a ping in 4.297 seconds. Each result requires fresh trusted HTTPS, the intended
  response body, an unchanged certificate and newer handshakes at both ends. The
  versioned receipt includes empty cleanup and CI refusal checks. These are single
  local observations, not deployment targets. Waitron still needs a scoped automatic
  appliance trigger and joint outage/active-connection proof; choose and prove the
  launch recovery target before making an availability promise. The portal now shows
  separate redacted public/staff evidence and certificate warnings in English and Spanish.
  Opted-in owners receive bilingual remote
  incident and recovery messages; delivery rechecks route authority, and opt-out or
  revocation suppresses queued mail. Current incident and observation tables are bounded
  current-state projections; terminal delivery links follow the explicit cleanup cutoff.
  The local worker-scale receipt now separates scheduling from polling, runs scheduling
  once a minute, bounds monitor/email claim batches at four and batches encrypted alert
  insertion in groups of 100. On an Apple M5 Pro with 18 logical CPUs, its 1,000-venue/200-recipient
  fixture reduced monitor processing from 7,030 ms with 1,001 sweeps to 2,335 ms with one,
  queued the bounded incident fan-out in 24 ms and reduced delivery backlog lag from
  1,558 ms to 477 ms. A 103-recipient PostgreSQL test enforces two inserts per table.
  Locked venues, restart completion and shutdown fencing remained intact. These are local
  measurements, not capacity promises. The aggregate operations command now surfaces
  the current worker queues and evidence projections through JSON, a readiness exit code
  and bounded-label Prometheus metrics. An opt-in local Compose collector now runs
  the same inspection on a bounded schedule, exports collection timestamps and failure,
  and suppresses expired or failed samples. It checks the full migration ledger
  before each inspection and uses read-only transactions. Production collection,
  retained time series and alerting remain open. The 2026-09-30 local
  [collection receipt](receipts/2026-09-30-operations-collection.json) proves healthy/degraded
  changes, migration-digest refusal, database outage/recovery, restart and read-only
  write refusal, with 26 label combinations and empty project cleanup.
  Next: choose the terminal-delivery cutoff, repeat the receipt and aggregate checks in
  the selected deployment environment, and add external representative checks,
  production quiet/reminder thresholds, wider escalation and rollout pause criteria.
- **Usage metering.** Cloud now records immutable organisation-scoped events for
  snapshot storage and transfer, completed installation operations, accepted monitoring
  probes and terminal administrative alert outcomes. Bounded reconciliation repairs
  interrupted durable-source writes, stable source identities suppress duplicates and
  cleanup preserves sources until their events exist. Owner-only portal totals retain
  exact decimal precision, show measurement freshness in English and Spanish and state
  that continuous-stream bytes and account identity mail are excluded. PostgreSQL and
  browser tests prove retry rollback, tenant isolation and fresh/incomplete views. This is
  observational only. A bounded watch worker now runs in the local deployment, retries
  failed passes and exposes stalled progress through existing operations freshness.
  PostgreSQL CLI tests cover competing workers, rollback/interruption, restart catch-up,
  tenant totals and shutdown. A clean local Compose proof on 2026-09-29 recorded two
  organisations automatically, reported all four sources stale after stopping, and
  caught up a third organisation after restart; its project containers, volumes and
  network were removed. This proves local scheduling, not a production freshness
  objective. The extended Compose proof now holds the final source's PostgreSQL row
  lock and stops the service with earlier writes still uncommitted. On 2026-09-29,
  it exited normally in 9,657 ms within the 15,000 ms Compose grace period, left
  committed events and every source timestamp unchanged, then caught up two new
  organisations without duplicates. The ten-second transaction deadline remains;
  extending both database deadlines in a disposable copy made Compose kill the
  worker (exit 137), which the proof rejected. Project cleanup was empty.
  Production deployment and monitoring remain open. Next: add
  attributable lookup/API, report and compute units when those services exist, measure
  provider costs, then define allowances, excess-use and metering-outage policy before
  connecting any total to billing or enforcement.
- **Data lifecycle.** The internal managed-backup catalogue now protects the latest
  successfully verified snapshot (or newest snapshot when none has verified) and active
  recoveries, with automatic operation expiry, resumable deletion and
  30-day daily/12-month monthly expiry. PostgreSQL tests cover failures and races.
  Versioned managed keys and bound owner recovery are implemented for local test venues;
  [the real snapshot proof](local-backups.md) runs Waitron validation and restore hooks.
  The local worker now schedules real restore verification, retention and abandoned-upload
  cleanup with durable claims, lease fences and bounded retries. Captures expire after
  24 hours; cleanup waits another 16 minutes and keeps tombstones. PostgreSQL tests cover
  concurrent workers, lease takeover and restart; the two-server proof uses this queue.
  The [authenticated capture adapter](authenticated-captures.md) now uses bound installation proofs,
  scoped upload grants and authority checks after storage waits. Waitron now schedules daily
  captures, assigns monthly retention to the first successful capture of each venue-local
  month and persists one encrypted archive for exact retries across restart. The file
  uploader streams with a 14-minute/credential-expiry deadline and bounded retry backoff;
  deliberate shutdown is not an outage. The local proof crashes after upload and restores
  the resumed snapshot without recapture. Cloud now stages provider downloads to private files
  while hashing and length-checking them, reopens the immutable stage for conditional upload
  retries, and streams verification into the isolated Waitron restore process. A 32 MiB local
  SeaweedFS fixture on an Apple M5 Pro observed 5,975,936 bytes of peak ArrayBuffer growth and
  26,968,064 bytes of RSS growth. Archive assembly in Waitron still uses its existing format and
  the end-to-end 512 MiB archive limit remains unchanged. Confirmed uploads retry publication without resending; loss of an
  acknowledged storage object waits until capture expiry before recapture. A reproducible
  4 MiB controlled-HTTPS receipt now measures throttled upload/download retries, 120 ms
  deadline cancellation, partial-stage cleanup, missing objects, one-copy publication replay,
  credential renewal with one durable archive and shutdown through a controlled Waitron archive
  wait. Cloud download cancellation now releases its durable verification claim without recording
  failure or consuming a retry. These are local boundary measurements, not production timeout or
  bandwidth targets. The capacity fixture adds a disk-backed two-venue TLS profile
  at 32, 128 and 512 MiB per venue, with signed credential isolation, interrupted retries,
  digest/length checks, cancellation and exact fixture cleanup. Its version 2 receipt
  records per-size resource preflights/skips, transfer times and sampled process memory
  and scratch/disk peaks. CI exercises the boundary cases at 1 MiB; larger runs stay
  explicit. See [the capacity guide](local-backups.md#measure-local-transfer-capacity).
  The [clean-commit measurement](receipts/backup-capacity-2026-09-30.json) ran all three
  sizes; the guide records the observed times and resource peaks. Provider policies
  and real Waitron archive assembly remain outside this fixture.
  Next: measure deployment uplink bandwidth, spool volume and real database/
  encryption shutdown latency, stream Waitron archive assembly/restoration before reconsidering the current 512 MiB bound,
  production master-key custody/rewrapping and production-host verifier hardening. The
  process verifier denies network, subprocesses, native addons, host reads and outside
  writes. The container adapter adds a disposable container around the deployed
  verifier with total memory, swap disabled, aggregate scratch, no network or host mounts, and ownership cleanup.
  Archive input now waits until Docker inspection acknowledges runtime startup.
  A local Docker 28.0.4 runtime with a controlled two-second start-return delay
  reproduced exit 73 with `OOMKilled=false`: restore input arrived before
  containerd installed its OOM watcher. Later inspection did not repair the flag.
  Waiting before streaming passes the same controlled native-memory, scratch
  and subsequent valid-restore sequence without changing a containment assertion
  or deadline. This establishes and fixes that startup mechanism; the original
  Ubuntu failure did not record its start stages, so its exact trigger remains
  unproved. Gated real-Docker tests keep the archive unopened through startup
  and cancellation at the start and refusal-inspection boundaries. Diagnostics
  precede the strict resource assertions so a future failure retains its cause.
  Real Docker fixtures exhaust native memory (192 MiB) and scratch (16 MiB); the parent
  survives and verifies later work. Two real Waitron snapshots at revision
  `00496fcd182a5c2c9189cc3faf0f8f22d3baf8ac` restore with 1024 MiB memory and 256 MiB scratch.
  See [the containment receipt and limits](backup-verifier-containment.md).
  Both container-verifier and database-worker image preparation have a separate
  150-second setup budget around their 120-second Docker command limit; individual
  test deadlines and containment assertions stay unchanged. A controlled 31-second
  build delay reproduces the former setup timeout. Separate CI jobs give each file
  a fresh Docker build cache. The database-worker CI case reached its 30-second
  deadline, but did not record the build duration separately. The same controlled
  build delay now passes its unchanged 30-second worker test after image preparation
  moves into the setup hook; the historical CI stage timings remain unproved.
  The process adapter stops and reaps a child when V8 reports fatal heap exhaustion,
  before kernel crash collection can replace that resource refusal with a watchdog timeout.
  [Synthetic Ubuntu tracing](https://github.com/waitron-io/waitron-cloud/actions/runs/39111778828)
  observed the heap report at 75–372 ms, then concurrent children waiting in crash-dump
  pipe writes until all eight reached the unchanged five-second watchdog.
  [A controlled eight-second core collector](https://github.com/waitron-io/waitron-cloud/actions/runs/39111842785)
  reproduces the original strict heap test's resource-versus-timeout failure. New tests
  pause a genuinely exhausted child, split the fatal report across chunks and preserve
  ordinary stderr outcomes. The [same controlled collector with the fix](https://github.com/waitron-io/waitron-cloud/actions/runs/39111967260)
  passes the unchanged heap assertion. The original nine process tests, heap limit, permissions,
  output bound and deadlines remain unchanged. The earlier main failure
  [39111146785](https://github.com/waitron-io/waitron-cloud/actions/runs/39111146785)
  did not capture child stages, so its precise historical crash-collection timing remains unproved.
  The fatal marker remains advisory: printing a matching line stops even a child
  that would otherwise return valid JSON. Qualify untrusted diagnostic forwarding
  before expanding this trusted-local-archive adapter's scope. The reviewer also
  measured about 0.2–0.6 seconds of extra parent CPU for 40,000 one-byte stderr
  writes from rescanning the accumulated text. The existing 64 KiB output limit
  bounds this work. A separately tested incremental detector is an efficiency
  follow-up; preserve split-line detection, the line-start anchor and output ordering.
  Production host/kernel isolation, hostile native exploits, fleet sizing and large archives remain
  unverified; the process-only development adapter still lacks these total-resource bounds.
  The verifier distinguishes bounded infrastructure failures from archive verdicts:
  failed staging, Docker start/connection, cleanup and verifier protocol errors preserve the prior snapshot
  state and retry with `verification_unavailable`. A real local PostgreSQL stop/restart,
  worker-only Docker connection outage, start refusal and two-organisation valid/invalid
  recovery tests pass. Eight-attempt exhaustion, explicit retry, cancellation, lease fencing
  and verified fallback protection remain covered. See the containment guide for the exact
  executed cases; shared-daemon loss during active cleanup, physical host crashes and
  production recovery timings remain unmeasured.
  **Open: intermittent container-worker verdict.** [CI run 36702956368, attempt 1](https://github.com/waitron-io/waitron-cloud/actions/runs/36702956368/attempts/1)
  expected a failed archive check but found it pending. Its cause remains unresolved:
  local and Ubuntu probes have not reproduced it. [PR #99](https://github.com/waitron-io/waitron-cloud/pull/99)
  adds verifier outcome, fixed Docker failure details and queued-job state to the
  unchanged test assertion; a controlled start-refusal experiment reports
  created state, attach exit 125 and `verification_unavailable`. This is diagnostic
  coverage, not a fix. The temporary stress workflow is removed. On the next natural
  failure, use those details to identify the failing boundary, reproduce it and fix
  its cause while preserving the distinction between infrastructure uncertainty
  and an invalid archive. Passing probes do not close this defect.
  **Concurrent reclamation tolerates an already removed container.**
  Deterministic Docker fixtures remove a listed container before inspection or
  removal; a missing result during active verification still raises infrastructure
  failure. Exit 1 with the exact missing-object/container diagnostic naming that
  ID is tolerated. Reclamation retries an exact removal-in-progress diagnostic
  within one ten-second removal budget, refusing a removal that never finishes.
  Daemon errors, another ID and a different exit code remain
  failures; raw daemon text is not exposed. The existing deadline and foreign-owner
  test passes unchanged. Shared-owner and isolated-owner lifecycle probes each
  complete 12 calls, with four successful restores and eight expected resource
  refusals. Three further rounds with ten expired containers and two reclaimers
  each finish without errors. This fixes the concurrent reclamation failure; it
  does not resolve the sequential worker-test failure above. Continue assigning distinct worker owners;
  these local probes do not establish production concurrency capacity.
  Two unchanged reclamation tests later exceeded their 13-second whole-operation
  checks in a full local backup run, at 14.57 and 14.82 seconds. Isolated tracing
  completed them in 2.17 and 10.84 seconds. Adding 11.5 seconds to container creation
  or 3.2 seconds to image inspection reproduces the respective elapsed-time
  failures without changing the ten-second removal budget. The original run
  overlapped root checks and review controls but retained no per-command timings,
  so its exact cause remains unproved. Capture image inspection, enumeration,
  removal, verification and host scheduling on recurrence. Keep the 13-second
  checks, 15-second test deadlines and removal policy intact; passing repeats
  do not resolve this timing defect.
  A read-only
  dependency inventory and local drill now prove active-key rotation, old snapshot restore,
  worker restart and wrong/missing-key refusal without exposing secrets or deleting keys.
  The history cleanup command
  now removes completed jobs and already-deleted tombstone metadata in bounded chunks
  after exact operator cutoffs; pending/running/failed jobs, current points, protected
  snapshots and recovery references remain. Choose the production cutoffs before use.
  A reproducible 1,000-venue local fixture now measures scheduling separately from job
  polling. It reduced 1,000 repeated empty backup sweeps from 3,602 ms to one 5 ms cadence
  sweep while preserving the 100-row query bound. Repeat this with the selected database
  topology and deployment-sized venue distribution before setting worker counts or
  scheduling objectives.
  The local two-venue proof now exercises Waitron's stream, sealed recovery kit and
  cold-restore contracts. Production still needs dynamic writer/reader credential
  delivery, rotation and revocation; the selected provider's prefix and conditional
  write semantics; measured continuous retention; monitoring and scheduling; and the
  planned final-write handover before activation.
  Retention, restore checks, export, deletion and access review;
  define what survives subscription termination and for how long.
  The catalogue implements daily retention for 30 days and monthly retention for 12 months.
  Longer paid retention for selected snapshots remains to be implemented. Daily timing follows the venue business-day cutover with stable jitter; the first successful
  capture per local month gets monthly retention, and missed runs make one current copy.
  Validate storage costs before pricing.
  Validate the inherited continuous-backup retention baseline. Protect the last verified snapshot from automatic
  expiry while the backup subscription is active. PostgreSQL tests already prove
  failed verification preserves the verified fallback and cleanup resumes after
  storage deletion fails, including concurrent cleanup. Run the focused cases in
  `packages/backups/test/worker.test.ts` and `catalogue.test.ts`; repeat these
  failure boundaries against the selected provider. Explicit deletion and
  cancellation policies remain open.
  Carry forward the existing topology's proposed hourly stream snapshots and 30-day
  stream retention as a baseline to validate. Productionise the implemented internal Cloud-managed recovery-key
  custody and authorised delivery, respecting the existing external vault-key design.
  The local integration now uses the contract's mapped backup contents, manifests,
  module restore hooks and per-secret handling against the landed SQLite interfaces;
  repeat those boundaries with the selected provider.
  The local key drill and two-venue recovery proof test rotation with retained snapshots
  and recovery after loss of the original server without an owner-held backup key. See the
  [existing-design reconciliation](documentation-ownership.md#backup-and-recovery-design-reconciliation).
  The version 3 recovery-boundary receipt now proves the landed consumers rather than
  the older proposed identity split: both stream and archive restore recover the source
  local node ID and run Waitron's restore hooks, while replacement registers a distinct
  Cloud installation with fresh machine authority. It restores an older key-version
  snapshot after rotation, restores the separate application vault state byte for byte,
  and inherits no backup destination, Cloud credential or staff TLS material.
  `BackupManifest` v1 needs no change for this managed path. A future hosted target with
  an external application-vault key remains blocked on the named
  `external-vault-archive-v2` compatibility contract and explicit on-premises re-encryption;
  an ordinary backup download does not satisfy either requirement.
  Owner-approved recovery and replacement now append immutable customer audit events and
  current owners can export them in stable pages. Before production, choose the
  recovery-request/result cutoff, audit retention and account-deletion handling. Closed
  expired recovery history now has a separate cleanup category that
  preserves active operations and incomplete replacements. A bounded two-instance run admitted exactly 10 of 12 concurrent fresh-key
  recovery starts behind one address. Guesses using unrelated UUIDs left the target's
  budget untouched; five concurrent wrong codes against a known UUID serialized to five,
  closed the pending request and refused its later correct code. Treat that availability
  cost as an ingress/request-reissue decision, not a reason to raise the guess allowance
  blindly. Recovery codes now use a separate external key, as described in
  [the upgrade and rotation instructions](recovery-code-keys.md).
  Keep completion reports separate from activation, and test deployment-scale transfer
  interruption, expiry and cancellation against the selected provider. Restore verification is
  separate from upload freshness; production workers still need enforceable resource and
  network isolation, without activating a primary or contacting fiscal/payment services. Define the external-key format extension
  rather than assuming it exists in the inspected manifest v1.

## Portal session test startup

A local full portal run during the receipt-selection work passed 195 of 196
cases, but `test/session.test.ts:59` timed out after three seconds waiting for the
initial signed-in screen. Running that file separately passed both cases. The
portal, backend and database harness sources match the preceding main revision;
that comparison does not explain the failure. The failed run recorded no initial
request/response or browser-error trace. Capture those boundaries, the rendered
heading and fake-clock time if it fails again before attributing a cause or
changing any check. The assertions and deadlines remain unchanged.

## Portal lost-reply test ordering

- **Resolved: reconciliation stalled after the reply was dropped.**
  [CI 36777640375](https://github.com/waitron-io/waitron-cloud/actions/runs/36777640375)
  on `ab5161d4af0fc41aad83c99ce22de80035b2e027` failed both English journeys
  at the four-second saved-name wait (portal 110/112). PR #102 subsequently reproduced
  the browser-side stall and retained the apply interceptor through reconciliation,
  as described below. [The fix's exact-merge CI](https://github.com/waitron-io/waitron-cloud/actions/runs/36851962407)
  passed on `3085054b8d82698ec3e8f420ade798957df2d9a8`.
  [PR #103](https://github.com/waitron-io/waitron-cloud/pull/103) includes the fix;
  [its rebased-head CI](https://github.com/waitron-io/waitron-cloud/actions/runs/36855902107)
  passed on `7b5cdb1f50449e4a9c2d50e59f757aa1c1cd8716`.
- The remote-DNS journey waits until its fixture has dropped a successful apply
  reply before starting the four-second saved-name assertion. Previously that UI
  wait also timed the fixture's forwarding and fault injection. A controlled
  4.5-second hold after the committed HTTP 200 reproduced the timeout while the
  browser was still waiting for the reply; the same case passes after the explicit
  injection acknowledgement. The English/Spanish journeys keep every existing
  assertion, and the delayed-injection case guards the ordering. A separate
  30-second fixture deadline fails with diagnostics if interception never completes,
  so the browser and database can close even when the route does not match.
- The failure in [CI 36738638444](https://github.com/waitron-io/waitron-cloud/actions/runs/36738638444)
  predates these diagnostics, so you cannot attribute that historical failure to
  this mechanism with certainty. The test records bounded request/status events,
  injection stages and the setup screen if it fails again. Investigate any new
  failure from that evidence; a passing repeat alone does not establish its cause.
- The bounded Ubuntu probes reproduced the newer status stall in
  [run 36846155539](https://github.com/waitron-io/waitron-cloud/actions/runs/36846155539)
  and [run 36846703454](https://github.com/waitron-io/waitron-cloud/actions/runs/36846703454).
  Both failures followed a committed apply and completed abort. The browser emitted
  the status request, the server never received it, and the database was idle.
  The second probe recorded interception being disabled after the abort. Keeping
  the apply interceptor until the saved-name assertion completes makes the status
  read pass through interception before teardown. Chromium's internal reason for
  stranding the request during teardown remains unverified. The separate delayed
  status control still fails at four seconds, so a genuinely slow read is not hidden.
  [The fixed probe](https://github.com/waitron-io/waitron-cloud/actions/runs/36847208929)
  passed all 18 English, Spanish and delayed-injection journeys; each status read
  was explicitly continued before interception was disabled. Temporary Ubuntu
  workflows, control switches and protocol tracing are removed.

## Initial services and future candidates

| Service | Design work still needed |
| --- | --- |
| Remote access (initial) | The local two-venue adapter, operator commands and durable route/certificate reconciler are implemented; see [the executable proof](local-remote-access.md). Customer setup screens expose assigned names, revision-bound custom DNS changes and readiness. The local worker has explicit per-cell/per-certificate mappings, bounded leased retries, atomic publication and stale-work fences; it reuses Waitron's CSR/install interface without taking its staff private key. The signed version 1 Cloud CSR/chain exchange and optional database staff worker now have a two-owner Pebble/HTTP/Waitron CLI proof. Live provider DNS/ACME credentials, production key storage and deployment, plus Waitron's durable exchange client, local stale-result checks and automatic install/TLS reload remain open. Public HTTPS terminates in Cloud for bot inspection; staff uses a separate hostname with TLS passthrough and network controls. Share a gateway within each cell, with separate venue tunnels and credentials. The [2026-09-30 two-venue receipt](receipts/public-gateway-limits-2026-09-30.json) records 16/16 solved calls, 31 challenge responses and 49 connection refusals in an 80-connection burst, plus four successful B calls within 14.1 ms while A timed out. The bounded public gateway profile now measures shared-source request and connection refusals, shared upstream saturation, challenge expiry and failure recovery, with two-venue credential/path isolation and a versioned cleanup receipt. The unchanged per-IP request budget and global upstream slots can refuse a legitimate other-venue caller. Choose per-venue fairness and legitimate automated-client handling; production traffic, carrier false-positive rates and multi-gateway coordination remain untested. See the public traffic profile in the remote-access guide. Implement the preferred local DNS overrides with router-specific setup and offline/recovery tests. Decide the bootstrap role of waitron.local. Temporary unavailability while the venue is offline and short interruptions during cell replacement are accepted; define and test the cell recovery-time target. |
| Backups (initial) | Guided continuous and verified-snapshot recovery are implemented for local test venues. The two-venue proof restores an exact Litestream database head after interruption and restores a verified snapshot after deleting its continuous source. Production still needs provider credential lifecycle, retention and monitoring checks, planned final-write handover and safe Waitron activation. |
| SQLite snapshots (initial backup service) | Retain daily snapshots for 30 days and monthly snapshots for 12 months, with longer paid retention for selected snapshots. Each must remain restorable if continuous backup data disappears. Protect the last verified snapshot from automatic expiry while subscribed; verify a newer copy before replacing it and show stale backup health. Define schedule details, consistency, extended-retention terms and prices, and independent storage/deletion controls. Explicit verified-snapshot selection and restoration with continuous data absent are proved locally; run the same flow against the selected production provider. |
| Failover to cloud | Allocate a replacement instance, coordinate promotion with Waitron, connect devices, stream the new primary and support return to the venue. |
| Hosted Waitron | Provision isolated operational instances, local print connectivity, upgrades, capacity and cloud-only recovery. |
| Bookings and public pages | Initial remote access may be unavailable while the venue is offline. Future independent cloud hosting needs rules for accepting reservations and synchronising them with the venue; include menus, ordering and payment-page candidates. |
| Invoice archive | Define the archived objects and access grants, including owner-approved AEAT/advisor access, retention, download and customer exit. Have hosting/archive questions reviewed for the launch country. |
| Analytics and reports | Choose ingestion, supported source versions, country and cell placement, search/aggregation engine, scheduled reports and group reporting. Elasticsearch is a candidate. |
| Multiple venues | Define group visibility, permitted changes and how central catalogue/configuration changes are delivered and acknowledged. |
| Address lookup (free) | [Spain measured on 2026-10-16](address-lookup-scope.md#measured-on-spain-2026-10-16): 40 public/synthetic cases; none of the three tested providers reaches the proposed selectable-match gate under the first-result mapping. The approved second comparison adds 60 public residential/rural addresses and 120 paired queries, first-versus-list scoring and explicit province inference. The original field references and a separate rural-municipality sensitivity remain distinct; accepted locality level and actual setup integration stay open. The owner prefers a Google-first plan with Geoapify fallback. The [terms finding and proposed design](address-lookup-scope.md#google-can-propose-an-address-you-must-confirm-what-you-keep) distinguish whole-address confirmation from a Places click and propose attribution, no shared cache, account limits and zero paid usage. Provider activation, effective account terms/quotas, fallback eligibility, locality policy and actual setup acceptance remain open. See [free services](#free-services-for-open-source-waitron). |
| Messaging | The [version 1 on-prem relay contract](transactional-email-relay-contract.md) has a disabled local-proof grant/reservation core; opt-in signed routes, an encrypted queue and a disabled local capture worker with bounded claims and accepted/uncertain outcomes; production origin verification, Waitron durable caller, joint proof and production decisions remain open. Include free transactional account email for open-source Waitron with a Cloud login and per-user limits; evaluate free mobile notifications separately. Prefer a Spain-hosted provider for administrative email; configure the implemented TLS SMTP adapter, notification channels, sender identities, preferences, delivery failures and message location policy. |
| Automated upgrades | Treat cloud services, cloud-hosted Waitron and on-prem installations separately; choose rollout groups, compatibility, maintenance windows, pause and recovery behaviour. |
| Monitoring | External venue and remote-route health, backup staleness, customer incidents and bilingual email alerts are implemented locally. Accepted public/staff probes now emit retry-safe organisation usage events and the portal shows their measured total. Add filing/device signals, broader functional checks and performance evidence. The local deployment now schedules usage reconciliation; define production operations, cost, allowance and limit policy before using measurements for enforcement. |

Further candidates remain in the complete inventory: loyalty and gift cards,
e-receipts, opening-hours publishing, accounting/delivery connectors, AI-assisted
reports, benchmarking and commercial payment-rate agreements. None is implied to
be an initial release commitment.

## Items transferred from Waitron

The source is [Waitron's backlog at `830cf71fe854`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/backlog.md).
Its section titled "The cloud primary" mixed cloud services with core SQLite work.
The [ownership map](documentation-ownership.md) records what remains in Waitron.

- **Cloud provisioning and trial onboarding.** Own the service that creates a
  customer's resources and supplies configuration and credentials to Waitron, plus
  the hosted trial entry path. The local integration contract is mapped and proved;
  provider provisioning, the paid lifecycle and the hosted trial remain open.
- **Cloud-only redundancy.** Choose the failure and recovery model for a hosted
  primary. The old backlog's managed-Postgres framing is historical; the current
  Waitron design targets SQLite and Litestream.
- **Production object-store proof.** The executable local SeaweedFS 4.47 contract admits
  exactly one writer in eight-way create-only and compare-and-swap races, refuses stale
  replacements, retains accepted versions, isolates venue credentials, revokes a rotated
  key, refuses an expired issued credential and commits no partial interrupted upload.
  A [one-day AWS Stockholm sandbox rehearsal](aws-storage-rehearsal.md) now proves
  real S3 conditional-write races, stale-write refusal, version retention, two-prefix
  isolation, role-session revocation/expiry and interrupted multipart cleanup. It
  restores an older-key retained archive through PostgreSQL-backed Cloud verification
  and Waitron, and a continuous Waitron database through Litestream. Its receipt
  records the conservative US$1.37 pretax estimate, cleanup and scheduled KMS deletion;
  charges were not read. This is no Spain-location or production-deployment claim.
  Qualify the selected Spain deployment, managed credential delivery/renewal,
  web identity and recovery journey; run a separate Google proof. The existing
  [prototype results](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/research/2026-09-16-sqlite-failover-prototype.md)
  concern MinIO and remain historical evidence.
- **Promoted cloud generation and current pointer.** The local proof follows a signed
  `current.json` generation through Waitron's cold restore. It does not activate the
  replacement or prove that the replacement begins streaming a new generation. Add
  that promotion proof to the production handover and activation work.
- **Remote support.** On-prem SSH support is a candidate capability requiring
  explicit customer approval for a specific server and limited period, separately
  from cloud data access. Scope the connection mechanism, server permissions, audit,
  early revocation and termination of active sessions on expiry. The
  [maintenance discussion](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)
  remains an unapproved implementation proposal and also covers local OS maintenance.
- **Managed devices.** Android Management API enrolment is a cloud candidate.
  Device hardware, kiosk behaviour and the local operating-system image remain
  Waitron work.
- **Archive and hosting advice.** Review the cloud assumptions in Waitron's advisor
  questions and the historical storage document's section 8a before a fiscal archive
  design. Do not treat migrated legal conclusions as a current assessment.

Waitron retains the SQLite storage change, safe promotion and rejoin behaviour,
on-prem mirrors, fiscal filing recovery, offline log growth, local credentials,
box image networking and the end-to-end selling proof. These cloud entries do not
declare those core prerequisites implemented.
