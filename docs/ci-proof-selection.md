# Select the separate proof workflows

## Remaining CI work measured on 9 November 2026 (D613)

Ordinary code changes still occupy many machines. Start with root-test selection:
the registration and portal examples below each ran about 25 job-minutes of root
tests. Package selection alone does not remove those jobs. The owner asked for
root checks to follow their actual inputs first, then a measured proposal for
splitting registration by area. At that measurement, those cuts were proposed.

**10 November update:** the first cut omits nine audited synthetic root suites
inside selected package-only PR commands, with the original full command as
fallback. The live-reader suite stays. See [root advice](ci-root-input-ownership.md#package-only-root-advice-10-november-2026).
The unchanged nine-file local profile attributed 22.194 of 619.851 sampled
seconds to Git initialisation/configuration and 13.240 to other non-child work;
fixture setup was a much smaller opportunity than omitting the complete suites.
That shared-Mac profile does not measure hosted job-minute savings. The historical
table below remains unchanged; the new cut needs a healthy natural eligible PR.
Receipt selection and the registration-area model remain open.

| Current example | Largest work | Does this change need it? | Next cut to assess |
| --- | --- | --- | --- |
| [Prose PR #1110](https://github.com/waitron-io/waitron-cloud/pull/1110) | General planner 18 seconds, documentation 13, general summary 12; venue planner and summary add 23 seconds. | Documentation and final checks are needed; venue planning selected no proof. | No substantial remaining path demonstrated in this example. |
| [Registration PR #1121](https://github.com/waitron-io/waitron-cloud/actions/runs/42639938693) | Eight root jobs total 24.63 minutes; six registration jobs 24.38; receipts 6.15. Slowest registration job is 5.53 minutes. | Registration tests are needed. Running every root test is a broad current policy, not proof each reads these billing files. Receipt selection explicitly retained all suites while qualifying package readers. | Select root tests by their real readers. Model registration areas from file times and recent changes before moving code. Review the receipt fallback separately. |
| [Portal PR #1122](https://github.com/waitron-io/waitron-cloud/actions/runs/42652536547) | Eight root jobs total 25.10 minutes; six portal jobs 19.90; receipts 6.35. Slowest portal job is 4.75 minutes. | Portal tests cover the changed passkey behavior. The root and receipt selections have the same broad policies as registration. | Apply the root-reader selection. Trace the portal receipt inputs before omitting unrelated proofs; profile the slow portal partition if it remains material. |
| [Prose merge](https://github.com/waitron-io/waitron-cloud/actions/runs/42512021251) | Planner 22 seconds, summary 18. | They verify reuse of the identical PR tree. | No substantial remaining path demonstrated; no fresh product tests ran. |
| [Registration merge](https://github.com/waitron-io/waitron-cloud/actions/runs/42641673180) | Registration 26.85 minutes; root 24.38; portal 18.33; backups 14.13; account HTTP 11.40; receipts 6.60. | The merge tree differs from its PR tree. The current main-range policy tests changed packages and direct consumers; PR evidence cannot simply replace it. | Apply root-reader selection to the actual main range only after proving its readers. Model registration areas. Any proposal to reduce dependent tests on main needs a separate owner decision. |
| [Portal merge](https://github.com/waitron-io/waitron-cloud/actions/runs/42654462815) | Planner 28 seconds, summary 27. | They verify reuse of the identical PR tree. | No substantial remaining path demonstrated; no fresh product tests ran. |

The receipts job runs six distinct command groups. On the registration and
portal PRs, `test:cloud-cost` takes 340.831 and 352.079 seconds; `test:local-stack`
takes 180.453 and 184.733 seconds. These commands overlap inside that job, so
their times cannot be added as a possible job saving. They exercise cost tooling
and composed local services, beyond the package's own test command. Removing
the separate cost-conformance PR workflow did not remove `test:cloud-cost` from
ordinary CI. The owner wants cost checks weekly; propose that scheduling change
and review which other receipt inputs these two PRs actually change.

Root and package test commands account for most of the long jobs. For example,
registration's slowest job spends 313 of 332 seconds in its test wrapper;
portal's spends 254 of 285. Fewer jobs could avoid repeated setup, but merely
combining partitions cannot establish a large reduction in test work. Keep
the assertions and limits, and measure the proposed allocation first.

### Before and after examples

A job-minute is one job's elapsed minute, including its setup and cleanup.
The totals sum all non-skipped jobs in the exact final attempts, excluding queue
time. They describe machine occupancy, not the time a person waits or a bill.

| Kind | Before PR | After PR | Before merge | After merge |
| --- | ---: | ---: | ---: | ---: |
| Prose, [#1091](https://github.com/waitron-io/waitron-cloud/pull/1091) / [#1110](https://github.com/waitron-io/waitron-cloud/pull/1110) | 44.32 | 1.10 | 62.48 | 0.67 |
| Registration, [#1083](https://github.com/waitron-io/waitron-cloud/pull/1083) / [#1121](https://github.com/waitron-io/waitron-cloud/pull/1121) | 203.47 | 56.67 | 171.98 | 113.73 |
| Portal, [#1067](https://github.com/waitron-io/waitron-cloud/pull/1067) / [#1122](https://github.com/waitron-io/waitron-cloud/pull/1122) | 96.32 | 52.83 | 105.67 | 0.92 |

These are natural changes with matching workspace owners, different fixes and
test workloads. Main ranges and merge topology also differ. The after prose
and portal merges reused their checked PR trees and ran zero fresh product
checks; both historical readback commands passed. Do not interpret the table
as an isolated causal saving or a fleetwide percentage.

The checked runs have no overlap with relevant published GitHub incidents,
checkout takes at most nine seconds, and retained log scans found no external
download HTTP 5xx. The per-run inventories, log classifications, source links
and successful historical reuse readbacks are retained in Lane I's
`receipts/d613-merge-measurement-20261109/` and Lane G's
`receipts/d613/measurement-20261109/`. The rejected 4 November aggregate is unused.
The watcher accepted these three measurement categories on 9 November at 21:22;
the owner's later instruction keeps the work open for the proposed code-PR cuts.
Check infrastructure and cost-input PRs as they arrive naturally for more slow
paths, without making PRs or rerunning workflows just to obtain measurements.

## Current proof selection

Pull requests start a small venue-proof planner and run its test job only when
reviewed inputs change. Cost conformance runs through manual invocation and the
nightly backstop, so backend edits no longer start that separate PR workflow.
The ordinary CI workflow keeps its own package and receipt selection.

You can run either complete proof manually with **Run workflow** in GitHub Actions.
Automatic main-push runs are removed. The [nightly full run](ci-nightly.md)
executes both complete matrices, even when called from an unrelated pull request.
Manual full runs remain available. The standard main workflow independently verifies reuse or selects its changed
range. Follow the [merge evidence checklist](ci-merge-evidence.md); its inherited
counts do not count as newly executed proof work.

## Cost conformance inputs

Cost preparation builds pinned Waitron releases, creates generated data and
loads Cloud mail, account and remote-access code. Its account-server imports
cross backend package boundaries. The conservative inventory includes all seven backend
packages' source and migration directories, plus their shared test helpers and
data files. Ordinary package files ending in `.test.ts`, `.test.mjs` and their
JavaScript variants do not select this separate rehearsal matrix.

The remaining inputs are:

- Everything under `scripts/cloud-cost/`, including fixture discovery, fonts,
  Docker recipes and pinned release preparation.
- Everything under `deploy/local-remote/`; its gateway image copies
  `packages/remote-access/src`.
- `docs/cost-model/`, `docs/cloud-cost-model.md` and the generated calculator.
- Root configuration, every workspace manifest, the PostgreSQL harness and
  pnpm bootstrap and diagnostic programs.
- The cost workflow and the shared proof planner.

The broad backend ownership is deliberate: this part does not prove individual
source files irrelevant to the account server. These cost selectors remain for
reading historical PR and merge evidence; they do not start a current PR workflow.
Manual and nightly invocations run the complete cost matrix. The pinned Waitron
checkout remains a separate input to its Cloud preparation program.

## Venue proof inputs

The venue matrix checks the composition of the venue suites.
Its own wrappers, `scripts/fixtures/service-proof.ts`, `scripts/test-cloud-*`,
`scripts/venue-service-*` and `deploy/test-cloud/` select it. So do the package
`venue-service-*` test files and the selector's named package tests. That list
still includes former receipt inputs, whose package CI remains in place. Shared backend test helpers
and fixture data, installation inputs, the workflow and planner also select it. This includes the registration venue-service
fixture, backup verification helpers and fake translation provider. The imported
`deploy/local-stack/{runtime,lease,bootstrap}.mjs` helpers and
`deploy/backup-verifier/target.json` also select venue.

Other product-source edits use package CI without repeating this composition
proof on every PR. A complete manual run remains available, and the
nightly run exercises every suite regardless of the changed paths.

## Review and verify the boundary

Generated review records and their writers have been removed. Former record
paths have the same conservative behavior as other unknown root inputs: they
select both proof jobs. The [documentation guide](ci-documentation-audit.md)
explains the accepted change from renewal gates to ordinary reader review.

You maintain the reviewed input list in `scripts/ci-proof-inputs.mjs`. When you
change a proof reader or add an import, helper, fixture or file read, follow that
input and update its ownership here and in the selector. Broad directory rules
include new files within their existing boundary. New packages, unfamiliar
root areas and unclassified scripts keep both proofs until you review them.
Root Markdown is unrelated prose for these proof readers. New readers must be
reviewed with their real ownership tests; no record regeneration discovers them.
New directories inside known `docs/`, `deploy/`, workspace or workflow areas
use their declared ownership rather than the unknown-root fallback. Review a new
reader before relying on that boundary. The fallback also retains all root-script changes, including the other proof
workflow's script tree. That conservative extra work remains a limit of this
part. This is a declared input boundary, not a general JavaScript dependency
resolver.

The planner compares the common ancestor of the PR base and head with the exact
checked-out head. It uses immutable Git paths, including both sides of a rename,
so local edits and unrelated advances on main cannot change the result. Missing
history, invalid revisions, a different checkout, an empty diff or malformed
paths retain full work. Manual and scheduled events also retain full work.

Run the controls with:

```sh
node --test scripts/ci-proof-inputs.test.mjs
```

They execute the real workflow planner against disposable Git histories. Positive
controls edit cost readers, migrations, gateway inputs, venue proof code and
installation inputs; negative controls edit portal code and unrelated package
tests. Further controls cover deletion, renaming, advanced main, missing history,
the PR merge environment and workflow-specific selection. These are local
selection receipts. GitHub job counts and timings must be measured separately.

The retired pre-venue receipt no longer runs. Its package suites keep their
package and local-stack checks, and the free-services command remains available.
The current venue receipt keeps its cases, assertions, time limits and command. The lightweight planner and summary have read access to Actions
and pull-request metadata so they can verify attempt-bound evidence. A skipped matrix means it was not selected. It does not
prove those tests passed on that revision.

An older selected venue PR can fail with `Incomplete native job inventory`
after this matrix change. Rebase that branch onto main so its strict summary
expects the current venue receipt. Unselected older branches keep their skipped
matrix placeholder; no compatibility code is added.

Kubernetes proof files and flat `scripts/kubernetes-proof-*` files have their
own workflow. Proof-only edits, with regular prose, use the existing script job
for module syntax and workflow controls. Mixed package edits keep their package
owners. Attributes, unknown inputs and failed ownership checks keep full work
in the main CI workflow. The separate proofs omit this family independently.
Read every separate Kubernetes result before merging; the required `summary`
check does not certify it. Workflow-only edits omit the generic pnpm-bootstrap
PR test; the full nightly still runs it.
