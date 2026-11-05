# Nightly full CI

A narrow pull-request check can miss a dependency between two areas. You get a
full backstop each night through **Nightly full CI** in
[GitHub Actions](https://github.com/waitron-io/waitron-cloud/actions/workflows/nightly.yml).
It is scheduled for 03:17 UTC, away from the busy start of the hour. GitHub can
delay scheduled work; the configured time is not a completion guarantee.

The run calls the existing standard CI, Cloud cost conformance and Venue service
proof workflows from the same revision. It runs every package partition, compiler
and root check, all six standard receipt suites, the complete cost matrix and both
venue proof cases. It always executes the full work, even when the source tree
has not changed since the previous successful night. The existing test commands,
assertions and time limits are unchanged.

You can start the same full run manually:

```sh
gh workflow run nightly.yml --ref main
gh run list --workflow nightly.yml --branch main --limit 5
```

Open the resulting run and its `nightly-summary`. It lists `standard`, `cost` and
`venue` separately and requires all three to succeed. A failed, cancelled, skipped,
missing or unfinished family cannot pass. The standard workflow still checks
its own actual job records, including every planned partition and receipt. Its
job names have the `standard / ` prefix inside this combined run; other families
are checked by their reusable workflow results and the final summary.

At the start of a campaign firing, inspect the latest **scheduled or manual main**
run, its source SHA and all of its jobs. A missing night or an unfinished run is
not a successful backstop. Record a red run and its failed step in the lane's
questions and progress files. Follow the shared campaign CI failure rule: inspect
the failure and its history, then fix its cause or record the existing owning
item before considering a retry. A passing retry does not prove a repair.
GitHub's normal workflow failure notifications and the Actions page remain the
notification channels; this change adds no external messaging or paging service.

When this workflow's own file changes in a pull request, GitHub runs the complete
nightly workflow as a rehearsal. This proves the real reusable calls and nested
job-name boundary before the wiring lands. Ordinary package and prose PRs do not
start that extra rehearsal. Manual branch runs are also possible, but do not
qualify `main`'s nightly backstop. PR rehearsals can supersede older rehearsals;
scheduled and manual runs each have their own concurrency group. The called
workflows use distinct groups, so they do not cancel the parent's standalone CI.

The standard main-push workflow still runs its complete suite in this slice.
D571 part 5 will separately restore verified equal-tree reuse and changed-path
selection for other merges. Cost and venue main-push removal belongs to part 4,
which must land after this nightly backstop. Until those parts land, their
current push policies remain in force. Read the merge's actual workflows; the
nightly run is additional coverage, not permission to skip current landing gates.
