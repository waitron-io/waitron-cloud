# Check AWS infrastructure locally

An infrastructure test can contact a provider even when you intended only to inspect a
plan. Cloud's first check refuses unsafe source files before an infrastructure command
can start. It parses HCL, OpenTofu's configuration language, inside a container with no
network connection and no host credentials or home-directory mount.

Prepare the tools once, then run the canary and source-policy checks:

```sh
node deploy/aws/check.mjs --prepare-tools
pnpm --dir deploy/aws install --ignore-workspace --frozen-lockfile
node deploy/aws/check.mjs --suite canary
node --test --test-concurrency=1 deploy/aws/*.test.mjs
```

Preparation downloads software from PyPI and the official OpenTofu and HashiCorp release
sites. The base image is fixed by its digest, an identifier for its exact contents.
The parser and both dependencies have fixed versions and verified download hashes.
OpenTofu 1.11.0 and AWS provider 6.42.0 use the archive checksums recorded in
`deploy/aws/tools-pins.json`. Preparation selects Linux ARM64 or AMD64 to match your
Docker engine and refuses other architectures. It submits only the six named software
build files to Docker, so ambient files cannot enter the build context.

On success, the command prints:

```text
Prepared software image waitron-cloud-aws-tools:1.11.0-aws6.42.0
```

The image contains an offline provider mirror, a local directory from which OpenTofu can
install the pinned provider without contacting a registry. Its configuration includes no
direct provider download method. Initializing from this mirror reports the provider as
unauthenticated: preparation checks the pinned archive checksum, but does not retrieve a
registry signature during initialization. Each root is a separate OpenTofu configuration
entry point. The account root's committed lockfile contains checksums for both
supported architectures. Add and qualify the same protection as you introduce each later
root. Test execution uses only the existing local image and refuses an implicit image
download.

OpenTofu and provider downloads require HTTPS and official distribution hosts, including redirects.
They ignore your proxy settings, check a three-minute deadline before each read, and
limit each network operation to 15 seconds. Archives are limited to 256 MiB; the selected
executable must be a single regular entry of at most 1 GiB. A checksum mismatch refuses
installation. Failed downloads remove their partial files, and preparation removes its
disposable build context after success or failure. The Docker build command has a
seven-minute limit. These limits bound software preparation; they do not set service
or infrastructure timeouts.

The source checker requires every test run, including a setup run, to say
`command = plan`. Every AWS provider and alias must select a mock, a substitute that
avoids provider requests. A test's explicit provider map can select another mocked
alias. Provisioners, external providers, real test-provider blocks, dynamic provider
bindings, alternate configuration formats, override files, variable files and symlinks
are refused. Comments, strings and heredocs are parsed as syntax, so a quoted example of
an apply command does not masquerade as an executable command.

Local modules must resolve to directories inside the inspected copy. Each child needs an
explicit provider map, including every alias it uses. The checker follows those maps
through nested modules to the test's mocks. Missing bindings, undeclared aliases and
module cycles are refused. A test run can select a different local module under the same
rules.

Only infrastructure source files enter a disposable copy. The checker excludes `.aws`, `.terraform`,
Git metadata and dependencies. The container sees that copy read-only, drops operating
system capabilities and has limited memory, CPU, process count and temporary storage.
After a timeout, cleanup checks the unique ownership label and removes only the recorded
container ID. A failed ownership check refuses cleanup and reports the problem.

The source-checking API also accepts `{ trackedOnly: true }` for your repository's
`deploy/aws` directory. This copies source files listed in Git's index, the list of
files staged for a commit, using their current working contents. Stage a new source
file before checking it; stage a deletion to remove it from the copy. Untracked and
ignored files cannot change the candidate. Conflicted files, unsupported indexed paths,
symlinks and files larger than 1 MiB are refused before a container starts. A staged
alternative input, such as a variable file, remains visible so the parser can refuse it.
The suite runner uses this boundary too. It inspects one source copy, then executes that
same copy using the exact local image identifier it checked. Later checkout edits cannot
change the files between inspection and execution. A staged provider lockfile is retained;
its provider source, version, constraints and checksum syntax must match the supported
AWS lockfile shape. Software preparation separately verifies the pinned archive bytes.

The canary checks a mocked Madrid region without declaring resources. A successful run
ends with `Success! 1 passed, 0 failed.` Each suite initializes with `-backend=false`
and `-input=false`, validates its configuration, then runs its named test file. Work happens
in a fresh temporary filesystem inside the container. OpenTofu receives a closed set of
environment settings, including the mirror configuration and empty AWS configuration and
credential paths, so ambient command flags cannot change initialization. A failed command
stops the suite. Each command has a 90-second deadline; each suite container has a
five-minute deadline and limits of 1 GiB memory, two CPUs, 128 processes and 512 MiB of
temporary storage. The source inspector has its separate smaller limits.

