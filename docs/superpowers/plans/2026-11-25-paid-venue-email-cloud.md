# Paid venue email in Cloud

Build after D621 in [design order](../specs/2026-11-23-venue-email-paid-design.md). Each pull request leaves the local test Cloud usable. Later slices get their own executable plans. Paid customer mail stays closed until delivery safeguards and separate production qualification are complete.

## 1. Test the alias in Stockholm

The owner said “Yes, run the check (Recommended)” in Lane G `questions.md` on 25 November at 10:30. After D621’s free diagnostics and once access is arranged, compare two temporary Waitron Dev SES identities without sending mail. Publish one signing key as direct TXT and the other behind a CNAME. At the result or [72 hours](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_DkimAttributes.html), remove both identities and records and confirm their absence. Save DNS answers and SES status in Lane J `progress.log`.

Alias verification selects one record. A final DNS-related refusal with a working control and correctly resolving alias selects three standard records. Pending at expiry, temporary failure or a failed control goes to the watcher as inconclusive. The check proves verification in the test zone. Cross-zone DNS and signatures on delivered mail still need qualification. No product or test code.

## 2a. Choose the Waitron sender

A synthetic paid venue owner chooses its own mail server or Waitron sending. Before a choice, free sending continues. Follow `remote-access.ts` owner checks in new `packages/account-http/src/venue-email.ts` and `apps/portal/src/venue-email-screen.ts`. Store paid consent with the choice. Keep `relay-grants.ts` free consent separate. Check the consenting owner and connected or hosted level at save, admission and handoff in `test-venue-levels` mode. An incoming owner gives fresh consent.

Reuse the signed relay and an existing template. In `relay-worker.ts` and `relay-smtp.ts`, use the Waitron From address, venue name and editable Reply-To. PostgreSQL checks cover cross-venue access, ownership change and downgrade. `deploy/test-cloud/free-services-relay.test.mjs` captures From and Reply-To in Mailpit and checks free delivery. About 250–350 product and 180–250 test lines.

## 2b. Verify the venue sender

Add an SES identity adapter for creation, status and removal. For one record, supply the key to SES and publish its public TXT through Cloud DNS, with private key custody and rotation. For three, read SES’s records. Bind domain proof to its owning organisation and current choice. Extend the page beside `remote-screen.ts` with the remote and email records, copy buttons, checks and the same list in the PDF.

Require matching records and SES verification for custom From. Recheck the saved choice. Confirmed loss restores the Waitron sender and queues an owner notice. Preserve the last confirmed state during transient checks. Use fallback once on explicit sender rejection before acceptance. Extend `smtp-mailer.ts`, `relay-ses-smtp.ts`, `ses-feedback-config.ts` and `ses-feedback-event.ts` for the configured Waitron identity and the exact venue identity bound to each send. Fake SES, TLS and feedback tests cover verification, fallback, cross-venue claims and attribution. Browser tests cover record and PDF parity. About 450–650 product and 250–350 test lines.

## 3. Give the box its contract

Extend signed actions and fixed templates in `installations.ts`, `relay-payload.ts` and the [relay contract](../../transactional-email-relay-contract.md). Agree template fields, bounded invoice PDF transport and any shared package release with the Waitron lane. Give the box venue status and reuse the paid per-venue allowance in `billing-allowances.ts`. A saved box mail server wins. Test signed admission, attachment limits and queue cleanup. About 300–450 product and 180–280 test lines.

## 4. Handle delivery failures

Reuse `ses-feedback-store.ts` and shared suppression. Add a protected 31-day delivery log without message content and venue block entries that expire after 12 months or removal. Signed box actions list failures, remove entries and resume sending. The box owns retry. Removing a venue entry preserves shared suppression. Pause only the affected venue and notify it and Waitron. A second pause within 30 days needs the operator. Test shared-recipient isolation, complaints with no address, pause, resume and expiry. About 350–500 product and 200–300 test lines.
