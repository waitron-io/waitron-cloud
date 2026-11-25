# Paid venue email in Cloud

Build after D621 in [design order](../specs/2026-11-23-venue-email-paid-design.md). Each pull request stands alone. Plan later slices separately. Paid customer mail needs delivery safeguards, D102 provider qualification and data-processor terms.

## 1. Test the alias in Stockholm

The owner said “Yes, run the check (Recommended)” in Lane G `questions.md` on 25 November at 10:30. After D621’s free diagnostics, compare two temporary Stockholm SES identities in Waitron Dev without sending mail. In the existing test zone publish a control TXT, an alias CNAME and its target TXT. At the result or [72 hours](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_DkimAttributes.html), remove both identities and all three records. Confirm removal and log DNS answers and SES status in Lane J `progress.log`.

Alias verification selects one record. A final DNS-related refusal with a working control and correctly resolving alias selects three standard records. Pending at expiry, temporary failure or a failed control goes to the watcher as inconclusive. The check proves verification in the test zone. Cross-zone DNS and signatures on delivered mail still need qualification. No product or test code.

## 2a. Choose the Waitron sender

A test owner chooses their mail server or Waitron sending. Follow `remote-access.ts` owner checks in `packages/account-http/src/venue-email.ts` and `apps/portal/src/venue-email-screen.ts`. Store paid consent with the choice. Check the consenting owner and connected or hosted level at save, admission and handoff. An incoming owner gives fresh consent. Until slice 3, use the existing staff grant and allowance. Paid consent changes only the sender.

Reuse `relay-worker.ts`, `relay-smtp.ts` and a staff template. Show the venue name and editable Reply-To with Waitron’s From. Extend `venue-service-relay.test.ts` for cross-venue access, owner change and downgrade. In `deploy/test-cloud/free-services-relay.test.mjs`, capture From and Reply-To for a Connected venue in `test-venue-levels` mode and preserve free delivery. About 250–350 product and 180–250 test lines.

## 2b. Verify the venue sender

Add SES identity creation, status and removal. For one record, give SES the key and publish its TXT through Cloud DNS. Plan private key custody and rotation. For three, read SES’s records. Bind proof to the owning organisation and current choice. Beside `remote-screen.ts`, show remote and email records with copy buttons, checks and the same list in the PDF.

Require matching records and SES verification for custom From. Confirmed loss restores the Waitron sender and queues an owner notice. Keep the last confirmed state on transient checks. Use the worker’s existing retry after explicit sender rejection before acceptance. Extend `smtp-mailer.ts`, `relay-ses-smtp.ts`, `mail-attempts.ts` and SES feedback for the exact identity bound to each send. Fake SES, TLS and feedback tests cover verification, fallback, cross-venue claims and attribution. Browser tests cover record and PDF parity. About 450–650 product and 250–350 test lines. Split verification and sender work if needed.

## 3. Give the box its contract

Extend `installations.ts`, `relay-payload.ts` and the [relay contract](../../transactional-email-relay-contract.md). The box needs paid consent discovery, sender and pause status, and typed invoice, report, hours, clock and disk notices. Agree PDF limits and contract releases with Waitron. Paid admission uses its own consent and `billing-allowances.ts`. A saved box mail server wins. Test signed admission, limits and cleanup. About 300–450 product and 180–280 test lines.

## 4. Handle delivery failures

Reuse `ses-feedback-store.ts` and shared suppression. Keep delivery metadata only for 31 days and venue blocks for 12 months or until removal. Signed box actions list failures, remove entries and resume. Settle what removal means for shared suppression. The box retries. Refuse paused mail before queuing and notify the venue and Waitron. A second pause within 30 days needs the operator. Test shared recipients, complaints without addresses, pause, resume and expiry. About 350–500 product and 200–300 test lines.
