# Connect your local test venue to Cloud

You can connect a Waitron venue through its Cloud services screen in Settings and
Cloud's `/connect` page. You need a local manager login with `system.manage` and a
Cloud account permitted to register venues for the chosen business. Enrol a passkey
or authenticator app in your Cloud account before connecting a box.

1. In Waitron, choose **Connect to Cloud**, then **Open Cloud**.
2. Sign in to Cloud. It checks the code from the link and shows the venue. If
   Cloud asks for a code, enter the eight-digit code shown in Waitron.
   Check **Venue name** when the box sends one. Check **Venue identifier** to see
   **New venue** or the existing Cloud identifier. Choose the business that owns
   the venue, verify your identity if Cloud asks, and choose **Approve this venue**.
   One verification covers sensitive actions in that session for ten minutes.
   The approved page repeats the venue, installation type, organisation and legal
   business and links back to your Cloud account.
3. Return to Waitron and choose **Check connection**. Check the organisation and
   legal business, then choose **Connect this venue**.

Approval in Cloud waits for your final confirmation in Waitron. Signing out or
changing your password or security methods withdraws that pending authority at
local confirmation. Keep
the same account’s permission and an enrolled method; the browser’s idle timeout and the
ten-minute verification window do not cancel an already authorised local confirmation. Once connected, the box can retry its
completed reply independently of the old browser session. Connecting registers
the installation; remote access and backups still show **Not configured**. You can
retry a failed check or confirmation. If Cloud reports the request unavailable,
choose **Start again** in Waitron to obtain another code. This keeps the installation
key and replaces the unavailable request.

Upgrade your box to a Waitron build that supports pairing version 3 before you
pair it with this Cloud. If you started pairing before the version switch, start
again from the updated box.

In Cloud, open **Venues** to see the name your box sent when it paired. When
Cloud has no name, it shows **Venue** and a short identifier. Open **Details**
for the full identifier, connection times, service health and snapshot status.
To add a venue, start in Cloud services on that venue's Waitron box.

## Connect an installed test box with Cloud sign-in

On a test Cloud using venue service levels, configure the account service with
`CLOUD_SETUP_PAIRING_PUBLIC_KEY` for the box's Ed25519 public key and
`CLOUD_SETUP_PAIRING_REDIRECT_URI` for its exact HTTPS
`/cloud/pairing/callback` URL. For the Amazon test configuration, set both
values in the deployment environment for the account service. Remove both
values when the check is finished.

From a Waitron test build with setup pairing, open **Cloud services** and start
sign-in. Use an existing Cloud account with a passkey or authenticator app.
The same tab returns to your box and Cloud files the saved venue under the
matching business. Cloud ignores spaces and hyphens when it compares tax
numbers and keeps the number as entered. If your only business still has
an empty tax number and no venues, Cloud uses it and saves the number from
your box. Choose **Back to Waitron** to leave sign-in and try again from the box.

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
Cloud sessions. Both Cloud screens show **Cloud Test Venue** from the Waitron fixture.
It restarts a venue before local confirmation, discards a committed
completion reply and recovers the result, and refuses a proof that mixes one
installation's key with the other's request. It then discards renewal and revocation
responses after Cloud commits and restarts the actual Waitron processes. Their
background workers recover both operations. Independent configurations and synthetic
adapter observations remain scoped to each venue; revoking one leaves the other
connected. The observations test reporting, not a working tunnel or backup.
It prints both source revisions and
whether the Waitron tree contains uncommitted changes. Set `PAIRING_RECEIPT` to save
that output as JSON. Each repository's CI remains independent of a sibling checkout.

## Prove translation survives interruptions

