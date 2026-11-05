# Disposable Kubernetes proof setup

A vanished controller must not leave a proof machine billing indefinitely. This
prerequisite supplies the private setup template and an independent expiry sweep.
It does not yet supply the owner-run setup lifecycle or permission to apply the
template. Both `node deploy/kubernetes/proof/setup.mjs up` and `down` refuse
execution. Machine launches have an explicit deny and the sweep rule is disabled.

The owner authorised D570's setup build for staging account `462991287391`, region
`eu-south-2`, one on-demand ARM `m7g.2xlarge`, with an all-in US$10 monthly cap and
an initial US$0 baseline. Temporary access expires at `2027-02-28T23:59:00Z`.
Weekly retention was approved through that expiry. Production account
`949687825720` remains forbidden. These approval values in `policy.json` are inputs
to future budget enforcement; recording them does not reserve funds or establish
current spend.

`setup.yaml` is the single CloudFormation template. It uses JSON syntax, which is
also valid YAML. `renderSetup` in `setup.mjs` checks observed account, region,
repository IDs, access expiry, official ARM image metadata and the S3 prefix-list
identifier, then embeds the actual expiry engine. Inputs must eventually come from
the trusted setup's live discovery, rather than a pasted resource list. An image
passing these shape checks has not passed a boot or offline-install test. A reused
GitHub OIDC provider is referenced by a conditional parameter; only an absent
provider gets a stack-owned resource. The template conditions suppress resources
outside the staging account and region.

The template contains a private VPC and subnet, no internet route or inbound
security-group rules, S3-only HTTPS egress, private encrypted storage, separate
launcher and expiry roles, a fixed launch template, a one-day log group and a
disabled one-minute sweep. Its outputs carry the runtime resource identities.
The launcher has no IAM, network, bucket or template administration permissions.
Every launcher grant also carries the approved absolute access-expiry condition,
so an already issued session cannot extend that deadline. Its intended launch
permissions remain denied pending the missing safety gates;
unit checks and CloudFormation validation do not qualify IAM behavior on AWS.

The sweep selects `Proof=D570` and the exact CloudFormation stack ARN. It checks
the entire bounded inventory before requesting termination or deletion. A valid
UUIDv4 `Run` tag is required; ambiguous or missing ownership stops the sweep.
Expired instances, including ones with a missing or invalid `ExpiresAt`, receive
termination requests. Future and foreign resources are left alone. Volume deletion
also requires available state and no attachments. Each inventory is bounded to
20 pages of at most 100 resources, and repeated tokens or duplicate IDs fail.

A successful heartbeat at `d570/health/reaper.json` records accepted termination
and deletion requests. It does not prove the machine stopped, its disk disappeared,
or billing ended. Any read, mutation, response-validation or clock failure prevents
a successful heartbeat. The launcher must eventually check heartbeat freshness,
actual cleanup and the durable cost reservation independently.

Run the focused checks with an explicit file list:

```sh
node --test --test-reporter=tap --test-timeout=30000 deploy/kubernetes/proof/setup.test.mjs deploy/kubernetes/proof/expiry.test.mjs
uvx --from cfn-lint==1.59.0 cfn-lint deploy/kubernetes/proof/setup.yaml
```

The unprivileged `Kubernetes proof prerequisites` workflow runs those checks on
pull requests and main, including validation of the fully rendered synthetic
template with its actual inline Lambda source. It requests no AWS session and has no recurring or manual
launch trigger. The Lambda test executes the rendered inline source with synthetic
SDK responses, including termination and volume deletion; it makes no claim about
a live AWS termination actor. The fixture uses made-up AMI and prefix-list IDs;
it is test input, not a discovered or qualified machine image.


Two named expiry gates must be resolved before enabling the sweep:

- **Whole-snapshot cleanup starvation:** one malformed run tag, even on a
  terminated row or an unattached volume, currently stops all mutations. A failed
  first termination also prevents later cleanup attempts. Define and prove a
  per-resource failure strategy that still cannot delete a foreign volume, then
  follow the plan's changed-check rule before changing ownership assertions.
- **Unbounded future expiry:** a syntactically valid future tag currently has no
  independent lifetime bound. Prove a cap against immutable EC2 launch time,
  the reserved 120-minute proof plus 15-minute cleanup window and the approved
  access expiry. Define missing, malformed and contradictory time evidence for
  instances and volumes; none may produce a false healthy result.

Also qualify the launch statement's required network-interface resources, condition
keys for each EC2 resource type, the regional official image owner and the account's
Lambda concurrency quota. These are live/provider gates, with no current passing
claim. The launcher deny and disabled rule remain mandatory until they are resolved.

Before the owner can run setup, implement the one-entry `up`/`down` lifecycle,
conditional all-in setup/runtime reservations, official current prices and billing
reconciliation, protected main-only GitHub environment, immutable ARM/offline input
closure, and fixed local-deadline bootstrap. Complete the real OIDC refusal and
both termination drills with exact actor and cleanup evidence. Preserve protection
and ownership records through partial setup or uncertain cleanup. Do not remove
the explicit launch deny, enable the rule or ask the owner to apply this template
until those dependencies are reviewed and their required gates pass. The full P1
service/fault proof remains separate; see the
[implementation plan](../../../docs/superpowers/plans/2026-11-04-kubernetes-weekly-proof.md).

The template follows AWS's [conditional S3 write policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html),
[EC2 launch-template restrictions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ExamplePolicies_EC2.html),
[Lambda runtime contract](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)
and [CloudWatch log ARN shape](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-logs-loggroup.html).
These references informed the implementation; live qualification remains open.
