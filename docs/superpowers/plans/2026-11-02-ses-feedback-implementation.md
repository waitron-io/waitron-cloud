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

## Task 1: Validate trusted configuration and bounded event envelopes

**New:** `packages/registration/src/{ses-feedback-config,ses-feedback-event}.ts`; `packages/registration/test/{ses-feedback-config,ses-feedback-event}.test.ts`.
**Use unchanged:** `packages/registration/src/{country-policy,account-input}.ts`. No production flow becomes qualified.

Proposed signatures and shared types, exported only between these internal modules:

```ts
type MailPurpose = 'cloud-account-email' | 'venue-email';
interface MailScope { country: string; providerAccountId: string; region: 'eu-west-3'; }
interface SesFeedbackConfig {
  scope: MailScope; policyRevision: number; revision: string; purposes: readonly MailPurpose[]; flows: readonly FlowRequest[];
  identityArn: string; configurationSet: string; configurationSetArn: string;
  topicArn: string; queueArn: string; queueUrl: string; dlqArn: string; smtpHost: string; smtpPort: number;
}
type FeedbackKind = 'delivery' | 'hard_bounce' | 'complaint' | 'provider_suppressed' | 'temporary' | 'unclassified';
interface ParsedFeedback {
  snsId: string; contentDigest: string; kind: FeedbackKind; eventId: string | null;
  eventTime: string; attemptTag: string; providerMessageId: string; recipient: string | null;
}
validateSesFeedbackConfig(policy: CountryPolicy, input: unknown): SesFeedbackConfig;
parseSesFeedback(body: string, config: SesFeedbackConfig): ParsedFeedback;
```

- [ ] **RED:** Add `rejectsIncompleteOrMixedQualifiedBindings`, `rejectsWrongSourceAndMultiRecipient`, `neverFetchesEnvelopeUrls`, `boundsParsingAndToleratesAddedFields`. Reject stale country/configuration revisions, unqualified purposes, wrong account/region/identity/configuration set/topic/queue, raw delivery, non-Notification wrappers, missing/duplicate attempt tags and malformed required fields. Inject a network trap to prove no certificate, subscription or embedded URL is fetched.
- [ ] Implement immutable trusted configuration with exact same-region/account ARN and queue bindings, production SMTP port 465 and no fallback. Check SNS `Type`/`TopicArn`, SES `sendingAccountId`/`sourceArn` and configuration-set/attempt tags. Match each enabled purpose/data class/endpoint through `decideCountryFlow` without combining evidence records. Account qualification cannot enable venue mail. The matcher keeps canonical HTTPS endpoints; qualify SMTP host/port separately on that evidence. Never accept caller policy, headers or a `qualified` flag.
- [ ] Bound the UTF-8 envelope to 256 KiB, SNS `Message` to 128 KiB and provider IDs to 256 ASCII characters; require a canonical 32-byte base64url attempt tag. Before reducing to `ParsedFeedback`, reject any destination/reported-recipient list with more than one entry or conflicting recipients. Complaints may omit/redact recipients; T3 must prove a unique one-recipient attempt. Other outcomes require their recipient. Reject invalid timestamps/identifiers, tolerate harmless added fields and explicitly classify provider-suppressed events. Temporary/undetermined events never imply permanent suppression.
- [ ] **GREEN C1:** `pnpm --dir packages/registration exec node --test test/ses-feedback-config.test.ts test/ses-feedback-event.test.ts test/country-policy.test.ts`. Expect all parsing/refusal cases and unchanged country tests to pass. Remove each local source guard in a disposable copy and require its owning test to fail. Synthetic envelopes/policy fixtures prove validation, **not actual IAM publisher authentication**. Commit with `git commit -s`.

## Task 2: Persist attempts, evidence and suppression under one lock protocol

**New:** `packages/registration/src/{mail-attempts,recipient-suppression}.ts`; `packages/registration/test/{ses-feedback-migration,mail-attempts,recipient-suppression}.test.ts`; one `packages/registration/migrations/<next>_ses_feedback.sql` (**metavariable**, allocated only during authorised execution).
**Modify then:** `packages/registration/src/migrate.ts` and `packages/registration/test/{registration,schema-compatibility,relay-worker,relay-control-migration,relay-bounds-migration,authenticator-schema}.test.ts` where their release setup needs the new tail. Trace all `migrationNames` consumers before adding it; retain historical prefix/data/digest assertions, including fiscal history unchanged.

Proposed internal contracts:

