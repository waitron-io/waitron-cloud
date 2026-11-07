# Run the first disposable machine

You need to know that a throwaway machine ends itself before you put a proof on
it. The manual controller runs one payload-free machine in the approved staging
account and Stockholm region. It keeps the full cost reservation and reports the
observed shutdown interval separately from the itemised account bill.

This is the [first-machine build](../../../docs/superpowers/plans/2026-11-06-kubernetes-manual-first-run.md).
It does not run P1, install application inputs or enable weekly automation. The
[later weekly plan](../../../docs/superpowers/plans/2026-11-04-kubernetes-weekly-proof.md)
still needs its own implementation and qualification. No live machine, provider
termination or final bill is qualified by the synthetic checks below.

## First sitting: setup and one drill

Use your temporary staging-project sign-in. Run the command from clean reviewed
Cloud `main`, matching GitHub's current main. The controller refuses a feature
checkout, a GitHub job, the wrong account or region, root and permanent IAM-user
identities. Each command checks remote main at entry and before state-changing
AWS calls; local source and clean-checkout checks surround every provider call.
It checks the official ARM image and the approved machine's capacity
before creating anything. If a command refuses, its message names the validation
step, for example `D570 controller refused: ce billing shape`. Keep the private files
for removal and report the named step; do not edit the files to bypass it. You can read the command shape without signing in:

```sh
node scripts/kubernetes-proof-control.mjs --help
```

Create one private directory outside the checkout. Keep it for both sittings,
including after removal, because it holds your original booking and observations.

```sh
cd ~/workspace/repos/waitron-cloud
git pull --ff-only
mkdir -m 700 -p "$HOME/.local/state/waitron-d570"
node scripts/kubernetes-proof-control.mjs up "$HOME/.local/state/waitron-d570"
```

If the account already has charges this month, `up` prints each service, usage
type and amount and refuses before writing a booking. Explain those charges and
rerun with one `--explain` for each printed row. Amounts are integer millionths
of a US dollar: `10000` means US$0.01. This example is synthetic; use the service,
usage type, ceiling and reason that match your actual list:

```sh
node scripts/kubernetes-proof-control.mjs up "$HOME/.local/state/waitron-d570" \
  --explain 'Amazon Simple Storage Service' 'EUN1-TimedStorage-ByteHrs' \
  10000 'Existing staging backup'
```

Duplicate explanations, unused rows and charges above their explained ceilings
refuse. The cap uses observed charges, so a larger explained ceiling never grants
more room. A credit bill still refuses and shows its observed aggregate; credits
never become a zero opening or increase allowance. Save the printed service,
amount and reason list for the watcher and the owner. The successful response also shows the opening, reserved upper cost
and remaining headroom. Opening plus reservation must stay strictly below US$10.

`up` acquires the four public AWS price files, saves their original bytes, books
the fixed upper cost, creates `d570-first`, enables its expiry sweep, reads its
fresh heartbeat and initializes the existing ledger. It launches no guest. Its
source is `scripts/kubernetes-proof-control.mjs`; the synthetic checks are
`node --test --test-name-pattern='^owner command up|^explained opening' scripts/kubernetes-proof-control.test.mjs`.

Start the single drill from the same reviewed head and UTC day:

```sh
node scripts/kubernetes-proof-control.mjs drill "$HOME/.local/state/waitron-d570"
```

The command books compute and disk before the launch request. The guest has a
three-minute shutdown deadline; the independent sweep retains the five-minute
outer expiry. The command waits for its ready console line while running, then
requires a running request at T+170 or later and OS termination received before
T+300. Disk and interface absence are checked separately. The response reports
when those observations arrived, not the exact physical poweroff time.

Private `launch.json`, `ready.json`, `shutdown.json` and `cleanup.json` keep the
observations. A lost reply or failed drill retains its booking and cannot start
a second first drill. Use `down` after a failure; do not erase files or try another
setup directory to regain allowance. The connected synthetic check is
`node --test --test-name-pattern='^owner command drill' scripts/kubernetes-proof-control.test.mjs`.

