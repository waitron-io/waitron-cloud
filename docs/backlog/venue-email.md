# Venue email: who sends it, and as which address

**Paid venue email is open.** The owner approved the
[paid venue email design](../superpowers/specs/2026-11-23-venue-email-paid-design.md)
on 23 November 2026, for release soon after go-live. The
[relay contract](../transactional-email-relay-contract.md#choose-staff-email-in-test-setup)
tracks the free test pilot.

## What the owner decided (2026-11-21)

**A venue's own mail server always wins.** When the venue has saved one, the box sends every
email straight to it, whatever the venue's plan, and Cloud is not in the path. Cloud sends only
for a venue with no mail server:

- **Free (level 1).** Cloud covers staff invitations, password resets and email-change
  codes, plus five notices the owner chose on 22 November: old-address warnings,
  security changes, role changes, box alerts and certificate reminders. The
  [free relay pilot](free-services.md) covers that scope. Staff working-hours
  questions, clock-in and clock-out reminders, invoices and reports need your own mail
  server. In this pilot you also need your own mail server for unusable-clock and
  full-disk emails.
- **Paid (level 2).** Cloud sends every email the box sends. The venue chooses the sender:
  1. **Their own domain**, such as `facturas@barpepe.es`, once they have added DNS records that
     let Cloud send as it. The owner expects most venues to have their own domain, so this is
     the main choice.
  2. **A Waitron address**, with the venue's name as the sender's name and replies going to the
     venue's own mailbox. This is the fallback for a venue with no domain, or one whose records
     are not yet in place.

Waitron's box does the opposite today for account emails: a paired test Cloud that is switched
on takes them ahead of a saved mail server. Waitron's backlog records that the order flips.

**Bounces belong to the venue.** The venue decides what to do about an address that bounced.
Cloud still has to keep its own list of blocked addresses and tell the venue, because Amazon
judges Cloud's sending account by every bounce (see *Abuse limits* below).

## Set up the sending domain

In the Connected and Hosted test setup, open **Remote access** for your venue.
Set `CLOUD_VENUE_MAIL_DNS_SUFFIX` to a test DNS suffix in the account server to
enable **Your domain**. You can save your sending address and copy each DNS
value or download the same email and remote-access records as a PDF to forward.
**Refresh status** checks whether the aliases point to the requested names.
Staff email uses a Waitron address and replies go to your sending address unless
you save a separate reply address. Save an empty reply address to go back to
your sending address and keep your DNS setup. Choose **Use standard sender**
to clear both addresses.
If domain setup is disabled, **Replies go to** still shows the active address
so you can change or clear it. An accepted ownership transfer clears both
settings in the transferred business.

Gmail and Mailgun verified the 27 November Stockholm sandbox message using
an alias in the venue's DNS zone and a signing key in Waitron's zone.
Gmail reported no DMARC record and put the message in spam. The trial sender,
both trial records and the temporary permissions were removed.

For local proof with fake providers, enable test venue levels, set the
`CLOUD_VENUE_MAIL_*` settings in `.env.example`, and run
`pnpm --dir packages/remote-access venue-mail:signing <venue-id>`.
Rerun once the alias points at the hosted key or after the owner resets the
sender or transfers the business. A `held` result keeps the claim. Check the
configured provider scope, the saved SES identity tag and the exact DNS TXT
record before retrying. The command is assumed to be the only writer for these
test identities and records. A real provider run needs
separate approval. The portal tick still checks the alias. A later slice
will use the venue’s From address and restore the Waitron sender with a
notice if verification is lost.
See the [approved design](../superpowers/specs/2026-11-23-venue-email-paid-design.md#approaches-for-the-domain-step-owner-chose-2).

## Abuse limits

Every venue sends through one Amazon SES account. Amazon places an account under review at a
5% bounce rate or a 0.1% complaint rate, and may pause it at 10% or 0.5%
([SES enforcement FAQ](https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html)). A
pause stops every venue's mail, so one venue must not be able to cause it.

- **Fixed content.** Every message comes from a Cloud template
  ([decision of 2026-11-08](../backlog.md#decisions-and-deliberate-limits)) and is set off by a
  real event. A venue cannot write a free-form message to a list. This removes most of the risk;
  a newsletter feature would change the picture completely.
- **Proof of domain.** A venue sends as its own domain only after its records check out.
- **Per-venue limits** well above what a real restaurant sends.
- **A per-venue pause.** Track each venue's bounce and complaint rates and stop that venue
  alone before it harms the shared account. SES has a
  [tenants feature](https://docs.aws.amazon.com/ses/latest/dg/tenants.html) for this; **not
  checked** whether it fits.
- **The free level** shares one per-account allowance across account email and staff
  notices. See [free services](free-services.md).

## Still to decide

- **Data protection.** At level 2 Cloud handles the venue's customers' email addresses and
  invoice PDFs, so Cloud becomes a data processor for them. The free relay carries staff account email and notices.
- **The box's half.** Without a mail server, a paid venue's box hands every email to Cloud.
  Waitron's backlog has the entry, next to its A987 entry.
- **What an email costs Cloud**, so the paid plan covers it.

## Outside facts this relies on

| Claim | Source |
| --- | --- |
| Microsoft switches off password sign-in for SMTP by default at the end of December 2026 and will name a final removal date in the second half of 2027. This affects any venue on Microsoft 365 that saves its own mail server, since that server then sends everything. | [Office 365 for IT Pros, 2026-01-29](https://office365itpros.com/2026/01/29/smtp-auth-basic-retirement/), summarising Microsoft's updated timeline; not read at Microsoft's own page |
| Google Workspace still accepts app passwords for SMTP, which need two-step sign-in and can be switched off by an administrator. | Third-party guides only; check Google's own pages before relying on it |
| SES review and pause thresholds, as above. | [SES enforcement FAQ](https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html) |