```ts
type QueueClaim = {purpose:'cloud-account-email'; outboxId:string; claimId:string; attempt:number}
  | {purpose:'venue-email'; installationId:string; messageId:string; claimId:string; attempt:number};
interface RecipientRef { keyId: string; digest: string; }
interface AttemptInput { config: SesFeedbackConfig; recipientKeys: RelayKeyConfig; claim: QueueClaim; recipient: string; }
interface HandoffAdmission { attemptTag: string; configurationSet: string; }
lockMailScope(client: PoolClient, scope: MailScope): Promise<void>;
recipientIsSuppressed(client: PoolClient, scope: MailScope, refs: readonly RecipientRef[]): Promise<boolean>;
admitMailAttempt(client: PoolClient, input: AttemptInput): Promise<HandoffAdmission>;
bindProviderId(client: PoolClient, attemptTag: string, providerMessageId: string): Promise<void>;
```

- [ ] **RED:** Prove pre-SMTP durability/rollback, fresh tags per retry, unique `(purpose, queue identity, claimed attempt)` and `(provider account, region, provider ID)`, conflicting first observations, immutable attribution, rotation across processes and refusal on missing/revoked/changed required key material. Concurrent receipt/event observations must resolve to one binding or a fixed conflict, never overwrite it.
- [ ] Add `mail_attempts` with a server-generated 32-random-byte base64url tag, country/policy/configuration revision, purpose, queue and installation scope, claim/attempt, admission time, configuration set, one-recipient marker and optional provider ID. Pin each queue identity to its trusted deployment country/provider scope; retries cannot reattribute it, and no recipient/domain inference supplies country. Store all required `RecipientRef` versions separately. Retain bindings after terminal erasure without address, body or token; keep RFC and provider IDs separate.
- [ ] Add `mail_feedback_receipts`, `mail_feedback_events`, `mail_suppressions`, `mail_recipient_key_versions` and `mail_suppression_actions`. Transport uniqueness is `(country, topic, SNS ID)` plus content digest; semantic uniqueness is attempt/recipient/event identity. Persist fixed results, blocking reasons/evidence and operator/reconciliation state, with scope constraints and account/region provider-ID uniqueness. These keyed indexes remain personal data.
- [ ] Use one transaction advisory lock keyed by schema plus country/provider account/region, covering **all recipient key versions and both purposes**. Enforce an open transaction on these helpers. Keep required historical keys and verify material against persisted commitments. Compute all retained recipient digests at admission; old feedback suppresses from stored refs after payload erasure. No automatic key retirement or retention cleanup.
- [ ] **GREEN C2:** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/ses-feedback-migration.test.ts test/mail-attempts.test.ts test/recipient-suppression.test.ts test/migration-history.test.ts test/schema-compatibility.test.ts`. Expect populated upgrade, interrupted transaction rollback/retry, repeat/concurrent migrate, immutable prior ledger/data and new uniqueness/rotation cases to pass. Test schemas only; migration authoring and application are both future build work. Commit with `git commit -s`.

## Task 3: Apply authenticated feedback atomically and independently of sending state

**New:** `packages/registration/src/ses-feedback-store.ts`; `packages/registration/test/ses-feedback-store.test.ts` and `packages/registration/test/fixtures/ses-feedback-crash.ts`.

Proposed `applySesFeedback(pool: Pool, config: SesFeedbackConfig, recipientKeys: RelayKeyConfig, event: ParsedFeedback): Promise<'applied'|'duplicate'|'ignored'|'conflict'>` owns the transaction; `ignored` means a recorded non-blocking/unresolvable outcome. Only T6 may supply messages received over its trusted queue connection.

- [ ] **RED:** Add `eventBeforeReceiptBindsOnce`, `erasedPayloadAndChangedContactKeepOriginalRecipient`, `redactedComplaintRequiresUniqueSingleRecipient`, `validTagWithDifferentRecipientRefuses`, `unknownOldAndAmbiguousBindingsNeverGuess`, `sameSnsIdChangedPayloadConflicts`, `semanticRepeatWithNewSnsIdIsNoop`, `commitCrashRestartsWithoutSecondEffect`, and `deliveryNeverClearsBounceOrComplaint`.
- [ ] Recheck configuration/attempt scope, purpose, queue/claim, configuration-set tag and original recipient before mutation. Never match by current account email, subject, body, RFC ID alone or an unbound provider ID. A redacted one-recipient complaint resolves only through its unique durable tag. For a non-redacted recipient, use the injected retained key ring to recompute and compare its keyed digest with the original attempt refs; a valid tag with a different recipient refuses. Required key unavailability keeps work retryable without deletion or guessed attribution. Pre-migration erased/unbound messages remain unresolvable; do not backfill guessed recipients or recover tokens.
- [ ] Process authenticated late feedback for an existing original attempt across later policy or configuration revisions when country, provider account, region, purpose and configuration set still match. Keep its sealed recipient and stored admission revisions unchanged. A revision upgrade alone must not consume blocking feedback as unresolved. Preserve every other scope, recipient, provider and key refusal.
- [ ] Keep the current full stop when any retained key in the scope is revoked. Before production, require a separately approved key-retirement and recovery design: the design promises refusal for required keys, while this implementation also stops attempts using other keys. Do not change a key guard or landed migration under this task.
- [ ] Take the shared scope lock, then lock/validate the attempt and bind the first trusted provider ID through T2. Independently deduplicate transport and semantic identities. Prefer provider feedback ID with type/attempt/recipient; otherwise use validated event type/time/provider ID/recipient identity. Hash complete transport content to detect changed same-ID payloads; retain original evidence and a fixed conflict diagnostic. Never overwrite a binding or existing receipt on conflict.
- [ ] Commit transport result, semantic feedback and any suppression in **one** transaction. Hard bounce, complaint and explicitly classified provider suppression add blocking evidence; soft/temporary/undetermined/malformed evidence adds no permanent block or resend. Delivery means recipient-server acceptance only. Keep `sent`, `accepted`, `uncertain`, debit and reservation facts unchanged. Out-of-order events retain every blocking reason; not-spam cannot clear them.
- [ ] **GREEN C3:** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/ses-feedback-store.test.ts`. Expect concurrent first observations, competing consumers, repeated/changed IDs, old payloads and out-of-order events to pass. Separate-process crash before commit must leave no partial effect; crash after commit must make replay a no-op. No SQS deletion exists in this task. Commit with `git commit -s`.

