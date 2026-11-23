# Paid venue email: Cloud sends every email as the venue's own domain

Design agreed with the owner in the watcher's window on 23 November 2026, building on the direction
of 21 and 22 November in [venue-email.md](../../backlog/venue-email.md). The owner's words are quoted
where they decided something; everything else is marked as the designer's call.

## Why

A venue's box sends invoices, reports, staff hours questions and reminders by email. Today it needs
its own mail server for those. Many venues have a domain for their website but no mail server a
program can use, and Microsoft 365 switches off password sign-in for sending mail at the end of
December 2026, so "save your mail server" will stop working for Microsoft venues. The paid level
lets Cloud send every email the box sends, from the venue's own address (`facturas@barpepe.es`),
with a domain step the person who set up the venue's website can finish alone.

## Already decided (owner, 21 and 22 November)

- A venue's own mail server always wins: when one is saved, the box sends straight to it and Cloud
  is not in the path.
- Free level (no mail server): Cloud sends staff account email and the five staff notices chosen
  on 22 November. Built, in test.
- Paid level (no mail server): Cloud sends every email the box sends, as the venue's domain or as a
  Waitron address.
- Bounces belong to the venue; Cloud still protects Waitron's shared Amazon sending account.
- A "download this PDF and forward it" option sits beside doing the domain step yourself.
- Every message comes from a fixed Cloud template (owner, 2026-11-08); no free text.

## Decided on 23 November

1. **Who does the domain step:** whoever set up the venue's DNS for its website; the same person adds
   Waitron's remote-access record. Owner: "somebody has set up the dns to point to their own website,
   and somebody will have to add entries to use some waitron functionality, so i suppose the same
   person will either set up their own smtp server, or add the dns entry to send emails via waitron".
2. **What the domain step offers at first:** the exact list of records with a copy button per value,
   the same list in a PDF to forward, and a tick per record once it checks out (owner: "that's a good
   starting point"). Step-by-step instructions for each domain company, one-click setup (Domain
   Connect) and "add only, never change" records are all still wanted, later: "i think all 3 are still
   important (but not for go live) as even i would appreciate step by step instructions".
3. **Which route the venue takes is the venue's choice.** The setup page shows "Waitron sends as your
   domain" and "Your own mail server" side by side, each with one line on what it means, and does not
   steer (owner: "Yes, c - put the question to them").
4. **Email never waits on DNS (owner: "a").** Until the records check out, Cloud sends from a Waitron
   address with the venue's name as the sender and replies going to the venue's own mailbox. It
   switches to the venue's address once every record checks out, and falls back, with a notice to the
   venue, if a record later disappears.