The runner also restricts each child to at most two CPU cores, because a CPU
quota alone leaves the host's larger core count visible to runtime worker pools.
Suites with more than six independent plan cases run in groups of at most six,
each in a fresh OpenTofu process. Expected-refusal plans can retain provider
processes until OpenTofu exits; grouping releases them within the existing
process and memory limits. Every group keeps the original shared mocks and
variables, must report every selected case passing, and stops the suite on a
failure or incomplete count. The runner restores the original temporary test
file and prints a clearly labelled aggregate only after all groups pass. Keep
cases independent; a reference to a run in a different group cannot carry state
between processes.

You can select only `canary`, `accounts`, `state`, `network`, `cell`, `database`, `storage`,
`custody`, `observability`, `ingress`, `dns` or `integration`. Each name selects fixed module
and root paths; the CLI accepts no custom command or directory. `--all` runs those suites
in order and refuses a missing test file. Build and qualify each remaining suite
before using `--all` as a check of the whole infrastructure layer.
It does not report the unfinished infrastructure as verified. Missing local tools produce
the `--prepare-tools` setup instruction without downloading anything.

The separate dependency install supplies Ajv, the JSON Schema validator used by the
contract tests. It leaves the application workspace dependencies unchanged. Its version
and dependency checksums are pinned in `deploy/aws/pnpm-lock.yaml`.

## Pass infrastructure references to the runtime

The runtime needs resource addresses and permission references without receiving passwords
or cluster credentials. The [infrastructure_v1 schema](../deploy/aws/contracts/infrastructure-v1.schema.json)
defines that handoff. Run `node --test deploy/aws/contracts.test.mjs` to validate independent
global and Spain fixtures and exercise refusals for unknown fields, missing references,
unknown roles and a running recovery region. These are contract checks, not resource outputs;
the resource modules and composed roots remain unfinished.

Every fixed object rejects extra fields. Reference maps accept named string references;
they reject embedded objects, such as a password object in a database secret reference.
A string alone cannot prove where a secret is held. Keep secret values outside the
handoff and supply only their references. The schema fixes the current region pairs to
Frankfurt/Ireland for global and Madrid/Paris for Spain. Global has no venue stream or
snapshot bucket. Recovery always has `runtime_enabled: false`; a valid handoff grants
no permission to activate a writer.

The [P1 role contract](../deploy/aws/contracts/p1-roles-v1.json) records the eight agreed
logical roles, matching service accounts, namespaces and ingress ports. P1 owns image
digests and runtime deployment; OpenTofu consumes no image reference. Its
[country-cell plan](superpowers/plans/2026-10-22-cloud-country-cell.md) maps migrations,
mail, usage, probes and operations to `registration-worker`, and manifest publication
to `remote-reconciler`. Translation stays disabled behind its separate production gate.
The global namespace is reserved until P3 supplies the global/country split. Agreement
on these names and ports does not qualify AWS permissions, ingress or secret delivery.

The remaining resource suites follow the
[implementation plan](superpowers/plans/2026-10-22-cloud-aws-layer.md).
Passing source-policy tests does not qualify AWS permissions, deployed infrastructure,
recovery or continuity. You still need separate approval before accessing AWS, creating
accounts or resources, spending money or applying infrastructure.

## Describe member accounts without replacing the Organization

Global and Spain need separate member accounts. You supply the existing Organization ID,
the parent organizational unit, and maps of existing references and proposed new members.
The account module describes only new member accounts; existing references stay outside
its creation loop. It declares no Organization or organization-wide policy resource.

Run the account checks locally:

```sh
node deploy/aws/check.mjs --suite accounts
node --test deploy/aws/accounts.test.mjs
```

All provider reads and proposed creations in this suite are mocked. The module checks
the supplied Organization against its provider's Organization, confirms existing members
belong to it, and refuses the management account, shared workload accounts, overlapping
existing/new scopes and names other than `global` or `es`. The administration root binds
the module only to `aws.organization`. Its protected `member_ids` output stays outside
the runtime handoff.

Contact addresses are sensitive inputs indexed by member name. Resource addresses come
from the separate, non-sensitive new-member map, so an email address never becomes a
resource address. Sensitivity hides values in normal output; future live state would
still need the separate protected state custody. Examples use synthetic account IDs and
contacts under `.invalid`; future real inputs stay outside Git.

Managed accounts explicitly prevent destruction and disable closing on deletion.
Removing an existing-member reference does not remove that account from AWS. Removing
or retiring an account from the Organization is destructive even if the account remains
open, and needs a separately authorized operation. These checks perform no import,
account creation, removal or retirement.

The account root installs from its committed lockfile on Linux ARM64 and AMD64 without
changing it. The checksums cover the mirror's executable packages, built from the
checksum-verified release archives. The archive checksums are retained too. Local
qualification runs initialization with the lockfile read-only, validation and all account
plans on both architectures; AMD64 runs under emulation. Removing either executable
checksum refuses installation on its matching architecture.

