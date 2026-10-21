# Estimate what serving a venue could cost

You need both a running platform and enough capacity for each venue. The
[offline calculator](cloud-cost-calculator.html) separates their priced subtotals
at zero, 1, 10, 100 and 1,000 venues. The full monthly bill remains unknown.
Each subtotal excludes named gaps, so you must not use it as a complete budget
or a customer subscription price.

Open the HTML file directly in your browser. It contains its data and calculation
code and works without a connection. Change region, orders, monthly archive
retention and owner sessions. Open **More assumptions** to enter capacity, disks,
keys and traffic choices. Empty inputs stay unknown. An explicit zero is different
from an empty field; zero sales still leaves startup and idle traffic.

## Rebuild and check the public files

From the repository, run:

```sh
node scripts/cloud-cost/cli.mjs build
node scripts/cloud-cost/cli.mjs verify
```

Both commands use only the public files in [cost-model/](cost-model/). They never
start a private replay or call a provider. Verification rebuilds the expected HTML,
this document and the trial assessment, then compares their complete contents.
It refuses changed, missing or stale artifacts. A successful check means the files
agree, while reporting that the cost estimate is incomplete.

## Read the measurements narrowly

The [joined evidence](cost-model/local-driver-evidence.json) preserves separate
experiments and their producing revisions. The [stream sample](cost-model/measurements.json)
replays all 207 selected sales into a fresh venue. Its copied source
database is 19,546,112 bytes; fresh-venue database
growth is 700,416 bytes. It records startup,
accelerated sales, 1200.008791962 seconds of idle observation, restore,
setup, observer and cleanup requests. Every one of its 342 physical requests stays
in the trial assessment, including 8 failed attempts. The calculator projects
startup, workload and idle separately; it does not add the experiment's setup or
cleanup to ordinary daily activity.

The [selected-sale archive](cost-model/archive-replay.json) contains
3,527,677 bytes and restores all selected sales.
The [one-sale storage sample](cost-model/archive-storage.json) separately counts
archive uploads, reads, listing, HEAD, an abandoned multipart part and cleanup.
It does not measure storage transfers for the selected-sale archive.
The [generated owner browser journey](cost-model/remote-owner-browser.json)
observes 2,836,968 encrypted response bytes,
including transport records. This does not establish public activity, monthly
owner frequency or provider-billed transfer. Service and API samples remain
available in the joined evidence; their absent monthly frequencies stay unknown.

These are measurements on this Mac. They establish neither typical venue state
nor AWS capacity. Raw sales, archive contents, credentials and private journals
are absent. For exact clocks and producer revisions, use the linked receipts.

## Separate assumptions from prices

Spain is the default modelling region; Stockholm is the comparison. The single-zone
example uses one control instance and one gateway per cell. The redundant example
uses two of each and the listed Multi-AZ database price, which already includes
its standby. These are illustrative configurations, not availability promises.
EC2 t3.small and RDS db.t4g.micro are priced candidates, not measured sizing advice.
Database deployment count and gateway cells change at the assumed venue capacity.
A gateway cell means one independently sized group of gateways. CPU, memory,
traffic and concurrency may impose a lower capacity than your assumed venue count.

Running resources use an assumed 730 hours/month. Request projections repeat the
sample for an assumed 31 days. Orders default to the reconciled 207,
not the earlier source-selection count of 203. Monthly owner sessions start empty.
Monthly archive retention starts at 12 months; the calculator supports 1–36 months.
All editable quantities are assumptions. The source files label measured inputs
with their units, scope, observation time and revision. A calculation carries
assumed status when it repeats or scales a measurement.

Low/base/high multiply future archive growth, sales-request cadence and owner-session
volume by 0.5/1/2, and divide assumed resource capacity by that factor. Startup and
idle remain separate. This range is illustrative, not a measured error bound.
Request quantities are aggregated across venues before tier pricing and rounding
up to a whole expected request. Failed-request billing and unknown request classes
remain gaps. The calculator does not claim an exact KMS request meter.

Archive simulation starts on 1 January 2027. It assumes a daily capture plus a
separate monthly capture on the first day, daily retention of 30 days and your
selected monthly retention. No production scheduler or shared-object selection is
inferred. Initial archive bytes default to the copied database size as an explicit
uncompressed-size assumption; they are not the measured small fresh-venue archive.
Future per-sale growth repeats the measured fresh-venue growth with your multiplier.
Each simulated capture verifies successfully. The pure retention model preserves
the last verified copy, but failure frequency, additional recovery references,
noncurrent versions, multipart lifetimes and continuous-stream storage remain gaps.
The later retention window begins one month beyond the selected retention horizon;
its database keeps growing. It is not a stationary storage total.

The displayed storage quantities are average retained bytes: byte-seconds divided
by the actual calendar-window seconds. Pricing divides byte-seconds by those
seconds and the S3 billing divisor of 1,073,741,824 bytes per billed GB. Decimal
GB is 1,000,000,000 bytes; GiB is 1,073,741,824 bytes. Other provider byte definitions
are not silently borrowed from S3. An assumed transfer-byte divisor is exposed
separately, and missing transfer minimum/rounding terms still prevent pricing.

## The synthetic AWS trial stopped before creation

The [trial assessment](cost-model/live-check.json) reports
**stopped-before-provision**. Object-size/lifetime distributions, schedules,
retry ceilings and operation-specific billing bounds are incomplete. The
illustrative high-cadence workload component alone projects
130,000 requests,
above the 10,000-request cap before cleanup. That multiplier is an assumption,
not a proved request ceiling. The base projection also cannot authorise a trial:
being under the cap for known components does not bound missing work.

