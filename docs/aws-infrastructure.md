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

You can select only `canary`, `accounts`, `state`, `network`, `cell`, `database`, `storage`,
`custody`, `observability`, `ingress`, `dns` or `integration`. Each name selects fixed module
and root paths; the CLI accepts no custom command or directory. `--all` runs those suites
in order and refuses a missing test file. The canary, account and state suites are implemented,
so `--all` currently reports those results, then fails on the missing network suite.
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
