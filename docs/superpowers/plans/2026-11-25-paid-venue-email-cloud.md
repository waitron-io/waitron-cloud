# Paid venue email in Cloud

Follow the [design](../specs/2026-11-23-venue-email-paid-design.md). Each pull request stands alone. Plan later slices separately. Paid customer mail needs delivery safeguards, D102 provider qualification and data-processor terms.

## 1. Test the alias in Stockholm

The owner said “Yes, run the check (Recommended)” in Lane G `questions.md` on 25 November at 10:30. With scoped access after D621’s diagnostics, compare two temporary Stockholm SES identities in Waitron Dev without sending mail. Publish a control TXT, an alias CNAME and its target TXT in the existing test zone. Read [`DkimAttributes.Status`](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_DkimAttributes.html). Allow up to 76 hours for a final result, four beyond SES’s 72-hour search window. Remove both identities and all three records at the result or deadline. Verify removal and log DNS answers and status in Lane J `progress.log`.

Alias `SUCCESS` selects one record. Alias `FAILED` selects three with a successful control and correctly resolving alias. A failed control or a nonfinal result at the deadline goes to the watcher. Cross-zone DNS and delivered signatures still need qualification. No product or test code.

On 25 November, both sandbox identities reached `SUCCESS` in one DNS zone. The one-alias path goes forward for test setup. Both identities and all trial records were removed, and no mail was sent.

## 2a. Choose the Waitron sender

In `test-venue-levels` mode, a Connected or Hosted test owner can choose Waitron sending and set where replies go. Show the own-mail-server option without saving a change for it. The box decides whether to use its own server. Follow the owner checks in `remote-access.ts` when saving the Waitron choice and Reply-To through `account-http/src/venue-email.ts` and a registration migration. Add `venue-email-screen.ts` and English and Spanish portal text.

Reuse the existing staff grant and allowance. At send, apply the saved Reply-To and venue name only while the venue is Connected or Hosted. Keep the Waitron From address. Carry the name and Reply-To through `relay-worker.ts`, `relay-smtp.ts`, `relay-ses-smtp.ts` and `smtp-mailer.ts`. Test owner and cross-venue access in `venue-service-relay.test.ts`. In `deploy/test-cloud/free-services-relay.test.mjs`, verify the headers on an existing staff message in Mailpit, then downgrade and verify the usual sender and free delivery. Capture English and Spanish screenshots in light and dark at 390 and 1280 pixels. About 350–450 product and 180–250 test lines.

## 2b. Show verified domain records

First [build the test setup and read-only DNS checks](2026-11-25-paid-venue-email-domain-records.md). An owner saves the sending address and can copy or download the DNS records and check the aliases. The tick confirms DNS delegation.

Plan SES identity creation, status and cleanup after the separate-zone qualification. Keep the private signing key in memory for creation. Retain the public key and selector for DNS. The plan needs to cover retry, rotation, and two venues asking to use the same domain in one SES account. Keep the certificate DNS rules when adding a mail-specific operation. Bind signing proof to the current choice and its organisation.

## 2c. Send from the verified domain

Use the venue From only when its records match and SES confirms the sender. Confirmed loss restores the Waitron sender and queues an owner notice. Keep the last confirmed state through transient failures. Reuse worker retry after explicit rejection before acceptance. Extend `smtp-mailer.ts`, `relay-ses-smtp.ts`, `mail-attempts.ts` and SES feedback for each send’s identity. Test fallback, retry and feedback attribution. About 200–300 product and 120–180 test lines.

## 3. Give the box its contract

Extend `installations.ts`, `relay-payload.ts` and the [relay contract](../../transactional-email-relay-contract.md). The box needs paid consent, sender and pause status, and typed invoices, daily reports, hours questions, clock-in/out reminders, unusable clock, full disk and bank-account change notices. Agree PDF limits and releases with Waitron. A saved box mail server wins. Paid admission requires owner consent and uses the venue allowance in `billing-allowances.ts`. Test signed admission, a fourth paid message in an hour bypassing the free account cap, venue limits and cleanup. About 300–450 product and 180–280 test lines.

## 4. Handle delivery failures

Reuse `ses-feedback-store.ts` and shared suppression. Keep delivery metadata for 31 days and venue blocks for 12 months or until removal. Before building, ask the owner what Remove does to the shared block. Signed box actions list failures, remove entries and resume. The box retries. Refuse paused mail before queuing and notify the venue and Waitron. A second pause within 30 days needs the operator. Test shared recipients, complaints without addresses, pause, resume and expiry. About 350–500 product and 200–300 test lines.
