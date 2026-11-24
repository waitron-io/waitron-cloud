# P2: AWS infrastructure implementation plan

> **Execution:** The owner approved unattended inline execution. Use `superpowers:executing-plans`, work task by task, and read the TDD skill before implementation. Do not dispatch implementer/reviewer pairs. Land this plan as a documentation milestone before building it; the lane driver owns that separate operation.

**Goal:** Describe the global and Spain infrastructure in OpenTofu and verify its intended configuration entirely through mocked plans, without accessing AWS.

**Architecture:** Keep AWS resources under `deploy/aws/`, behind a versioned, provider-neutral handoff to P1/P3/P7. Separate account administration, state custody, global infrastructure, country infrastructure and DNS delegation into independent roots, so routine country changes never need Organization administration. Primary regions have three independent network paths, management databases spanning availability zones, and one EKS cluster per cell; secondary regions hold recoverable encrypted copies with no running standby.

**Tech stack:** OpenTofu 1.13.2, `hashicorp/aws` 6.70.0, Node 26 built-in tests, Docker for network isolation. Pin these initial versions and provider checksums; upgrades are deliberate changes, not floating CI downloads.

**Deliberate tool upgrade, 2026-10-23 (D124).** The owner requested current stable
releases. The official [OpenTofu release](https://github.com/opentofu/opentofu/releases/tag/v1.13.2)
was published on 21 October and the [AWS provider release](https://github.com/hashicorp/terraform-provider-aws/releases/tag/v6.70.0)
on 22 October (its changelog is dated 21 October). Reviewed all 27 stable OpenTofu
releases after 1.11.0 through 1.13.2 and all 30 AWS releases after 6.42.0 through
6.70.0, including the withdrawn 6.57.0 notice. The four Linux archive hashes come
from the official release checksum files and were verified against downloaded bytes.

OpenTofu's intervening changes fix mocked-provider cleanup, improve provider
checksums and add instance overrides. The [1.12 changelog](https://github.com/opentofu/opentofu/blob/v1.12.9/CHANGELOG.md)
and [1.13 changelog](https://github.com/opentofu/opentofu/blob/v1.13.2/CHANGELOG.md)
identify these changes. Keep every explicit plan, provider-alias and assertion guard;
no test-only apply or new experiment is enabled. The new macOS minimum is 13.
WinRM removal and changed `base64gzip` bytes have no consumer in this infrastructure.

Relevant AWS changes include the 6.43 alarm validation correction, S3 standalone
configuration reconciliation in 6.46, backup-replication deletion fixes in 6.48,
EKS schema additions and Route53 changes. The 6.68 availability-zone limit concerns
RDS clusters; this plan uses DB instances. The 6.70 import-ID change concerns
Route53 Domains delegation-signer records, which this plan does not declare.
Do not enable new rotation, routing or experimental batched-read behaviour as part
of the upgrade. AWS 6.52 restores debug request/response bodies; the runner still
clears ambient logging and credentials and never loads live values for these tests.

Regenerate all five root lockfiles with `tofu providers lock` against the same
executable-only mirror that `prepare.py` constructs from the checksum-verified
official HashiCorp archives. Include Linux amd64, Linux arm64 and native macOS
arm64. Full-archive hashes include a licence file that the prepared directory does
not contain; a read-only initialization check must accept the prepared layout without
rewriting the lock. The default OpenTofu registry also returned different distribution
hashes during this upgrade, so neither alternative lock is used for the pinned image.
Keep the same exact provider constraints in every module and fixture. Native
`fmt`, `validate` and mock plans are interim feedback while Docker is unavailable;
the pinned image and current-head AWS workflow remain required before branch finish.

**Spec:** [Approved production design](../specs/2026-10-22-cloud-production-deployment-design.md), especially sections 3, 4, 9, 10 and 12. Read the [seven-plan order](2026-10-22-cloud-production-deployment.md) alongside this plan; the owner's instruction makes P2 independent of P1's unfinished build.

## Global constraints

- Work locally only: no AWS accounts/resources/access, spending, live plans, `tofu apply`, production schemas, mail or credentials. Every test `run` explicitly uses `command = plan`; mock every provider and alias. Do not use test-only apply.
- Use the **existing AWS Organization**. Give global and each country separate member accounts; never declare a replacement Organization or silently adopt its management account for workloads.
- Global primary: Frankfurt `eu-central-1`; Spain primary: Madrid `eu-south-2`; Spain backup/cold recovery: Paris `eu-west-3`. Propose Ireland `eu-west-1` for global backups, independently of Spain and Paris. This is a builder default, not qualification of that destination.
- Start Spain with one cell, three `t3.medium` nodes, one per availability zone (AZ, a separate AWS data-centre failure boundary), cap 64 venues. Provide an independent global service cell with the same three-node pattern; no extra gateway machines.
- A regional backup is not a running standby. P2 never starts hosted writers, promotes a database, switches regional DNS, implements stop proof or enables automatic regional failover.
- Preserve [documentation ownership](../../documentation-ownership.md): Waitron owns capture/restore/activation; Cloud owns provider infrastructure. Preserve [managed-key operations](../../managed-key-operations.md) and the [storage rehearsal's limits](../../aws-storage-rehearsal.md).
- Production design sections 3/4 supersede D101's older prohibition on Paris-usable keys during failover. P2 describes those copies; P7 amends D101 and rehearses regional recovery. No legal or location promise follows from these tests.
- No real account IDs, real contact addresses, credentials or secret bytes in repository examples, saved plans or state fixtures. Provider-schema validation still runs under mocks: allow explicitly synthetic 12-digit account IDs, schema-valid synthetic ARNs/Organization IDs and contacts under `.invalid`. Use distinct synthetic identities for global, country and administration; primary/backup aliases within one account share its identity. Future real inputs and sensitive state remain outside Git.
- Reserve `deploy/aws/` and `docs/aws-infrastructure.md` for this build. Read P1's current handoff before integration; do not edit its manifests, queues, `scripts/ci-*`, existing workflows, or other lanes' files.
- Defaults below are engineering configuration, not prices, service guarantees or approved legal retention. Record qualification gaps before any later live authorisation.

## File map and interfaces

Create the following paths during **implementation**, not this planning milestone. Each module has `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf` and its own `tests/*.tftest.hcl`; policy-heavy modules may add the explicitly named files below.

| Path | Responsibility |
| --- | --- |
| `deploy/aws/{check.mjs,check.test.mjs,inspect.py,tools-requirements.txt,Dockerfile,test-cli.tfrc,.gitignore}` | Small isolated test runner, pinned parser/tools/provider mirror, artifact exclusions |
| `deploy/aws/roots/{accounts,state,global,country,delegation}/` | Separate entry points and lockfiles; each has `providers.tf`, `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, `tests/` |
| `deploy/aws/modules/{accounts,state,network,cell,database,storage,custody,workload-permissions,observability,ingress,dns}/` | Focused resource ownership; no third-party module framework |
| `deploy/aws/contracts/{infrastructure-v1.schema.json,p1-roles-v1.json}`, `deploy/aws/contracts.test.mjs` | Closed handoff schema, proposed image roles and compatibility assertions |
| `docs/aws-infrastructure.md` | Local verification, custody, boundaries, later adoption/recovery prerequisites |

**Input contract.** Global/country roots take `deployment = {version:1, scope:"global"|"country", country:null|"es", primary_region:string, backup_region:string, network:{cidr:string,az_ids:list(string)}, cells:map({subnet_cidr:string})}`. Global starts `global-01`; Spain starts `es-01`. Use one VPC per primary scope, three unique AZ IDs, and disjoint cell subnet ranges inside it; each cell inherits all three AZs. Management-database subnets are shared within that scope, so later cells can reach the same database without cross-VPC routing. Provider bindings are separately supplied protected external inputs, `bindings = map({expected_identity:string, role_arn:string})`; aliases are fixed, not dynamically selected by customer input. Test identities use schema-valid synthetic fixtures; malformed-schema cases are separate from behavioral refusals. Account contacts never enter this deployment object. Separate required inputs are `kubernetes_version:string`, `database_settings:{engine_version:string,parameter_family:string,instance_class:string,allocated_storage:number,max_allocated_storage:number}`, and `budget_limit_usd:number`; fixtures use syntactically valid versions without claiming live availability.

**Output contract.** Both roots publish `infrastructure_v1_by_cell`, a map keyed by exact cell name. Each value is one unchanged version 1 object containing exactly that cell and its matching roles. The explicit selector preserves P1's single-object input. Its inner type is `infrastructure_v1 = {version:1, scope, country, regions:{primary,backup}, cells:map({cluster_name,region,az_ids,private_subnet_ids,node_security_group_id,oidc_issuer,ingress:{dns_name,zone_id,tcp_ports,udp_ports,target_group_arns}}), database:{endpoint,port,name,admin_secret_ref,kms_key_ref,backup_ref}, storage:{stream_bucket,snapshot_bucket,backup_buckets,kms_key_refs}, secrets:map(string), workload_roles:map(string), observability:{logs:map(string),signals:map(string),budget_ref:string}, dns:{zone_id,name,name_servers}, recovery:{region,database_backup_ref,key_refs,secret_refs,runtime_enabled:false}}`. References are strings; ports are numbers; collections have explicit schema types. For global, `storage.stream_bucket` and `storage.snapshot_bucket` are null and `backup_buckets` is empty; database backups use `database.backup_ref`. Cluster credentials, database passwords, secret values and kubeconfig are excluded. Do not publish account-administration outputs as this contract.

**P1 proposal, awaiting lane D agreement.** `p1-roles-v1.json` lists only `api`, `portal`, `registration-worker`, `backup-worker`, `backup-verifier`, `remote-gateway`, `remote-reconciler`, `monitor-worker`. These are logical image roles, not registry names; P1 may map several roles to one image and several commands to `registration-worker`. Propose namespace `waitron-cloud-global` or `waitron-cloud-es` and service-account names equal to these roles. Map Compose's migration/email/usage/manifest/probe/operations commands to `registration-worker` in the guide; translation stays disabled pending its separate production gate. P1 owns the release map `{version:1, images:map(role -> digestReference)}`, Kubernetes service accounts/manifests, GitOps tool, secret mounting, certificates and scheduling. OpenTofu consumes **no image reference** and invokes no Kubernetes/Helm provider. P2 can finish using its own schema fixtures, without pulling/building P1 images. Reconcile proposed roles through the lane driver later, without editing either queue here.

## Verification discipline

`node deploy/aws/check.mjs --suite <name>` is the only implementation-time infrastructure entry point. Suites are `canary`, `accounts`, `state`, `network`, `cell`, `database`, `storage`, `custody`, `observability`, `ingress`, `dns`, `integration`; `--all` runs all. Each maps to explicit module/root tests. The runner exports `checkSources(directory):Promise<void>` and `runSuite(name):Promise<void>`; no arbitrary command/module path argument. Module suite files are exactly `deploy/aws/modules/<name>/tests/<name>.tftest.hcl`; custody also runs `modules/workload-permissions/tests/custody.tftest.hcl` and `deploy/aws/fixtures/custody/tests/custody.tftest.hcl`; account/state/delegation roots repeat their matching suite, and global/country roots use `tests/integration.tftest.hcl`. Task 1 uses `deploy/aws/canary/tests/canary.tftest.hcl`.

- Prepare the pinned tool image and provider mirror with `node deploy/aws/check.mjs --prepare-tools`, from official distribution/registry endpoints with checksum verification. `runSuite` never builds/downloads tools; it fails with a setup diagnostic when the local image is missing. This fetches software only. Run verification in a fresh disposable copy using `docker run --network none --cap-drop ALL --read-only --tmpfs /tmp`, no host credentials, home-directory mounts, Docker socket, forwarded environment or instance-metadata access. Only the candidate copy and temporary directory are writable; copy only tracked source and this branch's explicit candidate changes, never ambient ignored files. Reject symlinks escaping that copy; never mount the checkout's `.aws` or `.terraform`.
- Inside that isolated copy, run `tofu init -backend=false -input=false`, `tofu validate`, then `tofu test -filter=tests/<suite>.tftest.hcl -no-color`; use the read-only filesystem mirror and exclude all direct provider installation. Set `TF_IN_AUTOMATION=1`, `AWS_EC2_METADATA_DISABLED=true`, and empty credential/config paths. No dummy access keys. Roots have partial backends, with no live backend settings in tests.
- Before spawning OpenTofu, reject missing/non-plan `command` in any run (including setup runs), unmocked aliases, test `provider` blocks, provisioners, external data/program execution and undeclared provider sources. Use `inspect.py` with pinned `python-hcl2==8.1.4` and hash-locked transitive dependencies in `tools-requirements.txt`, installed only in the tool image. Parse literal `.tf` and `.tftest.hcl` files without evaluating expressions. Reject alternative `.tofu`/JSON forms, override files, automatic variable files and symlinks; permit module sources only as resolved relative paths within `deploy/aws/`. Resolve explicit provider/alias maps through local modules; reject dynamic bindings or unrecognised syntax. Cover heredocs, interpolation, escapes, deceptive strings/comments, alternate-file precedence and an omitted command. Parser helpers may run inside the isolated container; no OpenTofu child starts until inspection succeeds. Network isolation remains effective even if a static check fails.
- Every task follows observed **RED → minimal implementation → GREEN**. A missing-file/parser/provider-download failure is not the desired RED: add enough declaration shape to reach the named behavioral assertion and record its failure. Invalid-input cases use `expect_failures` targeting the exact variable/precondition; do not count arbitrary diagnostics as success.
- After GREEN, delete each new critical guard in a disposable copy and rerun its focused test; require failure at the original assertion. Restore and rerun GREEN. For non-policyable lifecycle/binding checks, mutate the actual declaration/binding, not an output that merely claims protection. Keep receipts outside Git, with command, exit status and named assertions.
- Mocked plans prove declared relationships and refusals. They cannot prove actual IAM enforcement, credential expiry, route reachability, AZ-loss continuity, service/region capacity, provider availability, successful restore or one-writer stop proof. No provider qualification claim follows.

## Review focus

- Account/alias confusion must fail even when both providers are mocked (Tasks 2/12).
- An AZ loss must leave the surviving route graph independent and the database configured Multi-AZ (Tasks 4/6).
- Wildcard subjects, crossed prefixes and apex permissions must be refused, including malicious input (Tasks 7/8/11).
- Retained backup copies must name the matching historical-key custody and regional destination (Tasks 7/8).
- Missing mocks, destructive adoption and accidental backend access must fail without AWS connectivity (Tasks 1/2/3/11).

## Implementation tasks

Each task is bounded to one resource family or integration seam, normally 25–65 tool calls and always well under 100. If a task exceeds that bound, stop at its passing signed-off commit and split the remaining assertions before continuing. Use the relevant `--suite` command for RED and GREEN. Stage only each task's named files before its signed-off commit; never bypass hooks or weaken existing behavioral checks. Fresh initialization and test runs require zero AWS credentials, even on a developer machine with live profiles.

> **Built.** Tasks 1–12 are on main as offline checks; the qualification that is left stays below. Their step-by-step text was removed on 24 November 2026; read it with
> `git show 3c69f4903:docs/superpowers/plans/2026-10-22-cloud-aws-layer.md`.

## Technical references and remaining qualification

Checked official documentation on 2026-10-22 for planning syntax and service semantics; no provider commands were run. Recheck pinned schemas after Task 1's isolated initialization; fail rather than silently substitute an unsupported feature.

- [OpenTofu 1.11 tests, provider mocks and alias maps](https://opentofu.org/docs/v1.11/cli/commands/test/) and [initialisation/backend controls](https://opentofu.org/docs/v1.11/cli/commands/init/): explicitly plan every run; aliases need their own mock binding.
- [S3 backend locking/encryption](https://opentofu.org/docs/language/settings/backends/s3/): state custody uses encryption, versioning and native lockfiles; authorisation and restore are separate requirements.
- [AWS NAT resilience](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html) and [EKS managed node groups](https://docs.aws.amazon.com/eks/latest/userguide/managed-node-groups.html): use AZ-local outbound routes and explicit single-AZ groups.
- [Pinned AWS provider RDS schema](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.70.0/website/docs/r/db_instance.html.markdown), [RDS cross-region backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReplicateBackups.html) and [managed passwords](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html): distinguish Multi-AZ instances from clusters; region-pair listings do not qualify an engine/version/account.
- [Pinned S3 encryption schema](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.70.0/website/docs/r/s3_bucket_server_side_encryption_configuration.html.markdown) and [encrypted-object replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-config-for-kms-objects.html): preserve SSE-C and select destination KMS protection deliberately.
- [Pinned HCL parser](https://pypi.org/project/python-hcl2/8.1.4/): parse supported files with a real HCL2 parser without evaluating expressions.
- [Secrets replication](https://docs.aws.amazon.com/secretsmanager/latest/userguide/replicate-secrets.html) and [KMS regional semantics](https://docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html): the selected regional re-encryption design needs secret-population and recovery evidence; do not infer that related KMS keys automatically configure replication policies.
- [NLB health checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/target-group-health-checks.html) and [budget notification policies](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html): UDP services need a separate non-UDP health check; budget delivery needs explicit SNS/KMS authority.
- [DNS delegation](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html) and [account deletion behavior](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.70.0/website/docs/r/organizations_account.html.markdown): parent NS changes and member-account removal are distinct administrative operations; lifecycle protection is necessary even with account closure disabled.

**Self-review against the approved spec (completed once):** Sections 4/10 map to Tasks 2–12 (separate accounts, DNS, global/country databases, storage and resilient infrastructure). Section 3's automation corrections are preserved without implementing P4/P5. Sections 5/9 map to explicit P1/P6 exclusions: no sandbox approval or one-writer proof is inferred from node replacement. Sections 11/12 map to cold copies and local-only execution. Five review risks have owning negative checks: alias/account confusion (2/12), AZ-local routing/database failure (4/6), broad or malicious grants (7/8/11), unrecoverable retained keys (7/8), and accidental live execution or destructive adoption (1/2/3/11). Remaining assumptions are Ireland for global copies, the proposed P1 roles/ports, provisional infrastructure retention/sizing, and unqualified provider versions/capacity. P3 supplies database users/schema separation; P7 supplies actual failover, outside monitoring and recovery proof. None blocks P2's independent mocked configuration checks.