5. **Own mail server on Google and Microsoft.** Google: instructions only, nothing built; the venue
   creates an app password and pastes it into the password field (owner: "this just requires
   instructions, nothing special built"). Microsoft 365: "Sign in with Microsoft" is to be supported,
   "but not immediately". Recorded in Waitron's backlog on 23 November (89255be653).
6. **Bounces (owner: "yes" to this proposal).** Cloud stops sending to an address after a hard bounce
   ("no such address") or a spam complaint. The venue's dashboard shows a "Couldn't deliver" list:
   the address, what was sent (an invoice, a booking), when, and why, with **Try again** (after
   fixing a typo) and **Remove**. A venue whose bounce or complaint rate climbs towards Amazon's limits
   is paused alone and told, and Waitron is alerted.
7. **What Cloud keeps.** No email content, attachments included: it passes to Amazon and is
   forgotten; a resend comes from the box, which holds the invoice. A delivery log (to whom, what
   kind of email, when, delivered or bounced) is kept **31 days** (owner: "make it 31 days"). The
   blocked-address list is kept until the venue removes an address, or 12 months (designer's call).
8. **When:** soon after go-live, not for it (owner: "b"). The first venue starts on its own mail
   server or Google with an app password; the paid route needs production Cloud.
9. **How the domain authorises Cloud (owner: "2"): one record per venue, pointing at a signing key
   Waitron holds.** See Approaches.

## Goals, non-goals, anti-goals

- **Goal:** a paid venue with a website domain sends every box email as its own address, set up by
  its web person from one list or one PDF, with no email ever held up by DNS.
- **Non-goals now:** per-company instructions, Domain Connect, add-only records (later, item 2);
  Microsoft sign-in for the venue's own server (later, item 5); newsletters or any free-form message.
- **Anti-goals:** one venue's bounces pausing Waitron's shared sending account; Cloud keeping copies
  of customers' invoices; an invoice that cannot be sent today because of DNS; a domain step that
  can break the venue's existing email.

## Approaches for the domain step (owner chose 2)

1. **Amazon SES standard setup ("Easy DKIM"):** three CNAME records per venue; Amazon holds and
   rotates the keys. Well-trodden, nothing for Waitron to look after, but three records.
2. **One CNAME per venue to a Waitron-held key (chosen):** the venue adds one record,
   `<selector>._domainkey.<domain>` pointing at a name Waitron publishes, whose TXT holds a key
   Waitron gives SES ("bring your own DKIM"). Waitron can rotate keys without the venue touching DNS.
   **Not tested:** whether SES accepts a BYODKIM key published behind a CNAME. Prove it free on the
   test Cloud first; if SES refuses, fall back to approach 1 (the page and PDF are unchanged, only the
   record list grows).
3. **Send from a delegated sub-address** (`facturas@mail.barpepe.es`, one NS record): simplest
   for the web person, but customers see an address that is not quite the venue's. Rejected.

SPF alignment through a custom MAIL FROM sub-name is not required for DMARC when DKIM aligns; adding
it is the builder's call, and would add records.

## Design

- **Setup page (dashboard, paid venues with no mail server):** the two routes side by side (item 3).
  Choosing "Waitron sends as your domain" asks for the sending address (`facturas@barpepe.es`) and
  shows the record(s) with copy buttons, a "Download PDF" with the same records and a short note for
  whoever runs the domain, and a tick per record that Cloud keeps checking. The same page carries the
  remote-access record (one task, one page, one PDF), per the
  [one-record custom domain design](2026-11-17-custom-domain-one-record-design.md).
- **Sending states per venue:** *Waitron address* (from the moment the route is chosen), *own
  domain* (all records verified), back to *Waitron address* with a notice when a record disappears.
- **Box half (Waitron):** a paid venue with no mail server hands every email to Cloud through the
  existing signed relay, extended from the free scope to every template; a saved mail server still
  wins. Each box email kind needs its Cloud template; an invoice carries its PDF as an attachment of
  that template.
- **Bounces and complaints:** as item 6. Per-venue limits well above a real restaurant's volume.
- **Retention:** as item 7.
- **Data protection:** at the paid level Cloud processes customers' addresses and invoices for the
  venue, so Waitron is the venue's data processor for this; the terms must say so before the paid
  route opens (owner's item, outside the build).

## Designer's calls after the builder check (23 November; the owner may overrule any)

- **Where things live.** The domain step is in the **Cloud portal**, beside the remote-access domain,
  signed in as the account owner. The "Couldn't deliver" list is on the **box's dashboard**, where
  staff resend; the box fetches its venue's bounces from Cloud on its existing calls out (Cloud never
  calls the box), and **Try again** resends from the box.
- **The delivery queue is not "keeping a copy".** The relay's existing encrypted queue holds a
  message only until Amazon accepts it or its 24-hour retry window ends, then clears it. "Cloud keeps
  no email content" means nothing is kept after delivery or expiry.
- **Consent and limits.** Choosing "Waitron sends" on the setup page is the account owner's explicit
  consent the relay contract requires. Paid sending counts against a per-venue paid limit, not the
  free per-account limit.
- **Replies.** The setup page has a "Replies go to" address, defaulting to the sending address.
- **A paid venue with no domain** chooses "Waitron sends, from a Waitron address" (a third option
  under the Waitron route). **Before any choice**, nothing changes: the box sends only the free
  emails through Cloud.
- **While a venue is paused,** Cloud refuses its messages at once with a reason, so the box shows
  "couldn't send" and keeps the email for a later resend; nothing is held in Cloud.
- **Lifting a pause (owner, 23 November: "a").** The venue lifts it itself: once it has cleared the
  bad addresses from its "Couldn't deliver" list, it presses **Resume sending**. A second pause within
  30 days can only be lifted by Waitron, from the operator console.

## Left to the builder

- The Waitron sending address's form (for example `bar-pepe@mail.waitron.io`) and its sender name.
- The template list: one per box email kind, with allowed value types and lengths.
- Whether SES tenants fit the per-venue pause, or a counter in Cloud does it.
- How often records are re-checked, and how a disappeared record is confirmed before falling back.
- Order of slices: the BYODKIM-behind-CNAME test first, then sending states and the setup page, then
  the box half, then bounces and the delivery log.

## Open for the owner (not blocking the build)

- What the paid level costs the venue, and what an email costs Cloud.
- The data-processor wording in the terms.