The standalone module tests generate disposable locks for the current architecture.
Their incomplete-lock warning does not apply to the account root. Run the root lock
regression check with:

```sh
node --test deploy/aws/locks.test.mjs
```

That check runs the real account suite and refuses a root initialization that changes
the committed lock. State custody, live permissions and parent-unit ownership remain
unqualified. An offline plan passing on both architectures does not prove live AWS access.


## Keep infrastructure state separate from workloads

Infrastructure state records resource ownership and can contain sensitive provider
attributes. Each of administration, global and Spain has its own versioned S3 bucket
and KMS encryption key. Organization administration stays in the existing administration
account. Global and Spain use their own member accounts and home regions.

Run the declarations through mocked plans and the lifecycle/backend checks:

```sh
node deploy/aws/check.mjs --suite state
node --test deploy/aws/state.test.mjs
```

The module takes a scope, home region, expected account, exact deployment-role references
indexed by root, and a separate recovery-role reference. It checks the mocked provider's
account and region. The root exposes only `custody = {bucket_name, kms_key_ref, region}`.
It creates no role or trust policy; you must supply and separately qualify those identities.
The root-role map keeps each deployment's state and lock permissions separate.

| Custody scope | Home region | Permitted roots |
| --- | --- | --- |
| `administration` | Frankfurt | `accounts`, `state` |
| `global` | Frankfurt | `global`, `state`, `delegation` |
| `es` | Madrid | `country`, `state`, `delegation` |

Each supplied root needs a distinct role in that scope's account. Its state key is
`<scope>/<root>/terraform.tfstate`; its lock adds `.tflock`. Deployment roles can read
and write their exact state and create or remove their exact lock. Explicit denials
cover sibling objects, wider listing, foreign principals and state deletion, including
historical versions. The recovery role can list and read retained versions; recovery
writes use the matching deployment role through a separately reviewed access procedure.
There is no expiry rule for state versions.

The bucket blocks public access and unencrypted transport. Writes must name the exact
KMS key. S3 Bucket Keys are disabled because key permissions use the individual object's
encryption context, the object address attached to a key operation. Deployment key use
is restricted to that root's state and lock through its home region's S3 service. KMS
rotation is enabled. Both bucket and key prevent destruction through OpenTofu, and the
bucket disables forced deletion. These are declared protections; AWS administrators
can change policies outside OpenTofu, and mocked plans do not prove live enforcement.

### Bootstrap and recovery need separate authorization

A backend cannot create the bucket that already needs to hold its state. This build
performs no bootstrap, migration, import or state upload. The state root has an empty
partial S3 backend; every local check initializes with `-backend=false` and uses only
mocked providers. Its committed provider lock follows the account root's two-platform
checksums.

After separate live authorization, use this sequence as an operator checklist:

1. Verify the account inventory, home regions, exact role identities and their trust
   policies. Qualify the recovery role's ability to administer the key and recover
   retained state without relying on the running workload or the state bucket itself.
2. Prepare a private external directory on encrypted storage for bootstrap state and
   its backups. Keep all state, plans, contacts and backend settings outside Git.
   Secure its recovery key and access procedure independently of the new KMS key.
3. Under the separately authorized bootstrap identity, create each scope's custody
   using protected local state. Review the plan for replacement or deletion before
   any operation. Retain the encrypted local copy until recovery is verified.