## Task 4: Admit account and relay handoffs through shared suppression

**Modify:** `packages/registration/src/{email-outbox,relay-worker}.ts`; `packages/registration/test/{email-outbox,relay-worker}.test.ts`.
**New:** `packages/registration/test/mail-handoff-suppression.test.ts`.
**Inspect/retain consumers:** `packages/registration/src/{relay-control,relay-grants,relay-messages,venue-service-permissions}.ts`; signup, recovery and service-alert liveness writers. Use T2's interfaces, without widening their authority.

Proposed worker additions: account `EmailWorker` options and local-proof `RelayWorkerConfig` gain optional internal `ses:{config:SesFeedbackConfig;recipientKeys:RelayKeyConfig}`. `RelayKeyConfig` is the current key-ring shape, reused with distinct suppression key material. Trusted worker construction supplies it; message callers cannot. This prepares synthetic scoped handoffs, not a production relay mode.

- [ ] **RED:** Add `suppressionWinsBeforeAdmission`, `admittedSendCannotBeRecalled`, `sameCountryBlockCrossesPurposesOnly`, `rotationCannotSplitHandoff`, `staleClaimCannotAdmitOrSettleReplacement` and `expiryOrAuthorityChangeDuringLockWaitRefuses`. Cover two accounts/venues, another country/provider scope, changed contact email, unavailable historical keys and both lock winners. Observe actual database blockers rather than relying on sleeps.
- [ ] For relay handoff retain order: control, message identity, existing account/credential/membership and venue-service authority, venue/installation/grant/account-allowance locks, **then shared suppression**, then queue/attempt mutation. Feedback takes suppression and evidence locks only, never earlier authority/control/message locks. Preserve claim-capacity order and do not introduce bounds locks into workers. Keep `reserve` replay-only at handoff; no new debit.
- [ ] For account handoff, move the current liveness checks onto the transaction client. Follow existing account/credential/request authority order before suppression; service alerts keep their complete current owner/incident/installation/service checks. Then lock/recheck the claim, lease, expiry, credential generation and required keys with database time after waits, check all recipient refs and persist admission/tag before committing. A stale claimant creates no attempt. A confirmed block uses existing terminal `failed/delivery_rejected`; relay retains `failed/refused`. Configuration/key unavailability refuses SMTP without fabricating a block.
- [ ] Commit admission before opening SMTP and release the transaction first. Account retries get fresh tags and the stable original Message-ID; relay commits `sending` with its attempt. Later suppression cannot recall admitted mail. Retain the local relay lock/table/API for unconfigured local proof. For explicitly scoped SES fixtures, take that existing local suppression lock, then T2's scope lock, and check legacy plus shared rows. Feedback takes only T2's lock. Bridge scoped trusted `suppress` writes to both stores and persist an explicit legacy-key/digest-to-scope mapping for reconciliation. Retain old assertions and never infer a country/provider for legacy rows.
- [ ] **GREEN C4:** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/mail-handoff-suppression.test.ts test/email-outbox.test.ts test/relay-worker.test.ts test/relay-operator-stop.test.ts test/password-recovery.test.ts test/service-alert.test.ts`. Expect all current behaviour plus races to pass. Exercise pending legacy rows and synthetic explicit scope configuration; missing SES configuration keeps SES handoff off without disabling local capture. Commit with `git commit -s`.

## Task 5: Add trusted SES metadata and separate provider receipts to both adapters

**New:** `packages/registration/src/{ses-smtp-metadata,relay-ses-smtp}.ts`; `packages/registration/test/{ses-smtp-metadata,relay-ses-smtp}.test.ts`.
**Modify:** `packages/registration/src/{email-delivery,smtp-mailer,email-outbox,configured-mailer,email-worker-cli,relay-worker}.ts` and relevant existing adapter tests. Inspect `signup.ts`, `password-recovery.ts`, `service-alert.ts`, `index.ts` and mailer fixtures before extending context/receipt types.

Proposed additions, not replacements for current signatures:

```ts
interface SesProviderReceipt { provider: 'ses'; messageId: string; }
// EmailDeliveryContext gains optional internal ses: HandoffAdmission.
// EmailDeliveryReceipt gains optional providerReceipt: SesProviderReceipt.
type RelaySesResult = {outcome: RelayDelivery; providerReceipt?: SesProviderReceipt};
createSesRelaySender(config: SesFeedbackConfig, smtp: SmtpAccountMailConfig, trust?: {ca?: string | Buffer}):
  (content: RelayContent, admission: HandoffAdmission, signal: AbortSignal) => Promise<RelaySesResult>;
