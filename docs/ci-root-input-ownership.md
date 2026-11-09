# Checks outside workspace packages

A small test outside a package can otherwise select every package and receipt.
Tests and consumed documents have known execution owners, kept in
`scripts/ci-root-inputs.mjs`. Consumed-document routes apply only to pull requests;
default and main-push ranges keep those documents on full work:

| Changed input | Required checks |
| --- | --- |
| `scripts/ci-root-shards.test.mjs` | All eight root partitions |
| `deploy/local-stack/operations-health.test.mjs` | The entire `test:local-stack` receipt command |
| `docs/waitron-integration-contract.md` | translation, typecheck, root checks and all six receipt suites |
| `docs/cloud-cost-model.md`, `docs/cost-model/*.json` | `test:cloud-cost` |
| `docs/cloud-cost-calculator.html` | ui-smoke, typecheck, root checks and all six receipt suites |
| `docs/receipts/gateway-reconnection-2026-10-13.json` | All eight root partitions |

The two registered test targets must be regular files in both saved revisions. Removing either,
changing workspace identities or test commands, or changing checkout attributes
retains full work. Unregistered root inputs and shared configuration do too.
The capacity-verifier test stays unregistered because another root test copies
its live bytes; a receipt-only owner would omit that reader.

Package changes keep their package and compiler work. Combining them with a
registered test adds that test's owners. The independent summary reconstructs
the event's complete changed range and refuses missing owners, forged markers,
empty work and incomplete job results. Large markers retain full work.

## Review the actual readers

### Package-only root advice (10 November 2026)

After the existing root verification, a selected pull request that changes only
regular source/test files in existing packages or apps, optionally with ordinary
prose, can omit the nine synthetic suites named in the
[D613 plan](superpowers/plans/2026-11-09-cloud-root-test-inputs.md).
`ci-package-revisions.test.mjs` stays: its live-reader case clones the actual
repository. The nine other files passed 613 cases after live source/test
directories were removed in a committed temporary revision.

`scripts/ci-root-selection.mjs` provides advice inside the existing command.
Unknown inputs, full planner decisions, forced full runs, unavailable history,
inventory uncertainty and loading failures use the original complete command.
New tests remain in the inventory. Advice assigns files to their original sorted
eight-way partitions before omitting anything; each job can independently fall
back without losing another job's retained files. A retained test failure still
fails its job, without retrying the full command.

Plan fields, mandatory verification, summary and evidence comparisons do not
change. Fresh main root jobs and nightly runs use full commands; an identical-tree
merge may reuse its PR evidence. When you change a reader in an omitted file,
trace its imports, copies, reads and children before keeping that omission.
Run `node --test scripts/ci-root-selection.test.mjs scripts/ci-root-shards.test.mjs`
for the selection and real-command controls. Hosted job-minute savings still
need a healthy natural eligible PR; local profiling is not that measurement.

Root ownership comes from the explicit mapping, not generated records.
Consumed documents must be regular files wherever present in either saved tree.
A missing named package or an unknown companion input retains full work.
Package-associated work keeps the independent receipt audits. The old
JSON registry, records and writers have been removed. The [documentation guide](ci-documentation-audit.md)
explains this accepted trade-off. When a reader changes, trace imports, copied
files, scans and child commands and update its ownership tests in the same PR.
Ordinary review now supplies that pause.

Root work uses the event's exact head and a clean tracked checkout. These checks
also apply to full, document, script, receipt and summary work; they do not depend
on historical record activation. Actions jobs require their original event.
Main reuse still independently verifies the source evidence, and different-tree
merges use the literal pushed range. Forced full and nightly runs retain all work.

Run the controls with:

```sh
node --test scripts/ci-root-inputs.test.mjs scripts/ci-record-retirement.test.mjs
```

The closed [root control #985](https://github.com/waitron-io/waitron-cloud/pull/985)
and [health control #989](https://github.com/waitron-io/waitron-cloud/pull/989)
record the original hosted selection before record retirement. They do not
qualify later changes or establish a time saving.
