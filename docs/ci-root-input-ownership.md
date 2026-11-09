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