4. Prepare each root's external backend settings with its own bucket, region, exact
   key and KMS ARN, `encrypt = true`, `use_lockfile = true`, and an account allowlist.
   Select only the default workspace. Extra workspace paths are outside these grants.
   Use the [OpenTofu 1.11 S3 backend reference](https://opentofu.org/docs/v1.11/language/settings/backends/s3/)
   when qualifying that configuration. Credentials belong in the approved short-lived
   identity mechanism, never in backend files or command arguments.
5. Review and explicitly migrate the local state to that root's S3 key. Migration is
   an authorized operator operation, never an automatic upload during initialization.
   Verify version retention, exact-key encryption, concurrent lock refusal, lock release
   and recovery through the separately retained procedure before retiring local copies.

If custody already exists, review imports and state moves against the existing resource
IDs and addresses. Confirm there is exactly one authoritative state before moving it.
Never replace a bucket or key to make the plan fit, never upload an arbitrary local
state automatically, and never remove a lock without proving its writer stopped.
Keep historical KMS keys available while any retained state depends on them.

The offline checks do not qualify role assumption, bucket-policy enforcement, backend
migration, lock contention or recovery. Those remain named prerequisites for a later,
separately authorized live rehearsal.

## Keep each zone's outgoing path independent

A single outgoing gateway would couple otherwise separate availability zones, AWS's
independent data-centre boundaries. The network module gives each of three zones its
own NAT gateway, which lets private machines make outgoing internet connections,
and its own public IP and private route table. Each cell's subnet uses the NAT in its
own zone. Database subnets use separate route tables without an internet default.
Private route tables also use a regional S3 gateway endpoint for storage traffic.

Supply zone IDs, such as the synthetic test values `eus2-az1` through `eus2-az3`,
rather than account-dependent zone letters. The module checks them against available
standard zones in the provider region. Its scope is `global` in Frankfurt or `es` in
Madrid; provider and requested regions must match. Maps use zone IDs as keys, and
sorting those IDs keeps subnet assignments stable when you reorder the input list.

You can verify these declarations without contacting AWS:

```sh
node deploy/aws/check.mjs --suite network
node --test deploy/aws/network.test.mjs
```

The defaults keep global and Spain separate: `10.40.0.0/16` and `10.50.0.0/16`.
Each VPC, a private regional network, reserves its first two `/22` blocks for public
and database tiers. Each tier has three `/24` subnets. Cells start at the second `/20`
block, with three `/22` subnets each. Omit a cell's `subnet_cidr` to assign successive
blocks by sorted cell name, or supply it explicitly to keep an existing assignment
stable as you add names. Adding an earlier sorted name can change omitted assignments;
review those planned replacements before any later authorised operation. Explicit
ranges must be aligned IPv4 `/20` blocks inside the VPC, outside the reserved tiers
and disjoint from other cells. The `/16` carving has fifteen cell address slots; it
does not set a venue capacity or release-wave limit.

OpenTofu 1.11's mock provider gives these resource instances the same computed IDs.
The extra graph check evaluates the module's actual routing expressions with distinct
symbolic resource IDs, so a route accidentally using another zone cannot hide behind
identical mock values. It removes each zone from consideration and checks every
surviving cell path. This checks declared relationships, not packet delivery or a
network failure drill. Live reachability, NAT quotas, region availability and behaviour
during a zone outage still need separate qualification after live work is authorised.

## Keep a cell's machines and administration private

A cell must keep running when one zone loses a machine. The cell module declares
one EKS cluster, AWS's managed Kubernetes service, with three managed machine groups.
Each group has exactly one private subnet and one on-demand `t3.medium` machine.
Its minimum, desired and maximum counts all remain one, so a three-zone subnet list
cannot place every machine in the same zone. Increasing capacity needs a deliberate
configuration change and the later placement and growth rehearsals in P1 and P4.

Pass the network module's VPC and the cell's map of private subnet IDs, keyed by zone
ID. Use a stable name such as `es-01` or `global-01` and supply `kubernetes_version`
explicitly. The test fixture uses `1.34`; it does not establish that AWS offers that
version or machine type in the chosen region. You can check the declarations locally:

```sh
node deploy/aws/check.mjs --suite cell
```

The machine template requires encrypted 20 GiB gp3 root disks, no public IP or SSH
key, and IMDSv2, AWS's token-based machine metadata protocol. Its one-hop response
limit prevents ordinary containers from fetching the machine's credentials through
metadata. Within a cell, machines can use TCP ports 23–65535, UDP ports 53–65535 and
ICMP, which carries network error and path-discovery messages. These ranges keep
SSH port 22 closed while allowing service and DNS traffic. The control plane can
reach their HTTPS and management ports. The additional security groups allow no public
incoming connection. Outgoing node traffic uses the network's private routes.
Runtime firewall rules, public service ingress and workload isolation still need
their separate integration rehearsals.

The Kubernetes API has a private endpoint only. Name at least one exact operator
role in the cell's AWS account; only those named roles receive explicit cluster
administration through EKS access entries. The identity that creates the cluster
gets no implicit administration grant. You still need a separately qualified private
operator connection and a recovery procedure before live use. No operator tunnel,
cluster login credentials or kubeconfig is created by this module.

The control plane and machines use separate service roles. Their managed policies
provide cluster operation, node registration, private registry pulls and the IPv4
network plugin. The network plugin initially uses the machine role, which remains
available to privileged host-network workloads; the metadata hop limit does not
isolate those workloads. Dedicated workload permissions and the cluster's OIDC
identity, which lets Kubernetes service accounts obtain narrowly scoped roles,
belong to Task 8. Control-plane API, audit, authentication, controller and scheduler
logs are enabled; Task 9 owns retention and delivery.

These mocked plans check declarations and input refusals. They do not prove machine
placement, private API access, metadata enforcement, operator permissions or continuity
during a zone failure. P1's local cluster rehearsal and a separately authorised live
provider rehearsal must qualify those behaviours. Task 12 must keep cell creation
dependent on the complete network, including its routes and associations.

## Keep management data separate and recoverable

Losing a data centre must not leave the global layer or Spain with only one
database machine. The database module describes one private PostgreSQL instance
with a standby in another availability zone, AWS's Multi-AZ instance deployment.
Global uses `cloud_global`; Spain uses `cloud_es`. Each account has its own
database, private subnet group and encryption keys. Cells share only their scope's
database. You can check the declarations without contacting AWS:

```sh
node deploy/aws/check.mjs --suite database
```

Pass the scope's VPC, three database subnets keyed by zone ID, and its service
security group. The database firewall admits only that service group on TCP port
5432. The PostgreSQL parameter group requires TLS, which encrypts connections.
Supply an explicit engine version, matching parameter family and instance class.
The fixture uses PostgreSQL `17.6`, `postgres17` and `db.t3.small`; these are
configuration examples, not a claim that AWS offers them in either region.
Storage uses encrypted gp3 disks, starts at 20 GiB and may grow to at most 100 GiB.

RDS creates and manages the administrator password in Secrets Manager using the
primary encryption key. OpenTofu publishes the secret's reference, never its
value. This module creates no application users, tables or migrations. P3 owns
the separate schemas and restricted application users; P1 and P3 must connect
applications with those users rather than the administrator secret.

Primary and destination automated backups retain seven days by default. Spain
copies snapshots and transaction logs to Paris; global copies them from Frankfurt
to Ireland. The destination provider must use the same account and its own
regional key. The destination contains backups only, with no running database or
cluster. AWS documents this mechanism for [Multi-AZ instances and these regional
pairs](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReplicateBackups.html).
The local checks establish configuration bindings; restore success, backup lag,
key access and engine availability still need a separately authorised rehearsal.

Deletion protection, a required final snapshot, retained automated backups and
OpenTofu lifecycle guards protect the declared database and cold-copy resources
from ordinary destructive changes. Before a later authorised retirement, inventory
existing final snapshot names and verify retained copies and keys. Reusing the
same final snapshot name can prevent deletion; removing a resource's configuration
also removes its lifecycle guard. No retirement or restore runs here.

A Multi-AZ failover can interrupt existing connections. P1 and P3 must rehearse
reconnection and transaction retries; these mocked plans make no promise of zero
interruption. P7 owns the separately authorised regional recovery procedure and
new credentials for a restored database. An administrator-secret reference in the
primary region alone does not establish regional recovery access.

## Keep venue storage encrypted and its retained versions recoverable

Spain has separate stream and snapshot buckets in Spain, with matching cold-copy
buckets in Paris. Global has no venue storage; its root must omit this module.
Check the declarations locally:

```sh
node deploy/aws/check.mjs --suite storage
```

Supply the Spain/Paris region pair, one storage key reference per region and the
country account's `waitron-es-storage-replication` role reference. The module
refuses other regions, foreign accounts, wildcard references and prefixes other
than the adapters' existing `streams/` and `snapshots/`. Bucket names include the
country account and region. The handoff returns those names and key references.

Streams retain customer-provided server-side encryption, called SSE-C. Both
stream buckets explicitly unblock it through `blocked_encryption_types = ["NONE"]`,
as required by the [pinned provider's encryption configuration](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.42.0/website/docs/r/s3_bucket_server_side_encryption_configuration.html.markdown).
Their policies require no KMS upload header. AWS documents that [replication
preserves SSE-C without extra SSE-C permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-config-for-kms-objects.html).
No customer encryption key enters OpenTofu. The stream's bucket default is S3's
AES256 encryption; callers still supply their customer key for stream requests.

Snapshots default to the named regional KMS key. Their policies allow uploads
without encryption headers, which use that default, and deny explicit other
algorithms, keys or customer-key encryption. Bucket keys stay disabled so later
permissions can restrict encryption contexts to object prefixes. Snapshot
replication explicitly includes KMS-encrypted objects and names the Paris key.
Both copy rules select only their own adapter prefix, use S3 Standard storage
and leave delete-marker replication disabled.

All four buckets block public access, deny insecure connections and foreign
accounts, retain versions and refuse ordinary OpenTofu bucket deletion. The only bucket
age rule aborts incomplete multipart uploads after seven days. Completed and
noncurrent versions have no expiration or storage-class transition. The existing
catalogue selects daily snapshots for 30 days, monthly snapshots for 12 calendar
months and protects the last verified snapshot; bucket age alone cannot make
that decision. These declarations enable neither Object Lock nor automatic
venue deletion. D101 owns the exit policy, P1 owns worker wiring and P3 owns the
country catalogue schema.

The custody fixture now attaches scoped replication and workload policies after
the bucket, database and key references exist. Bucket policies themselves only
deny access; the separate role policies supply the grants. The local plans
establish configuration bindings, not live replication, key recoverability or
restore success. P7's separately authorised recovery rehearsal must establish
those, including retained application keys.


## Keep application keys separate from infrastructure permissions

An encrypted S3 copy cannot recover an application key that you never copied.
The custody module therefore declares four separate KMS keys in each region:
storage, database, secrets and logs. KMS protects provider encryption; application
keys remain separate secret values. Check the base keys, scoped permissions and
composed database/storage fixture together:

```sh
node deploy/aws/check.mjs --suite custody
```

Global declares email-key-ring and sign-in-signing secret shells in Frankfurt,
with Ireland replicas. Spain declares backup-master-key, email-key-ring,
installation-signing, gateway-signing and wireguard shells in Spain, with Paris
replicas. Each replica names the destination region's secrets key.
[Secrets Manager keeps the same secret name and suffix across regions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/replicate-secrets.html),
so the recovery handoff changes only the ARN's region. An ARN is a resource
reference, not its contents. The declarations never generate, read or write
secret values, and the shells are empty until a separately authorised procedure
populates them.

All symmetric KMS keys rotate and use a 30-day deletion window. Keys and secret
shells refuse ordinary OpenTofu destruction, and secret shells keep a 30-day
recovery window without overwriting existing replicas. These declarations do
not prevent an authorised administrator from changing policy or deleting data.
Before enabling recovery, retain every master-key version and email-key-ring
entry still needed by snapshots or encrypted email. Do not rely on unlabelled
Secrets Manager versions as an archive, or remove an old KMS key while retained
provider backups still depend on it. Empty shell replicas prove no retained key
bytes; population, retention and restore need their own live receipts.

Supply three distinct same-account roles named
`waitron-<scope>-deployment`, `waitron-<scope>-key-administration` and
`waitron-<scope>-recovery`. The key administrator can manage key policy; runtime
roles receive no administration or policy-changing rights. A later authorised
bootstrap must use the key administrator for key creation and policy updates,
with AWS's policy-lockout safety check retained. Root composition must keep
these provider roles separate. The KMS key policy delegates only enumerated use
operations to IAM policies in the same account. Its `Resource = "*"` means
[the key to which that policy is attached](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html),
not every key. No wildcard Allow action or principal is generated. S3 object
resources end in `streams/*` or `snapshots/*` because permissions apply to the
objects under those exact adapter prefixes.

Each cell gets its own signed EKS identity provider and roles. Trust requires
[the exact audience and service-account subject](https://docs.aws.amazon.com/eks/latest/userguide/associate-service-account-role.html),
using `sts.amazonaws.com`, the agreed country/global namespace and the role's
identically named service account. Role names include both scope and cell.
Unknown roles, wildcard accounts, escaped namespaces and crossed country
references refuse. Portal has no AWS grants. Other roles read only their named
application secrets through the primary secrets key. The backup worker can read,
write and delete current snapshot objects for catalogue retention; the verifier
can only read them. Neither receives permanent object-version deletion or the
RDS administrator secret. P3 owns restricted database users and their runtime
credentials; these declarations do not make the RDS administrator an application
user.

S3's replication shell trusts only the source account's exact source buckets.
Its attached policy reads source metadata and versions, writes only the matching
cold prefixes and explicitly denies source writes. KMS permissions name the
source-decrypt and destination-encrypt keys, regional S3 services and snapshot
object contexts. The separate recovery policy attaches to the supplied recovery
role, never a machine role. It reads cold application secrets and retained
object versions with matching destination decrypt contexts. It grants no key
changes, object deletion, database restoration or venue activation. Global has
no venue storage, country-only roles or S3 replication policy.

The composed plan checks references without a dependency cycle; it does not
qualify AWS policy enforcement or replication installation order. Before any
later authorised deployment, qualify source/destination permissions and service
readiness, then restore both retained objects and the matching application keys.
P1 must mount the existing runtime contracts through authenticated integration:
a KMS reference cannot replace the 64 hexadecimal characters expected in
`CLOUD_BACKUP_MASTER_KEY`, and an email-key-ring reference cannot replace
`CLOUD_EMAIL_KEYS` and `CLOUD_EMAIL_ACTIVE_KEY_ID`. The managed-stream credential
handoff still lacks STS session-token fields; extend that contract before
issuing temporary credentials rather than creating long-lived IAM access keys.
RDS manages its separate administrator secret; P7 must restore or reissue
credentials during recovery instead of assuming that secret is replicated.

## Retain infrastructure evidence and expose signals

You need local evidence before you can investigate a failed service. The
observability module declares primary-region destinations for EKS control-plane
logs, Container Insights performance records, PostgreSQL logs and VPC flow
metadata. It creates no application request-body logger or secret-value reader.
The VPC destination receives only the named network metadata fields. These
configuration checks do not establish that upstream audit payloads redact every
sensitive value. Qualify those payloads before collecting production records.

Operational destinations use your scope's regional log key and retain 30 days by
default. A regional CloudTrail records management events, validates log files and
delivers them to a private, versioned, encrypted audit bucket. Its lifecycle
expires current objects after 90 days and retains noncurrent versions for 90 days
after replacement; deletion in a versioned bucket is not an exact 90-day physical
purge. These defaults still need D101 and legal review. Operational retention must
be a supported CloudWatch duration of at most 365 days; audit retention must be
whole days from 1 through 365. Zero, which would keep CloudWatch logs indefinitely,
is refused.

The custody module remains the sole owner of key policies. Supply the same exact
cell names through its `observability_cells` input and the observability module's
resource input. Its primary log key admits only the named regional log-group
contexts, audit trail, budget and infrastructure alarms. Operational services gain
no permissions on the cold keys or other key purposes. The flow-log delivery role
can write only its own streams; its broader log-group discovery permission is
read-only and restricted to the primary region. CloudTrail's bucket delivery and
SNS publishing policies require the named service sources in this account.

The operator SNS topic is an encrypted notification destination. It has no
subscription or customer email address. A monthly AWS Budget takes your positive
USD threshold as an external input and sends actual and forecast notifications
when that threshold is exceeded. This is no cost estimate or spending stop.
Named alarms observe database free space below 1 GiB, at least 80 database
connections, failed EKS nodes and failed S3 replication operations. They send only
to that topic, take no repair action and leave missing metrics unknown. Review
those engineering thresholds against measured capacity before deployment.

[Failed replication metrics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/repl-metrics.html)
belong to the source region and identify the exact source bucket, destination and
`cold` rule. The existing replication declarations now enable these metrics
without Replication Time Control or an availability promise. Metrics can incur
separate charges during a later authorised deployment. Node signals use
[Container Insights' failed-node count](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Container-Insights-metrics-EKS.html);
the collector must be installed before it emits that metric.

Root composition remains Task 12's work: connect the admitted network and stores,
create log groups before EKS/RDS delivery, enable PostgreSQL exports, pass matching
cell names to custody and qualify collector permissions with P1. The module's
mocked plans establish declarations and refusal checks. They do not prove live
service delivery, mail, paging, legal retention or monitoring availability. Before
any separately authorised AWS rehearsal, exercise the
[CloudTrail key permissions](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/create-kms-key-policy-for-cloudtrail.html)
and [encrypted budget topic permissions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html)
with the actual regional services.

## Forward public traffic without taking a venue's TLS key

Each cell gets a network load balancer, called an NLB, across its three public
subnets. Cross-zone balancing lets each entry point forward to healthy nodes in
another zone. Run the isolated declaration checks with:

```sh
node deploy/aws/check.mjs --suite ingress
```

Supply the cell's scope and name, VPC, three public subnet references keyed by
zone ID, its node security group and the admitted public ports. Spain accepts
TCP 443 and UDP 51820; global accepts only TCP 443. Other ports, duplicate ports,
missing zones, duplicate subnet references and crossed scope names refuse.
The module checks the provider region and available zone IDs. Mocked references
cannot establish that the supplied subnets and node group actually belong to
that VPC or those zones; qualify those bindings before deployment.

TCP 443 forwards unchanged to instance targets on TCP 30443. The load balancer
holds no certificate or private key, so staff TLS still terminates at the
venue. P1's router owns the distinct Cloud API and customer-domain certificate
paths. Spain's WireGuard listener forwards UDP 51820 to UDP 31820. Both target
groups check TCP 30999 every ten seconds, with three successful or failed checks
to change health. That endpoint must report the actual service readiness;
an open TCP socket alone does not establish gateway or venue health.

The load balancer has its own security group from creation. Separate rule
resources own its paths; inline rule lists are omitted so they cannot revoke
those resources during a later authorised change. The added node rules admit only
its group on the target ports and readiness port; existing private cell-peer
paths stay under the cell module. Its outbound rules name only that cell's node
group. This follows AWS's [NLB security-group reference
pattern](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-security-groups.html),
which also supports client-IP preservation. Nodes gain no public administration,
database or blanket inbound path. Proxy Protocol headers stay disabled, so the
load balancer does not prepend bytes to staff TLS or WireGuard packets.

P1 accepted these NodePorts and `externalTrafficPolicy: Cluster` in the recorded
handoff. P1 still owns matching Services, readiness semantics, node target
registration and a narrowly scoped controller role. P2 returns the load
balancer's DNS name, hosted-zone identifier, public ports and target-group
references keyed `https` and, for Spain, `wireguard`. It discovers no Kubernetes
workload and starts no target. Task 12 must compose those references with the
same cell's network. Actual health transitions, source-address handling through
Kubernetes, target binding, traffic continuity during a zone failure and live
firewall enforcement remain unqualified. P7 owns regional recovery; an ingress
health signal starts no venue and switches no regional DNS.

## Keep country DNS independent of the parent zone

A country must keep its public names when its workloads move. Spain owns the
public `es.waitron.io` zone in its own account; the global account owns
`waitron.io`. The DNS zone stays in the Spain account during a future Paris
runtime move. These declarations neither move a workload nor switch regional
records. Check them locally with:

```sh
node deploy/aws/check.mjs --suite dns
node --test deploy/aws/dns.test.mjs
```

Pass `scope` (`global` or `es`), its exact `zone_name`, and the zone choice to
`modules/dns`. `create_zone` defaults to false: supply `existing_zone_id` to
reference an existing public zone. Creation requires an explicit true and no
existing ID. A managed zone refuses destructive replacement and recursive
record deletion. Referencing an existing zone does not import it into resource
management. The public-name lookup must return the supplied ID; a mismatched ID
refuses. Resolve duplicate public zones outside this change before adoption.
The pinned provider's [zone lookup](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.42.0/website/docs/d/route53_zone.html.markdown)
requires a unique match. The module returns `dns = {zone_id, name, name_servers}`.

Publish the country nameservers as an explicit protected handoff to the separate
`roots/delegation` entry point. This example uses synthetic inputs; keep actual
IDs and role credentials in protected external configuration:

```hcl
expected_account_id = "222222222222"
handoff = {
  version = 1
  parent_zone_id = "ZGLOBAL123"
  child_name = "es.waitron.io"
  child_name_servers = [
    "ns-1.awsdns-1.com", "ns-2.awsdns-2.net",
    "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"
  ]
}
```

Supply the four distinct Route 53 nameservers, including the com, net, org and
co.uk destinations. The root checks
the global account, Frankfurt provider region and exact public parent-zone ID.
It never reads country state or uses country credentials. The only DNS record
it declares is Spain's NS delegation in that parent, with a 300-second cache
lifetime and overwrite disabled. Existing delegation needs a separately
reviewed adoption procedure; no import or registrar operation runs here.

The module and delegation root declare separate, unattached IAM policies. Each
permits record changes in one exact hosted zone. The module permits A, AAAA,
CNAME, TXT and CAA records: global at the apex, Spain at its apex and below it.
It grants no NS or SOA change. Only the separate delegation policy permits NS,
for exactly `es.waitron.io` in the parent. Name, type and action conditions cover
every record in a change batch and require those keys to be present, following
[Route 53 condition rules](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/specifying-conditions-route53.html).
Attaching a policy to a role is later integration work. These allow statements
cannot constrain additional grants from other policies; qualify the effective
role permissions before any authorised deployment.

P1/runtime consumers own stable venue records and customer-domain certificates;
P4 owns action authority and P7 owns regional recovery. No venue record,
certificate, `waitron.app` zone or automatic failover is created here. The mocked
plans check names, references, refusals and policy declarations. They cannot
prove nameserver ownership from an external handoff, public DNS propagation,
registrar custody or live IAM enforcement. Verify those separately before any
provider operation.

## Bind each deployment root to its own account

A correct region is not enough to identify a deployment. Before a root can hand
references to a workload, you must supply its expected account and the exact
role for each provider. The independent `global` and `country` roots check
those bindings against all four provider identities and regions:

```sh
node deploy/aws/check.mjs --suite integration
node --test deploy/aws/provider-bindings.test.mjs
```

Each root currently runs 27 mocked admission plans. This checkpoint covers
provider admission only. Module composition and the complete
`infrastructure_v1` output remain unfinished. The current
`deployment_admission` output contains only version, scope, country and region
metadata; do not pass it to P1 as an infrastructure handoff.

For the global root, supply exactly `global`, `global_backup`, `global_keys`
and `global_backup_keys` in `bindings`. Spain instead takes `country`,
`country_backup`, `country_keys` and `country_backup_keys`; it needs no global
account input. Every entry contains `expected_identity` and `role_arn`. All
four entries in a root name the same account. Deployment aliases assume
`waitron-<scope>-deployment`; key aliases assume
`waitron-<scope>-key-administration`, where `<scope>` is `global` or `es`.
The regions are fixed to Frankfurt/Ireland and Madrid/Paris respectively.

Keep these bindings and live backend settings outside Git. Each provider
allows only the expected account, and the plans independently check its
reported account and region. The tests use synthetic identities, not AWS
credentials. They cannot prove who may assume a role or what its effective
permissions allow. The new roots contain no workload modules or resources yet.

Each cell has its own workload roles and identity provider. The current
version 1 handoff has one role reference per service, so one object cannot
name several cells' different roles. The integration default is an export
named `infrastructure_v1_by_cell`: each entry will be one complete, unchanged
version 1 object containing exactly the named cell and its matching roles.
P1's planned single-object input keeps the same shape: callers select an exact
cell entry.
Schema fixtures accept this representation for two cells in either scope.
The real export, selection checks and resource composition remain unbuilt;
no new schema or runtime consumer is qualified by that fixture check.
