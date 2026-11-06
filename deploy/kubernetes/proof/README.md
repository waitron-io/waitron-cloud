# Disposable Kubernetes proof setup

A vanished controller must not leave a proof machine billing indefinitely. This
prerequisite supplies the private setup template and an independent expiry sweep.
It does not yet supply the owner-run setup lifecycle or permission to apply the
template. Both `node deploy/kubernetes/proof/setup.mjs up` and `down` refuse
execution. Machine launches have an explicit deny and the sweep rule is disabled.

The owner authorised D570's setup build for staging account `462991287391`, region
`eu-north-1`, one on-demand ARM `m7g.2xlarge`, with an all-in US$10 monthly cap and
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

The sweep selects `Proof=D570` and the exact CloudFormation stack ARN. It validates
both bounded inventories before requesting termination or deletion. Structural
ambiguity, such as repeated tags or invalid resource IDs, stops all mutations. A
malformed UUIDv4 `Run` tag leaves that resource untouched and withholds healthy
status, while independently owned resources can still be cleaned. Foreign
resources remain untouched. Volume deletion requires a valid run tag, available
state and no attachments.

Terminating an instance can also delete its disks. Before that request, the sweep
reads every disk marked for deletion in its block mappings, including the root.
Each disk must match the same stack, proof, original run and expiry, with one
confirmed attachment to that instance and device. Missing or contradictory disk
records withhold termination and healthy status while independent cleanup
continues. These are read-time checks; live qualification must also verify that
runtime roles cannot change tags or attachments between the read and termination.

A valid future `ExpiresAt` cannot extend a resource beyond its original lifetime.
The sweep checks it against the earlier of the approved access expiry and 135
minutes after the original instance launch or volume creation. For an instance,
the primary network interface's attachment time supplies the original launch;
`LaunchTime` is only its most recent start. A restart therefore grants no extra
time. An excessive future expiry triggers owned cleanup and withholds healthy
status. A missing or malformed expiry grants no grace. Missing or contradictory
service times trigger owned instance termination only after those disk checks, and do
not authorize direct volume deletion; the sweep reports the error after attempting independent cleanup.
The observation clock is refreshed after both inventories so a resource created
during a read is not treated as being from the future. A backwards or invalid
clock prevents a healthy result. Each inventory is bounded to
20 pages of at most 100 resources, and repeated tokens or duplicate IDs fail.

A successful heartbeat at `d570/health/reaper.json` records accepted termination
and deletion requests. It does not prove the machine stopped, its disk disappeared,
or billing ended. Any read, mutation, response-validation or clock failure prevents
a successful heartbeat. Once both inventories pass validation, a refused mutation
or unconfirmed termination response allows later eligible cleanup attempts. If
those calls finish, the sweep rethrows the first failure without publishing health.
A stalled call can still delay later attempts until another sweep and reach the
Lambda timeout before the first error is reported. Real SDK request timeouts
remain unqualified; no healthy heartbeat is written during that wait. The launcher must eventually
check heartbeat freshness, actual cleanup and the durable cost reservation
independently.

Run the focused checks with an explicit file list:

```sh
node --test --test-reporter=tap --test-timeout=30000 deploy/kubernetes/proof/setup.test.mjs deploy/kubernetes/proof/expiry.test.mjs
uvx --from cfn-lint==1.59.0 cfn-lint deploy/kubernetes/proof/setup.yaml
```

The unprivileged `Kubernetes proof prerequisites` workflow runs those checks on
pull requests that change `deploy/kubernetes/proof/**` or the workflow itself,
and on every main push. This avoids asking unrelated older PR heads to run files
that they do not contain. It validates the fully rendered synthetic template
with its actual inline Lambda source. It requests no AWS session and has no recurring or manual
launch trigger. The Lambda test executes the rendered inline source with synthetic
SDK responses, including termination and volume deletion; it makes no claim about
a live AWS termination actor. The fixture uses made-up AMI and prefix-list IDs;
it is test input, not a discovered or qualified machine image.