```

- [ ] **RED:** Prove trusted configuration-set/opaque attempt headers, absence of recipient/body/token tags, distinct stable RFC ID versus fresh retry tags, early event/receipt races, valid `250 Ok` provider-ID extraction, and malformed/oversized optional metadata accepted without resend. Add real loopback TLS/authentication/certificate, deadline, cancellation, temporary/permanent refusal and post-DATA disconnect cases for the proposed relay adapter.
- [ ] Add only `X-SES-CONFIGURATION-SET` and `X-SES-MESSAGE-TAGS` from committed admission and immutable configuration. Proposed `CLOUD_MAIL_PROVIDER=ses` requires a trusted `CLOUD_SES_FEEDBACK_CONFIG_FILE` plus `CLOUD_MAIL_RECIPIENT_KEYS`/`CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID`; absent qualification refuses SES handoff, including direct SES-host configuration. Keep local/generic fixture modes explicit. No caller headers; one recipient, fixed sender/templates, authenticated certificate-verified TLS on 465. Local TLS fixtures may inject an ephemeral port/CA.
- [ ] Parse the bounded acceptance response into `providerReceipt` and discard the raw response. Persist/bind it against its original admission via T2, separately from the original `EmailDeliveryReceipt.messageId`/`email_outbox.message_id`. Optional malformed metadata must not turn success into retry. Binding conflicts raise fixed operational evidence without retrying an accepted send. Stale receipts may enrich only their admitted attempt, never complete a replacement claim. Lost acknowledgements retain account at-least-once limitations and relay uncertainty.
- [ ] Keep `RelayDelivery` and `localRelaySmtp` contracts/assertions intact; settle any production receipt separately from its outcome. Build/test `createSesRelaySender` as an internal standalone adapter, **without exporting a production startup path or widening `RelayWorkerConfig.mode:'local-proof'`**. Prepare its admission/settlement seam with local fixtures. Actual production worker/grant/startup composition requires the later enabling change and all relay gates; this task cannot enable relay by setting an SMTP variable.
- [ ] **GREEN C5:** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/ses-smtp-metadata.test.ts test/relay-ses-smtp.test.ts test/smtp-mailer.test.ts test/email-outbox.test.ts test/relay-worker.test.ts`. Expect protected 15/20/60 ordering, socket destruction, RFC receipts, local relay behaviour and new metadata cases to pass. Preserve production credential-free `--status`. Commit with `git commit -s`.

## Task 6: Consume bounded queue work, acknowledge after commit and expose health