## Later sitting: read the account bill and remove setup

Use clean current `main` and the same private directory. An unrelated main merge
between sittings does not invalidate the retained run: the command matches its
saved head and tree to the ledger.

```sh
node scripts/kubernetes-proof-control.mjs reconcile "$HOME/.local/state/waitron-d570"
node scripts/kubernetes-proof-control.mjs down "$HOME/.local/state/waitron-d570"
```

`reconcile` reports the account bill by month, service and usage type. It keeps
AWS's estimated flag; a current-month estimate is not a final bill. Account totals
include setup and other services, so the command never labels them as this guest's
cost or refunds the reservation. Future months were booked with a zero opening,
rather than copying this month's previous charges. Run
`node --test --test-name-pattern='^first billing|^later billing' scripts/kubernetes-proof-control.test.mjs`
for the synthetic billing and saved-identity checks.

`down` checks the owned subnet for live instances and interfaces and the exact
stack's tags for disks. This check also works after missing readiness, a lost
launch reply or an expiry-sweep termination. It does not require a new bill or
opening explanation. It preserves available ledger bytes and the original setup
booking privately, including an incomplete initialization. It then disables the
sweep, waits its two-minute function timeout, empties only known proof objects
and waits for the exact stack's deletion to complete. A partial deletion can be
retried using the retained private export. Unknown ownership, remaining resources
or an export failure refuses removal. Run
`node --test --test-name-pattern='^first removal|^owner command down' scripts/kubernetes-proof-control.test.mjs`
for those synthetic checks. Keep the private history after a successful removal;
this first build does not implement another `up` or history import.

## What remains to qualify

The fixed profile reserves 20 minutes of compute, one day of 64 GiB disk,
31 days of 16 MiB storage, 133,920 writes and Lambda requests, 5,000 reads,
a 128 MiB function running continuously for 31 days, 1 GiB of log ingestion and
four days of log storage. Transfer, events and network each reserve US$0.10;
tax reserves US$2 and contingency US$1. These are reviewed conservative
assumptions, not measured account consumption. The price reader uses paid
Stockholm rates without shared free tiers. The body limit rises from 256 to 320 MiB to fit the acquired Stockholm catalogue.
The 30-second acquisition deadline stays fixed.

`setup.mjs` remains a renderer and refuses direct `up`/`down` execution. The
ordinary template's launcher deny and disabled sweep stay in place; the manual
renderer omits the launcher role and GitHub trust. It preserves private networking,
no public IP or inbound internet, no guest credentials, disk deletion on shutdown
and independent expiry. Only the controller enables its own discovered sweep.
A heartbeat records accepted cleanup requests; it never substitutes for actual
termination or absent resources.

The installed CLI's new forms have been exercised against an unsigned loopback
server, not AWS. Live ARM boot, systemd behavior, provider ownership and quota
semantics, actual shutdown and deletion, the bill and complete cost assumptions
still need the owner sitting. The independent kernel-hang drill, offline ARM
inputs, full P1 service/fault proof and weekly access remain outside this build.

The prerequisite workflow runs the named unit files and validates both rendered
templates with pinned cfn-lint. For focused local checks, name files explicitly:

```sh
node --test scripts/kubernetes-proof-control.test.mjs scripts/kubernetes-proof-budget.test.mjs
node --test deploy/kubernetes/proof/setup.test.mjs deploy/kubernetes/proof/expiry.test.mjs \
  deploy/kubernetes/proof/bootstrap.test.mjs deploy/kubernetes/proof/prices.test.mjs \
  deploy/kubernetes/proof/workflow.test.mjs
```

Provider references: [CloudFormation deletion](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/delete-stack.html),
[S3 object deletion](https://docs.aws.amazon.com/cli/latest/reference/s3api/delete-objects.html),
[rule disablement](https://docs.aws.amazon.com/cli/latest/reference/events/disable-rule.html),
[EC2 shutdown behavior](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_ChangingInstanceInitiatedShutdownBehavior.html)
and [systemd timers](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).
