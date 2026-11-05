# Package changes in CI

A backend dependency cycle can make a small pull request run nearly every
package. For a package change, CI selects the changed package and one level of
its consumers: packages that declare it as a dependency or read its files.
A selected consumer does not select another level. Two changed packages each
contribute their own consumers.

Changes entirely inside a package's `test/` directory select that package.
Another package still runs when its saved sources refer to a changed test file,
including a test exposed through package exports. A manifest dependency alone
does not mean that a package imports another package's tests. File references,
extension substitutions, templates and directory reads retain possible readers.
This can deliberately select more than one package for a shared fixture.
Stored directories, composed paths and configuration references count too.
If your package's source exposes its own tests, its direct consumers still run.
The planner builds each reader index once, rather than scanning source text
again for every changed test file.

The planner checks both saved Git revisions. Removing an import, changing an
export or editing a local checkout cannot erase a consumer from either revision.
Missing or invalid saved-tree evidence retains conservative work. Unknown paths and shared
configuration still select the full suite. Audited lockfile selection keeps its
existing rule of following every dependency level.

This changes package selection only. Receipts use the original dependency scope
from both revisions, so a narrower package list cannot omit them. Compiler checks
and all deadlines stay in force. Main pushes still run the full suite;
verified merge reuse and the nightly full run are separate D571 changes.

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

The complete planner saves no jobs in this sample. Existing audit and reader
refusals retain full work. The projection isolates this change's potential effect;
it does not prove those exemptions or claim a CI saving. Only four projected
diffs change: #943, 28 to 5; #939, 28 to 1; #930, 28 to 27; and #918, 28 to 7.
The other 46 retain their projected counts. D571's reader-boundary and shared-path
work must establish the remaining exemptions independently.

At the measured `be28f5d6` workspace, a registration source change still selects 27 package
jobs rather than 28. Its consumers really are broad. An unshared registration
test selects its five existing partitions. Do not narrow registration source
selection further without measuring which files its consumers read.