**New:** `packages/registration/src/{ses-feedback-queue,ses-feedback-worker,ses-feedback-cli}.ts`; `packages/registration/test/{ses-feedback-worker,ses-feedback-shutdown}.test.ts`.
**Modify:** `packages/registration/package.json`, `pnpm-lock.yaml`; use existing `worker-loop.ts` cancellation patterns. Keep the new CLI opt-in, outside normal services.

Proposed queue port: `receive(signal:AbortSignal):Promise<{body:string;receiptHandle:string}[]>`, `delete(receiptHandle:string,signal:AbortSignal):Promise<void>`, `close():void`; worker `runOnce(signal:AbortSignal):Promise<boolean>`. Handles stay in memory. The real adapter authenticates to the configured SQS endpoint/queue and never uses event URLs. Trusted consumer construction injects the retained recipient key ring and passes it to T3; event bodies never supply keys.

- [ ] **RED:** Prove no delete on rollback/parse/conflict/database failure; delete only after durable success/duplicate/recorded ignore; delete failure and crash after commit replay safely. Exercise visibility expiry, two consumers, poison redrive, receive failure, stalled receive/processing/delete, database disconnection, SIGINT/SIGTERM and restart. Malformed or conflicting poison messages remain unacknowledged for bounded redrive, not silently dropped.
- [ ] Select local operational budgets: receive batch 1, concurrency 2, long poll 10 seconds, request deadline 15 seconds, database transaction/lock budget 5 seconds, visibility 60 seconds and shutdown grace 20 seconds. A visibility overrun permits duplicate intake, which T3 must tolerate; never weaken SMTP's independent budgets. Apply abort signals to network calls, bounded database waits and cleanup; stop new receives on shutdown and never acknowledge unfinished/uncommitted work.
- [ ] Plan redrive after five receives to a private encrypted same-region DLQ. Simulate that service contract locally; do not build a second application retry queue or an automatic DLQ replay sender. Persist fixed processing results only. Never log envelopes, raw recipients, headers, tokens, response bodies or receipt handles, including errors and shutdown.
- [ ] Provide aggregate health/status: successful poll/commit freshness, fixed failure state, queue age, DLQ count and configuration revision/drift status. A stuck consumer or stale sample cannot report ready. No identifying metric labels or dashboard. Expose data for D104's independent alert channel; D103 owns age/rate thresholds, so local budgets above are not alert thresholds.
- [ ] **GREEN C6:** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/ses-feedback-worker.test.ts test/ses-feedback-shutdown.test.ts test/worker-loop.test.ts test/email-worker-shutdown.test.ts`. Expect bounded exits, no premature delete and one durable effect after restarts. Real encrypted DLQ transfer and IAM are provider qualification, not established by the fake queue. Commit with `git commit -s`.

## Task 7: Require audited manual removal and provider reconciliation

**New:** `packages/registration/src/{mail-suppression-admin,ses-suppression-reconcile}.ts`; `packages/registration/test/mail-suppression-admin.test.ts`.
**Use:** T2's scope locks/operator records, `packages/identity/src/sessions.ts` and `packages/registration/src/{support-grants,security-audit}.ts` as authentication/audit references. Do not repurpose venue-scoped audit events for a cross-account block or use local `suppress` as removal authority.

Proposed `OperatorCredentials = {sessionToken:string;csrfToken:string}`; `requestMailUnblock(pool:Pool, operator:OperatorCredentials, scope:MailScope, recipient:string, expectedRevision:number, reason:string):Promise<{operationId:string}>`; `finishMailUnblock(pool:Pool, operator:OperatorCredentials, operationId:string, observation:ProviderSuppressionObservation):Promise<'cleared'|'blocked'>`. Both use existing `requirePlatformPermission` with proposed permission `mail.suppression.unblock`, provisioned only under separate operator authority. In `ses-suppression-reconcile.ts`, proposed `reconcile(operationId:string, signal:AbortSignal):Promise<ProviderSuppressionObservation>` uses an injected regional provider query/removal port. Its result is opaque, bound to operation/scope/revision and checked against a private runtime registry, not accepted as caller JSON.

- [ ] **RED:** Prove unauthenticated/ordinary-account/wrong-scope/stale-revision refusal, failed provider removal, partial BOUNCE/COMPLAINT reconciliation, a new blocking event during reconciliation, lost acknowledgement/restart, old duplicate redelivery and no queue resurrection. Add `mappedLegacyAndSharedUnblockTogether`, `unmappedLegacyBlockKeepsGateClosed` and `legacyMappingToAnotherScopeCannotBeCleared`. Verify immutable actor, reason, scope, prior evidence and outcome records with no token or raw address in audit output.
- [ ] Keep Cloud suppression active while a manual operation is pending. Outside database locks, separately authorised provider tooling queries/removes regional SES BOUNCE/COMPLAINT suppression and produces authenticated evidence bound to the operation. Reacquire the scope lock and compare the suppression revision; clear only the reconciled reasons when no newer blocker exists. Provider error, ambiguity, revoked operator authority or revision change keeps the block. Reconcile both directions; provider state never silently overrides Cloud evidence.
- [ ] For mapped legacy blockers, take the existing local suppression lock before T2's shared scope lock, then reconcile both stores in the same database transaction. The admin service receives retained legacy and shared digest matchers through trusted construction. Clear the exact mapped legacy digest only when all its mappings are to this reconciled scope and no blocker remains; an unmapped or differently scoped row keeps the operation blocked and production gated. Test both account and relay handoffs after clearing, retaining unrelated legacy rows and concurrent new blocks. Local tests inject trusted provider observations, including tampering and expiry; production observation acquisition and SES removal remain owner-only provider work. Delivery, not-spam and old events cannot clear a block. Keep deduplication evidence across removal, and let genuinely new blocking evidence block again. Removal creates no message, new attempt, token restoration, refund or account/recovery change.
- [ ] **GREEN C7:** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/mail-suppression-admin.test.ts test/security-audit.test.ts test/password-recovery.test.ts`. Expect audited idempotent reconciliation and unchanged mail/debit/state counts. Authentication must exercise actual session/capability verification, not a boolean operator flag. Commit with `git commit -s`.

