# Monitor connected venues locally

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

## Run the monitor

Apply migrations through `017_remote_probe_observations.sql`. Configure `DATABASE_URL` and the
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
`/public/availability`; there is no unprotected health bypass. The staff check performs
only a trusted hostname-verifying TLS handshake and sends no HTTP request or login.
Production resolution refuses private, loopback, link-local and reserved addresses.
Tests inject an exact mapping for their configured fixture names; the CLI has no URL,
address, port or trust-disable option.

At most four venues run concurrently. DNS answers, TLS/request time, total service time,
response bytes and proof work are bounded. Shutdown aborts pending sockets and suppresses
their results, so an interrupted check cannot store or print fresh success. Failures use fixed
codes rather than raw addresses or network errors.

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

## Delivery rules

Repeated scans and worker restarts do not queue the same incident transition twice.
Each recipient has a unique record for that incident revision. Recovery mail goes only
to current owners whose opening message was recorded as sent. New owners and people
opting in mid-incident can see the current status in the portal and receive future alerts.
One transition encrypts and inserts recipient messages in groups of at most 100. The
matching delivery rows use the same bound and transaction, so a failed group rolls back
the incident and every message instead of leaving a partial fan-out.

Before handing an alert to the transport, the email worker rechecks its delivery claim,
current ownership, account status, verified email address, preference,
service configuration, current public or staff route, revocation and incident revision.
An obsolete message is cancelled.
Language is refreshed from your current preference at sending time, so changing it
does not discard a queued alert. Run the monitor and mail worker from the same updated
checkout. Messages expire after 24 hours and use the existing bounded email retries. They contain
a venue identifier, a fixed explanation and an account link, with no backup keys, object
paths or archive content.

A provider may accept a message before a later preference change or incident recovery.
That message cannot be recalled. A crash or uncertain SMTP response after acceptance
can also cause a duplicate on retry. Queue deduplication does not remove that transport
limitation.

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
