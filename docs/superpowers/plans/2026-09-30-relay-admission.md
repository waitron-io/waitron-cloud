# Signed relay admission implementation plan

**Goal:** Admit the three version 1 message classes durably, expose private status and cancellation, and keep delivery disabled.
**Spec:** [Version 1 contract](../../transactional-email-relay-contract.md), slice 2.
**Architecture:** A separately configured local-proof `RelayMessages` store owns encrypted records and keyed replay checks. Each transaction takes a message advisory lock, then calls D45's reservation core (account, membership, venue, installation, grant, account allowance locks), rechecks the signed proof and lease under those locks, and inserts or reads the message. HTTP routes exist only when explicitly injected; normal startup and existing account mail stay unchanged.
**Execution:** Inline, test first, under the owner's unattended campaign authorisation.

## Tasks

- [ ] Add real HTTP/PostgreSQL tests in `packages/account-http/test/relay-messages.test.ts` and a local fixture. Observe missing-route failures before implementation. Cover concurrent admissions and retries, three message classes, invalid shape/version/action/key/lease, grant loss and tenant crossing, cancelled tombstones, lost replies and restart.
- [ ] Add migration `032_relay_messages.sql`, structured validation and separate encryption/replay key rings in registration, and `RelayMessages.execute(action,envelope)`. Store no plaintext recipient/code/token or unkeyed content digest. Bind encryption to installation/message/grant/revision/class/key; retain old replay keys for tombstones. Read missing and foreign IDs identically. Clear ciphertext on cancellation/expiry and preserve the debit.
- [ ] Add opt-in `/v1/installations/email/{submit,status,cancel}` routes through account HTTP. Reuse bounded ingress and authenticated installation limits; return fixed errors only. No environment switch, grant endpoint, SMTP path or worker. Add the three signed actions without widening existing lifecycle handlers.
- [ ] Prove rollback, key rotation/loss, swapped ciphertext, deadline after lock waits and concurrent cancel/submit with focused tests; remove critical guards in a disposable copy. Preserve existing account-mail and default-disabled assertions. Run typecheck and relevant migration/lifecycle/HTTP tests.
- [ ] Update the contract and backlog with current proof and remaining production/worker/Waitron dependencies. Run finish-branch's one Claude security/run-it review, triage findings, normal push/CI, then locked land-branch and exact-merge CI.

## Review focus

The message lock precedes D45's lock order; there is no installation UPDATE lock before membership locks. An expired or replaced key cannot use a previously authenticated envelope after waiting. Rotation verifies replays with their original key, and lost keys produce a fixed unavailable result. Cancelled/expired tombstones cannot create a fresh debit or revive content. Unknown and foreign status requests reveal no message existence. Admission rejects arbitrary URLs, HTML, headers and attribution. Current Waitron action format is 32 random bytes encoded base64url, six decimal code digits, 24h invitation / 30min reset or change / 10min code; no Waitron edits.