## Task 8: Prepare offline production configuration and qualification evidence

**New, only after build authority:** `packages/registration/src/ses-feedback-policy.ts`, `packages/registration/test/ses-feedback-policy.test.ts` and `docs/ses-feedback-qualification.md`.
**Update then:** `.env.example`, `docs/{production-email-implementation,transactional-email-relay-contract,country-policy,cloud-data-processing-register}.md` with proposed settings/evidence references, never secrets or claims of deployment. No assumed `deploy/aws` tree, live resource configuration or new location model.

Proposed `validateSesFeedbackPolicies(config:SesFeedbackConfig, documents:unknown):void` checks offline policy documents supplied by the future deployment owner. Configuration is immutable and denied when incomplete; examples use synthetic identifiers and leave production switches off.

- [ ] **RED:** Add `refusesBroadenedPublisherOrConsumerPolicy`, `refusesDriftAndUnencryptedOrPublicQueues`, `rejectsSecondCountryWithoutApprovedIsolation`, and `productionRelayRemainsUnavailable`. Cover missing configuration-set SourceArn/SourceAccount, wrong SES/SNS principals, wrong topic/account/region, raw delivery, wildcard resources, direct publisher rights and missing encryption/redrive bindings. Deliberately falsify each policy guard in an owned disposable copy and require failure.
- [ ] Specify least privilege: SES service publishes only for the exact configuration-set ARN/source account; SNS service sends only from the exact topic/account. The consumer may receive/delete/read primary-queue attributes and use required key decrypt rights, never publish, purge, change policy or administer SES. A separate health identity reads DLQ counts without message access. Restrict DLQ/redrive and key policies separately; both queues are private/encrypted and Standard, raw delivery off. Separate SMTP, consumer and operator permissions. Qualify queue-key custody without moving Spain venue keys.
- [ ] Describe the later deployment owner's resource/configuration steps, explicit opt-in CLI supervision, secrets delivery, schema compatibility checks, health collection and controlled shutdown. Inventory queue/DLQ contents, attempts, suppression refs, audit/deduplication records and backups for approved retention/deletion and key dependencies. Choose **no retention duration** or automatic cleanup here. Reconcile old local suppression rows before any production migration/enablement; an unmapped legacy row is a gate, never silently discarded.
- [ ] **GREEN C8:** `pnpm --dir packages/registration exec node --test test/ses-feedback-policy.test.ts test/ses-feedback-config.test.ts` and `pnpm typecheck`; run `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=120000 test/relay-disabled.test.ts test/relay-messages.test.ts` through the box wrapper. Expect offline refusal controls and unchanged normal relay-off routes to pass. Local documents/fixtures establish no effective IAM or live location claim. Record focused receipts and current-head CI through normal future branch finishing; sign off future commits with `git commit -s`.

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
