# Venue email: who sends it, and as which address

**Open; direction agreed, no design or build yet.** This file records what the owner decided
on 21 November 2026 and what is still to work out. Nothing here has been built or tested.

## What the owner decided (2026-11-21)

**A venue's own mail server always wins.** When the venue has saved one, the box sends every
email straight to it, whatever the venue's plan, and Cloud is not in the path. Cloud sends only
for a venue with no mail server:

- **Free (level 1).** Cloud sends only the account emails: invitations, password resets and
  email changes. This is the existing
  [free transactional email](free-services.md) work. Everything else the box sends — invoices,
  reports, clock-in and clock-out reminders — is not sent until the venue saves a mail server.
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

**A "download this PDF and forward it" option** sits beside doing the DNS step themselves,
never in place of it. The PDF holds the exact records and the steps for the venue's domain
company, so whoever runs the domain — often a web agency — can do it from that one document.
A PDF that is forwarded is more likely to be read than a link.

## The DNS step has to suit a non-technical owner

The open question is how technical the domain's owner is. The aim is that they can finish the
step alone. Each point below is a proposal, not a decision.

1. **Only add records, never change an existing one.** Editing a record is where people break
   things; a second SPF record, for example, makes both fail. Use only names nobody else uses:
   a DKIM name, and a sub-name such as `mail.barpepe.es` for bounces. The screen could then say
   "Adding these can't affect your existing email". **Assumption, not tested:** test it against
   a real domain before putting that sentence on screen.
2. **As few records as possible.** Amazon SES's standard setup for a sending domain is three
   DKIM records, plus two if bounces go to a sub-name of the venue's domain. **Assumption, not
   tested:** pointing those names at records Cloud hosts could cut this to one or two, as the
   [one-record custom domain](../superpowers/specs/2026-11-17-custom-domain-one-record-design.md)
   does for remote access.
3. **Automatic setup where the domain company supports it.** Domain Connect is an open standard
   in which the owner signs in at their domain company, sees what Waitron wants to add, and
   approves. **Not checked:** which domain companies common in Spain support it, and what
   registering Cloud with each one involves.
4. **Instructions for the venue's own domain company.** Look up who runs the domain from the
   domain name, then show that company's steps with a copy button for each value. The same
   steps go in the PDF.
5. **Nothing waits on the venue.** It sends from the Waitron address at once. Cloud keeps
   checking the records, switches to the venue's domain once they are right, and shows a tick
   per record. If a record later disappears, it falls back to the Waitron address and shows a
   notice. Invoices never stop.
6. **One flow for both domains.** Setting up the domain for email and the
   [custom domain for remote access](../backlog.md#custom-domains-with-one-record-and-names-that-follow-the-venue)
   should feel like the same task, done on the same page.

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
- **The free level** sends only account emails, under the per-account allowances in
  [free services](free-services.md).

## Still to decide

- **Data protection.** At level 2 Cloud handles the venue's customers' email addresses and
  invoice PDFs, so Cloud becomes a data processor for them. Today's relay carries account email
  only.
- **The box's half.** Without a mail server, a paid venue's box hands every email to Cloud.
  Waitron's backlog has the entry, next to its A987 entry.
- **What an email costs Cloud**, so the paid plan covers it.

## Outside facts this relies on

| Claim | Source |
| --- | --- |
| Microsoft switches off password sign-in for SMTP by default at the end of December 2026 and will name a final removal date in the second half of 2027. This affects any venue on Microsoft 365 that saves its own mail server, since that server then sends everything. | [Office 365 for IT Pros, 2026-01-29](https://office365itpros.com/2026/01/29/smtp-auth-basic-retirement/), summarising Microsoft's updated timeline; not read at Microsoft's own page |
| Google Workspace still accepts app passwords for SMTP, which need two-step sign-in and can be switched off by an administrator. | Third-party guides only; check Google's own pages before relying on it |
| SES review and pause thresholds, as above. | [SES enforcement FAQ](https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html) |