The engine and rendered-Lambda checks exercise malformed-run isolation and both
independent lifetime caps, including missing times, restart times and the exact
expiry boundary. These are synthetic results. Actual EC2 time and ownership
semantics and both termination actors still need the bounded live drills.

Also qualify the launch statement's required network-interface resources, condition
keys for each EC2 resource type, the regional official image owner and the account's
Lambda concurrency quota. These are live/provider gates, with no current passing
claim. The launcher deny and disabled rule remain mandatory until they are resolved.

Before the owner can run setup, implement the one-entry `up`/`down` lifecycle,
conditional all-in setup/runtime reservations, official current prices and billing
reconciliation, protected main-only GitHub environment, immutable ARM/offline input
closure, and integration of the fixed local-deadline entry. Complete the real OIDC refusal and
both termination drills with exact actor and cleanup evidence. Preserve protection
and ownership records through partial setup or uncertain cleanup. Do not remove
the explicit launch deny, enable the rule or ask the owner to apply this template
until those dependencies are reviewed and their required gates pass. The live
drills must capture the SDK's actual pending/shutting-down/terminated shapes,
original interface time versus latest launch time, clock differences and disk
attachment state. A shutting-down row with missing origin still withholds health;
only an observed terminated row needs no surviving interface. The full P1
service/fault proof remains separate; see the
[implementation plan](../../../docs/superpowers/plans/2026-11-04-kubernetes-weekly-proof.md).

The template follows AWS's [conditional S3 write policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html),
[EC2 launch-template restrictions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ExamplePolicies_EC2.html),
[Lambda runtime contract](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)
and [CloudWatch log ARN shape](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-logs-loggroup.html).
These references informed the implementation; live qualification remains open.

