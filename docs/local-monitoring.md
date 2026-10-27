# Monitor connected venues locally

For the proposed production policy, read the
[D103 monitoring thresholds](superpowers/specs/2026-10-22-cloud-monitoring-thresholds-design.md).
The owner approved that design for planning only on 22 October 2026. Build authority,
the exact daily schedule and first monitored group remain gated. The settings and
local behaviour below remain the implemented baseline; publication does not enable
production monitoring.

Use the account portal to see contact and snapshot problems without opening the venue's
server. You can opt in to service emails and choose English or Spanish. Your preference
covers the venues you currently own, across your organisations. It starts disabled and
applies to future incident changes; enabling it does not resend older alerts.

## What the monitor checks

The local monitor checks configured services on test installations once a minute:

- **Missing contact:** Cloud has not heard from the installation for 15 minutes. If it
  has never contacted Cloud, the grace starts when monitoring first sees a configured
  service. Check the venue's internet connection and Waitron server.
- **Old snapshots:** no currently verified snapshot was captured in the last 48 hours.
  A newly monitored snapshot service with no verified copy gets 48 hours to produce one.
  Check the server's backup configuration. A successful verification of an old archive
  does not make its captured data newer.
- **Failed verification:** the latest retained snapshot remains failed for five minutes.
  The grace resets when that snapshot changes or its verification stops failing. Keep
  older verified copies while the backup worker retries.
- **Public and staff routes:** a separate host checks the public availability journey and
  the staff TLS handshake. A fresh failed check opens a route incident even when the
  installation still has current control contact. Missing results and results older than
  five minutes are unknown, not healthy.
- **Remote certificates:** a certificate from a fresh successful check opens an expiry
  incident when it has 30 days or less remaining. The stored expiry date tells you whether
  the certificate is approaching expiry or has already expired.

The first three checks use received control contact and the retained snapshot catalogue.
The route checks use only the external probe evidence. None of them establishes
continuous-server recoverability or permission to trade. When the venue monitor stops
for five minutes, the portal shows its existing contact and snapshot view as unknown and
keeps the last incident evidence visible. The portal also shows the latest public and
staff checks separately, including an approaching certificate expiry. Missing or stale
remote evidence appears as unknown. It never exposes hostnames, certificate fingerprints,
fixed failure codes or raw network errors.

Stopping Cloud access or removing a service suppresses its incidents and queued notices.
It does not send a recovery message. Missing data gets a fresh grace if you enable the
service again; known old contact or snapshot evidence retains its age.

## Check a remote-access alert

Open the Account link in the email and find the venue named in the alert.
Public website and staff access have separate check results and dates.

