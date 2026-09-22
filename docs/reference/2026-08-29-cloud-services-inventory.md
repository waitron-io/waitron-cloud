> Moved from [Waitron at `830cf71fe854`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/superpowers/specs/2026-08-29-cloud-services-inventory.md) on 2026-09-22.
> This is a historical reference. Its original decisions, proposals and evidence have
> been preserved; read the [current product discussion](../product-and-platform.md)
> and [cloud backlog](../backlog.md) for current scope and unresolved decisions.
> Technical and legal claims below have not been revalidated as part of this move.

# Cloud services inventory & decision rules

**Date:** 2026-08-29
**Status:** Strategy note (brainstorm capture). NOT an implementation spec — nothing here is scheduled
to be built. It records the *candidate services*, the *rules for deciding what belongs in the paid
cloud vs. the open-source core*, and the reasoning, so a future session prioritising or packaging
this work does not have to relitigate the framing.

---

## 1. The tension this document exists to resolve

Waitron's on-prem product is **open source (ELv2)**. Anyone in the community can build a core POS
feature, and the licence does not let us stop them. So **a business model that depends on withholding
a core feature is a model the licence will not defend** — someone will add the feature, and we cannot
say no.

Therefore the paid cloud offering cannot be "the on-prem product minus some features you have to pay
to unlock." It has to be services that are *genuinely hard or uneconomical to self-host*, so the
value is real and not just an artificial gate.

## 2. The decision rule

A capability belongs in the **paid cloud** only if it passes at least one of these two tests:

- **[O] Online-only by nature** — it literally cannot work without being online. Reaching a box behind
  NAT, storing data offsite, seeing across multiple venues, serving a public web page, updating a
  fleet. A single on-prem box physically cannot do these alone.
- **[B] Bulk-cost economics** — it has real per-unit costs that are **cheaper for us to buy in bulk and
  pass on** than for each venue to buy directly. Messaging volume, storage, AI inference, negotiated
  payment rates, maintaining one third-party connector on everyone's behalf.

Every cloud row below is tagged **[O]**, **[B]**, or both.

**Everything that passes neither test belongs in the open-source core** — and if it belongs in core,
we do not fight the community for it.

Two deliberate additions to the rule:

- **On-ramp exception.** Ready-made hardware breaks "scales without staff" on purpose — see §6. It is
  allowed because it is the acquisition channel that seeds the fleet, not because it scales.
- **Rejected: staff-boundary traps.** Some candidates look scalable but drag in humans as they grow.
  They share one signature — see §3.

## 3. Two principles that decide the hard cases

### 3a. The trust-boundary principle (what turns a service into a staffing cost)

Services that touch only **the owner's own data** scale cleanly. Services that **mediate between the
owner and a third party** — inspectors, message recipients, reviewers, suppliers, delivery APIs, forum
posters — pull in humans as they grow (identity verification, moderation, abuse handling, dispute
resolution).

Our response at any such boundary: **provide the tooling — in the core product or as a cloud UI — but
make the user the responsible party.** Their Google account, their AEAT grant, their moderation
decision, their processor doing the KYC. **We never take on the moderation or the liability
ourselves.** This is what keeps the flagged items from becoming a support desk.

### 3b. Integrate, don't operate (commodity infrastructure)

Commodity infrastructure with a healthy competitive market — **DNS, website hosting, mailboxes** — has
excellent cheap providers already at scale. Operating it ourselves is undifferentiated work where we
compete on price with giants *and* inherit their support load. There is no bulk-cost win (the market
is already at scale) and no online-only necessity (anyone can buy it).

So: **rely on the existing providers.** Integrate or resell; never operate. The only nuance is where a
commodity is *internal plumbing* for something we do sell (we control DNS records to issue certs and
route remote access — but that is a hidden dependency of remote-access, not a product line). See §7.

### 3c. Saleable service vs. internal plumbing (do not list machinery as product)

A recurring error while drafting this inventory: listing **the machinery required to run a cloud
business** as if it were a **service a venue pays for**. It is not. Before an item enters a cloud
bucket, ask: *does a venue pay for this, or do we need it in order to charge for the things they do pay
for?*

- **Saleable** = the venue gets value they'd pay for directly (backups, analytics, remote access,
  booking).
