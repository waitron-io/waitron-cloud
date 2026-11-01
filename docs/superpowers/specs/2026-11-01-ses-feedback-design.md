# Stop sending to destinations that reject your mail

**D102 proposal, 2026-11-01. Documentation authority only.** You need authenticated
bounce and complaint feedback before enabling Amazon Simple Email Service (SES).
This proposal supplies neither
implementation authority nor live configuration. Source inspection uses main/base
`e797dbf0`; public AWS sources were checked on 2026-11-01. This design does not
depend on a lifecycle-journal implementation.

## Keep the email exception narrow

Recommend **Paris `eu-west-3`**, because it fits the existing operational region
set, including the separately approved extra backup destination. This is a
recommendation, not owner-approved email qualification. Frankfurt remains an
alternative requiring its own qualification. AWS lists Paris SMTP at
`email-smtp.eu-west-3.amazonaws.com` and no Spain SES endpoint.
[AWS endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html).

Spain venue data, logs and keys stay in `eu-south-2`. The separate email-processing
exception does not relocate them or establish recipient-system, transit or support
locations. Keep D101's supplier, location, legal and retention gates, and the
[register's](../../cloud-data-processing-register.md) separate `cloud-account-email`
and `venue-email` evidence. The
[D101 country decision](2026-10-22-cloud-data-protection-design.md#4-enforce-a-country-policy-and-qualify-every-outbound-flow)
grants no general platform permission.

Cloud-account mail and venue-instructed relay retain separate purposes, queues,
authority checks and usage attribution. Neither permits marketing. Feedback changes
no allowance, debit, refund or recovery policy; those decisions remain with the
[relay contract](../../transactional-email-relay-contract.md#allowances-abuse-and-status).
Missing approved configuration keeps production off, with no fallback region or provider.

## Receive feedback through a private queue

Recommend a SES configuration set, named event-publishing settings, that publishes
to a same-region **Standard SNS topic**, AWS's notification channel, then a
**Standard SQS queue**, AWS's work queue, and encrypted same-region **dead-letter
queue**, a private holding queue for repeatedly unprocessable events. A bounded
internal poller reads events, commits PostgreSQL feedback and recipient suppression,
a block on future sends,
then acknowledges them by deleting the SQS message. Encrypt the primary queue too.
SES requires Standard SNS rather than its ordered-topic option, FIFO.
[SES destination](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html).
Feedback topics must share the SES region.
[Regional rules](https://docs.aws.amazon.com/ses/latest/dg/regions.html).

Take exact account, region, sending identity, configuration set, topic and queue
bindings from qualified configuration, never event URLs. Bind the topic policy to
the SES service identity, expected configuration-set source ARN, an AWS resource
identifier, and source account. Permit queue publication only from SNS with the
expected topic ARN and account. Queue-specific consumer credentials cannot publish.
[SES policy](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html),
[SNS queue policy](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-sns-topic.html).

Keep raw delivery off so the SNS wrapper survives. Accept only `Notification` with
the configured `TopicArn`, account and region; also validate SES `sendingAccountId`,
`sourceArn`, configuration-set tags and attempt binding. Envelope fields do not
authenticate a publisher. The effective AWS policies and authenticated SQS connection
form the trust boundary. Qualification must prove wrong-source and direct-publisher
access denied, including falsification and configuration-drift tests.

Ignore embedded certificate and subscription URLs without fetching them. Compared
with a public HTTPS webhook, polling avoids a public receiver and certificate-fetching
surface, at the cost of queue custody and consumer-health work. A webhook would need
separate signature verification, constrained certificate retrieval and exposure review.

## Bind feedback before SMTP starts

The [adapter, lines 68–72](../../../packages/registration/src/smtp-mailer.ts#L68)
constructs `<deliveryId@domain>` and returns it. It does not expose SES's ID.
Preserve [EmailDeliveryReceipt.messageId](../../../packages/registration/src/email-delivery.ts#L2)
as that original RFC Message-ID, the message-header identifier. SES assigns a
different `mail.messageId`; its SMTP acceptance response includes `250 Ok` and the
provider ID. If captured, store it in a separate bounded, validated provider-receipt
field. Discard malformed optional receipt metadata without retrying an accepted send.
Never retain the raw response.
[SES event fields](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html),
[SMTP responses](https://docs.aws.amazon.com/en_en/ses/latest/dg/troubleshoot-smtp.html).

Preserve authenticated SMTP with TLS, encryption from connection start, on port 465
and certificate verification. SES supports this connection mode.
[TLS wrapper](https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html).

Before each external attempt, durably bind a server-generated opaque attempt tag,
an unpredictable reference, to
country, purpose, queue/installation scope, recipient keyed digest, configuration set
and claimed attempt. A keyed digest is an address lookup value computed with a secret
key. Use a fresh tag per attempt, including account-worker retries.

At the trusted adapter boundary, add `X-SES-CONFIGURATION-SET` and
`X-SES-MESSAGE-TAGS`, never caller headers. Put no raw recipients in metadata and no
body or tokens in tags. SES removes these headers before forwarding and exposes tags
in event data.
[SMTP headers](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-send-email.html),
[event fields](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html).

Resolve authenticated events through the pre-handoff tag even before the SMTP
acknowledgement or after terminal payload erasure. Bind the provider ID on the first
trusted observation, from a validated receipt or matched event, uniquely within its
account/region; reject conflicting bindings. Never match by current account email,
subject, body, client Message-ID alone or an unbound provider ID.

Keep one recipient per message. A complaint can redact its recipient; only a uniquely
bound one-recipient attempt resolves it. Unknown, ambiguous, old unbound or
multiple-recipient events cannot bulk-suppress guessed targets.
[AWS redaction guidance](https://docs.aws.amazon.com/ses/latest/dg/troubleshoot-notifications.html).

For example, a password-reset attempt in Spain commits tag `attempt-7K2` and the
original recipient digest before SMTP. A complaint carrying that tag can arrive
before the worker saves SES's ID. It blocks the original destination even if you
have since changed the account email and the worker has erased the reset payload.
The accepted-send record remains accepted; feedback creates no second message.

## Keep sending and feedback states independent

Feedback does not rewrite queue-terminal `sent` or `accepted` into inbox delivery.
`Delivery` means recipient-server acceptance.
[Event definitions](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html).
Permanent hard bounce, complaint and explicitly classified provider-already-suppressed
outcomes block further exact-destination handoffs. Temporary, undetermined or malformed
events do not become permanent suppression without explicit classification. Known soft
failures add no resend because SES may already retry. Feedback never starts a send or
replays an erased token.

**Proposed policy requiring full-design approval:** block the exact recipient across
account and venue purposes within the same provider account/region and country.
Keep attribution and Cloud records separate across countries. SES suppression is
account/region-wide, so a country-scoped Cloud record cannot limit a provider block.
Do not enable another country in that shared provider account without separately
approved isolation or sharing policy. Delivery, not-spam and later
old events cannot automatically clear a block. Manual removal needs separate operator
authentication, an audit record and reconciliation with SES regional BOUNCE/COMPLAINT
suppression. It never resurrects old mail.
[SES suppression](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html).
Keep public reset responses generic; neither deactivate an account nor fabricate a
recovery bypass.

The [account worker](../../../packages/registration/src/email-outbox.ts) can retry
ambiguous SMTP failures. This remains a production qualification limitation, not
exactly-once delivery or provider deduplication. Preserve the
[relay's uncertainty rule](../../transactional-email-relay-contract.md#queueing-and-uncertain-delivery)
and its separate [worker](../../../packages/registration/src/relay-worker.ts).

## Commit the decision before acknowledging it

Standard SQS can duplicate and reorder events.
[SQS guarantees](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html).
Process transport repeats once by SNS ID, topic and country, with a content digest detecting
changed content under the same ID. Independently deduplicate semantic outcomes by
event identity, attempt and recipient, using feedback ID where available. Bound
parsing sizes and validate required fields while tolerating harmless added fields.

Commit feedback and suppression in one database transaction before SQS deletion. A crash before commit
leaves work retryable; a crash after commit makes redelivery a no-op. Visibility expiry,
when a consumer's exclusive processing window ends,
competing consumers and out-of-order Delivery then Bounce must preserve the strongest
outcome. Bound retries for poison events, messages that repeatedly fail processing,
into the private encrypted dead-letter queue. Log fixed
diagnostics, never raw envelopes, recipients, headers or tokens.

Share one recipient-suppression lock protocol across feedback and both handoff paths.
Preserve relay control, message and authority lock order, then take suppression locks
at country/provider scope before queue/attempt mutation. This shared lock covers
all recipient key versions so rotation cannot split the decision.
Feedback takes suppression locks without acquiring those earlier authority locks.
Commit a durable handoff admission under that lock after rechecking claim, authority,
expiry, keys and suppression. Release the transaction before SMTP. Suppression blocks
new admissions but cannot retract previously admitted, in-flight or accepted mail.
Late events bind the original recipient, even after a contact-email change.

Conceptual durable records and internal interfaces, not SQL or migration reservations:

| Record/interface | Minimum meaning |
| --- | --- |
| Attempt binding / admit handoff | Opaque tag; country/policy/configuration revision; purpose; queue identity; installation scope; claim/attempt; recipient digest/key version; provider account/region; configuration set; optional provider ID; admission time |
| Feedback / apply event | SNS ID/topic/country; content digest; semantic identity/type/time; attempt binding; fixed classification and processing result |
| Suppression / check or audited removal | Country/provider scope; recipient digest/key version; blocking reason/evidence; operator action and reconciliation state |

These pseudonymous indexes replace addresses with keyed lookup values. They remain
personal data, not anonymous data. Rotation must
keep old lookups effective; missing or revoked required keys refuse handoff. Queue
and dead-letter contents remain personal email-processing data covered by the email
exception, contracts and explicitly approved retention. Choose no duration here;
qualify queue encryption/key custody without relocating Spain venue keys.

## Prove locally before qualifying live

Preserve the [current transport contract's](../../production-email-implementation.md#scope-and-contract)
15-second adapter, 20-second worker and 60-second queue lease, including
their protected assertions. Separate event polling, processing and visibility budgets
are builder choices validated locally. Start future implementation with failing tests.

| Synthetic case | Required success, refusal or restart result |
| --- | --- |
| Valid delivery, hard bounce, complaint, provider suppression | Bound evidence; appropriate block; no send |
| Spoofed source, wrong account/region, direct publisher | Refusal; falsified policy guards make tests fail |
| Duplicate; same ID with changed payload | No-op; conflict without overwriting evidence |
| Event before send acknowledgement; lost acknowledgement | Tag resolves original attempt; existing uncertainty remains truthful |
| Erased payload; masked complaint recipient | Unique one-recipient binding works without recovering tokens |
| Unknown/old/multiple-recipient binding | No guessed or bulk suppression |
| Cross-purpose/country; changed contact email | Proposed same-country block crosses purposes only; original destination retained |
| Suppression racing handoff | Lock winner determines admission; admitted mail cannot be recalled |
| Rotation; revoked/missing key | Historical lookup survives rotation; unavailable key refuses handoff |
| Worker crash before/after database commit | Retry before commit; no-op after commit, including restart |
| Competing consumers, visibility expiry, out-of-order Delivery/Bounce | One durable effect; strongest block survives |
| Poison event, dead-letter transfer, not-spam, unblock | Bounded private handling; no automatic clear or resend; unblock creates no mail |

## Keep approval and live qualification separate

Alert on aggregate queue age, dead-letter count, consumer health and provider
configuration drift through [D104's independent channel](../../incident-response.md#prepare-your-independent-route).
Age/rate thresholds await D103 approval. Add no dashboards or identifying metric labels.

You must approve the full proposal and grant build-plan authority before planning
implementation. Landing this document authorises no code build.

AWS account, sender, domain and controlled live-test authority remain owner-only on
3 November. No spending, resources, DNS changes, provider calls, live mail, customer
enablement, retention choice or new platform permission is authorised here. Before
enablement, require sender authentication through SPF, the permitted-sender record;
DKIM, the domain signature; and DMARC, the domain-alignment policy. Inspect received
source for authentication and tracking off, including no open/click tracking or link
rewriting. Require topic/queue access-denial proof, retention/supplier/location evidence,
and controlled delivery, bounce, complaint, suppression and audited-unblock live proof.
Local fixtures establish none of those live qualifications. Live SES configuration
remains unimplemented.
