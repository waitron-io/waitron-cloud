# Prepare SES feedback qualification offline

A valid policy file does not prove who can publish feedback or read a queue in
AWS. Before you enable mail, you need both a reviewed configuration and evidence
from the actual runtime identities. This guide prepares the offline documents;
every provider action still needs separate owner authority.

Stockholm (`eu-north-1`) is the configured default. The owner also accepts Paris
(`eu-west-3`), with explicit qualification for the selected region. Historical
Paris-only wording and the plan's 3 November date grant no provider permission.
The owner's existing sender DNS setup does not approve resources, SMTP credentials,
production access, spending or live mail. Spain venue data, logs and keys keep their
separate home-region rules.

## Check the proposed document bundle

`validateSesFeedbackPolicies(config, documents)` is an internal, synchronous check
of a closed document profile. First obtain `config` through
`validateSesFeedbackConfig(trustedPolicy, bindings)`. A caller-supplied policy or
`qualified` flag cannot qualify that configuration. Spain's production policy
still has no qualified email flows, and the offline check changes no runtime gate.

The bundle uses normalized JSON values rather than a raw AWS API response:
booleans are booleans, policies are objects and redrive settings are objects.
Remove response metadata before validation. Unknown fields, statements and policy
variants refuse; this is not a general IAM policy interpreter. IAM is AWS's system
for deciding who may perform an action on a resource.

You can run the synthetic example from the repository root:

```sh
node --input-type=module <<'JS'
import {validateSesFeedbackConfig} from './packages/registration/src/ses-feedback-config.ts';
import {validateSesFeedbackPolicies} from './packages/registration/src/ses-feedback-policy.ts';
import {feedbackPolicyFixture} from './packages/registration/test/fixtures/ses-feedback-policy.ts';
const {policy,input,documents}=feedbackPolicyFixture();
const config=validateSesFeedbackConfig(policy,input);
validateSesFeedbackPolicies(config,documents);
console.log('Offline documents match; production remains disabled');
documents.topic.Policy.Statement[0].Resource='*';
try { validateSesFeedbackPolicies(config,documents); }
catch(error) { console.log(error.message); }
JS
```

The output is:

```text
Offline documents match; production remains disabled
Invalid SES feedback policies
```

The example's `123456789012` account, `mail.example.test` identity and roles are
synthetic. Its five-receive poison-message setting is a fixture value, not an
approved production threshold. The validator accepts the provider's integer range
of 1–1000 without choosing a value or a retention duration.

The bundle contains these separately checked parts:

| Part | Required boundary |
| --- | --- |
| Revision and country inventory | Exact configuration revision and its single country. A second country, even with an `approvedIsolation` flag, refuses pending a separately reviewed sharing/isolation design. |
| Configuration-set destination | Exact configuration-set and topic ARNs, enabled, with only bounce, complaint, delivery, delivery-delay and reject events. Open/click tracking and rendering failure are excluded. No additional event type is qualified here. |
| Standard SNS topic policy | Only the SES service may publish, with exact source account and configuration-set ARN. No direct publisher identity or extra statement. |
| Subscription | SQS protocol, exact topic and primary queue, raw delivery off so the SNS envelope remains available. |
| Primary queue | Standard, customer-managed queue key, only SNS sending from the exact topic/account, exact DLQ target and bounded receive count. It accepts no other queue as a redrive source. |
| Dead-letter queue (DLQ) | Standard, same encrypted queue key, no direct publisher grant, and only the exact primary queue may use it as a DLQ. No automatic replay or message-move permission. |
| Consumer identity policy | Receive, delete and read attributes on the primary queue; decrypt its exact key. No publish, purge, policy changes, SES administration or DLQ message access. |
| Health identity policy | Read only DLQ attributes for counts, with no message or key access. Authenticated primary-age and drift collection still needs qualification. |
| SMTP identity policy | Send raw mail only for the exact SES identity. It shares no identity with the consumer, health reader, operator or key administrator. |
| Queue key and its policy | Exact same-account/region customer-managed symmetric enabled key. SNS data-key/decrypt use is source-bound; the consumer gets decrypt only; a separate administrator gets the enumerated management operations. |

Only a KMS key policy uses `Resource: "*"`: in that context it means the key
carrying the policy. Identity policies must name the full key ARN. The queue key
is separate from Spain venue keys. Its administrator can change its policy, so
that authority and subsequent changes belong in effective-permission and drift
qualification. The bundle identifies a separate reconciliation operator but grants
it no provider-removal permissions. Provider-only removal stays owner-only.

The limited profile rejects extra grants; it cannot discover another attached
identity policy, role trust, permission boundary, session policy, service-control
policy, endpoint policy or extra subscription. Nor can it authenticate an export.
A passing result returns `undefined`, never an enablement token. Collect the full
live inventory and test access with the actual identities before accepting it.