- **Internal plumbing** = we cannot operate the cloud without it, but nobody buys it: billing /
  entitlement management, feature flags, fleet-rollout orchestration, the device registry, SSO across
  our own services. These are real and must be built — they are just **not inventory items**. They live
  in their own note (§4, "Internal plumbing") so they are not mistaken for revenue lines.

---

## 4. The buckets

### CORE — on-prem, open source (do not cloudify)

These are table-stakes POS features. The community would (and should) build them; forcing them into
the cloud would be an artificial gate the licence won't protect.

- Card payments (Stripe) and multi-provider support (Redsys, SumUp, …)
- Payment reconciliation, tips reconciliation, chargeback/dispute alerts
- Within-venue device networking (tills, KDS, handhelds on the LAN; TLS, not a VPN)
- Local analytics & dashboards for a single venue
- Menu / catalogue management (local)
- Inventory / stock, recipes / BOM, price management / menu engineering
- Staff scheduling; registro de jornada (local record)
- Waitlist / queue management (local); customer feedback & survey *tooling*
- Manager end-of-day / shift-handover reports
- Public API + webhooks (the surface; hosting a public endpoint is the [O] part)
- Audit logging (local)
- **AEAT submission outbox** — the core product already files records and retries; a cloud relay adds
  nothing, since it only helps if the box is down *while trading*, which cannot happen. (Was listed as
  a cloud service; removed.)
- **Month-end `consultar` reconciliation** — fiscal-correctness function. (Was cloud; moved here.)
- **Regional fiscal variants** — TicketBAI (Basque/Navarra), SII for larger clients. (Was cloud;
  moved here — fiscal features the community owns.)
- **Clock sync (NTP)** — OS-level; just NTP, not a service. (Was listed as "trusted time sync";
  removed.) The regulation's only time rule is that the system clock stay within one minute of official
  time — an NTP obligation, not a qualified-timestamp one; **no RFC-3161 TSA is required** (verified
  against the AEAT developer FAQ — see §12).
- **Basic single-venue analytics & dashboards** — the operational read-out; the *paid* boundary is the
  cloud analytics/reporting service (fast explorability + scheduled reports + benchmarking), not the
  numbers themselves.
- **Device identity (first-run key)** — each box/till generates its own key on setup so it can prove
  who it is. The cloud only needs a *registry* of which device belongs to which venue, which folds
  into remote-access ("make the box reachable"), not a separate product.
- **OTA update mechanism** — check version / download / apply / roll back; artifacts come from GitHub
  releases (free CDN). A single self-hosted venue just pulls latest. (Only *fleet-rollout
  orchestration* is cloud-shaped — see Internal plumbing.)

### CLOUD — online-only by nature [O]

- Remote access to a venue's box **[O]**
- Public TLS cert issuance / ACME **[O]** (needs public DNS reachability — see §7)
- Cloud primary **[O]**
- Cloud mirror + failover **[O]**
- Cloud backups, point-in-time restore, disaster-recovery orchestration **[O]** (offsite is the point)
- Cold archival of closed fiscal years **[O]**
- Owner data export / portability **[O]** (also a GDPR obligation)
- AEAT permanent record + owner-approved inspector logins **[O]** (see §3a — inspector identity is the
  boundary; the owner self-serves the grant with an audit trail)