No synthetic payloads or AWS resources were created for this trial, and no
Cost Explorer read is due for it. Live and billing execution are unavailable.
There is no measured provider bill or billing agreement. The earlier storage
rehearsal, its key-deletion follow-up and its billing budget stay separate.
Do not truncate measured operations or increase a cap to turn this stop into a pass.

## Keep unpriced costs visible

Every required capability below stays in the gap list until its quantities,
billing rules and scenario coverage are complete. A priced instance alone does
not cover its disks, CPU credits, backups or operating work. Alternative and
excluded rows remain visible so they cannot silently become zero-cost promises.
The current model reports 37 named capability or evidence gaps.

| Capability | Inclusion | Scope | Quantity driver | Open choice or limitation |
| --- | --- | --- | --- | --- |
| control-runtime | required | platform | API and worker replica-hours | Required by the initial remote-access/backup service; exact deployment selection remains open. |
| ec2-control | candidate | platform | assumed EC2 count and instance-hours | EC2 comparison; t3.small is a priced candidate, not a measured production size. |
| fargate-control | candidate | platform | requested vCPU/GB-hours and excess scratch | Fargate comparison for API/workers; ARM compatibility and scratch capacity are unvalidated. |
| runtime-disks | required | platform | allocated GB and excess IOPS/throughput | Required by the initial remote-access/backup service; exact deployment selection remains open. |
| runtime-images | required | platform | retained image GB and deployment pulls | Pull-path byte definition, scan choice and deployment frequency remain unknown. |
| provision-cleanup | required | platform | operation frequency and CPU time | Required by the initial remote-access/backup service; exact deployment selection remains open. |
| management-postgres | required | platform | instance count/class, disk, replica layout | Class, supported PostgreSQL version, capacity and upgrade steps are unknown. |
| rds-postgres | candidate | platform | selected deployment hours and allocated GB | Single/Multi-AZ comparison, not a deployment decision. Storage minimum and baseline performance need selected configuration evidence. |
| self-hosted-postgres | candidate | platform | primary/standby EC2, disk and operations | Backup, failover, transfer and labour are not priced by the EC2 instance alone. |
| database-backup | required | platform | retained physical backups/WAL/snapshots | Required by the initial remote-access/backup service; exact deployment selection remains open. |
| public-ingress | required | platform | HTTPS connection/rule/byte load | ALB optional; existing gateway can terminate public HTTPS. Capacity-unit dimensions are unmeasured. |
| cell-gateway | required | cell | cells, gateways per cell, traffic and concurrency | Venues per gateway/cell and concurrency are unmeasured. |
| network-ingress | candidate | cell | optional compatible TCP/UDP balancing | Listener combinations, zones and load units need a deployment choice. |
| certificates | required | venue | certificate count/renewal jobs and validation DNS | Provider/ACME packaging undecided. No priced-zero assumption for exportable ACM. |
| bot-abuse | candidate | usage | public/blocked/probe request frequency | Gateway controls exist locally; selected paid WAF/managed-rule fees remain unknown. |
| nat | candidate | platform | private egress gateways per zone and processed GB | NAT is a topology option; each zone, hour and routed byte needs explicit inclusion. |
| public-ipv4 | required | usage | active/idle public addresses across compute/LB/NAT | Count every selected resource address; IPv6 availability is not assumed. |
| vpc-endpoints | candidate | platform | interface endpoints per zone and routed GB | S3 gateway endpoints have documented no hourly/data fee; interface endpoints have separate charges. |
| internet-paths | required | usage | bytes in/out for tunnel, portal, uploads/restores | Measure directional bytes and map service/account aggregate tier allocation; no public-traffic default of zero. |
| regional-paths | required | usage | directional cross-zone/VPC/provider traffic | Path mapping and regional/zone charge selection remain unknown. Never count the same direction twice. |
| internet-gateway | required | platform | chosen routed public topology | Documented no-charge resource term must be sourced separately from charged transfer. |
| dns | required | platform | hosted zones, records and query classes | Required by the initial remote-access/backup service; exact deployment selection remains open. |
| domain | required | platform | registered domains and renewal years | TLD and registrar not selected; existing ownership does not establish renewal cost. |
| iam-sts | required | usage | credentials/session rotation | IAM service has documented no additional charge; credential-delivery runtime remains charged. |
| venue-key | required | venue | active per-venue key/versions and mapped requests | Do not count a KMS request per SSE-C stream upload; archive SSE-KMS/bucket-key mappings differ. |
| platform-secrets | required | platform | master/email/application keys, versions, secrets/API calls | Secrets Manager versus Parameter Store and key count are assumptions; Parameter Store rate unknown. |
| retained-keys | required | venue | keys required by protected/recoverable copies | Cannot retire key dependencies before all retained backups release them. |
| continuous-stream | required | venue | measured stream, snapshot, compaction and idle events | No stream traffic or schedule is measured yet; hourly/30d is a proposal, local probe config is 24h/168h. |
| retained-archives | required | venue | daily/30d and monthly/12mo dated object events | Archive sizes/growth unmeasured; monthly selection and protected-copy events must be modelled. |
| versions-multipart | required | venue | every current/noncurrent/marker/unfinished-part lifetime | Unbounded noncurrent retention has no finite steady-storage estimate. |
| storage-alternatives | candidate | venue | selected class and object minimums | Deep Archive and retrieval/transition complete rates remain unknown. |
| verification | required | usage | captures, duration, concurrency, RAM/scratch | Container resources/time are local controls, not AWS capacity evidence. |
| venue-restore | required | usage | restore frequency, bytes, CPU and activation flow | Restore frequency and reserve/on-demand execution choices remain assumptions. |
| logs | required | usage | ingestion, retention, scans and cardinality | Production retention/volume and GB conversion evidence remain open. |
| metrics-alerts | required | platform | series count, alarm count, external check frequency | Local collector holds no history and cannot alert on its own disappearance. |
| audit | required | usage | privileged records and provider event volume | Audit retention and selected CloudTrail configuration are owner choices. |
| spend-controls | required | platform | budget/report/API frequency | Cost Explorer API list term is known; monthly calls and optional budget actions/reports are not selected. |
| mail | required | external | messages, attachments, retries and provider tier | Spain mail provider not selected; no live mail authorised. |
| ses-candidate | candidate | usage | Stockholm SES recipients/attachments | Attachments/extras unknown; not an adopted relay. |
| ci | required | external | rounded job minutes, cache/artifact storage | Standard Linux minute price is separate from AWS; included account allowance and monthly quantity unknown. |
| fiscal-api | required | usage | measured registry calls/retries | Measure registry usage without altering fiscal allocation. No external fee established. |
| kubernetes | candidate | platform | cluster count, support mode, nodes | Extended support, Auto Mode, node/volume/LB topology remain unknown. |
| paid-support | candidate | platform | selected provider support plan | Unknown tier and rate. |
| hosted-waitron | excluded | venue | dedicated venue CPU/RAM/storage | No usage or price selected for this candidate. |
| cloud-failover | excluded | venue | reserve/on-demand activation capacity | No usage or price selected for this candidate. |
| bookings-public-copies | excluded | venue | public request/storage volume | No usage or price selected for this candidate. |
| fiscal-archive | excluded | venue | invoice storage/retention/downloads | No usage or price selected for this candidate. |
| analytics-search | excluded | venue | cluster/query/index storage | No usage or price selected for this candidate. |
| multi-venue-groups | excluded | venue | configuration fan-out and reporting | No usage or price selected for this candidate. |
| address-lookup | excluded | venue | lookup/provider API allowance | No usage or price selected for this candidate. |
| mobile-notifications | excluded | venue | push/SMS channel and count | No usage or price selected for this candidate. |
| managed-devices | excluded | venue | enrolment/control-plane volume | No usage or price selected for this candidate. |
| automatic-upgrades | excluded | venue | rollout bytes/jobs and fallback | No usage or price selected for this candidate. |
| email-relay | excluded | venue | admission/delivery and abuse bounds | No usage or price selected for this candidate. |
| translation | excluded | usage | translation worker, source text and images, model input and output tokens | Translation workload and provider rates are outside this scenario. |

