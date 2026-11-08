# Nightly full CI

A narrow pull-request check can miss a dependency between two areas. You get a
full backstop each night through **Nightly full CI** in
[GitHub Actions](https://github.com/waitron-io/waitron-cloud/actions/workflows/nightly.yml).
It is scheduled for 03:17 UTC, away from the busy start of the hour. GitHub can
delay scheduled work; the configured time is not a completion guarantee.

The run calls standard CI, Cloud cost conformance, Venue service proof and
AWS infrastructure workflows from the same revision. It runs every package partition, compiler
and root check, all six standard receipt suites, the complete cost matrix and the
venue receipt, plus all four AWS guard and plan cells. It always executes the full work, even when the source tree
has not changed since the previous successful night. The selected product assertions and time limits stay in force.

A separate `nightly-mutations` job retains the two remote-wait checks, billing
qualification and the complete allowance checks, including the rendered gateway.
These checks deliberately remove protections in disposable copies. Ordinary pull
requests run the underlying behavior tests with required-case receipts instead.
The same job runs the 32-case Linux download-contention check and the password
and relay deliberate faults, retaining their diagnostic logs on failure. These
fault programs run nightly, while their underlying behavior tests stay in normal
PR checks.
Kubernetes prerequisites are separate: only changes matching their PR/main-push
paths start them. They have no scheduled or manual trigger, so this nightly
backstop does not check their external tool dependencies for drift.

You can start the same full run manually:

```sh
gh workflow run nightly.yml --ref main
gh run list --workflow nightly.yml --branch main --limit 5
```

Open the resulting run and its `nightly-summary`. It lists `standard`, `cost`, `venue` and
`aws`, plus `mutations`, separately and requires all five to succeed. A failed, cancelled, skipped,
missing or unfinished family cannot pass. The standard workflow still checks
its own actual job records, including every planned partition and receipt. Its
job names have the `standard / ` prefix inside this combined run. Cost, venue
and AWS use their corresponding prefixes and independently verify their native
job inventories before the parent checks every family result.

At the start of a campaign firing, inspect the latest **scheduled or manual main**
run, its source SHA and all of its jobs. A missing night or an unfinished run is
not a successful backstop. Record a red run and its failed step in the lane's
questions and progress files. Follow the shared campaign CI failure rule: inspect
the failure and its history, then fix its cause or record the existing owning
item before considering a retry. A passing retry does not prove a repair.
Use the Actions page as the source of the result. Delivery of GitHub's normal
failure notifications depends on your settings and has not been qualified by
this change. No external messaging or paging service is added.

When this workflow's own file changes in a pull request, GitHub runs the complete
nightly workflow as a rehearsal. This proves the real reusable calls and nested
job-name boundary before the wiring lands. Ordinary package and prose PRs do not
start that extra rehearsal. Configuration guards check the reusable input and
summary connections; a CLI control exercises the configured prefix. Those checks
do not prove GitHub expression evaluation or scheduling. Manual branch runs are
also possible, but do not
qualify `main`'s nightly backstop. PR rehearsals can supersede older rehearsals;
scheduled and manual runs each have their own concurrency group. The called
workflows use distinct groups, so they do not cancel the parent's standalone CI.

Standard CI and AWS can reuse independently verified identical-tree PR evidence
on main pushes. Other valid pushes select checks from their actual changed range;
uncertain evidence retains full work. AWS starts only for its infrastructure and
bootstrap inputs. Cost has no PR trigger; cost and venue have no main-push trigger.
Read the [merge evidence checklist](ci-merge-evidence.md) before interpreting a
skipped job. The nightly run always executes full work and never grants reuse.

## Generated storage warning

A passing nightly can still hide a large change in storage use. Open the run's
Summary page and read **Cloud cost advisory**, from the `storage-advisory` job.
It compares the generated replay with the last usable main measurement for the
same workload, cadence and configured windows. Runtime upgrades stay visible
in the report and do not suppress the comparison.

You see a range in byte-seconds: one byte kept for one second. The range includes
stream storage and its cleanup tail. A warning requires the entire new range
to exceed double the previous range, or fall below half of it. Overlapping ranges
do not establish that change. For example, a previous range of `[100, 110]` and
a new range of `[230, 240]` establish an increase of at least 2.09 times. The
warning names both runs so you can inspect what changed. Repeated smaller
increases can go unnoticed because the comparison uses the last usable run.

Missing or unreadable measurements remain visible. You get a warning when the
last usable measurement is older than 72 hours, or no usable baseline exists in
the retained 14-day history. Pull-request rehearsals report their current
measurement without entering main history. Read the first main nightlies before
treating the local Debian spread as hosted-runner variation.
When a partial rerun keeps an earlier export, the report links its original
attempt and keeps its timestamp. Rerunning other jobs does not make that
measurement fresh.

This measures generated storage only. Requests, compute, transfer, archives and
other service costs remain unknown; the report contains no dollar estimate.
The warning has its own summary and Actions annotation. It does not join the
five required workflow families or block a pull request or merge. Run
`node --test scripts/ci-nightly-storage.test.mjs scripts/ci-workflow.test.mjs`
for its comparison and wiring checks. Inspect the real nightly rehearsal to
check artifact delivery.

## Verified manual run

The [6 November manual run 42165813178](https://github.com/waitron-io/waitron-cloud/actions/runs/42165813178),
attempt 2, qualifies the full backstop at commit
`9237200a0023a3b19c76b9447717f36ddcb430f1`, tree
`8ccc8207d7d2e07fb96d808582bda2da3171e339`. Its 77 final jobs include
75 successes and two deliberate skips. Every checkout, full plan, family
summary and the parent summary was checked. It runs all 29 package allocations,
eight root partitions, compiler checks, six receipt suites, 21 cost cells, both
venue cases and four AWS cells, with reuse disabled.

The result reports 21,072 Node passes and 26 optional skips, plus 384 mocked
OpenTofu cases counted separately. Attempt 1 fails the native stream LIST
shutdown check in `stack-conformance.test.mjs`. Its counters agree on attempts
and bytes but disagree on outcomes after an interrupted response. D530 retains
that recurring failure and its unresolved cause. The failed-only retry runs
14 cost checks and two summaries; 21,058 reported passes retain their original
execution times and byte-identical logs. The passing retry qualifies this
revision's acceptance and does not establish a LIST repair.

You still need a scheduled run to verify schedule delivery. The 03:17 UTC run
did not appear that morning; the qualified run was dispatched manually at
05:00 UTC. This receipt also leaves aggregate usage savings open: the original
4 November measurement window overlaps published
[Git Operations](https://www.githubstatus.com/incidents/smtdswd1h2w4) and
[Actions](https://www.githubstatus.com/incidents/xr3myzj7ms51) incidents. Compare
busy periods that avoid relevant incidents, have no failed HTTP 5xx downloads
and keep every checkout step under about ten seconds before judging savings.

## Verified scheduled run

The [6 November scheduled run](https://github.com/waitron-io/waitron-cloud/actions/runs/42206360042)
ran on main `ef230096fbc9073e4c20109dc214038491864966`, attempt 1. All 77 jobs
finished: 75 successful exact checkouts and two planned skips. Independent readback
checked all five summaries, 21,348 Node passes, 26 optional skips and 384 mocked
OpenTofu cases. Its one expected failing child is covered by its passing cleanup
control. This qualifies that earlier code and verifies schedule delivery.

The [7 November full manual run](https://github.com/waitron-io/waitron-cloud/actions/runs/42350915402)
ran after record disconnection on main `9b81ee6b4c3a0e355f60f5160870ba0af6be0266`,
attempt 1. All 78 jobs finished: 76 successful exact checkouts, two planned skips,
23,108 Node passes, 26 optional skips and 384 mocked OpenTofu cases. All five
summaries passed; the expected failing child had its passing cleanup control.
Alongside the later ordinary narrowing PR [#1057](https://github.com/waitron-io/waitron-cloud/pull/1057),
this meets the owner's prerequisites for removing the inert records.
