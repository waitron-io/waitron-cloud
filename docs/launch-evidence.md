# Decide what you can claim before launch

Waitron Cloud has completed its first milestone with local fixtures. It has not
deployed a public cloud service. Use this page to keep those two facts separate.

The local evidence proves that the Cloud and Waitron contracts compose under the
tested conditions. Provider documentation proves that suitable services exist in
Spain. Neither proves that a production account is configured correctly, that every
data flow stays in Spain, or that a customer-facing recovery or availability promise
has been met.

This audit was checked on 27 September 2026 against Cloud main
`3efca036d4ddbb9e252931579a51ef80ae9f1e5c` and the official sources linked below.
Recheck the provider sources when you select or change a service.

## Read the D101 decisions as policy, not runtime evidence

D101 slice 1 now implements the outbound AI refusal and an explicit synthetic-only
loopback transport. The owner initially authorised this slice alone, then authorised local slices
2–5 on 2026-10-23. The [slice 2 register](cloud-data-processing-register.md) and
[draft annexes](cloud-processing-annexes.md) publish unqualified evidence and
unsigned instructions. Other runtime controls remain unbuilt; slices 6–12 remain
unauthorised. No local proof supplies privacy eligibility, supplier approval or
deployment evidence.

The [D101 data-protection design](superpowers/specs/2026-10-22-cloud-data-protection-design.md)
and reconciled [D88 hosting proposal](superpowers/specs/2026-10-21-cloud-hosted-venue-design.md)
record policy and proposed hosting, with source inspection at Cloud `60c0fbf` on
2026-10-22. The owner approved the D101 design, then its
[implementation roadmap](superpowers/plans/2026-10-22-cloud-data-protection.md),
and authorised local slices 1–5, with SQL-free slices 2/3 first and later schema
work using an actually available migration slot after reconciliation with Lane G. Broader D88 hosting/isolation/shared contracts
remain unapproved. They use
[A980 section 2](https://github.com/clintongormley/waitron/blob/96a1129e385447e9b9a6dc545673009953a2c551/docs/superpowers/specs/2026-10-22-a980-data-protection-design.md#2-the-data-map)
as the single application data map; Cloud builds no second application rights tool.
The owner selected country-pack home/permitted backup regions; Spain venue data,
logs and keys in `eu-south-2` plus one extra backup in another EU region; menu-only
translation without personal data; full exit download, 90-day read-only backups and
then deletion except Cloud's own billing; per-session approved support or the narrow
emergency route when the venue cannot trade and cannot be reached; scoped machine key use; and cold recovery.
D102 owns the separate selected EU SES email exception. The owner approved a 24-hour
maximum for how long one venue approval keeps support access open, shorter where
practical with fresh approval to extend, and Paris `eu-west-3` for the extra backup,
subject to qualification. All six D101 lawyer questions, the KMS deletion-waiting
policy, legal annexes, supplier/entity/access/transfer evidence and runtime proof remain
open. AI additionally requires separately accepted privacy-reviewed input eligibility,
examples and limits. Only the local AI refusal and explicit synthetic transport are implemented; other
D101 runtime controls remain unbuilt.
No production build starts from this documentation. D68 is landed, but hosting and
recovery costs remain unmeasured. D79 PR5/6 and migration 043 are landed; PR7
final local integration/release qualification remains incomplete.
Its local receipts do not qualify a production deployment.

## Read the local evidence narrowly

The first milestone is complete locally. Each row names the executable evidence and
the boundary it does not cross.

| Milestone claim | Current evidence | What it does not prove |
| --- | --- | --- |
| An owner can connect two venue installations with venue-scoped authority. | The [pairing proof](local-pairing.md) and combined milestone receipt exercise signed installation proof, matching-code approval, lost replies, restart and cross-venue refusal. | Public account ingress, live sender delivery, production credentials or a provider network. |
| Public HTTPS and staff TLS passthrough remain separate and venue-scoped. | The [remote-access proof](local-remote-access.md) uses real Waitron servers, WireGuard, HAProxy, certificates, bot challenges, revocation, functional probes and gateway replacement. | AWS networking, live DNS or ACME credentials, deployed key custody, appliance installation, traffic capacity or a production availability target. |
| Two venues can upload and recover without sharing storage authority. | The [backup proof](local-backups.md) covers scoped storage, conditional writes, managed-key rotation, interrupted transfer, continuous recovery and verified-snapshot fallback. | S3 behavior, production credential rotation, actual storage cost, the adopted continuous-retention policy or production resource isolation. |
| A replacement can recover the source data without inheriting the source Cloud authority. | The combined milestone and recovery-boundary receipts cover continuous and archive restore, older-key restore, fresh installation and machine authority, old-authority refusal and a fresh post-replacement snapshot. | Automatic promotion, a final-write handover, safe production activation or the future `external-vault-archive-v2` compatibility contract. |
| A gateway or cell can be replaced without changing customer-facing names. | The remote and cell-movement receipts cover stable routes and certificate fingerprints, cancellation before cutover, old-route removal, replay and neighbour isolation. | A provider-native cell, an availability-zone design, a production recovery-time objective or a faster WireGuard rekey strategy. |

The repository keeps two additional deployment rehearsals outside that five-step
milestone:

- The [local deployment](local-deployment.md) packages the API, workers, PostgreSQL,
  Mailpit, TLS object storage and an empty-route gateway in a loopback-only Compose
  stack. Its receipt covers install, restart, same-schema upgrade and complete cleanup.
- The [database recovery drill](database-recovery.md) uses restricted migration,
  runtime and replication roles. It covers a physical standby, exact operation replay,
  worker-claim recovery and tenant isolation.

A separate [AWS storage rehearsal](aws-storage-rehearsal.md) on 14 October 2026 uses
a real Stockholm sandbox, ordinary assumed-role sessions and synthetic data. It
proves S3 conditional writes, prefix isolation, session revocation/expiry, interrupted
multipart cleanup and local Waitron archive/Litestream restores. Its receipt records
the estimate and cleanup, including scheduled KMS deletion; account charges were not
read. It does not qualify Spain residency, the deployed credential adapter, the
guided recovery journey or production activation. The local milestone evidence in
the table above retains its original scope.

On the audit date, GitHub Actions run
[`36294635800`](https://github.com/waitron-io/waitron-cloud/actions/runs/36294635800)
completed successfully on the exact main SHA above. It ran the workspace typecheck,
the combined milestone receipt tests, the local-stack tests and the full PostgreSQL
suite. Fresh checks on the D30 branch passed:

```text
pnpm test:two-venue-milestone-receipt  # 80 passed
pnpm test:remote-reconciler-receipt    # 1 passed
pnpm test:cell-movement-receipt        # 1 passed
pnpm test:database-recovery-receipt    # 19 passed
pnpm test:local-stack                  # 38 passed
```

These commands test the receipt contracts and their rejection cases. The linked local
guides identify the commands that create fresh integration receipts. Run those proofs
again on the final deployment candidate. Do not turn the recorded laptop timings into
service objectives.

## Start with AWS Europe (Spain)

The intended initial provider is AWS. [AWS identifies Europe (Spain)](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html)
as `eu-south-2`
and publishes three stable Availability Zone IDs: `eus2-az1`, `eus2-az2` and
`eus2-az3`. Account-facing zone letters can map differently, so read the actual account
before assigning resources.

Official AWS documentation currently supports these candidates:

| Need | Candidate evidence | Remaining check |
| --- | --- | --- |
| Management PostgreSQL | [RDS lists Europe (Spain)](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RegionsAndAvailabilityZones.html). | Select and test the engine version, class, Multi-AZ layout, backups, encryption, quotas and restricted roles in the real account. |
| Backup object storage | [S3 lists a Spain endpoint](https://docs.aws.amazon.com/general/latest/gr/s3.html). | Repeat the conditional-write, credential, retention, interruption and restore proof against the selected bucket configuration. |
| Container or virtual-machine compute | [ECS on Fargate supports `eu-south-2`](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate-Regions.html), and [EC2 publishes regional instance availability](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html). | Choose the workload packaging, sizes, zone layout, quotas, capacity and recovery path. |
| Public certificates | [Certificate Manager lists `eu-south-2`](https://docs.aws.amazon.com/general/latest/gr/acm.html). | Prove that the selected ingress and renewal design preserves the separate staff TLS contract. |
| Public DNS | [Route 53 is a global service](https://docs.aws.amazon.com/general/latest/gr/r53.html). | Map the DNS data and control path separately. Do not describe it as Spain-regional merely because the workload is in Spain. |
| Menu translation | OpenAI is the actual adapter; Anthropic and Google remain candidates. At Cloud `60c0fbf`, [openai-client.ts:63](https://github.com/waitron-io/waitron-cloud/blob/60c0fbf25618a30977657fe74cce90fc5dbb915b/packages/translation/src/openai-client.ts#L63) sets `store: false`. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) describe default abuse-monitoring retention up to 30 days with exceptions. | Qualify exact project/model/endpoint, EU processing/retention approval and legal/access evidence. Build D101's [proposed outbound boundary](superpowers/specs/2026-10-22-cloud-data-protection-design.md#4-enforce-a-country-policy-and-qualify-every-outbound-flow): arbitrary menu text can contain personal data, so AI stays disabled pending a separately accepted input-eligibility rule. `store: false` does not prove EU processing or zero retention; no candidate fallback is approved. |
| Administrative email | The owner selected Amazon SES in an EU region on 2026-10-21. The [feedback proposal](superpowers/specs/2026-11-01-ses-feedback-design.md) recommends Paris and private queue intake; it remains unapproved and unbuilt. The [SES endpoint table](https://docs.aws.amazon.com/general/latest/gr/ses.html) lists Paris/Frankfurt, with no Spain endpoint. | D102 qualifies region/account, entities, locations, retention, tracking off, sender-domain authentication, bounce/complaint intake, suppression, alerts and live delivery. Full-design approval and build-plan authority remain open. This email exception does not relocate venue data/logs/keys or prove deployment. |

Service availability is not deployment evidence. Before provisioning, inspect region
enablement, account-specific zones, product versions, quotas and capacity. After
provisioning, record the exact service, region, replication, logging, backup, key and
support settings used by each data flow.

## Keep Google Cloud as a future target

Google documents Madrid as `europe-southwest1`, with zones
`europe-southwest1-a`, `europe-southwest1-b` and `europe-southwest1-c`. Its location
pages list Madrid options for [Cloud SQL for PostgreSQL](https://docs.cloud.google.com/sql/docs/postgres/region-availability-overview),
[Cloud Storage](https://docs.cloud.google.com/storage/docs/locations),
[Cloud Run](https://docs.cloud.google.com/run/docs/locations) and
[Compute Engine](https://docs.cloud.google.com/compute/docs/regions-zones).

This makes Madrid a candidate, not a supported Waitron deployment.
[Cloud DNS is global](https://docs.cloud.google.com/dns/docs/overview).
[Certificate Manager](https://docs.cloud.google.com/certificate-manager/docs/certificates)
is tied to Google load-balancer designs. Google's
[email guidance](https://docs.cloud.google.com/compute/docs/tutorials/sending-mail)
points to a third-party provider or Workspace relay rather than a Madrid transactional
mail service. Each of those paths needs the same data-flow, contract and live-proof
review as the AWS launch.

Google's [data-residency terms](https://cloud.google.com/terms/data-residency) and
[service-specific terms](https://cloud.google.com/terms/service-terms) apply to named,
configured services and distinguish stored customer data from access, movement and
some metadata. A [resource-location policy](https://docs.cloud.google.com/organization-policy/restrict-locations)
controls supported resource creation; it is not a universal storage commitment.
Do not claim Google support until a separate deployment passes the full launch gate.

## Decide the customer promise before provisioning

A region is one input to a residency policy. It is not the policy. Map every initial
data flow by purpose, including account records, venue data, continuous backups,
retained snapshots, logs, keys, usage records, DNS, certificates, email and support
access. Name the controller or processor role, storage and processing locations,
permitted access, provider and subprocessors, transfer mechanism where needed,
retention and deletion authority for each flow.

The GDPR requires purpose limitation, storage limitation, appropriate security and
accountability. Processor contracts and international transfers have separate
requirements. The primary references are [Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng),
the European Commission's [processor guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en),
its [international-transfer guidance](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en),
the EDPB's [transfer guidelines](https://www.edpb.europa.eu/documents/guideline/guidelines-052021-on-the-interplay-between-the-application-of-article-3-and-the_en)
and the AEPD's [breach-notification guidance](https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/brechas-de-datos-personales-notificacion).
This repository records engineering evidence, not a legal assessment.

These decisions and qualifications remain necessary before making a customer promise.
D101 records the owner choices already answered; those choices still need enforcement
and legal/provider evidence:

| Area | Known choices and remaining work | What it unlocks |
| --- | --- | --- |
| Data location and vendor chain | D101 country-pack policy, Spain home plus one extra EU backup, SES exception, roles by purpose, exact supplier/entities/access locations, contracts and transfer safeguards. These choices are not deployed proof. | Final AWS service selection, a deployable data-flow map, customer terms and truthful location wording. |
| Service reliability | Tolerated data loss, recovery time, availability, promotion authority and planned-handover rules for remote access and backups. | Availability-zone layout, backup/replication settings, monitoring thresholds and live acceptance tests. |
| Retention and exit | Continuous/snapshot detail and longer paid retention; implement the selected full exit download, 90-day read-only backups and purge, including earlier verified delete, all copies, keys and billing/legally approved exceptions in D101. | Production lifecycle jobs, restore inventory, cancellation flow and retention wording. |
| Packages and price | Whether remote access and backups are separate or bundled, trials, usage limits, tax/commercial assumptions and excess-use behavior. | Checkout, billing and customer price publication. It does not block a private deployment rehearsal. |
| Operational authority | Implement D101 per-session venue approval, expiry/revocation, every-action venue-visible audit, narrow emergency evidence/reporting and scoped machine KMS access; qualify roles and incident responsibilities. | Enabling support grants, staff operations, incident response and secret rotation. |

Do not infer a universal retention period, a Spain-only guarantee, GDPR compliance,
an uptime or recovery promise, or a price from the provider pages. Those claims need
the adopted policy, actual contracts, deployed configuration and measured evidence.

## Pass the production evidence gate

Before public exposure, complete one versioned launch record that names the deployed
commit and configuration. It must show:

1. The enabled AWS account, `eu-south-2` resources, account-specific zone mapping,
   quotas and exact service versions or tiers.
2. A data-flow inventory that matches the adopted residency, retention, vendor,
   subprocessor, access and transfer rules.
3. Production ingress, live DNS and certificate renewal, staff TLS passthrough, bot
   controls, route and session isolation, traffic limits and offline LAN behavior.
4. The selected object store passing the conditional-write, credential, rotation,
   interruption, deletion and recovery checks used by the local proof.
5. Production key custody and rotation for Cloud data, backups, email and installation
   authority without collapsing their separate trust boundaries.
6. Live sender-domain verification, accepted delivery, bounce and complaint handling,
   suppression reconciliation, monitoring and the approved email location policy.
7. Management-database backup, replication, promotion, routing and restore under the
   deployed credentials and representative data volume.
8. Continuous and snapshot recovery, final-write handover, old-server fencing,
   explicit activation and post-replacement capture against the selected provider.
9. External monitoring, incident handling, quiet periods, escalation, capacity and
   spend alerts, plus measured results against the adopted service objectives.
   D104's [incident runbook](incident-response.md) now records the sole-owner phone
   response and recommends Cloudflare Pages outside Waitron's AWS. Qualify the
   independent page read/update, phone delivery/failure/acknowledgment and owner
   coverage-gap drills there; no provider setup or production proof is complete.
10. Cancellation, expiry, export and deletion behavior against lawyer-reviewed terms
    and D101 acceptance cases: full portable download, fixed 90-day clock, earlier
    verified delete, resubscription races, all-region/all-copy purge and key dependencies.
    Reconcile protected snapshots, platform backups, billing exceptions and history
    cutoffs; report residual/uncertain deletion honestly, with no fiscal-row changes.

Hosted Waitron, automatic cloud failover, independent booking pages, invoice archives,
analytics, cross-provider operation, other countries, address lookup, the on-premises
email relay, mobile notifications and automated upgrades remain separate work. They do
not block an initial remote-access and backup launch unless the customer promise includes
them.
