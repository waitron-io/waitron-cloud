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
| Administrative email | The current [SES endpoint table](https://docs.aws.amazon.com/general/latest/gr/ses.html) does not list Spain. | Select a separate relay, then verify its processing locations, retention, tracking, subprocessors, bounce handling and live delivery. |

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

Only these owner decisions prevent the initial service from becoming a customer
promise:

| Decision | What you must decide | What it unlocks |
| --- | --- | --- |
| Data location and vendor chain | The scoped Spain-location promise, roles by purpose, permitted providers and subprocessors, access locations, contracts and transfer safeguards. | Final AWS service selection, a deployable data-flow map, customer terms and truthful location wording. |
| Service reliability | Tolerated data loss, recovery time, availability, promotion authority and planned-handover rules for remote access and backups. | Availability-zone layout, backup/replication settings, monitoring thresholds and live acceptance tests. |
| Retention and exit | Continuous-backup retention, snapshot timing, longer paid retention, cancellation, deletion, protected-copy behavior and audit/security-record cutoffs. | Production lifecycle jobs, restore inventory, cancellation flow and retention wording. |
| Packages and price | Whether remote access and backups are separate or bundled, trials, usage limits, tax/commercial assumptions and excess-use behavior. | Checkout, billing and customer price publication. It does not block a private deployment rehearsal. |
| Operational authority | Platform roles, support actions, customer approvers, emergency access, incident responsibilities and production key custody. | Enabling support grants, staff operations, incident response and secret rotation. |

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
10. Cancellation, expiry, export and deletion behavior against the adopted terms,
    including the protected last verified snapshot and every operational-history cutoff.

Hosted Waitron, automatic cloud failover, independent booking pages, invoice archives,
analytics, cross-provider operation, other countries, address lookup, the on-premises
email relay, mobile notifications and automated upgrades remain separate work. They do
not block an initial remote-access and backup launch unless the customer promise includes
them.
