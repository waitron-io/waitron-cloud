# Package changes in CI

A dependency cycle can make a small pull request run nearly every package.
Your pull request now tests only the packages whose directories changed.
A source file, shared test fixture or package README selects its own package;
several changed packages each run their own tests. The existing typecheck command
still checks the whole workspace, including dependents.

This trades earlier behavioural coverage for less PR work: a change that breaks
a dependent package's behaviour while keeping its types valid is caught at the
next [full nightly](ci-nightly.md). Manual full runs also retain all packages.

When a main push needs fresh tests, package changes keep the previous selection policy: changed packages and one level
of their consumers, using both saved revisions. A selected consumer does not
select another level. Changes entirely inside a package's `test/` directory
retain actual readers of those files, rather than every manifest dependent.
The default saved-range selector keeps this policy too. Source-plan reconstruction
uses the original PR policy; merge reuse checks its tree, source and jobs and
skips repeated package work only when that evidence qualifies.

Package selection does not narrow receipt checks. The planner retains the
original dependency scope from both saved revisions and independent receipt
audits. A refused reader audit keeps all package owners in the receipt scope,
while PR tests still select only changed packages. Unknown paths and shared
configuration retain full work. Lockfile audits keep their existing rules.

Ordinary root/docs Markdown can accompany code without widening package work.
On PRs, consumed documents instead select their [named checks](ci-root-input-ownership.md);
default and main-push ranges keep them full.
Links, executable Markdown and checkout attributes retain full work.

## What the measurement establishes

The sample is the last 50 first-parent squash merges through
[`be28f5d6`](https://github.com/waitron-io/waitron-cloud/commit/be28f5d6e2d25f6617f29856ddae1fc20f342f65),
ending with #949 and starting with #891. Each applied diff was replayed as a pull
request against both saved revisions, using the same current workspace.
These are package-job counts, not total jobs, test counts or measured durations.

| Replay | Previous selection | One-level selection |
| --- | ---: | ---: |
| Complete planner, preserving every audit refusal | 980 | 980 |
| Package-selection projection, excluding prose and audit metadata | 410 | 338 |

The complete planner saved no jobs in this historical sample. At that revision,
audit and reader refusals retained full work. Generated review records and their writers have been
[removed](ci-documentation-audit.md#review-readers-instead-of-renewing-records).
The projection isolated package selection; it did not prove exemptions or a CI saving. Only four projected
diffs change: #943, 28 to 5; #939, 28 to 1; #930, 28 to 27; and #918, 28 to 7.
The other 46 retain their projected counts. D571's reader-boundary and shared-path
work must establish the remaining exemptions independently.

At the measured `be28f5d6` workspace, a registration source change still selects 27 package
jobs rather than 28. Its consumers really are broad. An unshared registration
test selects its five existing partitions. These historical counts describe the earlier PR policy, retained for main
pushes; current PR source changes run only registration's own partitions.

After the sixth registration partition lands, the same registration source
change selects 28 jobs from the full plan's 29. An unshared registration test
selects all six registration partitions. The historical sample above keeps
its original five-partition counts.