- Digital-certificate custody + auto-renewal (the owner's AEAT cert) **[O]** — the one genuine cloud
  KMS case: a cloud service must *hold and use* the venue's cert to renew it. All other secrets stay
  local/core.
- Compliance / audit-trail dashboard + export **[O]**
- Regulatory-change feed (new fiscal rules shipped as updates) **[O]**
- **Venue / box monitoring & alerting** **[O]** — the reframed "Veri\*Factu health" entry, generalised:
  online/offline, disk, backups succeeding, printer / card-reader down, **and** fiscal-submission
  health (series gaps, stuck submissions) as one signal among many. Only something *outside* the box
  notices when the box itself dies. **Absorbs** the former "uptime/heartbeat monitoring" and
  "fleet-health dashboard" rows — one service.
- **Analytics & reporting service** **[O][B]** — ingest each venue's data (single **and** multi-venue)
  into a cloud search/analytics store (Elastic or similar) for fast explorability + scheduled generated
  reports, plus cross-venue **benchmarking**. **[O]** because cross-venue is impossible locally; **[B]**
  because running Elastic is heavy infra, far cheaper multi-tenant than on each little on-prem box — so
  even a single venue wins by offloading it. Downstream of the operational DB, never in the sale path.
- Software-update attestation (proof the SIF was patched) **[O]** — speculative: hard to do meaningfully
  on commodity hardware; keep as a maybe, not a committed service.
- Multi-venue console / central menu push / central config **[O]** (hub-and-spoke — see §5; absorbs the
  former "remote configuration management" row)
- Franchise / group console **[O]**
- Cross-venue inventory aggregation, cross-venue registro-de-jornada aggregation **[O]**
- QR digital-menu hosting **[O]**; website hosting → integrate, see §8
- Online booking / reservations (software) **[O]** (see §9)
- Online ordering (pickup / delivery) **[O]**
- Pay-at-table / QR pay / order-and-pay **[O]** (software is core; the public reachable page is the [O]
  layer we provide)
- E-receipt / e-invoice delivery to the diner **[O][B]**
- Loyalty / customer accounts / gift cards **[O]** (shared identity across visits/venues)
- Opening-hours / status broadcast to Google Business, and generalisable to Apple Business Connect,
  TheFork, the venue's own site **[O]** (backlog #19; Google is customer #1 of a small broadcast
  service; clean fit because it's the owner's own data going to a service they already control)
- Status page, self-service knowledge base **[O]** (self-serve — no staffing boundary)

*(Removed from this bucket after review: the OTA update **mechanism** and **artifacts** are core/GitHub
— only fleet-rollout orchestration is cloud, and that's internal plumbing; **device
provisioning/identity/attestation** demoted — identity is a core first-run key, the registry folds into
remote-access, at-scale provisioning is hardware fulfillment, attestation is speculative;
**remote-config** and **fleet-health** folded into the multi-venue console and the monitoring service;
**uptime monitoring** absorbed into the monitoring service; **trusted time sync** is just NTP/core and
fiscal timestamping is **not required** by the regulation (verified — see §12); **secrets/KMS** kept only as the AEAT cert-custody case
above; **SSO** and **entitlement/feature-flags** moved to Internal plumbing.)*

### CLOUD — bulk-cost economics [B]

- Transactional messaging: email (SES/Postmark), SMS, WhatsApp **[B]** — send volume bought in bulk,
  cheaper per message than each venue. This is **infrastructure for booking/ordering/receipts, not a
  product** — it is a dependency, not a debate. (Sending only; NOT mailboxes — see §8.)
- Bulk cloud storage (backups, archival) **[B]** — cheaper than each venue arranging offsite.
- **Discounted payment processing rates** by aggregating many restaurants' volume **[B]** — see §10.
- AI / intelligence, where shared models + amortised inference beat each venue running their own **[B]**:
  demand forecasting → staffing prediction; AI reorder / inventory optimisation; sales-anomaly &
  internal-fraud detection; menu / pricing optimisation; natural-language analytics ("ask your data");
  customer churn / RFM segmentation.
- Cross-venue **benchmarking** ("your food-cost % vs. similar delis nearby") **[O][B]** — needs the
  pooled data of many venues *and* shared compute; impossible alone and cheaper in aggregate. (Delivered
  by the analytics/reporting service above.)
- **Delivery-platform connector** (Glovo / Uber Eats / Just Eat → shared order queue) **[B]** — the
  bulk argument is real (we maintain *one* connector for everyone instead of each venue chasing the
  API), but flagged ⚠: each platform's API rots and someone has to chase it. Start narrow.

### INTERNAL PLUMBING — needed to run the cloud, NOT a saleable service (see §3c)

Real, must be built, but no venue buys them. Kept here so they are not mistaken for revenue lines.