The permission shapes follow AWS's
[SES event destination policy](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html),
[encrypted queue policy guidance](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-least-privilege-policy.html)
and [queue key management](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-key-management.html).
These sources were checked on 6 November 2026. Recheck effective service conditions,
key use during redrive and the complete access graph during live qualification.

## Prepare the later deployment handoff

Keep the [plan's enablement checklist](superpowers/plans/2026-11-02-ses-feedback-implementation.md#enablement-checklist-separate-owner-only-provider-qualification)
open. Once the owner authorises each provider action, create the approved
configuration set, private topic, subscription, primary queue, DLQ and queue key
in the explicitly selected account/region. Export the actual settings and every
relevant policy, record their immutable digests and compare them with the reviewed
bundle. Test wrong source/account/region, direct publishing, wrong-queue access,
unapproved keys and extra subscriptions from the real runtime credentials.
Unknown or changed evidence stops qualification; a synthetic refusal is not an
effective AWS access denial.

Deliver SMTP credentials, AWS identity credentials and retained recipient keys
through the approved secrets mechanism. Keep those channels and identities
separate. The bindings file is not a credential store. Do not paste keys, recipient
addresses, payloads or raw provider replies into an evidence receipt or log.

Before supervision starts, run the actual migration command and the deployment's
consumer-schema compatibility checks against the intended database revision.
Migration 051 and its predecessors must be applied unchanged. Inventory retained
recipient keys and reconcile historical local suppression rows: unknown-origin,
unmapped or differently scoped blockers remain a production gate. Do not discard
or assign them a country to make enablement pass. Retain the approved separate
key-retirement/recovery design as another open gate.

The standalone command is `packages/registration/src/ses-feedback-cli.ts`. Normal
services do not start it. Later, qualified supervision must explicitly opt in with
`CLOUD_SES_FEEDBACK_CONSUMER=enabled`, the bounded
`CLOUD_SES_FEEDBACK_CONFIG_FILE`, `DATABASE_URL`,
`CLOUD_MAIL_RECIPIENT_KEYS` and `CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID`.
`CLOUD_SES_FEEDBACK_HEALTH_SAMPLE_FILE` can supply a bounded trusted operational
sample; that file alone does not collect or authenticate provider metrics.
Keep these settings off in examples. Account SMTP separately requires
`CLOUD_MAIL_PROVIDER=ses` and `CLOUD_MAIL_TRANSPORT=smtp`, qualified bindings,
verified fixed sender and certificate-verified TLS on port 465.

Qualify process supervision and the independent alert route together. Readiness
needs both consumer slots and fresh trusted poll/operational evidence. Collect
primary queue age, DLQ counts, stale/failed consumer state and configuration drift
without identifying labels. D103's thresholds and D104's independent delivery
route remain open. Test SIGINT/SIGTERM and the existing twenty-second shutdown
grace; a committed message without acknowledgement must remain replayable.
Check replay and poison-message transfer without purging queues or resending old
mail. Runtime schema, health and shutdown tests are local evidence until the
actual deployment is qualified.

Production relay remains independently gated on consent and origin proof,
allowances, recovery alternatives, key custody, abuse limits and pinned
Cloud/Waitron compatibility. Neither an account-only qualification nor this
bundle wires relay routes, grant construction or a production worker.

## Inventory retained evidence before choosing deletion

Keep each email purpose separate in the
[processing register](cloud-data-processing-register.md). Have the owner approve
the supplier/entity/contract, support and access boundaries, transit, recipient
systems and all-copy retention/deletion for each of these inventories:

| Inventory | Dependencies to account for |
| --- | --- |
| Primary and dead-letter messages | SNS envelope, provider metadata, potentially recipient details, queue key versions, poison/redrive policy and operational exports |
| Attempts and shared suppression | Original destination's keyed references, configuration/policy revision, scope, retained recipient-key commitments and late-feedback binding |
| Feedback and deduplication | Transport IDs, semantic evidence, conflicting observations and previously removed blockers; replay must not resurrect an old block or old mail |
| Manual reconciliation | Actor/reason, block lifetimes, immutable requests and provider intents/results, expiring private observations and unfinished uncertainty |
| Database backups and diagnostic copies | Every retained version, both restore paths, recipient-key and queue-key custody, evidence exports and independent alert records |

No cleanup job or retention duration is introduced here. Do not disable an old key
while retained messages or copies still require it. Deleting queue messages does
not delete database evidence or backups, and clearing suppression creates no
new send, refund or restored token. D101 must approve the complete schedule and
verify its key dependencies before you enable production processing.
