# SES feedback and suppression implementation plan

**D102, plan-only authority.** The owner approved [PR850's full design](../specs/2026-11-01-ses-feedback-design.md) as written on **2026-11-01 at 13:08**, permitting this implementation plan only. Source baseline: main `b522fa943a15badafbb4e88e9e7c637f2bd58d51`. No implementation, tests, migration, AWS configuration, commits or provider operations are authorised by this document.

Build work, AWS resources, spending, sender/domain setup, DNS and controlled live mail need separate owner authority on/after **3 November**. The date alone grants none. All checkboxes below describe future work; no future test is claimed as run.

**Goal:** Bind authenticated SES feedback to the original attempted destination and block later handoffs across account and venue purposes within one country/provider account/region.

**Architecture:** Use Paris `eu-west-3`, a SES configuration set, private Standard SNS/SQS and encrypted primary/dead-letter queues. Commit an opaque attempt binding before SMTP; commit feedback and suppression atomically before deleting an SQS message. Keep sending outcomes, feedback, authority and accounting separate.

**Stack:** Existing TypeScript, Node test runner, `pg`, PostgreSQL transactions, Nodemailer and TLS fixtures. A future SQS adapter adds a pinned `@aws-sdk/client-sqs` dependency and lockfile entry; automated tests use injected transport doubles, never AWS.

## Source baseline and constraints

These are source observations, not executed delivery guarantees:

- `packages/registration/src/{email-delivery,smtp-mailer,email-outbox,configured-mailer,email-worker-cli}.ts` supply account delivery. `EmailDeliveryReceipt.messageId` is the original RFC Message-ID, built from the queue ID, not SES's `mail.messageId`. Preserve the 15-second adapter, 20-second worker and 60-second lease assertions, claim fencing, bounded retries, terminal payload erasure and generic reset responses.
- `packages/registration/src/{relay-worker,relay-smtp,relay-messages,relay-grants,relay-control}.ts` supply **local proof only**. `RelayDelivery` is currently a string outcome; `localRelaySmtp` is loopback capture without TLS. Normal startup has no relay routes or production worker. Preserve stop, cancellation, authority, admission bounds, debit attribution and uncertain/no-resend behaviour.
- `packages/registration/src/country-policy.ts` matches trusted `CountryPolicy`/`FlowRequest` snapshots; Spain's default has no qualified flows. Use the existing country concept. Keep Spain venue data, logs and keys in `eu-south-2`; the email exception grants no other flow or fallback.
- `packages/registration/src/{migrate,transaction}.ts`, `deploy/local-stack/runtime.mjs` (`checkConsumerSchema`) and `packages/registration/README.md` own migrations and compatibility. There is no `migrations/README.md`. Allocate additive SQL's number only after rebasing on landed main; reserve none now and never edit applied SQL/digests.
- Read [production account email](../../production-email-implementation.md), [account delivery](../../email-delivery-implementation.md), [relay contract](../../transactional-email-relay-contract.md), [country policy](../../country-policy.md) and [processing register](../../cloud-data-processing-register.md) alongside the design. Retain separate `cloud-account-email` and `venue-email` qualification and attribution.
- Main has no `deploy/aws`. Every new path and signature below is **proposed**, not existing infrastructure or a dependency on unlanded lane D/G work. Do not change Waitron, fiscal/golden assertions, authority checks or recovery checks.
- Exact-destination suppression crosses both mail purposes only within one country/provider account/region. Another country sharing that provider account needs separately approved isolation/sharing because SES regional suppression is account-wide. No marketing, automatic unblock, account deactivation, recovery bypass, refund change or replay of old mail follows from feedback.

## Execution and verification rules

After separate build authority, implement tasks in order. Before writing code or tests, read `superpowers:test-driven-development`. For each RED step, add the named behavioural cases and run its command: observe the expected missing behaviour, not an environment/setup failure. Then implement minimally and rerun GREEN with every existing assertion retained. Finish each passing task with an explicit file list and `git commit -s -m '<task outcome>'`; never bypass hooks. This plan grants no authority to commit implementation. Prove every new guard in an owned disposable copy: run the passing control, remove the guard and observe the expected failing assertion, restore it and require the control to pass.

Commands C1–C8 below run from the repository root. While Mac Docker is off, read `~/waitron-campaign-shared/test-box.md` and run Docker-dependent commands through the existing wrapper, **only after build/test authority**, for example:

```sh
~/waitron-campaign-shared/test-box-run.sh H "$PWD" node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/ses-feedback-store.test.ts
```

The wrapper runs the copied candidate on Linux; remote Docker from the Mac does not provide the tests' loopback endpoints. Record candidate revision/diff, exact command and result. Exit 75 means busy, not failure or pass. Respect reported memory, run bounded groups, and remove only resources your run created. Native parser/type checks need no Docker. CI owns the broader suites on the current candidate; do not duplicate them locally merely to finish.

Review focus: forged transport identity (T1/T8), feedback before acknowledgement or after erasure (T2/T3/T5), key rotation during handoff (T2/T4), commit/delete interruption (T3/T6), and late feedback during manual removal (T7). Each has explicit failing cases below.

> **Built.** Tasks 1–8 are on main; the owner-only enablement checklist stays below. Their step-by-step text was removed on 24 November 2026; read it with
> `git show 3c69f4903:docs/superpowers/plans/2026-11-02-ses-feedback-implementation.md`.

## Enablement checklist: separate owner-only provider qualification

No task above grants live enablement. Keep this checklist open until the owner separately authorises the relevant action on/after 3 November; reverify current provider behaviour against authoritative sources before qualification.

- [ ] Record separate build/test authority and passing local task receipts first. Then obtain explicit AWS account/resource/spend, sender/domain/DNS and controlled live-test authority. Do not infer one permission from another or from a calendar date.
- [ ] D101: accept supplier/entity/contract/role, support/access/transit/recipient boundaries, exact account/surface/location and retention/deletion evidence for **both** email purposes, including encrypted queues/DLQ, pseudonymous indexes, keys and backups. Keep Spain data/log/key rules and no fallback. Another country on the SES account waits for approved isolation/sharing.
- [ ] Provision only the approved Paris configuration-set/SNS/SQS/key bindings. From the actual runtime credentials prove wrong-source/account/region, forged envelope, direct publisher and wrong-queue access denied; falsified effective policy/drift must stop qualification. Check actual encryption, redrive, bounded custody and least privilege. Synthetic tests prove none of these access denials.
- [ ] Qualify fixed verified senders with SPF, DKIM and DMARC. Inspect received source for authentication and tracking off, including no open/click tracking or link rewriting. Prove controlled delivery, hard bounce, complaint/redaction, provider suppression, lost acknowledgement and manual audited unblock/reconciliation without resurrecting mail.
- [ ] D103: approve queue-age/rate thresholds and provider/recipient abuse/spend controls. D104: deliver queue-age, DLQ, consumer-health and configuration-drift alerts through the independent channel, including failed/stale consumer handling. No dashboard or identifying labels.
- [ ] Keep production relay gated until separate consenting-grant/origin proof, allowance/debit/refund/reset-limit policy, recovery alternative, key custody, abuse limits and pinned Cloud/Waitron compatibility evidence are approved. Only a separately authorised enabling change may compose the production adapter with qualified grant/worker/startup paths. Account mail retains its separate gates and generic reset responses.

## Design traceability

| Approved design section / boundary | Tasks |
| --- | --- |
| Narrow Paris email exception, separate purposes/countries and no fallback | T1, T4, T8; D101/enablement gates |
| Private Standard SNS/SQS, authenticated source, least privilege, no URL fetching | T1, T6, T8; actual IAM qualification |
| Durable tag before SMTP; original RFC ID versus provider ID; unique first observation | T2, T3, T4, T5 |
| Erased/old payloads, changed contact, redacted one-recipient complaint, unknown/multiple recipients | T1, T2, T3 |
| Independent sending/feedback states, classification, no resend/automatic clear, generic recovery | T3, T4, T5, T7 |
| Atomic commit before delete, transport/semantic deduplication, changed same-ID content, crashes/order/concurrency | T2, T3, T6 |
| Shared suppression lock order, all-version rotation, stale claims and durable admission | T2, T4; T7 removal race |
| Preserved account deadlines/receipts; local-only relay and explicit production adapter | T4, T5, T8; relay enablement gate |
| Bounded encrypted DLQ, shutdown/health, fixed diagnostics and alerts | T1, T6, T8; D103/D104 gates |
| Audited manual unblock/provider reconciliation; retention/supplier/legal/live proof | T7, T8; owner-only enablement checklist |
