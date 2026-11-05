# Nightly full CI

A narrow pull-request check can miss a dependency between two areas. You get a
full backstop each night through **Nightly full CI** in
[GitHub Actions](https://github.com/waitron-io/waitron-cloud/actions/workflows/nightly.yml).
It is scheduled for 03:17 UTC, away from the busy start of the hour. GitHub can
delay scheduled work; the configured time is not a completion guarantee.

The run calls standard CI, Cloud cost conformance, Venue service proof and
AWS infrastructure workflows from the same revision. It runs every package partition, compiler
and root check, all six standard receipt suites, the complete cost matrix and both
venue proof cases, plus all four AWS guard and plan cells. It always executes the full work, even when the source tree
has not changed since the previous successful night. The existing test commands,
assertions and time limits are unchanged.

You can start the same full run manually:

```sh
gh workflow run nightly.yml --ref main
gh run list --workflow nightly.yml --branch main --limit 5
```

Open the resulting run and its `nightly-summary`. It lists `standard`, `cost`, `venue` and
`aws` separately and requires all four to succeed. A failed, cancelled, skipped,
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
uncertain evidence retains full work. Cost and venue do not trigger on main pushes.
Read the [merge evidence checklist](ci-merge-evidence.md) before interpreting a
skipped job. The nightly run always executes full work and never grants reuse.