AWS documents the [original and most recent instance launch times](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html#find-initial-launch-time)
and the volume's [creation timestamp](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_Volume.html).

## Prepare the first manual setup

For the first payload-free drills, `renderManualSetup` compiles the private setup
without a GitHub identity provider or launcher role. The owner approved using the
same temporary staging sign-in for those two drills on 6 November. Ordinary launch
admission stays closed, and the independent sweep starts disabled until the
lifecycle observes its actual health. The renderer does not apply the template or
launch a machine; the owner lifecycle and live qualification are still unfinished.

Before any manual action, you need a clean Cloud `main` checkout matching both
recorded and freshly read remote main. The new control preflight checks that
identity before reading the temporary staging session and current account bill.
It rechecks the checkout and UTC date around provider waits. A GitHub job,
foreign repository, account or region, root identity, permanent IAM user, stale
checkout or incomplete bill refuses. Billing observations round upward to whole
millionths of a dollar and retain AWS's estimated flag; they do not establish
reconciliation, reserve allowance or authorize a launch.

The CLI adapter uses fixed service endpoints, bounded output and a 30-second
process deadline. Cost Explorer uses its US East endpoint while the proof's
resource region remains Stockholm. The adapter permits only identity, billing,
setup discovery and reads of expiry protection. The `up`, `drill`, `reconcile`
and `down` entries still refuse
without making a provider call, because creation and cleanup are unfinished.
You do not need to sign in yet. Verify the preflight without credentials with
`node --test scripts/kubernetes-proof-control.test.mjs`.

`inspectManualSetup` connects those checks to the manual renderer. It reads
Amazon Linux's [public ARM image parameter](https://docs.aws.amazon.com/linux/al2023/ug/ec2.html),
then checks the image's actual owner and shape. It requires the regional
`m7g.2xlarge` response to report eight CPUs, 32 GiB and on-demand ARM support.
It discovers the AWS-owned IPv4 S3 network list for Stockholm rather than
accepting a pasted list. Missing, ambiguous or incomplete responses refuse.
The controller rechecks main and the UTC date around every provider read.
The resulting template still has no GitHub trust or launcher role. These checks
use synthetic provider responses; no regional image, account quota, machine boot
or resource creation has been qualified on AWS.

A stack name alone does not prove its expiry protection is working.
`inspectManualProtection` resolves the bucket, rule and function from the exact
stack's [CloudFormation resource inventory](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/describe-stack-resources.html).
It requires a completed setup, an enabled one-minute rule and exactly the
expected function target. It then reads the sweep's own heartbeat from that
bucket. Both the sweep and object must be less than two minutes old; foreign,
incomplete or contradictory observations refuse. Main and the UTC day are
checked around each read. A heartbeat records accepted cleanup requests, so you
still need separate live observations to establish termination and absent disks.

The [S3 read](https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object.html)
requests a bounded byte range with the staging account as expected bucket owner.
The CLI writes into a private temporary directory, checks the complete returned
range and length, and removes its own files on success or failure. The controller
requires encrypted JSON and retains the original sweep observation. These are
synthetic checks only; the lifecycle does not yet create or enable protection,
initialize a live ledger or authorize a launch.

The prerequisite workflow checks both rendered templates with the same pinned
CloudFormation validator. Its setup tests require every retained resource
reference to resolve and preserve the private launch and expiry configuration.

## Reserve cost before the next action

The reservation core in `scripts/kubernetes-proof-budget.mjs` records one active
run and each affected UTC month through the receipt-retention deadline. Every
write uses a create-only condition or the exact previously read S3 entity tag (ETag).
A second controller cannot take ownership. An identical retry keeps the original
head, tree, deadline and cost; it cannot extend them. Partial writes keep ownership
and their booked cost until an exact retry completes, so cancellation grants no
new allowance.

Amounts are integer millionths of a US dollar. Every affected month books the full
run bound, its reconciled baseline and its reserved protection overhead. A total
of US$10 or more refuses. This deliberately leaves a margin at the approved cap.
New higher baseline or overhead evidence refuses until a separate reconciliation
updates the opening; the core never silently keeps a smaller old estimate.

Confirmed machine termination, absent disks and interfaces, reconciled billing
and healthy expiry protection release the active slot. A confirmed cleanup of a
partial reservation first completes every original monthly booking, even after
the reservation deadline. They never refund its
monthly reservation. Original identities, cost-source evidence and cleanup facts
remain in the ledger. The active record carries a corruption checksum, and every
completion and active identity must correlate to its complete monthly bookings.
Every retry checks all remembered months. Missing, damaged, oversized or unrecognized history refuses;
runtime cannot recreate it. Initialization is restricted to an empty ledger and
can leave a protected, incomplete setup after a failed write.

Run the synthetic checks without credentials:

```sh
node --test scripts/kubernetes-proof-budget.test.mjs
```

These checks exercise the reservation engine and the conditional S3 adapter with
an isolated object-service substitute. They do not establish current prices,
current bills, real S3 behavior or a runnable setup. Trusted price and billing
acquisition must still build and verify the complete all-in bound, including
setup, retained data, idle protection, taxes and delayed cleanup. The core accepts
those reviewed inputs; a price URL and digest alone do not prove a price or an
upper bound. The launch controller must still verify cleanup and budget evidence
against AWS. Owner lifecycle, deadline-entry integration and live qualification
remain open. Admission stays closed.

The returned reservation is a ledger receipt, rather than a lasting machine-launch
permission. A final read requires unchanged active ownership after the ledger's
waits. The future launch controller still needs the current-owner and launch/cleanup
protocol; an S3 read does not make an EC2 action atomic with the ledger. Checksums
and source digests detect corruption and disagreement; they do not authenticate
provider facts. An exact repeated cleanup acknowledgement preserves the saved
facts and performs no further writes.

## Read the paid regional prices

You cannot reserve a cost from a historical quote or a shared free allowance.
`acquirePriceCatalogue` in `prices.mjs` reads the fixed public AWS regional
catalogue for EC2, Lambda, S3 or CloudWatch. You supply a `retain` callback that
saves the original bytes and their SHA-256 digest before the reader returns.
It requests no AWS session. HTTP requests refuse redirects and accept only AWS's
JSON or octet-stream content types, followed by strict JSON decoding;
one 30-second deadline bounds the request, body reads and retention wait.
The owned timer keeps the process alive until the operation settles. Rejected
cancellation and late responses cannot escape the caller's error handling.
Synchronous JSON processing cannot be interrupted, but elapsed-time readback
refuses evidence if that work exceeds the deadline.
The decoded body is limited to 320 MiB. Stockholm's EC2 catalogue was
270,696,312 bytes on 6 November. Larger bodies refuse until reviewed.

The reader requires the fixed Stockholm products, including ARM Lambda matching the
template, unrestricted paid USD terms,
the expected units and complete price tiers. It retains the highest tier rate as
an exact fraction, avoiding a floating-point rounding discount. It excludes
global free-tier entries and refuses missing or ambiguous products. Observation
must be on the same UTC day; the catalogue publication may be older.
UTF-8 decoding refuses malformed bytes, and duplicate object keys, including
escaped spellings of the same key, refuse rather than hiding a higher price.

Run `node --test deploy/kubernetes/proof/prices.test.mjs` for synthetic checks.
The reduced public-catalogue fixture supplies nine paid rates plus a global
free-tier and non-ARM distractors. It is test data, not a complete retained price source.
Decoded inputs and acquired inputs have distinct `kind` labels. Neither label is
an authenticated spending grant. Your trusted `retain` callback must save the
exact bytes durably; the reader's synthetic checks do not prove filesystem durability.
Fresh public-catalogue retrieval alone does not reconcile the service pricing
pages or your bill. Transfer, EventBridge, network, tax, contingency, request
quantities, retained data and idle protection still need the complete all-in
calculation and billing evidence. The lifecycle does not yet call this reader;
setup and admission remain closed.

## Fix the guest deadline before preparing inputs

A proof machine must retain its original shutdown time after a retry.
`renderDeadlineBootstrap` in `bootstrap.mjs` binds staging scope, stack, run,
head, tree and the original start/expiry into a self-contained Bash entry.
It emits at most EC2's 16 KiB raw user-data limit. It does not fetch inputs,
execute a candidate or obtain credentials. The future trusted launcher must
bind its reconciled reservation and verified IMDSv2 launch identity before
using this entry; the current setup still refuses execution.

The entry installs a UTC systemd timer and a second trigger measured from boot,
so moving the wall clock backwards cannot extend the first boot's interval.
The boot trigger is rounded down with a two-second margin. Uptime is read before
the wall clock, so a pause between them can shorten the interval without extending it. An enabled
reboot service requests poweroff before cloud-init on a later boot.
An exact retry checks the original boot, identity, clock and unit checksums
and active protection without restarting a timer. Missing or damaged state,
a changed reservation, an elapsed deadline or a failed installation withholds
the ready record and requests poweroff. Existing named system units and override directories are preserved; their presence refuses setup.
These include unit-specific, shared service/timer and prefix overrides in the
standard [unit load paths](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html).
The reboot service must report persistent [enablement](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html), not a static or transient state.
Interrupt, hangup and terminate signals request poweroff. Diagnostic and temporary-file
cleanup failures cannot suppress that request.

These are synthetic shell and command-boundary checks. The tests project only
OS paths and executable boundaries into an isolated directory; they do not run
a system service manager or terminate a machine. A ready line is an observation,
not an atomic release permission. The controller still needs fresh live deadline,
shutdown-to-terminate, independent sweep, budget and cleanup evidence before
releasing any payload. A crash before protection is installed still relies on
the independent sweep. Actual ARM boot ordering, timer behavior, suspension,
shutdown and termination remain live qualification gates.

Run the focused shell checks without root or AWS access:

```sh
node --test deploy/kubernetes/proof/bootstrap.test.mjs
```

The timer follows systemd's [wall-clock and monotonic timer semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).
Keep the [EC2 shutdown-to-terminate setting](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_ChangingInstanceInitiatedShutdownBehavior.html)
and independent sweep; requesting guest poweroff alone proves neither termination
nor an end to billing. Owner lifecycle, official cost evidence, complete offline
ARM inputs and the runnable sign-in handoff remain open in D570.