- Billing / subscription / **entitlement management** ("what has this venue paid for; is their card
  still valid")
- **Feature flags** (remote on/off, staged rollout, killswitches)
- **Fleet-rollout orchestration** (which venue gets which version when; canary + auto-rollback;
  update-success telemetry) — the only cloud-shaped part of OTA; mostly *our* tool for the fleet we host
- **Device registry** (which device belongs to which venue + its identity) — needed by remote-access
  and mirror anyway
- **SSO across our own cloud services** (one login for remote access, analytics, booking admin) — the
  cloud-account identity layer that makes the other services usable; ties to the landed identity/auth
  work (#144). Single-venue login is core auth.

### ON-RAMP — deliberately not cloud-scaling (see §6)

- Ready-made hardware with software pre-installed. **Breaks "scales without staff" on purpose.**

### INTEGRATE / RESELL — commodity, don't operate (see §3b, §8)

- DNS hosting → rely on providers (internal plumbing for certs/remote-access is a dependency, not a
  product — §7)
- Website hosting → rely on providers (Vercel/Netlify/Cloudflare)
- Email **mailboxes** → resell a provider (Google Workspace/Fastmail); the venue operates it, not us
- Accountant / gestor export (Holded, A3, …) → integrate
- Payroll → integrate, don't build (backlog note: integrate-not-build)
- CDN for menu images/assets → rely on a provider

### REJECTED — staff-boundary traps (§3a); provide *tooling*, not the service

- Email hosting / mailboxes as an *operated* service (deliverability + abuse desk)
- Bulk marketing email campaigns (abuse desk) — transactional sending only
- Reviews / reputation moderation (we may surface reviews as *tooling*; we do not moderate)
- Community forum as a moderated service
- Procurement / supplier onboarding as a managed service (supplier vetting needs humans)
- Booking **marketplace / directory** (two-sided demand-gen — the expensive, staff-heavy part; see §9)
- Reservation aggregators in general (what TheFork charges for — see §9)
- Remote diagnostics as a *we-read-your-logs* service (that is support); a *self-serve* fleet-health
  view is fine and lives under CLOUD:[O]

---

## 5. Multi-venue: hub-and-spoke, not a mesh VPN

The "secure device network / VPN between a venue's own devices" idea was retired: within one venue the
devices are on the same LAN as the box and TLS already secures that traffic — there is nothing to sell.

For an owner with **multiple geographically remote venues**, the answer is **not** a peer-to-peer VPN
between venues. It is **hub-and-spoke through the cloud that already exists**:

- Each venue keeps its **own autonomous on-prem box**, local-first. A venue keeps trading even when cut
  off from every other venue and from the cloud ("nothing may block a sale").
- Each box **dials outbound** to the cloud (the snitun tunnel). No venue needs a static IP, open ports,
  or NAT configuration — it works over anyone's broadband. (Matches the confirmed sync connection
  direction: the on-prem box always dials out.)
- The cloud is the **hub**. The owner viewing both venues, pushing one menu to both, comparing them,
  or remotely reaching any one box all go **through the cloud**, never venue-to-venue.
- **Venues never talk to each other directly.** There is no reason venue A's till should reach venue
  B's box.

This is *why* multi-venue is a legitimate paid cloud service and not a core feature: **a single
on-prem box physically cannot see another venue.** Only an online hub can.

## 6. Hardware — the deliberate exception

Ready-made hardware with software pre-installed lowers the barrier for a non-technical owner to get
from "interested" to "trading." It **does not scale like cloud** — it is inventory, shipping,
warranty, and RMA, all of which are real costs and real people (logistics, returns).

It earns its place for a *different* reason than the cloud services: it is the **acquisition channel**,
not the business. Framing:

- **Hardware is the on-ramp; the recurring cloud subscription is the scalable annuity.** Sell hardware
  at cost or thin margin; the cloud services are where the money is.
- **Own-hardware stays first-class.** It is the open-source promise and a pressure valve: a tinkerer
  runs their own box, a busy owner buys ours. The appliance is *convenience, never lock-in.*
- It **reinforces the fleet cloud services**: pre-installed + device identity/attestation + OTA updates
  means the shipped box stays patched and trusted for its whole life. The appliance and the
  fleet-management services are the same story from two ends.

Filed in its own bucket with this note so a future reader does not "fix" it by trying to make it scale.

## 7. DNS, certs & remote access — never host their DNS

We do **not** need to host a venue's DNS to issue certs or route remote access. It splits by *whose
brand the public name wears*.

### Case 1 — the name lives under *our* domain (the default)

For everything that does not need the venue's branding — **all remote admin access, the till, internal
fleet** — give them a subdomain of a domain *we* own: `sunny-deli.waitron.app`. We control that zone
completely:

- **Cert:** we issue it ourselves; no venue involvement.
- **Routing:** the name points at our **relay**; the box dials out to the relay (the tunnel). The
  public endpoint is our cloud, never the box.

Zero DNS work on the venue's side, identical for every venue, most robust. Covers the majority of
"issue a cert + route remote access."

### Case 2 — the name must wear *their* brand (`book.sunnydeli.com`)

Only customer-facing pages (booking, menu) really need this. Options, worst first:

1. **Host their whole DNS** (nameservers → us) — ❌ avoid. Commodity-operate trap plus maximal blast
   radius (fumble their MX and their email breaks).
2. **Subdomain delegation** — they add one `NS` record delegating `pos.sunnydeli.com` to us; we
   automate under it, their apex/website/email untouched. Clean, but more than we need.
3. **Tell them the records to make** — ✅ the light default. Two one-time records, then we never touch
   their DNS again:
   - `CNAME book.sunnydeli.com → sunny-deli.waitron.app` — routes their branded name to our relay.
   - `CNAME _acme-challenge.book.sunnydeli.com → book-sunnydeli.acme.waitron.app` — **delegates cert
     issuance to us.** Because that record points into a zone *we* own, we write the ACME TXT record
     ourselves on every renewal, forever, wildcards included — without hosting their DNS. This is the
     standard ACME CNAME-delegation pattern (`acme.sh`/`lego` follow it natively).
   - Or skip the cert record: since traffic flows through our relay, the relay can answer an **HTTP-01**
     challenge, so the single routing CNAME may suffice. DNS-01 + the delegation trick is only
     *required* for **wildcard** certs.

> These ACME/CNAME patterns are established externally but are stated here as design intent, not as a
> receipt — verify the exact `acme.sh`/`lego` behaviour and challenge flow against a real issuer before
> building.

### "An interface to the common hosting services?"

- **Guidance interface** (✅ start here): detect their provider, show the exact records to paste /
  deep-link into Cloudflare/Google/etc. No credentials change hands — a nicer wrapper around Case 2.
- **API-token interface** (⚠ later, optional): they paste a DNS API token and we write records
  automatically. Slick, but hands us write access to their *whole* zone (blast radius) and makes us
  custodian of a secret (security/support burden). It re-introduces exactly the risk the CNAME trick
  avoids. A convenience for big providers, never the foundation.

**Bottom line:** never host their DNS; own-domain subdomain handles all internal/admin/remote-access
with no venue DNS at all; their-brand pages cost them one or two one-time records.

## 8. Email — split the "maybe"

"Maybe we handle email" is really two different things:

- **Transactional sending** (booking confirmations, e-receipts, "your order's ready", resets) — **yes,
  and it's a dependency, not a debate**: the booking/ordering/receipt services don't work without it.
  It is **not** email hosting — it is sending on the venue's behalf through a specialist (SES/Postmark).
  Clean **[B]** fit. → CLOUD:[B].
- **Mailboxes** (`info@theirdeli.com`) — **no** (or resell). Deliverability, spam, storage, "I can't
  log in" tickets = abuse desk ⚠. If we help at all, we *resell* a provider so **they** operate it and
  are the responsible party. → INTEGRATE/RESELL.

## 9. Reservations — software yes, marketplace no

TheFork's price is not for the booking *software* — it is for the **marketplace / demand generation**
(bringing diners to the venue). Two very different products:

- **Booking software** (availability, the widget on the venue's *own* site, confirmations, no-show
  handling) — **build this.** Cheap, clean, and the real cost (SMS/email confirmations) is a **[B]**
  win: buy messaging in bulk, undercut TheFork's per-cover commission with flat-rate software + cheap
  messaging. The venue keeps the customer relationship (which they prefer).
- **Booking marketplace / directory** (a diner-facing site that discovers restaurants) — **do not
  chase.** Two-sided, needs demand-gen, discovery, and dispute handling — the staff-heavy trap.
  (Confirmed by the product instinct: nobody uses a reservations site to *find* restaurants; the diner
  value is thin.)

## 10. Payments — core software, cloud rate

Card processing itself is **core** (works on-prem at standard rates; the community builds it). Going
through our cloud gets the venue a **cheaper rate** because we aggregate everyone's volume — we are not
withholding the feature, we are making it *cheaper*. Nobody can fork their way to our negotiated volume,
so this survives ELv2 cleanly.

**Boundary to respect (§3a):** aggregated pricing usually means the **platform model** (e.g. Stripe
Connect), where each venue is a connected account and **the processor does the KYC, onboarding, and
underwriting**. The trap is drifting toward becoming a full **payment facilitator** (the Square model),
where *we* underwrite and are liable for every restaurant — regulated, staff-heavy ⚠. Keep the
processor as the responsible party; take the aggregated rate and a margin; never become the regulated
entity. Worth its own memo when this is picked up — the structuring decision is load-bearing.

---

## 11. A design principle worth carrying forward

Several decisions above reduce to one idea, useful as a fast filter for future candidates:

> **A service that touches only the owner's own data scales cleanly. A service that mediates between
> the owner and a third party does not** — that boundary is where humans (and liability) get pulled in.
> At every such boundary, provide the tooling and make the user the responsible party.

And a de-duplication note: several "connectivity" rows are one capability wearing many hats — DNS,
cert, tunnel, per-venue domain, and remote access are really one **"make this box reachable"** service.
Collapse them when this moves from inventory to structure.

## 12. Explicitly out of scope for this note

- **Pricing / packaging** into sellable tiers (free-local / connected / premium) — deferred. When this
  pass happens, build a per-service **economics table**: our **cost-to-run** (the actual cloud cost —
  storage/egress/compute/messaging/processor share per venue per month) against **what competitors
  charge** for the equivalent (e.g. Square/Lightspeed/TheFork/Toast add-on prices). The **[B]
  bulk-cost** services are exactly where this matters most — the margin *is* the product — and it
  doubles as a reality check on the whole "cheaper in bulk" premise. A service where our cost-to-run
  approaches the competitor price is a service to reconsider or renegotiate the supplier for.
- **Prioritisation** — which to build first — deferred to a separate pass. Per house convention,
  ranking is by soundness / dependency / de-risking / reuse, not by any external deadline.

**Resolved (2026-08-29): no qualified RFC-3161 timestamp is required.** Verified against the AEAT
developer FAQ *"Preguntas frecuentes — Desarrolladores"* (dated 4 de diciembre de 2025). A full-text
search of the 52-page document returns **zero** hits for `RFC 3161`, `sello de tiempo`, `marca de
tiempo`, `autoridad de sellado`, or `TSA`. The only "Timestamp" mention recommends using one as a
unique *installation number*, unrelated to record integrity. Concretely:

- **Integrity mechanism** = the hash-chain, plus (in NO VERI\*FACTU mode) the record's own signature:
  *"…para la modalidad NO VERI\*FACTU, incluyen (además del hash encadenado) la firma del registro por
  parte del sistema emisor."* VERI\*FACTU mode relies on the hash-chain + AEAT submission.
- **The record's timestamp is a plain self-recorded system datetime** — `art. 10.1.p) RRSIF`
  (RD 1007/2023): *"…la fecha, hora, minuto y segundo de generación…"*.
- **The only time requirement is clock accuracy** — `arts. 7.e) y 7.f)` OM HAC/1177/2024 (NO VERI\*FACTU
  only): the system clock *"no difiere en más de un minuto de la hora oficial"*. That is an NTP-grade
  obligation (keep within one minute of official time, e.g. Spain's ROA), **not** a requirement to
  obtain a cryptographic timestamp token. Plus a chaining rule: a new record's system time must not be
  more than a minute *earlier* than the previous record's, and records are generated in chronological
  order.

**Therefore "trusted/fiscal timestamping" is not a saleable cloud service — NTP clock-sync satisfies
the regulation, and that is core.** The §4 demotion stands, now sourced rather than assumed.

This note is the **complete inventory + decision rules**. Turning it into a roadmap or a tier sheet is
a later, separate exercise.
