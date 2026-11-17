# Custom domains with one DNS record, and names that follow the venue

Status: approved by the owner on 2026-11-17 ("yes"), in the session that produced it.

The owner's decisions so far were made in the session of 2026-11-17 that produced this document:
use one DNS record per custom name, check the name on port 443, and have Cloud answer no plain
`http://` address ("no" to opening port 80).

## Why

When a venue's owner uses their own domain for the venue's staff or customer address (say
`staff.your-cafe.es`), the portal asks them to create two DNS records at their domain provider:

| Type  | Name                                 | Points to                                            |
| ----- | ------------------------------------ | ---------------------------------------------------- |
| CNAME | `staff.your-cafe.es`                 | `staff-v-<venue-id>.<cell-suffix>`                   |
| CNAME | `_acme-challenge.staff.your-cafe.es` | `_acme-challenge.staff-v-<venue-id>.<cell-suffix>`   |

The first sends visitors to Cloud. The second exists only so Cloud can prove to Let's Encrypt that
it may have a certificate for the name: Cloud writes Let's Encrypt's proof as a TXT record under
its own Route 53 name, and the owner's record forwards Let's Encrypt's lookup there
([`dnsInstructions`](../../../packages/remote-access/src/certificates.ts),
[`certificateAuthorization`](../../../packages/remote-access/src/placement.ts)).

The owner wants this down to **one record per name**. A second gain comes with it: today, an owner
who points `staff.your-cafe.es` somewhere else but forgets the second record leaves Cloud able to
get certificates for their name. With the check this design uses, Cloud loses that ability the
moment the first record moves.

## What changes for the owner

For each of their own names, one record:

| Type  | Name                 | Points to                             |
| ----- | -------------------- | ------------------------------------- |
| CNAME | `staff.your-cafe.es` | `staff-v-<venue-id>.<country-suffix>` |

