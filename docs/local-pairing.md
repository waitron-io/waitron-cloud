# Connect your local test venue to Cloud

You can connect a Waitron venue through its Cloud services screen in Settings and
Cloud's `/connect` page. You need a local manager login with `system.manage` and a
Cloud account permitted to register venues for the chosen business.

1. In Waitron, choose **Connect to Cloud**. Keep the eight-digit code on screen.
2. Choose **Open Cloud**, sign in and enter that code. Check the venue identifier and
   choose the business that owns it. Choose **Approve this venue**.
3. Return to Waitron and choose **Check connection**. Check the organisation and
   legal business, then choose **Connect this venue**.

Approval in Cloud waits for your final confirmation in Waitron. Connecting registers
the installation; remote access and backups still show **Not configured**. You can
retry a failed check or confirmation. If Cloud reports the request unavailable,
choose **Start again** in Waitron to obtain another code. This keeps the installation
key and replaces the unavailable request.

## Run the local integration proof

Build the Cloud portal and the dashboard in your Waitron checkout first. Use a Waitron checkout containing the installation lifecycle adapter and
`apps/server/scripts/cloud-integration-fixture.ts`. From this Cloud checkout:

```sh
pnpm portal:build
pnpm --dir "$WAITRON_CHECKOUT" --filter @waitron/dashboard build
WAITRON_CHECKOUT="$WAITRON_CHECKOUT" node scripts/test-postgres.mjs exec node scripts/test-waitron-pairing.mjs
```

Set `WAITRON_CHECKOUT` to an absolute checkout path. The runner starts disposable
PostgreSQL and Mailpit containers, two real Waitron server processes with separate
SQLite directories, and Chromium. It provisions test venues in demo mode; it does
not create invoices, configure payment providers or submit fiscal records. It removes
its own processes, containers and temporary directories when the run finishes.

The proof connects both venues through the browser screens using real local and
Cloud sessions. It restarts a venue before local confirmation, discards a committed
completion reply and recovers the result, and refuses a proof that mixes one
installation's key with the other's request. It then discards renewal and revocation
responses after Cloud commits and restarts the actual Waitron processes. Their
background workers recover both operations. Independent configurations and synthetic
adapter observations remain scoped to each venue; revoking one leaves the other
connected. The observations test reporting, not a working tunnel or backup.
It prints both source revisions and
whether the Waitron tree contains uncommitted changes. Set `PAIRING_RECEIPT` to save
that output as JSON. Each repository's CI remains independent of a sibling checkout.

## Configure a development server

Set `WAITRON_CLOUD_ORIGIN` on Waitron to the Cloud portal's exact origin, without a
trailing slash. HTTPS is required; `WAITRON_ENV=dev` also permits HTTP on loopback.
The browser cannot supply a Cloud destination or local venue identifier. Waitron
uses its provisioned location and maps preproduction/development to Cloud's test
installation environment.

The node keeps `cloud-connection.json` in its protected state directory, separate
from the venue database. Run one server process per node state directory. The file
contains the installation's private key; keep it out of customer exports and managed
replacement restores. Current Waitron recovery capture selects its own named secret
and configuration files. A replacement needs a fresh Cloud identity.

The Cloud API needs `CLOUD_INSTALLATION_ISSUER_KEY` to issue access leases; see the
[API guide](../packages/account-http/README.md#installation-access-and-status). The
local fixture generates its own test issuer. Waitron refreshes access once a minute
and renews with ten minutes left. The screen separates configuration from observed
health, and shows the last contact and expiry.

Choose **Stop Cloud access** in Waitron, or sign in to Cloud as the organisation owner
and choose it for the installation. Confirm the consequences before submitting.
You can retry a lost response. This permanently retires the installation identity,
preserves stored backups and venue records, and leaves local trading and billing alone.
Replacement recovery will issue a fresh identity.

Before public deployment, complete ingress controls and
operation/pairing audit retention work in the backlog. This local proof does not establish an
AWS deployment or a working remote-access/backup service.
