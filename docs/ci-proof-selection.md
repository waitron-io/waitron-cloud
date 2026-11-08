# Select the separate proof workflows

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
