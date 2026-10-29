# Cloud billing — design

Status: draft for owner approval, 2026-10-29. Launch platform item 3 in
[docs/backlog.md](../../backlog.md) ("Billing").

Decisions marked **(owner)** were made by the owner in the design session on 2026-10-29
unless another date is given. Decisions marked **(driver's call)** were made by the
session that wrote this design and are open to the owner's correction. Everything else is
either a fact about the current code or documents, with a pointer, or is left to the builder
and says so.

## 1. Why, and what success looks like

Remote access, backups, the rota solver and hosting are paid services, and nothing today
can take money for them. The only plan mechanism is D79's test switch, which an operator
sets by hand per organisation (`packages/registration/src/organisation-plans.ts:30-34`), and
the usage ledger measures without charging (`docs/usage-metering.md:3`).

Success is a venue owner who signs up, tries level 2, pays for it each month and, on the
day their box dies, gets their venue running in the cloud — with **no work from us** at
any step. The owner's standing rule for sign-up applies to all of billing: "they should do
the sign-up themselves. It should require zero work from us"
(`docs/superpowers/specs/2026-10-22-cloud-production-deployment-design.md:33-38`).

### Goals

- Three levels, each including the one below, with allowances per level.
- A free trial of level 2.
- Card payments and direct debit, collected automatically each month.
- Cloud's own invoices, issued by our own Veri\*Factu-compliant software.
- A failed payment handled without staff, ending in a defined, recoverable state.
- An emergency path to hosting that a venue administrator can use when the owner cannot
  be reached.

### Non-goals

- **Setting prices or allowance sizes.** Prices wait for cost measurements
  (`docs/backlog.md:189`). This design holds named slots; §11 lists them.
- Selling to venues outside Spain, and the VAT rules for doing so.
- Building the SMS service. This design only gives it an allowance slot.
- Paid longer retention for chosen snapshots (`docs/product-and-platform.md:224-231`) —
  a later add-on.
- Yearly billing and multi-venue discounts.
- The mechanics of starting a venue in the cloud (restore, fencing, activation). Those
  belong to the handover contract (A1018) and production plan P6; this design states only
  who may agree to the bill and when charging starts (§7).

### Anti-goals — failure even if it technically works

- **Billing stops a sale on an on-prem box.** Nothing billing does may touch local
  trading. A lapsed level 2 venue keeps selling.
- **Billing stands between a venue and selling again after a restore.** A restored or moved
  venue starts its new invoice chain under a time-based installation name the box chooses
  itself; no Cloud service, account or billing level is involved: "It's part of the basic
  product" (owner). Cloud's fiscal allocation registry, which would have handed out these
  names, is no longer used (owner, 2026-10-29), so billing has no fiscal check to add.
  This answers the registry's open owner gate to "define subscription entitlement,
  end-of-subscription consumption policy and retained access" (Waitron
  `docs/superpowers/plans/2026-10-12-cloud-fiscal-allocation-registry.md:296`): no billing
  check. The local fixture that "denies new reservations after entitlement ends"
  (`docs/fiscal-allocation-registry.md:101-103`) must not become production behaviour.
- **A surprise charge.** Hosting is charged only after someone with the authority to agree
  to it has said yes (§7).
- **Staff work per customer.** Any step that needs us to act by hand for an ordinary
  customer is a defect.
