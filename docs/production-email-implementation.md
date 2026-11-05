# Production account email

The owner selected **Amazon SES in an EU region** on 2026-10-21. D102 owns the
feedback plan, account setup and live qualification. On 2026-11-03 the owner
accepted Stockholm (`eu-north-1`) or Paris (`eu-west-3`); the local validator
defaults to Stockholm and requires explicit regional qualification. The
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

The owner approved the [feedback and suppression design](superpowers/specs/2026-11-01-ses-feedback-design.md)
on 2026-11-01, including Paris and private queue intake for authenticated bounce and
complaint events. It binds feedback before sending, keeps provider IDs separate from
the original Message-ID and blocks future handoffs without replaying accepted mail.
The [implementation plan](superpowers/plans/2026-11-02-ses-feedback-implementation.md)
covers the local build and separate provider qualification. D565 authorises code
and synthetic tests only. Task 1 validates configuration and event envelopes;
queue intake and the shared account/venue suppression boundary remain
unimplemented. Account/provider qualification is still required in the selected
region.

D102 must qualify and configure the selected SES account/region and verified sender
domain. Confirm the processing/storage locations, retention, subcontractors and suppression rules for the
chosen service. Disable open/click tracking and link rewriting for account emails;
confirm with a real delivered message. Configure SPF, DKIM and DMARC as instructed by
the provider. Use an application credential, configure a monitored bounce address and
prove delivery, permanent bounce and complaint handling.

The plan separates local intake tests from live setup. Build authority permits
no AWS resources, credentials, production-access request or live mail. Production authentication,
suppression reconciliation, alerts, secret provisioning and live delivery proof need
the qualified account/provider. Hands-on account, sender/domain and live testing
wait for the owner on 3 November.
The transport implementation does not pretend those operational pieces are deployed.
There is no automatic cross-country or provider fallback. D102 must qualify the
selected EU SES path before enabling it. The public portal routes are still a
separate implementation.

SES selection reconciled 2026-10-22; transport source retained from the 2026-09-22 implementation:

- [AWS SES endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html)
- [Nodemailer SMTP options](https://nodemailer.com/smtp)

## Check feedback configuration locally

Before any future SES handoff, you need separately qualified evidence for each
mail purpose. Run the synthetic validator and parser checks without a provider
connection:

```sh
pnpm --dir packages/registration exec node --test test/ses-feedback-config.test.ts test/ses-feedback-event.test.ts test/country-policy.test.ts
```

The internal `SesFeedbackPolicy` extends the unchanged country policy with
`smtpBindings`. Each binding names its purpose, SES content evidence ID, SMTP
host and port, configuration revision, identity ARN, configuration-set ARN, topic
ARN and primary/dead-letter queue ARNs. ARN means the exact AWS resource name.
Content and email-metadata flows must independently match trusted evidence for
the selected SES, SNS and queue endpoints. This prevents account-mail evidence
from enabling venue mail or an unrelated resource on the same AWS account.
Missing or stale evidence refuses configuration; input flags cannot qualify it.

The parser accepts only the expected notification wrapper and one-recipient
attempt tag. It bounds the envelope, nested message and identifiers, refuses
ambiguous recipients and duplicate JSON members, and never retrieves embedded
URLs. A redacted complaint leaves recipient resolution to the future durable
attempt lookup. Provider suppression, hard bounces and temporary outcomes stay
separate; parsing writes no suppression or sending state. These checks validate
structure against trusted settings. Only a separately qualified SQS connection
and effective publisher policies can authenticate the actual sender.


Task 2 adds the [durable attempt ledger](../packages/registration/README.md#keep-mail-attempts-bound-before-a-future-provider-handoff)
and shared suppression lookup. It retains original keyed recipient references
after payload erasure and refuses conflicting provider IDs. The account and relay
workers still use their existing sending paths; Task 4 must join them to the new
admission helpers before this protocol governs a real handoff.
