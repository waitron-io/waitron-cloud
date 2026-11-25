# Paid venue email in Cloud

**PLAN FOR APPROVAL · Lane J · Base `8a3f0ade0`**

Claude reviews this plan before watcher clearance. Build after D621 as specified in the [backlog](../../backlog.md#venue-email-from-cloud-sent-as-the-venues-own-domain). Land each slice independently in [design order](../specs/2026-11-23-venue-email-paid-design.md). Write executable plans for later slices as needed under the three-hour rule. Infrastructure, deployment, real mail, production opening, pricing and legal work stay outside this plan.

## 1. Compare domain proofs without sending

After D621’s free diagnostics and once access is arranged, run the owner-approved comparison in the Stockholm Waitron Dev sandbox. Compare two temporary Amazon SES identities, one with a Waitron-held signing key behind a CNAME alias and one with the standard direct TXT record. Remove both identities and the test DNS records and confirm their absence. Send no mail and incur no charges. Record answers and status in `progress.log`. A verified alias selects one CNAME. A final DNS-related SES failure with a correctly resolving alias and a verified control selects three standard SES CNAMEs. Other results leave the choice open. Estimate 0 production and 0 test lines.

## 2. Save the sender and prove it locally

Reuse owner checks in `packages/account-http/src/remote-access.ts`, test plan checks in `packages/registration/src/venue-service-permissions.ts` and `organisation-plans.ts`, and consent in `relay-grants.ts`. Require current ownership and paid access for setup. Recheck paid access at relay admission and handoff. Add a `venue-email.ts` account handler and `venue-email-screen.ts` beside `apps/portal/src/remote-screen.ts`.

Show both routes side by side, with a Waitron-address option and editable reply address defaulting to the sending address. Saving “Waitron sends” records consent. Before a choice, keep free sending as before. Build the record list for the proven approach. Reuse `packages/remote-access/src/dns-lookup.ts` and the same record fields for either outcome. Show the remote access record alongside, with copy buttons, ticks and the same records in the PDF.

Use a Waitron From address with the venue name and reply mailbox. Switch From to the venue address once every record verifies for the current saved choice. Confirmed record loss or mismatch restores fallback and notifies the owner. Transient lookup failures leave the last confirmed state intact. Reuse registration’s `relay-messages.ts`, `relay-worker.ts` and `relay-smtp.ts` with an existing fixed template. Account HTTP tests cover owner, venue and paid boundaries. Portal browser tests cover both lists and PDF parity. Worker tests cover stale proof and fallback. Extend `deploy/test-cloud/free-services-relay.test.mjs` with a synthetic paid venue and assert captured From and Reply-To in Mailpit through each transition. A queue receipt shows admission only. Keep free choices and the loopback worker path working. Estimate 300–450 production and 200–300 test lines.

## 3. Give the Waitron lane its Cloud contract

Extend registration’s `installations.ts` and `relay-payload.ts` around existing signed operations. The box needs venue status, an independent per-venue paid allowance and typed inputs for each fixed template, including a PDF scoped to its invoice template. A saved box mail server wins. HTTP and registration tests prove signed admission and PDF cleanup, reject cross-venue access and caller-supplied templates or headers, and preserve free sending. Estimate 250–400 production and 150–250 test lines in Cloud.

## 4. Show delivery failures and pause one venue

Reuse registration’s `ses-feedback-store.ts` and `recipient-suppression.ts`. Signed box reads expose only that venue’s failures for Try again from the box or Remove. Keep the shared suppression guard. Pause only the affected venue, refuse its mail immediately and notify it and Waitron. Let the venue resume after clearing bad addresses. A second pause within 30 days requires Waitron’s operator. Keep a 31-day delivery log without message content. Feedback and HTTP tests cover isolation, resume and expiry. Estimate 250–400 production and 150–250 test lines.
