# Select the separate proof workflows

A portal edit should not repeat the backend cost rehearsals or the venue service
matrix. Each pull request still starts a small planner in the two separate
workflows. It runs their test jobs only when their reviewed inputs change.
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
source files irrelevant to the account server. A backend source edit still runs
cost conformance. A portal edit or an ordinary unrelated package-test edit does
not. The pinned Waitron checkout is a separate input: changing the pinned release
changes its Cloud preparation program and selects the rehearsals.

## Venue proof inputs

The venue matrix checks the composition of its existing legacy and venue suites.
Its own wrappers, `scripts/fixtures/service-proof.ts`, `scripts/test-cloud-*`,
`scripts/venue-service-*` and `deploy/test-cloud/` select it. So do the package
`venue-service-*` test files and both suite matrices' explicitly listed package
tests, including translation's `worker-cli` case. Shared backend test helpers
and fixture data, installation inputs, the workflow and planner also select it. This includes the registration venue-service
fixture, backup verification helpers and fake translation provider. The imported
`deploy/local-stack/{runtime,lease,bootstrap}.mjs` helpers and
`deploy/backup-verifier/target.json` also select venue.

Other product-source edits use package CI without repeating this composition
proof on every PR. A complete manual run remains available, and the
nightly run exercises every suite regardless of the changed paths.

## Review and verify the boundary

When you renew [root-input review](ci-root-input-ownership.md), its records alone
do not select a proof matrix. Both saved root reviews and documentation
authorities must qualify first, with an unchanged registry and checker. A stale,
forged or removed record keeps proof work. Every other changed path still uses
the rules below, so a valid renewal cannot hide a real proof input.

You maintain the reviewed input list in `scripts/ci-proof-inputs.mjs`. When you
change a proof reader or add an import, helper, fixture or file read, follow that
input and update its ownership here and in the selector. Broad directory rules
include new files within their existing boundary. New packages, unfamiliar
root areas and unclassified scripts keep both proofs until you review them.
With v2, accompanying audit records count as evidence only after the saved head's
documentation records verify. Unused identity, gateway and lock shortcuts can
remain stale; the proof selector never uses their authority. Damaged metadata,
a changed frozen v1 policy or stale documentation records keep full proof work.
Historical v1 renewals still require all four inventories. This keeps required
record renewal from waking both matrices for unrelated code PRs. Root Markdown is unrelated prose for these proof readers.
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

Changing when a proof runs does not change its cases, assertions, time limits,
proof commands. The lightweight planner and summary have read access to Actions
and pull-request metadata so they can verify attempt-bound evidence. A skipped matrix means it was not selected. It does not
prove those tests passed on that revision.