The target no longer names a cell, so it never changes when the venue moves or fails over to
another cell (see *Names that follow the venue between cells*). Everything else they see stays as
it is: it must still be a subdomain (a domain's root cannot be a CNAME), Cloud still checks the
record before switching, and the record stays while the name is used.

## Goals

- An owner's own name needs exactly one CNAME, for both the staff and the public address.
- Cloud gets that name's certificate with Let's Encrypt's **TLS-ALPN-01** check, answered by Cloud's
  gateway on port 443 — the port it already listens on.
- The staff address's private key stays on the venue's box, as today. Only the throwaway key of the
  check certificate is made by Cloud.
- Cloud's own assigned names (`v-…` and `staff-v-…`) keep the DNS check they use today.
- A venue's names — assigned and custom — stay the same when it moves or fails over to another
  cell. The owner never edits their record because of a move, and QR links keep working.
- When an owner's record stops pointing at Cloud, the owner is told in their own language, in the
  portal and by the existing owner alert email.
- Every certificate, for staff and public addresses, assigned and custom names alike, is issued,
  renewed and installed with nobody acting. Owners get no certificate-expiry email (see
  *Renewal runs by itself*).

## Non-goals

- **Plain `http://` addresses.** The owner decided on 2026-11-17 that Cloud does not answer port 80:
  no redirect and no HTTP-01 check. Nothing opens port 80 on the load balancer or the gateways.
- Changing how assigned names get certificates.
- The optional local-network setup for the staff address (router override) — unaffected.
- Wildcard certificates, which this check cannot give and Waitron does not use.
- Live Let's Encrypt, a real Route 53 zone or any AWS change. Those stay behind the owner's separate
  approval, as every remote-access production step does.
- Moving existing custom names over. Nothing is in production; test installations can switch freely.

## Anti-goals — it would be a failure, even working, if

- the gateway answered a check for a name that is not a current route in its own cell's signed
  manifest, so Cloud could be used to get certificates for names it does not serve;
- a check connection ever reached a venue's box, or the check answer were taken from anything the
  box or a visitor sent;
- one venue could get a certificate for another venue's name, or for a name in Cloud's own
  namespace (the existing `hostname_conflict` refusals must stay);
- a failed or half-applied check replaced a working certificate (the existing "keep the last good
  chain" rule must stay);
- the change put the gateway's normal routing — staff passthrough by name, public termination — at
  risk for connections that are not checks;
- moving or failing over a venue to another cell needed the owner to change a DNS record, or broke
  a printed QR link, or left the venue's name pointing at a cell that no longer serves it.

## How it works today (the parts this touches)

- **Load balancer:** opens TCP 443 and WireGuard's UDP port only
  ([`ingress/main.tf`](../../../deploy/aws/modules/ingress/main.tf)).
- **Gateway:** HAProxy in TCP mode on 443. It reads the name the visitor asks for (SNI), passes staff
  names straight to the box over WireGuard, and sends public names to a local HTTPS frontend that
  ends the secure connection with certificates from `/input/public-certs`
  ([`renderHaproxy`](../../../packages/remote-access/src/config.ts)). Its routes come from a signed,
  per-cell manifest it polls every second and accepts only with a higher sequence
  ([`manifest.ts`](../../../packages/remote-access/src/manifest.ts),
  [`authority.ts`](../../../packages/remote-access/src/authority.ts)). It writes the sequence it
  *accepted* to a local `status.json`, with `ready: false` when applying it failed
  ([`gateway-cli.ts`](../../../packages/remote-access/src/gateway-cli.ts)). In traffic-measurement
  mode, every newly accepted manifest starts a new HAProxy process and is recorded for traffic
  coverage, and that mode accepts only manifest version 2
  ([`gateway-traffic-options.ts`](../../../packages/remote-access/src/gateway-traffic-options.ts),
  [`traffic-coverage.ts`](../../../packages/remote-access/src/traffic-coverage.ts)).
- **Renewal worker** (`RemoteConfigurationReconciler`): central; runs Let's Encrypt orders with
  `acme-client` using the DNS check through a pluggable DNS adapter (Route 53 in production), and
  publishes per-cell manifests ([`reconciler.ts`](../../../packages/remote-access/src/reconciler.ts),
  [`reconciler-cli.ts`](../../../packages/remote-access/src/reconciler-cli.ts)).
- **Saving a custom name:** `setHostname` calls `verifyDelegation`, which requires both CNAMEs to
  give exactly one answer each, equal to the shown target, before saving
  ([`placement.ts`](../../../packages/remote-access/src/placement.ts)).
- **Portal:** owner-only English and Spanish screens tell the owner to "Create both CNAME records"
  ([`locale.ts`](../../../apps/portal/src/locale.ts),
  [`remote-screen.ts`](../../../apps/portal/src/remote-screen.ts)).

## Approaches considered

1. **Keep the DNS check (today).** Two records. No gateway work. Leaves the forgotten-record problem.
2. **HTTP-01 on port 80.** Let's Encrypt fetches a small page at
   `http://<name>/.well-known/acme-challenge/<token>`. One record, but it needs port 80 opened on the
   load balancer and every gateway, which the owner declined.
3. **TLS-ALPN-01 on port 443 — chosen.** Let's Encrypt opens a secure connection to the name on 443,
   marked with the special protocol name `acme-tls/1`, and expects a one-off self-signed certificate
   that carries the proof. It needs no new port. Let's Encrypt describes it as "best suited to
   authors of TLS-terminating reverse proxies that want to perform host-based validation like
   HTTP-01" ([challenge types](https://letsencrypt.org/docs/challenge-types/)), which is what the
   gateway is. The installed `acme-client` 5.4.0 supports it, including building the check
   certificate (`acme.crypto.createAlpnCertificate`).

Within approach 3 there are three places the answer could live:

- **a. Inside the route manifest.** Rejected after review. Each check would add two manifests, one
  adding it and one removing it. In traffic-measurement mode each manifest starts a new HAProxy
  process and adds traffic-coverage rows, which feed billing allowances. A new manifest version
  would also break that mode, which accepts only version 2.
- **b. In the gateway, as one plain file per name in the gateway's check folder, delivered the way
  public certificates are — chosen (Claude's call, revised 2026-11-17 after review).** The renewal
  worker writes a small file for each name being checked into the check folder of every cell that
  serves the venue, and each gateway reads that folder in its existing loop. Routes, HAProxy and
  traffic coverage are untouched by a check, and there is no new service or network path. The files
  are not signed, because public certificates and their keys already reach the gateway as plain,
  unsigned files in `/input/public-certs`
  ([`gateway-cli.ts`](../../../packages/remote-access/src/gateway-cli.ts)): anyone who could write
  the gateway's input could already plant a public certificate, so signing the far less sensitive
  check files would add no protection. The first version of this design chose a signed, numbered
  check list; a plain file per name also removes that list's weakness of an older list being
  accepted after a gateway restart.
- **c. One responder per cell that gateways forward check connections to.** This gives one answer,
  so there's no "has every gateway got it yet" question. But it's a new service holding state,
  reached from internet-facing gateways, that needs its own database access or a push path.
  Rejected as more moving parts for the same result.

## Design

### Owner's records and the check before saving

- `dnsInstructions` returns only the routing CNAME for a custom name.
- `verifyDelegation` checks only that record: exactly one answer, equal to the assigned name. The
  existing namespace and reserved-name refusals in `setHostname` stay as they are.
- An `_acme-challenge` record the owner already made is simply no longer used.

### Getting the certificate

For a **custom** name, the renewal worker asks Let's Encrypt for the TLS-ALPN-01 check only
(`challengePriority: ['tls-alpn-01']`). For an **assigned** name it keeps the DNS check. Which one
applies is decided from the name itself: a venue's stored assigned name (under the country suffix)
uses the DNS check; any other name is custom.

For each check:

1. The worker builds the check certificate with a fresh throwaway key
   (`createAlpnCertificate(authz, keyAuthorization)`). It confirms the check is for exactly the
   name it ordered, as today's DNS path does (`unexpected_challenge`).
2. It writes the name's check file (certificate, key, `expiresAt`) itself into the check folder of
   every cell that holds an active or staged route for that venue. Only route jobs publish today
   ([`reconciler.ts`](../../../packages/remote-access/src/reconciler.ts)). The worker loop
   schedules only between batches, so a certificate job cannot wait for a separate job to deliver
   its check.
3. It tells Let's Encrypt the check is ready only once every gateway reports the name answerable
   (see *When to tell Let's Encrypt it is ready*).
4. When the order ends, whether it succeeds or fails, it deletes those files.

The throwaway key is not a secret worth protecting: it can answer only this one check, and only to
someone already reaching the gateway for that name. It still never goes in logs or receipts.

The certificate's own key is unchanged: the box's CSR for the staff address, and Cloud's key for the
public address, exactly as today. `validateCsr` and the publication rechecks
(`publishAuthorizedCertificate`) stay as they are.

### The check files

- One plain file per hostname in the gateway's check folder, holding the check certificate, its
  key and `expiresAt`. No signing, no audience, no sequence.
- The worker writes the file to every cell holding an active or staged route for the venue, and
  deletes it when the order ends.
- The gateway answers a name only if its file is unexpired **and** the name is a route name in the
  gateway's currently accepted manifest. A check file cannot add a route.
- Use an ECDSA throwaway key; `createAlpnCertificate` accepts one.
- A missing, expired or unreadable file means that name's check is not answered. Routing carries
  on unaffected.

### The gateway

- HAProxy's TCP frontend gets one new rule, **ahead of** the name routing:
  `use_backend acme_alpn if { req.ssl_alpn -m str acme-tls/1 }`. It sits ahead of every route,
  whatever the name, so a check connection never reaches a box. The rule doesn't change from one
  check to the next. HAProxy is not pinned: the image runs a plain `apk add haproxy` on Alpine 3.23
  ([Dockerfile](../../../deploy/local-remote/Dockerfile)). The builder confirms that version has the
  `req.ssl_alpn` fetch, and pins it if the rule depends on a version.
- `acme_alpn` forwards to a small local TLS listener on loopback, inside the gateway process. That
  listener:
  - offers only the `acme-tls/1` protocol;
  - picks the certificate by name from the check folder;
  - refuses the handshake for any name that lacks an unexpired check file or is not a route name in
    the accepted manifest;
  - sends no application data and closes after the handshake. RFC 8737 has the validating side
    close straight after the handshake.
- Connections without `acme-tls/1` are routed exactly as today.
- The listener loads the check folder's certificates into memory in the gateway's existing loop. A
  check file never touches HAProxy, the route manifest or traffic coverage. HAProxy is restarted
  only by what restarts it today: a new manifest, and, with `GATEWAY_CERTIFICATE_REFRESH=1`,
  changed public certificate files.
- `status.json` gains the names the gateway can answer right now: unexpired file, loaded
  certificate, and a route name in the accepted manifest.

### When to tell Let's Encrypt it is ready

Let's Encrypt checks from several places on the internet at once. Its own documentation says, for
this check: "if you have multiple servers they need to all answer with the same content." A wrong
answer is expensive: "Up to 5 authorization failures per identifier can be incurred by one account
every hour" ([rate limits](https://letsencrypt.org/docs/rate-limits/)).

So the worker tells Let's Encrypt the check is ready only after **every gateway that can receive
that name reports the name answerable**: its check file loaded, unexpired, and the name a route in
that gateway's accepted manifest. A file merely present is not enough. Today a gateway reports only
to its own `status.json`. Nothing central learns it, and the backlog already lists "multi-gateway
coordination" as open before production
([service-candidates.md](../../backlog/service-candidates.md)). This design therefore:

- defines the readiness rule in terms of a per-gateway "answerable check names" signal;
- in the local proof (one gateway per cell), reads it the way the proof already reads gateway
  status;
- adds the signal to the existing multi-gateway coordination item as a requirement, without
  building central gateway reporting here.

Before tasks are written, the builder states how the local proof reads that signal.

**Time limit.** Today every job holds a 120-second claim, and nothing stops a job that runs past it.
Once the claim lapses, a second worker can pick up the same job and start a second order for the same
name. So the whole order, including the wait for gateways, must stay inside the claim.

Route 53 alone may take 75 of those 120 seconds, so certificate jobs get a longer claim than route and
name jobs. A review on 2026-11-17 found the squeeze. The plan sets the value and shows its arithmetic.
A job that still cannot finish in time renews its claim, as the existing lease fences allow, or gives
up.
Two orders for one name must never be in flight at once.

If the gateways have not confirmed in time, the job ends the order without saying "ready". Nothing
has been validated, so it costs none of Let's Encrypt's failed-check allowance. It then retries
under the existing backoff.

### Renewal and an owner who moved away

Renewal uses the same check. If the owner has pointed their name elsewhere, Let's Encrypt's
connection never reaches Cloud and renewal would fail. Before each order for a custom name, the
worker checks the routing CNAME again with `verifyDelegation`. If it no longer points at the
venue's assigned name, the worker starts no order, so no failed check is spent. Instead the job
records a `dns_not_verified` failure through the existing failure handling: the last good chain
stays, and retries back off within the existing bounds. The owner is told, as below.

### Telling the owner their record has moved

The owner decided on 2026-11-17 ("yes now") that they are told, in this change, in their own
language. The portal offers English and Spanish, so the wording is written in both, and each owner
sees the one they chose.

- **When it shows.** The latest attempt for one of the venue's custom names ended `dns_not_verified`.
  It shows on the owner-only remote-access screen, next to that name, for the staff or the public
  address, whichever is affected.
- **Also by email.** It becomes a new kind of service incident, one for each address:
  `public_record_moved` and `staff_record_moved`; the builder may rename them. It is raised and
  cleared through the existing monitoring transitions
  ([`monitoring.ts`](../../../packages/registration/src/monitoring.ts)). Owners who opted into alerts
  for the venue then get the existing service-alert email, in their saved language
  ([`account-mail.ts`](../../../packages/registration/src/account-mail.ts)), with its existing
  reminders and recovery message. The new kind needs its English and Spanish text and labels there,
  and in the portal's alert list, beside `public_certificate_expiring`. Alert codes must stay as the
  monitoring code expects (`email-outbox.ts` lists the remote-access kinds).
- **What it says** (draft; the builder may tighten it, keeping both languages in step):
  - EN: "Your DNS record for `staff.your-cafe.es` no longer points at Waitron Cloud. Point it back
    to `<target>`, or this address stops working when its certificate expires on `<date>`."
  - ES: "Tu registro DNS de `staff.your-cafe.es` ya no apunta a Waitron Cloud. Vuelve a dirigirlo
    a `<destino>`; si no, esta dirección dejará de funcionar cuando caduque su certificado el
    `<fecha>`."

  `<target>` is the current assigned name, the same one the instructions show. `<date>` is the
  published certificate's expiry. Owners pick their own domain provider, so the notice names none
  and points to none.
- **Check again (Claude's call).** A button reruns `verifyDelegation` straight away, so a fixed
  record needn't wait for the backoff. On success, it makes the certificate job due now and
  clears the notice. On failure, it shows the existing `remoteDnsWait` refusal.
- **When it clears.** The next successful check or certificate clears it.
- **How early (Claude's call).** The record is checked only at renewal attempts, so the notice and
  email appear from the first one. Today that is 30 days before expiry, or the last third of the
  certificate's lifetime if that is shorter
  ([`renewal.ts`](../../../packages/remote-access/src/renewal.ts)). Nothing checks the record
  between renewals.
- **Status line unchanged.** The single remote-access status (ready, pending or not placed) stays.
  The separate "DNS ready" and "certificate ready" readings remain future reporting in the
  [integration contract](../../waitron-integration-contract.md).
- **Where the reading comes from.** The account service needs the reading: for each of the
  venue's names, its kind, the name, whether the record failed the latest check, the target and the
  certificate's expiry. Whether the builder reads it from the job row or adds a column is their
  call; it must be scoped to the owner's own venue exactly as the existing remote-access reads are.

### Renewal runs by itself

**The owner's direction (2026-11-17):** "no need to email anybody, just automate renewal". Then:
"the box isn't running yet so we don't need a stopgap alert until automatic renewal is built".

**What is manual today:**

- **Public certificates.** An operator makes each venue's key and signing request, using Waitron's
  `cloud-certificate.ts csr` command. They list the venue in the renewal worker's configuration
  file (`certificates`: `installationId`, `csrFile`, `output`;
  [`reconciler-cli.ts`](../../../packages/remote-access/src/reconciler-cli.ts),
  [`reconciler-files.ts`](../../../packages/remote-access/src/reconciler-files.ts)), and place
  chain and key in the gateway's `/input/public-certs`
  ([local-remote-access.md](../../local-remote-access.md), "Issue and renew certificates"). The
  worker renews only the venues listed, and only once restarted with the new file.
- **Staff certificates.** These are already automatic end to end through the database exchange:
  - the box makes its key and signing request, and asks Cloud;
  - Cloud issues;
  - the box installs the certificate and starts using it, with no restart.

  On the Waitron side, `refreshStaffCertificate` and the cloud worker do this
  (`apps/server/src/cloud-staff-certificate.ts`, `apps/server/src/cloud-worker.ts`). On the Cloud
  side, the `staffExchange` mode does. But a second, by-hand path is still supported beside it: CSR
  and chain files, installed with Waitron's `cloud-certificate.ts install`.
- **The box's own staff name.** The box reads it from `WAITRON_STAFF_ORIGIN`, a setting someone
  types in (`apps/server/src/config.ts`). It uses that name to ask for its certificate. So a change
  of name, to a custom domain or back, needs someone to edit the box.

**The design:**

- **Public certificates are Cloud's alone, from start to finish.**
  - **No operator in the loop.** For every venue with remote access, the worker makes its own key
    and signing request for each public name, from the database. It renews them in the window it
    uses today, and publishes chain and key to every cell that holds a route for the venue (active
    or staged).
  - **Keys stay out of shared folders.** They are held in the worker's storage for certificate
    keys, never in a file an operator edits. Production storage for these keys is the existing
    open production gate; locally, a private folder is enough.
  - **Gateways load new certificates without a restart**, using the existing
    `GATEWAY_CERTIFICATE_REFRESH` behaviour; the builder makes it the default for public
    certificates. A gateway never serves a certificate for a name that isn't a route in its accepted
    manifest.
  - **The configuration file names no venues.** Its per-venue `certificates` list goes. It keeps
    the cell mappings, Let's Encrypt account details and the DNS module.
- **Staff certificates use only the database exchange.**
  - The file-based staff path is removed from Cloud. Waitron's `cloud-certificate.ts install`
    command stays only if something other than this path still needs it; the builder checks first.
  - Both sides keep refusing production installations until remote access as a whole opens for
    production. That is a production gate, not part of this design.
- **The box takes its staff name from Cloud (the Waitron part).**
  - The exchange reply already carries the hostname, and Waitron already checks it.
  - Waitron uses the current staff name from Cloud's signed installation reply, instead of
    `WAITRON_STAFF_ORIGIN`, both for asking for its certificate and for the checks that a
    sign-in change came from its own page.
  - A name change then needs nobody at the box: the box asks for a certificate for the new name and
    starts using it once it arrives. Until then, it keeps serving the old name with its old
    certificate.
  - Trusting Cloud for this name is within the risk the owner already accepted for A951-S: "a
    compromised Cloud could obtain a staff certificate and intercept logins" (Waitron
    `docs/backlog/replication-cloud.md`, A951).
  - Whether `WAITRON_STAFF_ORIGIN` stays as a fallback for boxes without Cloud is the builder's
    call. Pre-live, removing it is acceptable.
- **No certificate-expiry email to owners.** The owner-facing alerts `public_certificate_expiring`
  and `staff_certificate_expiring` are removed, with their portal and email text
  ([`monitoring.ts`](../../../packages/registration/src/monitoring.ts),
  [`account-mail.ts`](../../../packages/registration/src/account-mail.ts),
  [`locale.ts`](../../../apps/portal/src/locale.ts)). No stopgap replaces them, because no box is
  running yet.
  - A certificate that is failing to renew is Cloud's to fix. The approved-for-planning monitoring
    design already turns it into an operator signal: a work item at 30 days left, a phone page at 7
    ([thresholds design](2026-10-22-cloud-monitoring-thresholds-design.md)). That stays as its own
    work.
  - The only certificate-related email an owner can get is the "record no longer points at Cloud"
    alert, because only the owner can fix that.

### Names that follow the venue between cells

**The owner's requirement (2026-11-17):** "we must be able to fail over to a new cell
transparently". A venue moving or failing over to another cell must not make the owner change their
DNS record, and must not break printed QR links.

**Today this fails.**

- Every cell has its own suffix: the database requires suffixes to be unique, even between two
  cells in the same country
  ([`010_remote_access.sql`](../../../packages/registration/migrations/010_remote_access.sql)).
- A venue's assigned names are built from its cell's suffix when it is placed
  ([`placement.ts`](../../../packages/remote-access/src/placement.ts), `staff-${stem}.${cell.suffix}`).
- The record target and the certificate's check name are recomputed from the venue's *current*
  cell (`#assigned`, `certificateAuthorization`).
- So any move changes what the owner's record must name, and what the assigned public name in the
  QR links is. The path is already listed as unqualified
  ([local-remote-access.md](../../local-remote-access.md)), under the open decision on "stable
  customer-facing addresses on movement"
  ([decisions-in-progress.md](../../backlog/decisions-in-progress.md)).

**The design.**

- **One name per venue and kind, in the country's zone, naming no cell.**
  - The names are `v-<venue-id>.<country-suffix>` and `staff-v-<venue-id>.<country-suffix>`.
  - For Spain the zone is `es.waitron.io`, the zone the DNS module already creates
    ([aws-infrastructure.md](../../aws-infrastructure.md)). The production names under it are not
    chosen, so the country suffix is configuration, as the cell suffix is today.
  - A venue's names are fixed when it is first placed, stored in `remote_hostnames`, and never
    recomputed from a cell.
- **Every place that derives a name from the cell reads the stored name instead:** `#assigned`,
  `certificateAuthorization`, the certificate jobs in `desiredTargets`, the reserved-name check in
  `setHostname`, and the namespace refusal. The namespace refusal now covers the whole country
  suffix as well as every cell suffix.
- **Cloud keeps one DNS record for each stable name, pointing at the venue's current cell.**
  - The target is the cell's own ingress name, which may keep using the cell suffix.
  - Who keeps it: the renewal worker, as a new per-venue name job, the same way it already keeps
    route and certificate jobs. The Route 53 adapter gains CNAME writes for exactly these names. The
    DNS module's permissions already allow CNAME records under `*.es.waitron.io`.
  - Each record has a short time-to-live, so a switch takes effect quickly. The builder chooses
    the value and says how long a switch can take with it.
- **A move or failover switches only Cloud's record**, at the point the move commits to the new
  cell.
  - Before the switch, the new cell must already hold the venue's route, the public certificate and
    any check file. A staged move already publishes the route to the destination cell.
  - The owner's CNAME and the QR links are unchanged throughout.
  - Deciding *when* to fail over, and getting a replacement cell ready when a cell is lost, stay
    with the cell-move work. This design only guarantees that the names never need to change.
- **Certificates follow the stable names.**
  - The DNS check for an assigned name writes `_acme-challenge.<stable name>`, which doesn't change
    with the cell, so the cross-suffix "wrong challenge name" problem in local-remote-access.md
    goes away.
  - For a custom name, Let's Encrypt follows owner's CNAME → stable name → current cell, so the
    check reaches whichever cell serves the venue. During a staged move the check file goes to
    both cells, because the record may switch while an order runs.
- **Nothing is in production**, so no existing venue needs its names carried over. Test
  installations are placed again. A migration that has already run is never edited: the new column
  or table goes in a new migration.

### Portal wording (English and Spanish)

- `remoteDnsHelp`: "Create this CNAME record with your domain provider. It directs your name to the
  venue, and lets Cloud get its certificate." Spanish to match.
- `remoteDnsWait`: one record, not "Both DNS records".
- `remoteDnsApex`: "Keep this record while you use this name."
- The instructions table shows one row.
- The 237-character limit on custom names existed to leave room for the `_acme-challenge.` prefix.
  It can rise to the general 253-character name limit, minus whatever the certificate itself needs.
  This is the builder's call; keeping 237 is also acceptable.
- Other code that assumes two records or the 237 limit, and must change with this:
  - `apps/portal/src/remote-types.ts`, which holds the limit and accepts a reply only with exactly
    two records;
  - `packages/account-http/src/remote-access.ts` and `packages/remote-access/src/operator-cli.ts`,
    which pass the record list on.
- The renewal worker's configuration keeps its DNS module, because assigned names still use the DNS
  check ([`reconciler-cli.ts`](../../../packages/remote-access/src/reconciler-cli.ts)).

## What the tests must show

- **Gateway:** a check connection for a current custom name gets the check certificate. One for an
  unknown name, an expired check file or a name only in another cell's manifest is refused. A check
  connection with a staff name never reaches the box (count backend connections). A normal
  connection with the same name is routed as before.
- **Check files:** the gateway ignores an expired file, a file whose key does not match its
  certificate, a certificate without the `acme-tls/1` proof, and a file for a name that is not a
  route in its accepted manifest. In traffic-measurement mode, writing a check file starts no
  HAProxy process and adds no coverage row.
- **Worker:** an order for a custom name uses TLS-ALPN-01 only, and one for an assigned name uses
  DNS-01 only. "Ready" is never sent before every gateway reports the name answerable; a file
  present but not answerable (for example, its route not yet in the gateway's manifest) does not
  count. A timed-out wait sends nothing and retries. Two workers never hold orders
  for one name at once. The check files are deleted after success and after failure. A renewal for a
  name whose CNAME has moved starts no order and records `dns_not_verified`. A venue with a staged
  move gets the check file in both cells.
- **Saving a name:** one record is required, and a missing or wrong one is refused with
  `dns_not_verified`. The namespace and reserved-name refusals still hold.
- **Stable names:**
  - A venue placed in one cell and moved to a cell with a different suffix keeps both names.
  - Its certificate jobs keep the same check names.
  - The record a custom name must point at is unchanged, and `verifyDelegation` still passes after
    the move.
  - Cloud's DNS record for the name switches to the new cell when the move commits, and not before.
  - A cancelled move leaves the record on the old cell.
  - A name under the country suffix, or under any cell suffix, is refused as a custom name.
  - The local two-cell proof shows the public and staff addresses answering through the new cell
    after a move, with the owner's CNAME untouched.
- **Renewal by itself:**
  - A newly placed venue gets public certificates for both its names with no configuration-file
    entry and no operator command.
  - A certificate inside its renewal window is renewed and reaches every cell holding the venue's
    route.
  - A gateway picks it up without a restart.
  - The worker's configuration with no per-venue list is accepted, and one with a per-venue list is
    refused, so the old shape cannot linger.
  - Changing a staff name in Cloud leads the box (Waitron's tests, against a fake Cloud) to ask for,
    install and serve a certificate for the new name, with no setting changed. Its own-page checks
    accept the new name and refuse the old one once switched.
  - The `*_certificate_expiring` incidents are no longer raised for owners, and no owner email or
    portal text for them remains.
- **Notice:**
  - It shows for the affected name only, in the owner's chosen language (tested in both), with its
    target and expiry date.
  - The incident opens and clears through monitoring, and an opted-in owner gets the email in
    their saved language.
  - It is not shown to another venue's owner, nor to someone who isn't an owner.
  - "Check again" clears it and makes the job due, once the record is right. With the record
    still wrong, it shows the existing refusal and changes nothing.
  - A later successful certificate also clears it.
- **Local proof:** the existing two-venue remote-access proof issues a custom-name staff and public
  certificate through Pebble's TLS-ALPN-01 check against the real gateway, then renews one. Pebble
  validates on the port its config names. The builder confirms the port in the pinned image's config,
  and points it at the gateway's 443.

Any changed test check goes under "Changed test checks" in the pull request, as the repository rule
requires. `verifyDelegation`'s tests change deliberately, from two records to one.

## Left to the builder

- The check files' format, folder location and file naming.
- Whether the loopback listener is part of the existing public-gate process or a sibling inside the
  gateway process.
- How the local proof reads each gateway's answerable check names.
- Whether a long order renews its claim or is bounded to fit inside it.
- Whether to raise the 237-character custom-name limit.
- Updating [local-remote-access.md](../../local-remote-access.md), the
  [integration contract](../../waitron-integration-contract.md) and the relevant entries in
  `docs/backlog.md` and `docs/backlog/` in the same pull request.

## Still open after this lands

The same production gates as the rest of remote access: live Let's Encrypt, the real zone,
production keys, and multi-gateway coordination, which now carries this design's answerable
check-names signal, and getting each venue's check files to every gateway of a cell.

The cell-move work keeps two questions: when to fail over, and how a replacement cell is made ready
when one is lost. This design removes names from those questions, but doesn't answer them.

Two repositories change. Cloud carries almost all of it. Waitron carries one part: the box takes
its staff name from Cloud and follows a name change by itself. The two land in an order that never
leaves a box asking for a name Cloud no longer serves. Cloud's reply carries the name first, and
Waitron starts reading it after.