Gross AWS subtotals apply no free allowance, discount, credit or tax. Allowances
may be shared across an account and cannot be applied once per venue. Customer
credits are not a reduction in the service's underlying list cost. Tax, exchange
rates and external mail/fiscal API prices remain unknown. GitHub's standard-runner
CI is free for this public repository under the owner's current operating decision;
paid/private/special runner use is a separate quantity and is not included here.
The historical paid-minute snapshot in prices.json is not a monthly CI charge.

## Price snapshot and exact regional terms

These are stored list-price receipts read on 14 October 2026, not a fresh provider
quote. The [full price file](cost-model/prices.json) carries service attributes,
units, tiers, minimums, rounding, source quotes, applicability and exclusions.
An unavailable regional price remains unknown. The calculator does not substitute
a Stockholm price for Spain. The source date links below open the exact offer file.

| Price | Region | USD/unit | Unit | Tier | SKU / rate code | Read date and source | Effective at |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| ec2-t3-small | eu-south-2 | 0.0228 | Hrs | 0–unbounded | UMDZEJ7KAZPTX53X / UMDZEJ7KAZPTX53X.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| ebs-gp3-storage | eu-south-2 | 0.088 | GB-Mo | 0–unbounded | 4STH5FTTSDG422F5 / 4STH5FTTSDG422F5.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| ebs-gp3-iops | eu-south-2 | 0.0055 | IOPS-Mo | 0–unbounded | BTGDVC8Y22Q99H89 / BTGDVC8Y22Q99H89.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| ebs-gp3-throughput | eu-south-2 | 45.056 | GiBps-mo | 0–unbounded | 8PJX6TYWPQTW3NG8 / 8PJX6TYWPQTW3NG8.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| ebs-snapshot | eu-south-2 | 0.05 | GB-Mo | 0–unbounded | 66XEWM6NE3U5MQ25 / 66XEWM6NE3U5MQ25.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| nat-hours | eu-south-2 | 0.048 | Hrs | 0–unbounded | J68CACDFX6JYYNVN / J68CACDFX6JYYNVN.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| nat-data | eu-south-2 | 0.048 | GB | 0–unbounded | 5MACN4CM6WEUTZU5 / 5MACN4CM6WEUTZU5.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| ec2-t3-cpu-credits | eu-south-2 | 0.05 | vCPU-Hours | 0–unbounded | X22DTJ2VSGX3A3PY / X22DTJ2VSGX3A3PY.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-t4g-micro-single | eu-south-2 | 0.018 | Hrs | 0–unbounded | Q5AKGC7KNZTEFQZG / Q5AKGC7KNZTEFQZG.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-t4g-micro-multi | eu-south-2 | 0.035 | Hrs | 0–unbounded | BV996TF7FBPHH7EC / BV996TF7FBPHH7EC.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-gp3-single | eu-south-2 | 0.127 | GB-Mo | 0–unbounded | N5JQVEUQRQ7NCE9Q / N5JQVEUQRQ7NCE9Q.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-gp3-multi | eu-south-2 | 0.254 | GB-Mo | 0–unbounded | EKKGGFVXA5SF5GYF / EKKGGFVXA5SF5GYF.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-backup | eu-south-2 | 0.095 | GB-Mo | 0–unbounded | CQFS9DFZEQ8E22R6 / CQFS9DFZEQ8E22R6.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-gp3-iops | eu-south-2 | 0.022 | IOPS-Mo | 0–unbounded | G2TWGBGWE9VNX8YY / G2TWGBGWE9VNX8YY.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-gp3-throughput | eu-south-2 | 0.088 | MBPS-Mo | 0–unbounded | E7B6C5JSBV8QWZGR / E7B6C5JSBV8QWZGR.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-standard-storage | eu-south-2 | 0.023 | GB-Mo | 0–51200 | J4G6TDWKTHGQ4EUR / J4G6TDWKTHGQ4EUR.JRTCKXETXF.PGHJ3S3EYE | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-standard-storage | eu-south-2 | 0.022 | GB-Mo | 51200–512000 | J4G6TDWKTHGQ4EUR / J4G6TDWKTHGQ4EUR.JRTCKXETXF.D42MF2PVJS | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-standard-storage | eu-south-2 | 0.021 | GB-Mo | 512000–unbounded | J4G6TDWKTHGQ4EUR / J4G6TDWKTHGQ4EUR.JRTCKXETXF.PXJDJ3YRG3 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-write | eu-south-2 | 0.0000053 | Requests | 0–unbounded | MJ7ZMNPX5NN9Q6PV / MJ7ZMNPX5NN9Q6PV.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-read | eu-south-2 | 4e-7 | Requests | 0–unbounded | WZ38K7WCHNBSJUXZ / WZ38K7WCHNBSJUXZ.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-ia-storage | eu-south-2 | 0.0125 | GB-Mo | 0–unbounded | 2NYZ5553SJU7CCG3 / 2NYZ5553SJU7CCG3.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-glacier-instant-storage | eu-south-2 | 0.005 | GB-Mo | 0–unbounded | CDPNM5D99KCX836C / CDPNM5D99KCX836C.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-glacier-flexible-storage | eu-south-2 | 0.00405 | GB-Mo | 0–unbounded | HM4XX7A5FTEARYMU / HM4XX7A5FTEARYMU.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| alb-hours | eu-south-2 | 0.0252 | Hrs | 0–unbounded | X8MXE2X46RMCT7M6 / X8MXE2X46RMCT7M6.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260911124544/eu-south-2/index.csv) | 2026-07-31T22:00:00.000Z |
| alb-capacity | eu-south-2 | 0.008 | LCU-Hrs | 0–unbounded | WGNWCMFBZX9VQX86 / WGNWCMFBZX9VQX86.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260911124544/eu-south-2/index.csv) | 2026-07-31T22:00:00.000Z |
| nlb-hours | eu-south-2 | 0.0252 | Hrs | 0–unbounded | 64S93CCDM5UJG6RT / 64S93CCDM5UJG6RT.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260911124544/eu-south-2/index.csv) | 2026-07-31T22:00:00.000Z |
| nlb-capacity | eu-south-2 | 0.006 | LCU-Hrs | 0–unbounded | D3E9NSDX9XFEU5VX / D3E9NSDX9XFEU5VX.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260911124544/eu-south-2/index.csv) | 2026-07-31T22:00:00.000Z |
| ipv4-active | eu-south-2 | 0.005 | Hrs | 0–unbounded | VJK6DQ2VJH2J2884 / VJK6DQ2VJH2J2884.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-south-2/index.csv) | 2026-08-31T22:00:00.000Z |
| ipv4-idle | eu-south-2 | 0.005 | Hrs | 0–unbounded | 7ZHXXZ83FMPFSPWD / 7ZHXXZ83FMPFSPWD.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-south-2/index.csv) | 2026-08-31T22:00:00.000Z |
| endpoint-hours | eu-south-2 | 0.011 | Hrs | 0–unbounded | 3NMF7YF6PPAG9EMU / 3NMF7YF6PPAG9EMU.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-south-2/index.csv) | 2026-08-31T22:00:00.000Z |
| endpoint-data | eu-south-2 | 0.01 | GB | 0–1048576 | J6PCHJC7DUCC5Z4S / J6PCHJC7DUCC5Z4S.JRTCKXETXF.D7RZ6WCPVW | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-south-2/index.csv) | 2026-08-31T22:00:00.000Z |
| endpoint-data | eu-south-2 | 0.006 | GB | 1048576–5242880 | J6PCHJC7DUCC5Z4S / J6PCHJC7DUCC5Z4S.JRTCKXETXF.RBMR72YW69 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-south-2/index.csv) | 2026-08-31T22:00:00.000Z |
| endpoint-data | eu-south-2 | 0.004 | GB | 5242880–unbounded | J6PCHJC7DUCC5Z4S / J6PCHJC7DUCC5Z4S.JRTCKXETXF.SW9U2ZKBYX | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-south-2/index.csv) | 2026-08-31T22:00:00.000Z |
| kms-key | eu-south-2 | 1 | Keys | 0–unbounded | ZPG7NY487K7SFHVY / ZPG7NY487K7SFHVY.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/20260911124601/eu-south-2/index.csv) | 2025-06-30T22:00:00.000Z |
| kms-symmetric | eu-south-2 | 0.000003 | Requests | 0–unbounded | MG69RRR3V9FG2YMF / MG69RRR3V9FG2YMF.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/20260911124601/eu-south-2/index.csv) | 2025-06-30T22:00:00.000Z |
| logs-ingest | eu-south-2 | 0.57 | GB | 0–unbounded | RB6JKDQ5NE5HFZP4 / RB6JKDQ5NE5HFZP4.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| logs-storage | eu-south-2 | 0.03 | GB-Mo | 0–unbounded | HQTF3SN9EXAENXWB / HQTF3SN9EXAENXWB.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| logs-query | eu-south-2 | 0.0057 | GB | 0–unbounded | 6DPF896JB9M4KA6Q / 6DPF896JB9M4KA6Q.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| metrics | eu-south-2 | 0.3 | Metrics | 0–10000 | 7EGPKS3JK9S6Q5CN / 7EGPKS3JK9S6Q5CN.JRTCKXETXF.A6VD9GXV7W | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| metrics | eu-south-2 | 0.1 | Metrics | 10000–250000 | 7EGPKS3JK9S6Q5CN / 7EGPKS3JK9S6Q5CN.JRTCKXETXF.FG3KHZ79QN | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| metrics | eu-south-2 | 0.05 | Metrics | 250000–1000000 | 7EGPKS3JK9S6Q5CN / 7EGPKS3JK9S6Q5CN.JRTCKXETXF.95SDKRWVHH | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| metrics | eu-south-2 | 0.02 | Metrics | 1000000–unbounded | 7EGPKS3JK9S6Q5CN / 7EGPKS3JK9S6Q5CN.JRTCKXETXF.VNJQCFJPS4 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| alarms | eu-south-2 | 0.1 | Alarms | 0–unbounded | Y6CMMZRHD9WZV9UY / Y6CMMZRHD9WZV9UY.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| synthetic-checks | eu-south-2 | 0.0014 | Runs | 0–unbounded | BJUNX52MT82XF932 / BJUNX52MT82XF932.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-south-2/index.csv) | 2026-09-30T22:00:00.000Z |
| eks-standard | eu-south-2 | 0.1 | Hours | 0–unbounded | C9KXANWPZBNBYGUT / C9KXANWPZBNBYGUT.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEKS/20260928194255/eu-south-2/index.csv) | 2026-08-31T22:00:00.000Z |
| fargate-x86-cpu | eu-south-2 | 0.046552 | hours | 0–unbounded | UMRZEYF8C2H5Z9XQ / UMRZEYF8C2H5Z9XQ.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-south-2/index.csv) | 2026-06-30T22:00:00.000Z |
| fargate-x86-memory | eu-south-2 | 0.005112 | hours | 0–unbounded | 369RDUVMT5DP6PJT / 369RDUVMT5DP6PJT.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-south-2/index.csv) | 2026-06-30T22:00:00.000Z |
| fargate-arm-cpu | eu-south-2 | 0.037242 | hours | 0–unbounded | FEY9TDTGY5GY6UXA / FEY9TDTGY5GY6UXA.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-south-2/index.csv) | 2026-06-30T22:00:00.000Z |
| fargate-arm-memory | eu-south-2 | 0.004089 | hours | 0–unbounded | MHVYR45QP7ZT4CTP / MHVYR45QP7ZT4CTP.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-south-2/index.csv) | 2026-06-30T22:00:00.000Z |
| fargate-scratch | eu-south-2 | 0.000122 | GB-Hours | 0–unbounded | GF9TTN92WMCW78ZE / GF9TTN92WMCW78ZE.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-south-2/index.csv) | 2026-06-30T22:00:00.000Z |
| secrets-storage | eu-south-2 | 0.4 | Secrets | 0–unbounded | XUMB6X2XZZXRSFJS / XUMB6X2XZZXRSFJS.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/20260911124610/eu-south-2/index.csv) | 2025-06-30T22:00:00.000Z |
| secrets-api | eu-south-2 | 0.000005 | API Requests | 0–unbounded | MKT75EMY2CHH4ZDK / MKT75EMY2CHH4ZDK.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/20260911124610/eu-south-2/index.csv) | 2025-06-30T22:00:00.000Z |
| ecr-storage | eu-south-2 | 0.1 | GB-Mo | 0–unbounded | 29AGJ4R54J9EFSMR / 29AGJ4R54J9EFSMR.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECR/20260911124425/eu-south-2/index.csv) | 2025-10-31T23:00:00.000Z |
| ec2-t3-small | eu-north-1 | 0.0216 | Hrs | 0–unbounded | RZ2CPJT3JCVWXCQM / RZ2CPJT3JCVWXCQM.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| ebs-gp3-storage | eu-north-1 | 0.0836 | GB-Mo | 0–unbounded | H33YTQG3Y9XKNSF3 / H33YTQG3Y9XKNSF3.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| ebs-gp3-iops | eu-north-1 | 0.0052 | IOPS-Mo | 0–unbounded | XS8EGK3XM47WU7KN / XS8EGK3XM47WU7KN.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| ebs-gp3-throughput | eu-north-1 | 42.8032 | GiBps-mo | 0–unbounded | 5S36SXRUX9DP4FTA / 5S36SXRUX9DP4FTA.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| ebs-snapshot | eu-north-1 | 0.0475 | GB-Mo | 0–unbounded | JAFNEA2DZUKPNWGT / JAFNEA2DZUKPNWGT.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| nat-hours | eu-north-1 | 0.046 | Hrs | 0–unbounded | BYQ4CZQVRHZ225T7 / BYQ4CZQVRHZ225T7.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| nat-data | eu-north-1 | 0.046 | GB | 0–unbounded | GRRDFYMQ5CUU37H4 / GRRDFYMQ5CUU37H4.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| ec2-t3-cpu-credits | eu-north-1 | 0.05 | vCPU-Hours | 0–unbounded | 5C2EHUGDY6WHFMRW / 5C2EHUGDY6WHFMRW.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20261012193925/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-t4g-micro-single | eu-north-1 | 0.016 | Hrs | 0–unbounded | BE43FJYR9D2ZCPA8 / BE43FJYR9D2ZCPA8.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-t4g-micro-multi | eu-north-1 | 0.033 | Hrs | 0–unbounded | GM6MNBDSKYVDDB94 / GM6MNBDSKYVDDB94.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-gp3-single | eu-north-1 | 0.12 | GB-Mo | 0–unbounded | 5KMSGBD4HCJXHFZ8 / 5KMSGBD4HCJXHFZ8.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-gp3-multi | eu-north-1 | 0.24 | GB-Mo | 0–unbounded | V6JTQP9RGZ27Q6GG / V6JTQP9RGZ27Q6GG.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-backup | eu-north-1 | 0.09 | GB-Mo | 0–unbounded | H3CVP78CY7HBN3X2 / H3CVP78CY7HBN3X2.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-gp3-iops | eu-north-1 | 0.021 | IOPS-Mo | 0–unbounded | 8YPXENVHTM2TE3JP / 8YPXENVHTM2TE3JP.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| rds-gp3-throughput | eu-north-1 | 0.083 | MBPS-Mo | 0–unbounded | Y7FUAR8HM6JAEBBC / Y7FUAR8HM6JAEBBC.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261006224050/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-standard-storage | eu-north-1 | 0.023 | GB-Mo | 0–51200 | W3FCBWN4J47P9GU4 / W3FCBWN4J47P9GU4.JRTCKXETXF.PGHJ3S3EYE | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-standard-storage | eu-north-1 | 0.022 | GB-Mo | 51200–512000 | W3FCBWN4J47P9GU4 / W3FCBWN4J47P9GU4.JRTCKXETXF.D42MF2PVJS | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-standard-storage | eu-north-1 | 0.021 | GB-Mo | 512000–unbounded | W3FCBWN4J47P9GU4 / W3FCBWN4J47P9GU4.JRTCKXETXF.PXJDJ3YRG3 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-write | eu-north-1 | 0.000005 | Requests | 0–unbounded | GRMX7KKGXZWXWYA7 / GRMX7KKGXZWXWYA7.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-read | eu-north-1 | 4e-7 | Requests | 0–unbounded | 78XM3R8BT46YZKTU / 78XM3R8BT46YZKTU.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-ia-storage | eu-north-1 | 0.0125 | GB-Mo | 0–unbounded | EHYYY83E32UJWDAQ / EHYYY83E32UJWDAQ.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-glacier-instant-storage | eu-north-1 | 0.004 | GB-Mo | 0–unbounded | FWSQCG97MQQZCEHA / FWSQCG97MQQZCEHA.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| s3-glacier-flexible-storage | eu-north-1 | 0.0036 | GB-Mo | 0–unbounded | VKTE3TCC544QQDSG / VKTE3TCC544QQDSG.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/20261012231102/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| alb-hours | eu-north-1 | 0.02394 | Hrs | 0–unbounded | FY6N7P3VBQKBHGCC / FY6N7P3VBQKBHGCC.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260911124544/eu-north-1/index.csv) | 2026-07-31T22:00:00.000Z |
| alb-capacity | eu-north-1 | 0.0076 | LCU-Hrs | 0–unbounded | 3T8FA94JAYX6F8NU / 3T8FA94JAYX6F8NU.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260911124544/eu-north-1/index.csv) | 2026-07-31T22:00:00.000Z |
| nlb-hours | eu-north-1 | 0.02394 | Hrs | 0–unbounded | TRECDNRTVX6SSW4U / TRECDNRTVX6SSW4U.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260911124544/eu-north-1/index.csv) | 2026-07-31T22:00:00.000Z |
| nlb-capacity | eu-north-1 | 0.0057 | LCU-Hrs | 0–unbounded | 5PCGKRZDNVWXYNVZ / 5PCGKRZDNVWXYNVZ.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260911124544/eu-north-1/index.csv) | 2026-07-31T22:00:00.000Z |
| ipv4-active | eu-north-1 | 0.005 | Hrs | 0–unbounded | H24SU884XW7MB5WC / H24SU884XW7MB5WC.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-north-1/index.csv) | 2026-08-31T22:00:00.000Z |
| ipv4-idle | eu-north-1 | 0.005 | Hrs | 0–unbounded | 2M69N79CPJC2EXZ3 / 2M69N79CPJC2EXZ3.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-north-1/index.csv) | 2026-08-31T22:00:00.000Z |
| endpoint-hours | eu-north-1 | 0.0105 | Hrs | 0–unbounded | RQDW4F29PDT7RYTA / RQDW4F29PDT7RYTA.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-north-1/index.csv) | 2026-08-31T22:00:00.000Z |
| endpoint-data | eu-north-1 | 0.01 | GB | 0–1048576 | PUGDDHYKX88JEKYR / PUGDDHYKX88JEKYR.JRTCKXETXF.D7RZ6WCPVW | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-north-1/index.csv) | 2026-08-31T22:00:00.000Z |
| endpoint-data | eu-north-1 | 0.006 | GB | 1048576–5242880 | PUGDDHYKX88JEKYR / PUGDDHYKX88JEKYR.JRTCKXETXF.RBMR72YW69 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-north-1/index.csv) | 2026-08-31T22:00:00.000Z |
| endpoint-data | eu-north-1 | 0.004 | GB | 5242880–unbounded | PUGDDHYKX88JEKYR / PUGDDHYKX88JEKYR.JRTCKXETXF.SW9U2ZKBYX | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/eu-north-1/index.csv) | 2026-08-31T22:00:00.000Z |
| kms-key | eu-north-1 | 1 | Keys | 0–unbounded | FJZGZWXK3EGTGQXE / FJZGZWXK3EGTGQXE.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/20260911124601/eu-north-1/index.csv) | 2025-06-30T22:00:00.000Z |
| kms-symmetric | eu-north-1 | 0.000003 | Requests | 0–unbounded | 2S77H5MZU5BVWEXS / 2S77H5MZU5BVWEXS.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/20260911124601/eu-north-1/index.csv) | 2025-06-30T22:00:00.000Z |
| logs-ingest | eu-north-1 | 0.54 | GB | 0–unbounded | 2WXCZPMH3FF7XAAZ / 2WXCZPMH3FF7XAAZ.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| logs-storage | eu-north-1 | 0.028 | GB-Mo | 0–unbounded | FC3W9RUMP83VDX52 / FC3W9RUMP83VDX52.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| logs-query | eu-north-1 | 0.0054 | GB | 0–unbounded | FJF4YG442XPSUXQT / FJF4YG442XPSUXQT.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| metrics | eu-north-1 | 0.3 | Metrics | 0–10000 | D8QWPGZQF8DEFNQD / D8QWPGZQF8DEFNQD.JRTCKXETXF.A6VD9GXV7W | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| metrics | eu-north-1 | 0.1 | Metrics | 10000–250000 | D8QWPGZQF8DEFNQD / D8QWPGZQF8DEFNQD.JRTCKXETXF.FG3KHZ79QN | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| metrics | eu-north-1 | 0.05 | Metrics | 250000–1000000 | D8QWPGZQF8DEFNQD / D8QWPGZQF8DEFNQD.JRTCKXETXF.95SDKRWVHH | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| metrics | eu-north-1 | 0.02 | Metrics | 1000000–unbounded | D8QWPGZQF8DEFNQD / D8QWPGZQF8DEFNQD.JRTCKXETXF.VNJQCFJPS4 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| alarms | eu-north-1 | 0.1 | Alarms | 0–unbounded | XWA5C8TQDRYG6RN7 / XWA5C8TQDRYG6RN7.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| synthetic-checks | eu-north-1 | 0.0013 | Runs | 0–unbounded | GFBX78RFZ8TXPJ3N / GFBX78RFZ8TXPJ3N.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/20261007115540/eu-north-1/index.csv) | 2026-09-30T22:00:00.000Z |
| eks-standard | eu-north-1 | 0.1 | Hours | 0–unbounded | WQ9KHG4EAH8T7T5B / WQ9KHG4EAH8T7T5B.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEKS/20260928194255/eu-north-1/index.csv) | 2026-08-31T22:00:00.000Z |
| fargate-x86-cpu | eu-north-1 | 0.0445 | hours | 0–unbounded | WYRS7KX9WP3W2KQ5 / WYRS7KX9WP3W2KQ5.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-north-1/index.csv) | 2026-06-30T22:00:00.000Z |
| fargate-x86-memory | eu-north-1 | 0.0049 | hours | 0–unbounded | JG8R47GSTBBHHNX3 / JG8R47GSTBBHHNX3.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-north-1/index.csv) | 2026-06-30T22:00:00.000Z |
| fargate-arm-cpu | eu-north-1 | 0.0356 | hours | 0–unbounded | 4937C9K6EA45AVZV / 4937C9K6EA45AVZV.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-north-1/index.csv) | 2026-06-30T22:00:00.000Z |
| fargate-arm-memory | eu-north-1 | 0.00392 | hours | 0–unbounded | GAVHMPXDKCWCSGQC / GAVHMPXDKCWCSGQC.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-north-1/index.csv) | 2026-06-30T22:00:00.000Z |
| fargate-scratch | eu-north-1 | 0.000116 | GB-Hours | 0–unbounded | JYJXR3ZYFBC3VYF6 / JYJXR3ZYFBC3VYF6.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/eu-north-1/index.csv) | 2026-06-30T22:00:00.000Z |
| secrets-storage | eu-north-1 | 0.4 | Secrets | 0–unbounded | CMSG8A9ZU2DMCFPE / CMSG8A9ZU2DMCFPE.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/20260911124610/eu-north-1/index.csv) | 2025-06-30T22:00:00.000Z |
| secrets-api | eu-north-1 | 0.000005 | API Requests | 0–unbounded | 7VFSFM2SK8GV8DGV / 7VFSFM2SK8GV8DGV.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/20260911124610/eu-north-1/index.csv) | 2025-06-30T22:00:00.000Z |
| ecr-storage | eu-north-1 | 0.1 | GB-Mo | 0–unbounded | YZ2F5ZZ8QJ8MVBSF / YZ2F5ZZ8QJ8MVBSF.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECR/20260911124425/eu-north-1/index.csv) | 2025-10-31T23:00:00.000Z |
| dns-zone | global | 0.5 | HostedZone | 0–25 | KVPGEJE88UW8S779 / KVPGEJE88UW8S779.JRTCKXETXF.G2A93NZ7DT | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRoute53/20260911124504/index.csv) | 2026-07-31T22:00:00.000Z |
| dns-zone | global | 0.1 | HostedZone | 25–unbounded | KVPGEJE88UW8S779 / KVPGEJE88UW8S779.JRTCKXETXF.VYAP54KATQ | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRoute53/20260911124504/index.csv) | 2026-07-31T22:00:00.000Z |
| dns-query | global | 4e-7 | Queries | 0–1000000000 | JHRA6QBEDT9FZVT5 / JHRA6QBEDT9FZVT5.JRTCKXETXF.ZN357FEBCK | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRoute53/20260911124504/index.csv) | 2026-07-31T22:00:00.000Z |
| dns-query | global | 2e-7 | Queries | 1000000000–unbounded | JHRA6QBEDT9FZVT5 / JHRA6QBEDT9FZVT5.JRTCKXETXF.AGD8ADSNTG | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRoute53/20260911124504/index.csv) | 2026-07-31T22:00:00.000Z |
| dns-healthcheck-external | global | 0.75 | Mo | 0–unbounded | EYUFFNGJ6B6EEPX3 / EYUFFNGJ6B6EEPX3.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRoute53/20260911124504/index.csv) | 2026-07-31T22:00:00.000Z |
| internet-egress | eu-south-2 | 0.09 | GB | 0–10240 | ECTP3BJUBCHZH4H7 / ECTP3BJUBCHZH4H7.JRTCKXETXF.Q3Z75P77EN | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260916132208/index.csv) | 2026-05-31T22:00:00.000Z |
| internet-egress | eu-south-2 | 0.085 | GB | 10240–51200 | ECTP3BJUBCHZH4H7 / ECTP3BJUBCHZH4H7.JRTCKXETXF.VF6T3GAUKQ | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260916132208/index.csv) | 2026-05-31T22:00:00.000Z |
| internet-egress | eu-south-2 | 0.07 | GB | 51200–153600 | ECTP3BJUBCHZH4H7 / ECTP3BJUBCHZH4H7.JRTCKXETXF.N9EW5UVVPA | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260916132208/index.csv) | 2026-05-31T22:00:00.000Z |
| internet-egress | eu-south-2 | 0.05 | GB | 153600–unbounded | ECTP3BJUBCHZH4H7 / ECTP3BJUBCHZH4H7.JRTCKXETXF.GPHXDESFBB | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260916132208/index.csv) | 2026-05-31T22:00:00.000Z |
| internet-egress | eu-north-1 | 0.09 | GB | 0–10240 | DRTM7T5YA7E492Z3 / DRTM7T5YA7E492Z3.JRTCKXETXF.Q3Z75P77EN | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260916132208/index.csv) | 2026-05-31T22:00:00.000Z |
| internet-egress | eu-north-1 | 0.085 | GB | 10240–51200 | DRTM7T5YA7E492Z3 / DRTM7T5YA7E492Z3.JRTCKXETXF.VF6T3GAUKQ | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260916132208/index.csv) | 2026-05-31T22:00:00.000Z |
| internet-egress | eu-north-1 | 0.07 | GB | 51200–153600 | DRTM7T5YA7E492Z3 / DRTM7T5YA7E492Z3.JRTCKXETXF.N9EW5UVVPA | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260916132208/index.csv) | 2026-05-31T22:00:00.000Z |
| internet-egress | eu-north-1 | 0.05 | GB | 153600–unbounded | DRTM7T5YA7E492Z3 / DRTM7T5YA7E492Z3.JRTCKXETXF.GPHXDESFBB | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260916132208/index.csv) | 2026-05-31T22:00:00.000Z |
| audit-data-events | eu-south-2 | 0.000001 | Events | 0–unbounded | RRF5VWQUSVYYRK78 / RRF5VWQUSVYYRK78.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSCloudTrail/20260911124531/index.csv) | 2026-06-30T22:00:00.000Z |
| audit-data-events | eu-north-1 | 0.000001 | Events | 0–unbounded | DZJQD2RFD5B93PYJ / DZJQD2RFD5B93PYJ.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSCloudTrail/20260911124531/index.csv) | 2026-06-30T22:00:00.000Z |
| ses-messages | eu-north-1 | 0.0001 | Count | 0–unbounded | 455CU3DN9W2Z5R7U / 455CU3DN9W2Z5R7U.JRTCKXETXF.6YS6EN2CT7 | [2026-10-14](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSES/20260911124507/eu-north-1/index.csv) | 2026-06-30T22:00:00.000Z |

Before using a complete figure for a launch decision, establish each remaining
driver and billing path, validate provider capacity and costs, and review the
[launch evidence boundary](launch-evidence.md). An offline subtotal supplies no
deployment or recovery authority.