- **A cut so large it dominates a small bill.** At €10 a month, a 5% + 50¢ service such as
  Paddle takes about 10% (Paddle's published rate, read 2026-10-29 at
  <https://www.paddle.com/pricing>). That is why Cloud collects and invoices itself.

## 2. The three levels (owner)

| Level | Name in this design | Who it belongs to | What it includes |
| --- | --- | --- | --- |
| 1 | Registered | the Cloud account | the email gateway, address lookup, automatic upgrades; free |
| 2 | Connected | one venue | level 1, plus remote access, automatic translation, the rota solver, off-box backups with the live stream, and the possibility of failing over to the cloud |
| 3 | Hosted | one venue | level 2, with the venue's server running in Cloud |

- **Level 1's allowances count per Cloud account**, so an owner with many venues has a
  reason to bring them all into Cloud (owner). Levels 2 and 3 are per venue (owner).
- **Failing over to the cloud is part of what level 2 promises.** No one agrees to it in
  advance, because nothing has to happen until it is needed: the live stream is already in
  Cloud (owner).
- **A venue moves to level 3 only when someone says "host this venue in the cloud"** —
  after a failure, from the live stream, or as a fresh start with no box (owner). That is
  the moment the higher price is agreed (§7).
- **Hosting is charged by the day** while the venue is in the cloud. When it moves back
  on-site it drops to level 2 the same day (owner: "That it's less intimidating, perhaps").
- **The working price figures** are about €10 a month for level 2 and about €30 a month for
  level 3 (owner, as estimates). They are placeholders until §11's measurements.
- A hosted day costs one thirtieth of the level-3 monthly price. A day already paid for at
  level 2 counts towards it, so a level-2 venue that fails over pays only the difference
  for each hosted day (driver's call).
- Hosting can be tried free too (owner; §4). This settles the "hosted trial" the earlier
  backlog left open (`docs/backlog.md:3265-3268`).

### What changes from the test switch

D79's switch is per organisation and puts translation in the free plan
(`packages/registration/src/organisation-plans.ts:30-34`). This design replaces it in
production: the level is held per venue (level 1 per account), and **translation moves to
level 2**. The translation design already expected this: free use for any connected
installation lasts until "a monthly allowance, recorded so that billing can use it later,
replaces this before the first live venue"
(`docs/superpowers/specs/2026-10-14-translate-all-design.md:22-27`). D79's rules for what
a downgrade clears, and for rechecking permission after each external wait
(`docs/superpowers/specs/2026-10-17-test-cloud-free-paid-design.md:60-70`), carry over to
production enforcement. How the per-venue level and the existing per-organisation
enforcement points are reconciled is left to the builder.

## 3. Allowances (owner)

- The email gateway, SMS (a new service, to be built separately) and the AI features
  (translation, the rota solver) each have a **monthly allowance, which can differ by
  level**.
- **The allowances exist to stop abuse, not to make money.** They are set high enough that
  a normal venue never meets them. The AI features cost us very little so far.
- **What happens when a venue reaches an allowance is not designed now.** "Later, when we
  see how they actually get used, we can decide whether there are separate levels or like
  upgrades" (owner). Until then a reached allowance refuses further use of that service
  until the allowance resets, as translation's existing monthly cap already does
  (driver's call).
- **Trial allowances are tighter** for translation and the rota solver, but only for a trial
  with no payment method behind it (owner; §4).
- The sizes, reset periods and units are §11 slots. The translation cap of US$5 per venue
  per month (`docs/superpowers/specs/2026-10-14-translate-all-design.md:22-27`) is the
  starting point for translation's level-2 allowance.

### Measure remote-access traffic (owner)

Remote-access traffic per venue must be measured. Our provider bills us for that traffic,
so we need to know how much each venue uses, and the trial extension rule (§4) depends on
it. The usage ledger records installation operations and probes but no traffic volume
(`docs/usage-metering.md:9-20`). Add a traffic unit per venue per day to the ledger. This
measurement does not charge anyone; it feeds §11 and §4.

## 4. Trials

- **A new venue can try level 2 free for 30 days**, once per venue (owner: yes to a trial;
  30 days and once per venue are the driver's call).
- **No payment details are needed to start** (owner: asking first is "a bit of a put off").
- **Translation and the rota solver have tighter allowances during a trial with no payment
  method on file** (owner).
- **We email before the trial ends** — a week before, and on the last day (driver's call for
  the timing). Each email explains how to add a card or bank account.
- **If no payment method has been added by the last day, the venue drops to level 1**,
  exactly as a lapsed payment does (§6). Backups taken during the trial follow the
  cancelling path: readable for 90 days, so signing up within that time keeps them (owner,
  2026-10-21; see §8).
- **A trial that was not really used is extended by a month, once** (owner). "Really used"
  means any of:
  - remote-access traffic on **at least three different days** (owner: "actual traffic …
    rather than just a one-off connection"; three days is the driver's call);
  - one translation run;
  - one rota-solver run.

  Backups do not count, because they run by themselves once switched on (driver's call).
  The extension email says why the trial was extended.
- During a trial with no payment method on file, the emergency hosting path (§7) is
  closed to administrators; only the owner can start hosting, from the Cloud account, by
  adding a payment method (driver's call).
- **A new venue in a business that already pays gets the trial too, with full level-2
  allowances** (owner): the tighter limits apply only to a trial with no payment method
  behind it. No "add a payment method" emails are sent: at the trial's end the venue joins
  the business's next renewal date automatically, and the days between are free (owner).

### Trying hosting (level 3)

Hosting can be tried free as well (owner). The rest of this subsection is the driver's call.

- **It is for a venue that starts in the cloud** — a fresh hosted venue with no box. A
  level-2 venue that fails over pays for its hosted days as §2 and §7 describe; an
  emergency is not a trial.
- The hosted trial follows the level-2 trial's rules above: 30 days, once per venue, no
  payment details needed to start, the same reminder emails, and the same tighter
  translation and rota-solver allowances while no payment method is on file. It cannot be
  extended for lack of use: a hosted venue that is trading is using it.
- **A hosted trial that ends with no payment method stops hosting**, so the venue's tills
  stop. The reminder emails say so plainly, with the date and time. Hosting stops at the
  venue's quiet hour on the last day. The venue then follows the cancelling path (§8): a
  full download, 90 days readable, and adding a payment method within those 90 days brings
  it back where it was, with nothing owed for the trial.
- A venue that has used a hosted trial can still try level 2 later, and the other way round:
  "once per venue" counts each level separately.

## 5. Signing up, paying and managing it

### Where each thing happens (owner)

- **Setup offers it.** The Waitron setup tour invites the owner to sign up for Cloud.
- **The dashboard shows it.** If they skipped it during setup, the dashboard's Cloud services
  screen shows the venue's current level, the other levels and **their prices**, and links
  to the Cloud website to sign up.
- **The Cloud website manages it.** Choosing a level, entering payment details, changing the
  payment method, seeing invoices, cancelling and choosing hosting all happen on the
  owner's Cloud account. That is also where a venue with a dead box, or with no box at all,
  starts hosting.

### Who may change billing

Waitron on the box has no "owner" role; its top staff role is administrator, and connecting
a box to Cloud needs a local manager with `system.manage`
(Waitron `docs/developers/cloud-connection.md:3-5`). The owner exists only on the Cloud
side: one Cloud account owner per customer per country, with no invitations or manager
accounts (owner, 2026-10-24; `docs/superpowers/specs/2026-10-21-cloud-hosted-venue-design.md:95-106`).
Since billing is managed on the Cloud account, **billing is changed by whoever signs into the
Cloud account — the owner.** The single exception is the emergency start in §7, which the
owner authorises in advance.

### What the box learns

The box receives, for display only: the venue's level, its billing state (trial, active,
payment failing, lapsed), the end date of the trial or paid period, and the published
price list (owner: the dashboard shows the levels and their prices). This reverses D79's
rule "Do not add a plan field to the Waitron wire"
(`docs/superpowers/specs/2026-10-17-test-cloud-free-paid-design.md:64`) for display. **The
box never uses these values to switch anything on or off**; Cloud alone decides what a
venue is allowed, as it does today. The shared contract
([waitron-integration-contract.md](../../waitron-integration-contract.md)) gains a billing
section; its exact shape is left to the builder and needs Waitron's agreement.

## 6. Taking payment

### Two providers (owner)

- **Cards through SumUp**, with the card saved and charged each month. At these sums SumUp
  is the cheapest card option: a comparison site gives 1.95% for remote payments, about
  €0.20 on €10 (<https://bankkers.com/?p=3575>, read 2026-10-29); SumUp's own pages did not
  confirm the rate.
- **Direct debit through Stripe**, at €0.35 a debit (Stripe's Spanish price page,
  <https://stripe.com/es/pricing>, read 2026-10-29). Not Stripe's subscription product
  (an extra 0.7%): our renewal and retry rules are our own.
- The owner chooses card or direct debit when signing up and can switch later.

**The first build step is a sandbox test of SumUp**, because two facts are unconfirmed:
that 1.95% is the rate for charging a saved card, and that SumUp lets us charge a saved card
with the owner absent each month. SumUp's developer guide describes saving a card for
recurring payments
(<https://developer.sumup.com/online-payments/guides/tokenization-with-payment-sdk/>), but a
third-party gateway listing marks SumUp's merchant-initiated payments as unsupported
(<https://docs.spreedly.com/payment-gateways/sum-up>). If either fails, Stripe takes cards
as well (Stripe's standard European card rate, 1.5% + €0.25, from the same price page).

### What Stripe's direct debit does for us

From Stripe's SEPA Direct Debit documentation (<https://docs.stripe.com/payments/sepa-debit>,
read 2026-10-29):

- The owner types their name and IBAN on Stripe's page and accepts the mandate there.
  Stripe can generate the mandate text and keeps the mandate.
- By default Stripe collects under its own creditor identifier, so we need none from a bank.
  Stripe recommends an EU business use its own later, to reduce disputes. Getting our own is
  later work (driver's call).
- Stripe emails the payer before each debit when its creditor identifier is used.
- Using direct debit needs an extra identity check on our Stripe account.
- **A debit is confirmed about 6 business days after submission.**
- **Only the standard ("Core") scheme is supported.** The payer can have a debit refunded
  through their bank "no questions asked" for eight weeks; such a dispute is final and
  carries a fee.

### Renewal date (owner)

- **A business's renewal date is the day it first started paying.** No one is charged on the
  1st of the month.
- **A second venue joins the business's existing renewal date, and its first part-month is
  free.** It is first charged on the next renewal date. With the trial (§4), "first
  part-month" means the days between the trial's end and that renewal date (owner).
- **One charge and one invoice per business per renewal**, covering all of that business's
  venues and the hosted days since the last charge (driver's call). It is per business, not
  per account, because an account can hold several legal businesses with different tax
  numbers (`docs/product-and-platform.md:340-347`), and each invoice names one.
- A renewal date of the 29th to the 31st falls on the last day of a shorter month (driver's
  call).

### Charge timing (driver's call)

- The level-2 fee is charged in advance for the coming month. Hosted days are charged with
  the next renewal, in arrears.
- **Cards are first tried 7 days before the renewal date; direct debit 10 days before**,
  because a debit takes about 8 calendar days to confirm. The owner said "a week in
  advance"; the extra days for direct debit keep that promise once confirmation time is
  counted.

### Moving between levels (driver's call)

- Moving up to level 2 starts at once. For a business's first venue this sets the renewal
  date; a later venue follows the rule above.
- Moving down or cancelling takes effect at the end of the paid month, with no refund for
  the rest of it. A cancellation made after the early charge for the coming month (below)
  but before the renewal date keeps that charge: the cancel page says plainly that the
  month to that date is already paid for and the service runs until then. No refund
  machinery is built for this.
- Hosting is charged by the day, as above.
- Price changes reach existing customers by email at least 30 days before they apply.

### When a payment fails (owner)

**Level 2:**

1. The charge is attempted ahead of the renewal date (above).
2. If it fails, the owner is emailed.
3. **On the renewal date, online services stop**, remote access included, and the venue
   drops to level 1. The tills keep selling.

The rest is the driver's call: further attempts between the failure and the renewal date
are left to the builder. Stopping a service follows D79's downgrade rules: the backup stream
and remote access stop, and stored backups and keys are kept
(`docs/superpowers/specs/2026-10-17-test-cloud-free-paid-design.md:60-70`). Paying again
switches everything back on. A lapsed venue's backups follow the cancelling path (§8).

**Level 3 (hosted):**

1. The venue gets **about a month** of retries and emails, during which it keeps running
   in the cloud (owner: "I'm okay with doing it over a month").
2. If it still has not paid, **hosting stops** and the venue drops to level 1 (owner).
3. It then follows **the cancelling path**: a full download, 90 days readable, and paying
   within those 90 days brings it back where it was (owner).
4. **To come back, the owner first pays the hosted days used without paying**, then carries
   on from the day they return (owner). If they never come back, the debt is not chased
   (owner). The invoice for those days is issued when they are paid (§9). A lapsed level-2
   venue owes nothing to come back, because its services stopped on the renewal date
   (owner). The day a business comes back becomes its new renewal date (driver's call).

The rest is the driver's call: cards are retried weekly across that month. Direct-debit
retries are 14 days apart, with none in the last 10 days before hosting stops; a pending
debit prevents another attempt. Each retry emails the date hosting will stop. Hosting stops at the venue's quiet hour, not
at a fixed time that could fall in the middle of a service. The production deployment
design already uses quiet hours for moves. Why a month is reasonable: Lightspeed retries over
about three weeks and then restricts the account for a week before cancelling (from a
search summary of
<https://x-series-support.lightspeedhq.com/hc/articles/25534099770907-What-does-dunning-mean->,
whose page refused a direct download), and Shopify freezes a store after about 28 days of
retries (staff replies on its community forum, not its help pages). Each hosted venue beyond
the first machines' capacity adds about $6 a month to our costs
(`docs/superpowers/specs/2026-10-22-cloud-production-deployment-design.md:391-408`), so a
month's grace is cheap.

**A direct debit the owner later has refunded through their bank** counts as a failed
payment from the day we learn of it: the owner is emailed and the same countdown starts
(driver's call).

## 7. Emergency hosting when the owner cannot be reached

**The scenario (owner):** the box dies, the owner is away with no internet, and an
administrator at the venue has to bring the venue up in the cloud. The administrator
cannot sign into the owner's Cloud account.

**What is already decided.** Under the handover contract, an emergency takeover needs a
freshly authenticated venue person holding `node.promote` — "the owner or an authorised
manager with fresh passkey or password plus enrolled authenticator code. A till PIN is
insufficient." That person declares that the old box is shut down. A hosting purchase
alone "does not supply Waitron permission or the emergency declaration"
([waitron-integration-contract.md](../../waitron-integration-contract.md), the emergency
handover and "Map the person and the retry" sections). Cloud keeps the backup keys in AWS's
key service and its machines may use them to restore (owner, 2026-10-21;
`docs/superpowers/specs/2026-10-22-cloud-data-protection-design.md:36-42`).

**What this design adds.** The design session agreed this as one proposal (owner: "That
sounds better").

1. **The owner agrees in advance.** When signing up for level 2, the owner sees one
   setting: in an emergency, the venue's managers holding `node.promote` may start cloud
   hosting, charged at the hosted daily price to the payment method on file. On by default,
   and the owner can switch it off (driver's call for the default).
2. **The venue emergency code.** When that setting is on, Cloud creates an emergency code
   for the venue. Admins can save or print it from the dashboard while the box is healthy,
   and it is printed in the recovery pack.
3. **One recovery pack (owner).** Waitron produces a single recovery document holding
   everything an administrator needs when things go wrong. It includes the venue's
   emergency address and emergency code. This is Waitron-side work (§10).
4. **Where they go.** The emergency address is the venue's own remote-access address, which
   level 2 already provides. It appears in the recovery pack and on the tills, which must
   learn the cloud address anyway to follow a new primary.
5. **The page asks for the code first.** It does not say whether the box is offline until a
   valid code is entered. Wrong codes are rate-limited. Without a valid code, nothing is
   restored. This answers the abuse concern the owner raised: a public page that anyone
   could use to trigger restores. The two parts are the driver's call.
6. **A valid code starts a locked copy.** Cloud restores the venue from the live stream into
   a copy that does not sell, file with AEAT or take payments. Its only page is an
   administrator sign-in. Restoring needs no key from the person: Cloud holds it. If nobody
   signs in within 30 minutes, the copy shuts down (driver's call for the limit).
7. **The administrator signs in to that copy**, with their own Waitron password and
   authenticator code, which came across in the backup. Cloud never checks staff
   passwords itself. If they hold `node.promote` and the owner's setting is on, they make
   the handover contract's declaration that the old box is off.
8. **Charging starts at that declaration.** The owner is emailed at once with who started
   hosting, when, and the daily price.

**The owner can always start hosting from their Cloud account**, with no code. An
administrator who has lost the code is therefore no worse off than without this path. The
owner can issue a new code from the account, which cancels the old one — for example when
an administrator leaves (driver's call).

The emergency path is open only while the venue's level 2 is active and a payment method is
on file (driver's call). Restoring, fencing, activation, moving the tills and the declaration
itself are A1018's and P6's to build. The rules in this section are what those designs must
honour for billing.

## 8. Cancelling, lapsing and closing an account

- **Cancelling follows the exit the owner approved on 2026-10-21:** "Full standard-format
  download of database, latest backup and its key; plain fiscal-retention warning; backups
  read-only for 90 days, recoverable on resubscription; then delete everything except
  Cloud's own billing records" (`docs/superpowers/specs/2026-10-22-cloud-data-protection-design.md:39`).
  The engineering states and clocks are in the same design's section 6.
- A trial that ends unpaid (§4), a lapsed level 2 (§6) and a hosted venue stopped for
  non-payment (§6) all enter that same path (owner for the hosted case; driver's call for
  the other two).
- Cancelling is done from the Cloud account and takes effect at the end of the paid month
  (§6).
- Closing an account cancels every venue, then follows the same lifecycle.
- **Only Cloud's own billing records survive** the final deletion. Which fields, for how
  long and who may see them is lawyer question 2 in the data-protection design
  (`docs/superpowers/specs/2026-10-22-cloud-data-protection-design.md:363`). A billing record
  never carries venue content (`docs/cloud-processing-annexes.md:43`).

## 9. Cloud's own invoices

- **Cloud issues its invoices with its own software, built on Waitron's Veri\*Factu
  library** (owner). This was preferred over an invoicing service such as Holded or Quipu,
  and over a seller-of-record service (§1, anti-goals).
- **That billing software needs its own declaración responsable** (owner), separate from
  Waitron's.
- Invoices are full invoices carrying the business's legal name, address and tax number.
  Signing up for level 2 is when those are collected: the signup design left "Tax details,
  billing and country-specific validation" to "the later billing journey"
  (`docs/cloud-signup-implementation.md:22-25`).
- The issuer is the Waitron company. The action plan says it is not yet formed (Waitron
  `docs/compliance/action-plan.md`, step 6), so **billing cannot go live before the company
  exists.**
- Prices are shown before VAT, with VAT added (driver's call: these are business
  customers). Spain only at launch.
- An invoice is issued when its payment succeeds; for direct debit, when the debit is
  confirmed (driver's call). A part-month that is free (§6) or a trial produces no charge.
- Invoices are listed on the Cloud account. The dashboard links to them.

## 10. Where it lives, and what each repository builds

### Cloud

- **Billing records, payment state and invoices live in the country's own part of Cloud**
  (Spain for now). This adopts the recommendation that billing stays country-local, so
  customer billing self-service survives the loss of the global layer
  (`docs/superpowers/specs/2026-10-22-cloud-production-deployment-design.md:148-153`).
  It also keeps the plan country-local, as the country split requires
  (`docs/superpowers/plans/2026-10-22-cloud-global-country-split.md:17,144`)
  (driver's call).
- SumUp and Stripe each need a row in the processing register and a qualified country flow
  before any live data reaches them (`docs/cloud-data-processing-register.md:48,60`;
  `docs/country-policy.md:3-6,21-25`).
- Build, in the order a plan will set: the SumUp sandbox test (§6); per-venue levels
  replacing D79's switch; allowances; remote-access traffic measurement (§3); the trial
  (§4); sign-up and checkout pages; renewals, retries and failed-payment handling (§6);
  invoicing (§9); the emergency setting, code and code page (§7, items 1, 2 and 5); the
  billing section of the integration contract (§5).

### Waitron (handed over as Waitron backlog entries)

- The dashboard's Cloud services screen shows the venue's level, billing state, the other
  levels and their prices, and links to the Cloud account (§5).
- The setup tour offers the level-2 trial (§5).
- **One recovery pack** that merges today's recovery documents — the recovery kit, the
  recovery sheet with the disk key, and the archive recovery pack — and adds the emergency
  address and code (§7).
- The tills learn the cloud address and can show the emergency link to an administrator
  when the box disappears. This is part of the A1018 handover work.
- The emergency locked copy: an administrator-only sign-in, then `node.promote` and the
  declaration (§7, items 6 and 7). This is part of A1018 and P6.

## 11. Slots the owner fills later

| Slot | Working figure | Waits for |
| --- | --- | --- |
| Level-2 monthly price | about €10 | cost measurement; the deployment design estimates $2–4 a month of cost per on-prem venue (`docs/superpowers/specs/2026-10-22-cloud-production-deployment-design.md:419-442`) |
| Level-3 monthly price (daily = ÷30) | about €30 | the same, plus about $6 a month for each hosted venue beyond the first machines' capacity |
| Allowances per level and service (email, SMS, translation, rota solver, address lookup) | translation: US$5 per venue per month | usage once venues are live |
| Trial allowances for translation and the rota solver | — | the same |

## 12. Questions for others

- **Asesor:** when Cloud's invoice is issued for a direct debit, and what happens to it if
  the debit is later disputed (a correcting invoice, or an unpaid debt).
- **Lawyer:** the terms that let us stop a hosted venue for non-payment; the period for
  keeping billing records (data-protection lawyer question 2).
- **Owner, later:** the §11 slots.

## 13. Left to the builder

- How per-venue levels are reconciled with the per-organisation enforcement points D79
  added.
- The billing section's exact fields in the integration contract, subject to Waitron's
  agreement.
- Retry schedules within the windows above.
- The traffic unit's exact definition (bytes per day, counted at the relay) and how a
  "day with traffic" is decided for the trial rule.
- How a dispute, a failed renewal and a successful later payment are recorded so that a
  retried request never charges twice (`docs/product-and-platform.md:671-675`).
- Email wording, in Spanish and English.

## 14. The driver's calls, collected

For the owner to check while reading:

1. A hosted day costs one thirtieth of the level-3 monthly price; days already paid at
   level 2 count towards it (§2).
2. The hosted trial is for a venue that starts in the cloud, not for a failover; it follows
   the level-2 trial's rules, stops hosting at the quiet hour if unpaid at its end, and is
   counted separately from the level-2 trial (§4).
3. A reached allowance refuses further use until it resets (§3).
4. The trial lasts 30 days, once per venue; reminder emails a week before and on the last
   day (§4).
5. Remote access counts as really used after traffic on three different days; backups never
   count (§4).
6. The emergency path is closed during a trial with no payment method (§4, §7).
7. One charge and one invoice per business per renewal; renewal dates of the 29th to the
   31st fall on the last day of a shorter month (§6).
8. Cards are first tried 7 days ahead; direct debit 10 days ahead (§6).
9. Moving down or cancelling takes effect at the end of the paid month, with no refund,
   including a cancellation made after the early charge for the coming month; price changes
   come with 30 days' notice (§6).
10. A hosted venue's card retries are weekly; direct-debit retries are 14 days apart,
    outside the final 10 days and only after the previous debit settles. Hosting stops at
    the venue's quiet hour (§6).
11. A refunded direct debit counts as a failed payment (§6).
12. The emergency setting is on by default (§7).
13. The emergency page reveals nothing until a valid code is entered; the locked copy shuts
    down after 30 minutes without a sign-in; the owner can replace the code (§7).
14. Our own creditor identifier comes later (§6).
15. A trial that ends unpaid and a lapsed level 2 both follow the cancelling path (§8).
16. Prices are shown before VAT; an invoice is issued when its payment succeeds (§9).
17. Billing lives in the country's part of Cloud (§10).
18. A business that comes back after a lapse takes the day it returns as its new renewal
    date (§6).
