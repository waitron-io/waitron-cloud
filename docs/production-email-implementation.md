# Production account email

The owner selected **Amazon SES in an EU region** on 2026-10-21. D102 owns the
Paris/Frankfurt recommendation, account setup and live qualification. The
[SES endpoint table](https://docs.aws.amazon.com/general/latest/gr/ses.html) lists
those regions but no Spain endpoint. This is an approved email-processing exception,
not a claim about recipient mail providers, transit or every subprocessor. The
[D101 proposal](superpowers/specs/2026-10-22-cloud-data-protection-design.md) records
the supplier/location/legal evidence still needed. Keep the queue independent of
the provider; SES selection does not establish configured delivery.

## Scope and contract

- Add an explicitly configured SMTP adapter with TLS from connection start, certificate
  verification, SMTP authentication, a fixed sender and a trusted HTTPS portal origin.
  Share account templates with Mailpit. No connection URL, plaintext fallback or
  certificate-verification bypass is accepted.
- Own each send's TLS socket so a total deadline or worker cancellation destroys the
  connection, including during handshake, authentication or waiting for a response.
  Default adapter deadline: 15 seconds; worker deadline: 20 seconds; queue lease: 60.
  Destroying a socket cannot retract mail a provider has already accepted.
- Keep retries in PostgreSQL. Retry connection failures and temporary SMTP responses;
  stop retrying an unchanged message after a permanent rejection. Authentication and
  TLS configuration failures retain a fixed diagnostic and use the bounded retry policy.
  Never persist or log raw SMTP responses, credentials, recipients or token contents.
- Pass the queue ID and cancellation signal to delivery adapters. Use a stable Message-ID
  for retries and retain it on accepted sends. It supports investigation; it does not
  guarantee provider deduplication or prove delivery to an inbox.
- Select local or production delivery explicitly. Production mode requires the SMTP
  option. Status inspection needs the database, not working delivery credentials.
- Validate the adapter against a local authenticated TLS SMTP server and keep the
  existing Mailpit, queue, account and session behavior tests. No live messages are
  sent during automated tests.

## Sequence

1. Write failing transport tests for TLS/authentication, messages, response classes,
   deadlines and cancellation, plus queue tests for permanent failure and receipts.
2. Add shared delivery types/templates, SMTP adapter, migration 006 and worker wiring.
   Update CLI configuration and setup documentation.
3. Verify locally, run the required branch review and CI, then finish and land.

## Configure the worker

Use the same persistent encryption key ring as the account backend and apply all
migrations, including 006. Supply these settings through your deployment environment:

```sh
NODE_ENV=production
CLOUD_MAIL_TRANSPORT=smtp
CLOUD_SMTP_HOST=<approved relay hostname>
CLOUD_SMTP_PORT=465
CLOUD_SMTP_USER=<application user>
CLOUD_SMTP_PASSWORD=<application credential>
CLOUD_MAIL_FROM=accounts@your-verified-domain.example
CLOUD_PORTAL_ORIGIN=https://your-cloud-portal.example
```

The sender must be a normalised email address. The portal origin must be HTTPS with
no path, credentials, query or fragment. It supplies the signup and reset links;
configure it only after the corresponding public routes exist. Port 465 uses TLS
from the start of the connection. A STARTTLS-only port such as 587 is unsupported.
Certificate trust uses Node's certificate store; custom deployments can add a trusted
CA through `NODE_EXTRA_CA_CERTS`. The adapter always verifies the relay certificate.

Run `pnpm mail:worker` continuously or `pnpm mail:worker --once` for one due message.
`pnpm mail:status` reads queue counts using only `DATABASE_URL`. Provider failures
are saved with fixed diagnostic codes; `--once` exits successfully after recording
such a failure, so inspect the returned counts and row status. Database and startup
configuration failures exit nonzero. No automatic fallback to another relay occurs.

The worker supplies the queue ID and an abort signal to the adapter. It saves the
SMTP Message-ID on acceptance, then removes the encrypted recipient and token.
A successful adapter response with malformed optional receipt metadata still
finishes the message as sent, discarding the receipt to avoid a duplicate send.
A permanent SMTP rejection stops retries. Temporary responses, connection failures
and authentication/certificate errors retry within the queue's existing limits.
Correct configuration before the attempts or token lifetime run out. Terminal
messages cannot be replayed after their encrypted payload has been erased.

## Before enabling live delivery

D102 must qualify and configure the selected SES account/region and verified sender
domain. Confirm the processing/storage locations, retention, subcontractors and suppression rules for the
chosen service. Disable open/click tracking and link rewriting for account emails;
confirm with a real delivered message. Configure SPF, DKIM and DMARC as instructed by
the provider. Use an application credential, configure a monitored bounce address and
prove delivery, permanent bounce and complaint handling.

Authenticated delivery-event ingestion, suppression reconciliation, alerts, production
secret provisioning and a live delivery proof need the selected account/provider.
The transport implementation does not pretend those operational pieces are deployed.
There is no automatic cross-country or provider fallback. D102 must qualify the
selected EU SES path before enabling it. The public portal routes are still a
separate implementation.

SES selection reconciled 2026-10-22; transport source retained from the 2026-09-22 implementation:

- [AWS SES endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html)
- [Nodemailer SMTP options](https://nodemailer.com/smtp)
