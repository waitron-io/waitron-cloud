# Waitron Cloud

Waitron Cloud is a commercial, closed-source product that provides cloud services
for venues running Waitron, including remote access, backups, recovery, hosted
instances, bookings and reporting.

Registration, account identity, email delivery and a bilingual account portal are implemented;
no Cloud service is deployed. Start with the [product and platform discussion](docs/product-and-platform.md),
then the [cloud backlog](docs/backlog.md). The [documentation ownership map](docs/documentation-ownership.md)
records the material moved from Waitron and the shared designs that remain there.
The [Waitron integration contract](docs/waitron-integration-contract.md) maps registration,
service configuration and recovery to the existing interfaces and the current SQLite storage model.

## Development

Use Node.js 24 or later and pnpm 9.15.0 to work in this repository. Follow
the [GitHub package authentication setup](docs/shared-ui-release.md#install-locally)
first, then install dependencies and the test browser with:

```sh
pnpm install --frozen-lockfile
pnpm --filter @waitron-cloud/ui-smoke exec playwright install chromium
```

Run `pnpm test:ui` for the shared UI browser smoke test on its own.

Check types and run the package tests against a disposable PostgreSQL container
(requires Docker):

```sh
pnpm typecheck
pnpm test
```

See [registration development](packages/registration/README.md) for the trust boundary,
migrations and test setup. The workspace packages are private. The [identity package](packages/identity/README.md)
provides internal password sessions used for Cloud approval. The
[signup backend](docs/cloud-signup-implementation.md) verifies email tokens and creates
the first organisation and legal business. The [account HTTP API](packages/account-http/README.md)
exposes signup, sessions and
recovery with shared request limits. Run it with `pnpm account:serve` after configuring
the database, keys and origin and applying migrations. Live provider setup, venue
pairing and service provisioning remain to be implemented.

## Run the account portal

You can create an account, sign in and recover a password without a venue server.
The portal uses English or Spanish from your browser preferences; its language
switch saves your choice. Signup normally needs just your legal business name.

Follow the [local account-server setup](packages/account-http/README.md#run-locally)
for PostgreSQL, migrations, keys and Mailpit. Then build and serve the screens:

```sh
pnpm portal:build
CLOUD_PORTAL_ASSETS_DIR=apps/portal/dist pnpm account:serve
```

In another terminal, run `pnpm mail:worker`. Open
[Waitron Cloud](http://localhost:3000/signup), submit your email and open its link
from [Mailpit](http://localhost:8125). The account server serves the screens and API
on the same origin, so no development proxy is needed. Rebuild and restart it after
changing frontend files; it loads the build at startup. Without
`CLOUD_PORTAL_ASSETS_DIR`, the server keeps its API-only behavior.

Run the portal browser and state tests with:

```sh
node scripts/test-postgres.mjs --filter @waitron-cloud/portal test
```

This starts disposable PostgreSQL and Mailpit instances. Tests cover real email
links, signup, sessions, recovery, lost replies, both languages and accessibility.
The portal is local development software; live delivery and deployment controls
remain in the [backlog](docs/backlog.md).

## Local email inbox

Use Mailpit to view signup, password-reset and password-change emails locally:

```sh
pnpm mail:up
pnpm mail:demo
```

Open [the Cloud inbox](http://localhost:8125). SMTP listens on `127.0.0.1:1125`,
so it can run alongside Waitron's Mailpit. The demo sends three preview messages;
their sample links do not create accounts. Use the portal signup form for a working link.
No external delivery or relay is configured. Stop the inbox with `pnpm mail:down`;
this removes captured messages. Copy `.env.example` to `.env` to override local ports.

The [password recovery backend](docs/password-recovery-implementation.md) changes
passwords and revokes existing sessions atomically. `pnpm test` starts its own
PostgreSQL and Mailpit containers on random ports and exercises real SMTP delivery
without clearing your development inbox. The account HTTP routes are tested; live
provider configuration remains open.

Account messages now use a [durable PostgreSQL queue](docs/email-delivery-implementation.md).
After configuring your database and persistent encryption key, run `pnpm mail:worker`
to deliver pending mail to Mailpit, or `pnpm mail:status` to inspect delivery counts.
The preview command remains independent of the database.

For an approved production relay, select `CLOUD_MAIL_TRANSPORT=smtp` and configure
TLS, authentication and your sender using the [production email guide](docs/production-email-implementation.md).
Spain is the preferred email-processing location. The adapter is implemented and tested
against a local TLS server; no live provider account or sender is configured.

## Local remote access

Run two real Waitron servers through a shared gateway using the
[local remote-access guide](docs/local-remote-access.md). It covers staff TLS passthrough,
public bot controls, real certificate issuance, LAN DNS, revocation and gateway replacement.
The commands use disposable local services; no AWS deployment is created.

## Local managed backups

Run encrypted storage and two real Waitron snapshot restores with the
[local backup guide](docs/local-backups.md). It covers key rotation, retention,
scoped credentials and recovery after stream loss. Complete continuous server
replacement still depends on Waitron's SQLite slice-2 recovery implementation.
