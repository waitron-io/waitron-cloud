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

These checks use received control contact and the retained snapshot catalogue. They do
not establish public route availability, continuous-server recoverability or permission
to trade. When checks stop for five minutes, the portal shows monitoring as unknown and
keeps the last incident evidence visible. A fresh check with no alerts means those
conditions are absent from the latest observation.

Stopping Cloud access or removing a service suppresses its incidents and queued notices.
It does not send a recovery message. Missing data gets a fresh grace if you enable the
service again; known old contact or snapshot evidence retains its age.

## Run the monitor

Apply migrations through `013_service_monitoring.sql`. Configure `DATABASE_URL` and the
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
Concurrent monitors skip rows already being processed. If enqueueing fails, the whole
observation rolls back for retry. `--once` schedules and processes at most one venue.
The continuous command polls when idle and stops claiming new work on shutdown.

Status needs only database access. It reports venue and due counts, unknown checks,
open incidents and the oldest completed check. Use `pnpm mail:status` separately to
inspect email delivery failures. An observed incident does not prove an email was sent.

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

Before handing an alert to the transport, the email worker rechecks its delivery claim,
current ownership, account status, verified email address, preference and language,
service configuration, revocation and incident revision. An obsolete message is cancelled.
Messages expire after 24 hours and use the existing bounded email retries. They contain
a venue identifier, a fixed explanation and an account link, with no backup keys, object
paths or archive content.

A provider may accept a message before a later preference change or incident recovery.
That message cannot be recalled. A crash or uncertain SMTP response after acceptance
can also cause a duplicate on retry. Queue deduplication does not remove that transport
limitation.

## Evidence and next deployment work

PostgreSQL tests cover clock boundaries, concurrent monitors, rollback, restart,
revocation, opt-in changes, permission changes during a queue wait and notification retries.
Real browser tests cover both languages, saved preferences, stale monitoring, phone
layout and accessibility. Mailpit captures incident and recovery messages in both languages.

Before deployment, add external functional probes, operational alert routing, retention
for incident/delivery history, and scheduler/fan-out measurements at the intended scale.
Define outage escalation and quiet-period policies with actual operating data. Live email
provider setup, Spain processing requirements and delivery monitoring remain separate
launch work. This local implementation creates no cloud resources and sends no live
customer messages during its tests.