Use Node 26 or later, local Docker and installed Playwright Chromium. Build the
Cloud portal and a clean, separately prepared Waitron checkout containing paging
[#1901](https://github.com/clintongormley/waitron/pull/1901) and the fixture repair
[#1903](https://github.com/clintongormley/waitron/pull/1903). The proof has passed
against Waitron `a3be14ba4e59bc8104087624171ddabec4978de2`. Build only a checkout you
own; the proof refuses uncommitted Waitron changes and a dashboard bundle missing
the translation-notice markers.

```sh
pnpm portal:build
pnpm --dir "$WAITRON_CHECKOUT" --filter @waitron/dashboard build
WAITRON_CHECKOUT="$WAITRON_CHECKOUT" node scripts/test-postgres.mjs exec node scripts/test-waitron-translation.mjs
```

This runs five independent cases with fresh synthetic venues: a lost page reply,
restart with SIGTERM, restart with SIGKILL, a lost release reply and expiry between
pages. Cloud uses its real worker with a local fake provider. No provider key or
customer menu is needed. A 512-byte fixture budget forces three one-item pages;
the production page budget remains 16 MiB and Waitron's page timeout remains 120 seconds.

Each release waits for a read-only SQLite check of the complete stored result.
Restart checks inspect the saved first-page cursor and the next process's actual
request. Expiry checks keep that first suggestion and read the real dashboard bell
before opening suggestions, because opening the finished run clears its notice.

The command prints JSON with both revisions, ordered request cursors, process
generations, counts, deletion and cleanup evidence. Set `TRANSLATION_RECEIPT` to
save it to a JSON file; response bodies are represented by hashes. To investigate
one case, add `--case lost-page`, `restart-term`, `restart-kill`, `lost-release` or
`expiry`. `--case baseline` runs the healthy three-page walk. A failed case exits
nonzero. Every case stops its recorded children, closes Cloud and removes its own
temporary venue. The surrounding runner removes its PostgreSQL and Mailpit containers.

This proves the named interruptions with synthetic input. Provider quality,
bounded decoded reads, commercial decisions and production deployment remain
separate [release gates](waitron-integration-contract.md#translate-all-version-1).

## Configure a development server

Set `WAITRON_CLOUD_ORIGIN` on Waitron to the Cloud portal's exact origin, without a
trailing slash. HTTPS is required; `WAITRON_ENV=dev` also permits HTTP on loopback.
The browser cannot supply a Cloud destination or venue identifier. A new box requests
an empty venue id. Cloud allocates its id when both approvals complete, and Waitron
records that same id in its venue database. Preproduction/development maps to Cloud's
test installation environment.

The node keeps `cloud/connection.json` in its protected state directory, separate
from the venue database. Run one server process per node state directory. The file
contains the installation's private key; keep it out of customer exports and managed
replacement restores. Current Waitron recovery capture selects its own named secret
and configuration files. A replacement needs a fresh Cloud identity.

The Cloud API needs `CLOUD_INSTALLATION_ISSUER_KEY` to issue access leases; see the
[API guide](../packages/account-http/README.md#installation-access-and-status). The
local fixture generates its own test issuer. Waitron refreshes access once a minute
and renews with ten minutes left. The screen separates configuration from observed
health, and shows the last contact and expiry.

Choose **Stop Cloud access** in Waitron to retire the installation's connection.
As an organisation owner, you can also choose **Remove venue** under **Venues** in
Cloud. This stops its Cloud connection and hides its card, even if you already
stopped the connection. The same confirmation takes down any shared guest menu.
If Cloud cannot take the menu down, you can retry removal from the same card.

Local trading continues and Cloud keeps your saved backups. For a test venue,
you can still select it in Recovery. Charges continue and the venue stays in
**Billing**. You can retry if you lose the removal reply. Replacement recovery
issues a fresh installation identity.

Before public deployment, complete ingress controls and
operation/pairing audit retention work in the backlog. This local proof does not establish an
AWS deployment or a working remote-access/backup service.

Pairing accepts only version 3. Each retry signs the id its request started with, so
an empty request stays empty even after its reply contains the allocated Cloud id.
An unknown or foreign supplied id is refused before approval. A different installation
key cannot take over an existing venue through pairing.

Migration 064 discarded old pairing and connection requests and preserved venues,
installations, keys and backups. Start again for a fresh code when you switch to
a Waitron build that uses the version 3 proof. Configure the separately held
[pairing-code key](pairing-code-keys.md) before starting account workers. The
stored code verifier keeps its version-1 domain.

If the completion reply is lost before Waitron saves its allocated venue id, retry
the original request. A fresh empty-id request with the same key is refused; once
history cleanup deletes the original request, that retry is unavailable. If you
already have the Cloud venue id, the same key can quote it in a new request.