- If a recent check failed, check the venue's internet connection. Open **Set up
  remote access** for that venue and check **Selected hostname** and the setup
  status. The [remote setup guide](local-remote-access.md#set-up-your-venue-in-the-account-portal)
  explains how to review a custom name's two DNS records. Do not change a working
  name merely because an external check failed; changing it can interrupt access.
- If monitoring is unknown, use **Refresh status** below the venue list to look
  for new observations. A missing recent check does not establish an outage, and
  refreshing does not start a probe or repair the route.
- If a certificate expires soon, compare **Last external check** with **Verified
  certificate expiry**. Check the selected hostname in remote setup, then refresh
  the venue list to look for a newer observed expiry date. An expiry warning can
  appear while the latest route check still passes.

In Spanish, the controls are **Configurar acceso remoto** and **Actualizar estado**.
You must still own the organisation to open remote setup for an active venue.
These checks show the configuration and observations available to you; they do not
prove the cause or resolve every alert. Gateway assignment, certificate renewal
configuration and installation still use the local
[operator tools](local-remote-access.md#keep-a-local-gateway-configured).
Account does not offer those operations. Automatic delivery to customer appliances
and live provider activation remain unfinished; these are product capabilities to
build, not a paid support path.

The focused browser check exercises both languages, themes and screen widths with
synthetic server replies. It follows the named setup and refresh controls, checks
the hostname and pending status, and preserves the distinction between failed,
unknown and expiring-certificate results:

```sh
node --test apps/portal/test/monitoring-action-guidance-browser.test.ts
node --test packages/registration/test/monitoring-action-mail.test.ts
```

These checks qualify the guidance and displayed evidence. The local gateway proof
and database suites qualify the underlying monitoring and certificate behaviour;
they need Docker and do not run as part of these focused commands.

## Run the monitor

Apply every migration through `037_monitoring_quiet_escalation.sql`. Configure `DATABASE_URL` and the
same `CLOUD_EMAIL_KEYS` and `CLOUD_EMAIL_ACTIVE_KEY_ID` used by the account email queue.
The monitor encrypts notification payloads using those keys. It needs no backup master
key, storage credentials or SMTP credentials.

```sh
pnpm monitor:worker --once
pnpm monitor:worker
pnpm monitor:status
```

A scheduling sweep adds at most 100 missing venues. Each transaction processes one due
venue and saves its observation, incident transition and queued messages together.
The continuous worker runs a sweep at startup and then once a minute. Its one-second
idle poll does not repeat that sweep. Up to four venue transactions run together, and
concurrent monitors skip rows already being processed. If enqueueing fails, the whole
observation rolls back and retries after 30 seconds. Locked installations are skipped
for the same interval, without marking their check fresh. A failing venue does not
stop the continuous process or hold up other due venues. `--once` schedules and processes at most one venue.
The continuous command stops claiming new work on shutdown and finishes the active batch.

The route freshness and certificate warning thresholds have conservative defaults. Change
them only when your local schedule needs different bounds:

```sh
CLOUD_REMOTE_PROBE_STALE_SECONDS=300 \
CLOUD_REMOTE_CERTIFICATE_WARNING_DAYS=30 \
pnpm monitor:worker
```

Probe freshness accepts 1 to 86,400 seconds. The certificate warning accepts 1 to 3,650
days. Invalid values stop the worker instead of silently changing incident behavior.

Status needs only database access. It reports venue and due counts, unknown checks,
open incidents and the oldest completed check. Use `pnpm mail:status` separately to
inspect email delivery failures. An observed incident does not prove an email was sent.

## Probe remote access from outside the gateway

Run the separate remote probe from a host which resolves each configured public and
staff name to the real gateway:

```sh
pnpm remote:probe --once
```

Without `--once`, the process repeats every 60 seconds until `SIGINT` or `SIGTERM`.
It derives at most 100 targets from current, non-revoked placements. It stores each
accepted result in PostgreSQL, then writes one complete JSON object per line. Each result
carries the installation, venue and current
configuration revision, separate public/staff checked times and elapsed milliseconds,
and the verified certificate validity dates and SHA-256 fingerprint on success.

The public check receives and solves the normal bot challenge before requesting
`/public/availability`; there is no unprotected health bypass. Browsers reject a
host-only cookie that names a domain. The probe refuses any `Domain` attribute,
including empty and bare attributes that some browsers ignore. Attribute names
trim only ASCII spaces and tabs. A no-break space leaves a different name, so
a protected host-only cookie with that unrelated attribute can still pass.
The probe also checks the last effective `Path` attribute. Values over 1,024 bytes
are ignored, as in Chromium. A later non-root, empty or bare path within that limit makes the
host-prefixed cookie unusable, even when an earlier attribute says `Path=/`. Its Path comparison
trims ordinary spaces and tabs, preserving other bytes so it cannot mistake a
no-break space for a browser-accepted root path. It also refuses zero or negative
whole numbers, including `+0`, in the last `Max-Age` attribute within Chromium's
1,024-byte value limit. Oversized values leave an earlier attribute effective.
When no valid `Max-Age` overrides it, the last `Expires` value within the same
limit sets the expiry. The probe reads legacy cookie dates and adjusts for the
server clock in the response `Date`, refusing expired cookies before replay.
Invalid dates leave a session cookie; an invalid final value replaces an earlier
expiry. Real HTTPS fixtures and independent Chromium controls cover date forms,
clock differences, attribute replacement and signed `Max-Age` saturation.
The staff check performs only a trusted hostname-verifying TLS handshake and
sends no HTTP request or login. It finishes sending the handshake, then releases
the verified connection without waiting for the peer to close its side. A peer
that keeps its side open cannot keep your completed probe process alive.
Production resolution refuses private, loopback, link-local and reserved addresses,
including deprecated site-local IPv6. IPv4-compatible (`::/96`) and 6to4 (`2002::/16`)
addresses must also contain a public IPv4 address. Teredo and NAT64 prefixes remain
refused.
Tests inject an exact mapping for their configured fixture names; the CLI has no URL,
address, port or trust-disable option.

At most four venues run concurrently. DNS answers, TLS/request time, total service time,
response bytes and proof work are bounded. Shutdown aborts pending sockets and suppresses
their results, so an interrupted check cannot store or print fresh success. Failures use fixed
codes rather than raw addresses or network errors.
If storing a result fails, the runner stops starting targets and suppresses results
from probes still running. Late probe errors no longer report that work is continuing.
It waits for started probes and writes to finish before
reporting the first failure, so the CLI can close its database pool afterwards.
Writes already in progress can still complete; the batch is not one transaction.

The database keeps the current result, the last success and failure times, the last fixed
failure code and the most recently verified certificate evidence. A newer result can
replace an older one, but an equal or older result cannot move state backwards. The write
also checks the current installation, placement, revision and both hostnames while holding
the installation authority lock. A hostname change, replacement or revocation therefore
rejects a late result from the old route. Evidence more than one minute ahead of database
time is rejected so a bad clock cannot leave a stopped worker looking fresh.

The monitor records deduplicated route, stale-probe and certificate-expiry incidents and
their recoveries. It suppresses them when you remove the route or revoke the installation.
The portal presents the public and staff routes separately. If you have opted in to service
alerts, their incident and recovery transitions use the same bilingual email queue as contact
and snapshot alerts.

For local delivery, start Mailpit and run the existing mail worker with local transport:

```sh
pnpm mail:up
CLOUD_MAIL_TRANSPORT=local pnpm mail:worker
```

## Delay brief incidents and send one reminder

You can leave an incident visible in the portal while waiting to see whether it clears
before sending mail. Both timing options default to `0`, which disables that option.
For a local rehearsal, supply seconds only to the monitor:

```sh
CLOUD_MONITOR_QUIET_SECONDS=120 \
CLOUD_MONITOR_REMINDER_SECONDS=180 \
pnpm monitor:worker
```

This example waits two minutes before opening mail and allows one reminder three minutes
after each recipient's opening is recorded as sent. These are fixture values, not production
recommendations. Each setting accepts an integer from `0` to `604800`; blank, negative,
fractional or larger values stop the worker. The incident appears immediately regardless
of the email delay. A brief incident that recovers during the wait sends no email.

Each uninterrupted open period captures its timing settings and eligible account IDs.
Its opening deadline uses PostgreSQL's opening time. Each reminder deadline uses that
recipient's committed opening send time. Restarting workers or changing configuration
leaves those deadlines fixed. A deadline makes mail eligible for the next monitor scan;
it does not promise delivery at that instant. An owner added or enabled during the wait
receives future incidents instead of this incident's opening, reminder or recovery.

## Delivery rules

Repeated scans, concurrent workers and restarts keep one queue identity for each recipient
and notification in an open period. One optional reminder requires the same recipient's
recorded sent opening and a still-open incident. Recovery mail also requires that sent
opening. If a send already accepted by the mail transport finishes after the monitor sees
recovery, a later scan creates the missing recovery notice once. An uncertain send or a
stale worker claim cannot authorize it. Recovery, suppression or replacement cancels future
work; a later failure starts a new open period with a fresh recipient list and deadlines.

Recipient snapshots, outbox messages and delivery links use groups of at most 100 in one
transaction. A failed group rolls back the whole observation and every notification slot.
Before enqueueing delayed mail and immediately before transport handoff, workers recheck
current ownership, account status, verified matching address, preference, service, route,
original installation and incident revision. Messages that have become obsolete are
cancelled. Language follows your current preference at sending time.

A recorded send means the queue worker committed its valid claim's `sent` outcome. It does
not prove inbox delivery, and optional SMTP metadata is not required. A provider can accept
mail before a connection fails or the process stops, so retries may duplicate it. One reminder
means one durable queue identity, with the existing transport retries, rather than exactly one
SMTP delivery. Monitoring mail remains independent of Cloud account recovery and the venue
email relay.

Upgrading existing incidents creates no historical opening or reminder, even when you enable
these timings. Existing queued openings remain readable with their original external email
keys, and a late recorded send can still authorize recovery. Keep those keys separately from
your database backup. Cleanup protects opening receipts while reminders or recovery still
need them and until usage reconciliation records terminal outcomes. It uses your explicitly
supplied history cutoff; no retention duration is selected for you.

## Rehearse the monitoring schema upgrade

Run the populated upgrade against a clean committed implementation. The old revision
below has 36 migrations; the new revision must have 37:

```sh
node scripts/schema-upgrade-receipt.mjs /tmp/cloud-monitoring-upgrade.json \
  --monitoring-quiet \
  --old d681db284ac8babeffb9f1029c2c32f8dc47701c \
  --new "$(git rev-parse HEAD)"
node scripts/verify-schema-upgrade-receipt.mjs /tmp/cloud-monitoring-upgrade.json
```

The version 4 receipt requires a populated interrupted/retried upgrade and two separate
backup restores. It checks original account, factor and relay state, unchanged notification
deadlines and recipient lists, late sent-opening recovery, and wrong/missing email-key
refusal. It also checks that the source database stays unchanged and that every resource
created by the proof is removed. This uses local PostgreSQL and Mailpit only. It establishes
neither an online upgrade nor recovery of writes made after a backup.

## Evidence and next deployment work

PostgreSQL tests cover clock boundaries, concurrent monitors, rollback, restart,
revocation, opt-in changes, permission changes during a queue wait and notification retries.
Real browser tests cover both languages, saved preferences, fresh, failed and stale remote
checks, phone and desktop layouts, light and dark journeys, and accessibility. PostgreSQL
API tests cover venue isolation. Mailpit captures incident and recovery messages in both
languages, and proves that opting out or revoking a route suppresses queued remote notices.

External remote-access probes now persist revision-bound evidence and the monitor records
route, stale-probe, certificate-expiry and recovery transitions without confusing a live
control connection for a working route. The portal presents redacted evidence, and opted-in
owners receive bilingual incident and recovery emails after delivery-time authority checks.
The two-venue proof runs this whole path against real local gateway and TLS fixtures. It stops
one venue peer while the other continues working, restores it, lets probe evidence become
stale, verifies rejection with the wrong trust root, stops and replaces the gateway, and uses
the local ACME certificate dates with a proof-only warning threshold. Control contact remains
fresh throughout the route failures. Mailpit captures every opening and recovery, while the
proof re-runs an unchanged monitor transition and confirms the complete Mailpit mailbox gains
no duplicate opening.

Build the portal and local gateway image as described in
[the remote-access guide](local-remote-access.md#run-the-proof), then write and verify the
machine-readable receipt:

```sh
WAITRON_CHECKOUT=/absolute/path/to/waitron \
  REMOTE_RECEIPT=/tmp/cloud-remote-monitoring-receipt.json \
  node scripts/test-postgres.mjs exec node scripts/test-local-remote.mjs
node scripts/verify-remote-monitoring-receipt.mjs \
  /tmp/cloud-remote-monitoring-receipt.json
```

The receipt records elapsed time and open-incident count for the route-healthy baseline, isolated
route outage and recovery, stale worker, invalid trust, gateway outage and recovery, and
certificate warning phases. These are local measurements, not production availability or
delivery guarantees.
Before deployment, add retention for incident/delivery history and repeat the
scheduler/fan-out measurements in the selected deployment environment.
Define outage escalation and quiet-period policies with actual operating data. Live email
provider setup, Spain processing requirements and delivery monitoring remain separate
launch work. This local implementation creates no cloud resources and sends no live
customer messages during its tests.

## Measure worker scheduling locally

Use the disposable PostgreSQL runner to reproduce the worker measurement. Baseline mode
records the legacy per-claim scheduling and single-slot delivery loops with the current
fan-out implementation. Comparison mode embeds that baseline and measures the current
cadence and bounded concurrency with the same fixture.

```sh
node scripts/test-postgres.mjs exec node scripts/worker-scheduling-receipt.mjs \
  --baseline /tmp/cloud-worker-scheduling-baseline.json
node scripts/test-postgres.mjs exec node scripts/worker-scheduling-receipt.mjs \
  --compare /tmp/cloud-worker-scheduling-baseline.json \
  /tmp/cloud-worker-scheduling-receipt.json
node scripts/verify-worker-scheduling-receipt.mjs \
  /tmp/cloud-worker-scheduling-receipt.json
```

The 2026-09-26 local run used Node 26.7.0 on an Apple M5 Pro with 18 logical CPUs. Its fixture had
1,000 venues, 1,000 snapshot candidates and 200 alert recipients. Every scheduling
query kept the 100-row limit. The old backup loop repeated 1,000 empty scheduling sweeps
in 3,602 ms. The current cadence made one empty sweep in 5 ms. Monitoring 1,000 due
venues fell from 7,030 ms with 1,001 scheduling sweeps to 2,335 ms with one sweep.

The current fan-out queued 200 encrypted incident messages in 24 ms. A separate
PostgreSQL regression proves that 103 recipients use two bounded inserts per table and
that an insertion failure rolls back the whole transition. Four email claim slots
delivered 200 messages in 464 ms, with 477 ms from the oldest queue timestamp
to the last completion. The previous single-slot run took 1,353 ms and 1,558 ms
respectively. A locked venue did not block another venue, and a restarted worker drained
all 400 opening and recovery messages without loss. Shutdown finished the in-flight send
in 14 ms and claimed no later row. Peak resident memory was 195 MiB, compared with 192
MiB in the untuned run.

These figures describe one local machine and fixture. Use the receipt to compare code
changes, not to promise production throughput or availability. Repeat it with the chosen
database, mail relay limits and deployment-sized venue distribution before launch.

## Private gateway forwarding collection

A gateway can report its last observed forwarding outcome without putting the venue
application's reply or address in visitor responses. Reporting is disabled by default.
Country collection requires a separately provisioned Ed25519 reporter key and a version 2
gateway manifest. Register or rotate that authority through trusted country provisioning;
it grants no route, account or activation permission.

Run `pnpm --dir packages/remote-access forward:collect /absolute/config.json` inside
the country, with `DATABASE_URL` pointing at its primary database. For one polling
pass, add `--once`. The trusted configuration has this shape:

```json
{"mappings":[{"country":"ES","environment":"test","cellId":"00000000-0000-4000-8000-000000000001","file":"/country/forward/report.json","writerUid":0,"readerGid":1000}]}
```

Mount only the report directory read-only into the collector. It must have mode 2750,
the configured writer owner and collector group; `report.json` must be a regular 0640
file with the same identities and no symlink traversal. Keep the signing key outside
that mount. The collector polls every 30 seconds and prunes at most 64 observations
per cell every 60 seconds. Its database cursor also enforces the 30-second batch
limit across restarts and concurrent collectors.

The latest observation expires after at most five minutes or when its manifest
expires. Revocation, replacement, placement, revision or reporter changes make old
observations unreadable immediately. Collection failure and lost transient storage
mean unknown; they never mean that forwarding succeeded. A successful gateway
attempt records a success, not a promise that every visitor can reach the venue.

Logical backups must use `--exclude-table-data=*.remote_forward_observations`.
The schema-upgrade backup driver shares this exclusion with the dump/restore test.
Reporter authority and ordering cursors remain durable, while cause rows use an
unlogged table whose contents are lost on crash recovery. Before enabling reporting
in P1/P3 deployments, qualify the gateway/collector mounts, primary-only reads and
backup exclusion in that deployment. No deployment is enabled by this change;
the owner-only Account display remains separate work.
