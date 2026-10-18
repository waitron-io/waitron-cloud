# Documentation-only CI

A prose change should not need the database and browser suites. A pull request
that changes only regular Markdown under `docs/` (outside `docs/receipts/`) or at
the repository root can run `changes`, `documentation` and `summary` alone.
The document check reads the exact Git revisions, validates UTF-8, rejects NUL
characters and requires a final newline. It accepts deleted regular documents.
Every push to `main` runs all package, receipt and compiler checks, including
an equal-tree merge of a green documentation-only pull request.

The shared policy in `scripts/ci-input-audit.json` records four independent
SHA-256 inventories: documentation, identity scripts, gateway scripts and
lockfile readers. Each excludes the policy itself and only its existing audited
content. Documentation excludes regular root and `docs/` Markdown; package
Markdown, receipt data, executable Markdown, links and submodules remain pinned.
Both immutable trees must match the selected inventory. Mixed changes, unknown
paths or missing or stale evidence retain full work. A fresh head cannot qualify
an unaudited base.

The planner checks its committed checkout on every run and emits a GitHub warning
when the documentation inventory is stale, including for code changes. A matching
hash records your review boundary; it does not prove that the review was correct.

## Review before renewal

Compare your candidate with the last reviewed tree. Inspect added, changed and
removed programs, tests, installation inputs and execution wiring for readers of
exempt Markdown. Include generated programs, directory scans, subprocess arguments,
imports, file reads, installation and lifecycle hooks. If a new reader consumes
exempt content, update the selection rule and its behavioural tests before renewal.
Never renew merely to pass CI.

From the repository root, stage the complete reviewed candidate, including a schema-valid policy placeholder
when creating the file. Generate all four inventories from the index, which holds
your staged files, then inspect and stage only the policy output:

```sh
node scripts/ci-input-audit.mjs --write-staged
git diff -- scripts/ci-input-audit.json
git add -- scripts/ci-input-audit.json
node scripts/ci-input-audit.mjs --write-staged
git diff --exit-code -- scripts/ci-input-audit.json
git commit -s
node scripts/ci-input-audit.mjs --check "$(git rev-parse HEAD)"
```

The second generation must leave identical bytes. The generator never stages
files or contacts services. It reads staged blobs, ignoring unstaged changes.
The checker accepts an immutable commit SHA, writes nothing and reports each
mode separately. Repeat review and generation after any inventoried input change.
Run focused behavioural checks locally, keep normal hooks enabled and verify CI
on the exact pull-request head. CI owns the mandatory package suites.

The shared schema rejects missing, extra, duplicate or damaged fields and requires
regular policy and owning inputs. A well-formed wrong peer hash invalidates that
peer's check; malformed peer evidence invalidates every check. Content from one
family still invalidates the other inventories. Sharing the policy lets you renew
a fixed reviewed tree together; it does not keep every mode current after arbitrary
changes. Historical revisions without this policy retain full work.

The five receipt certificates and saved dependency, execution, schema and deployment
fixtures are separate evidence. This command never renews them. Historical receipt
tests use their independently pinned nine-manifest certificate; current lock
validation requires every current manifest and its metadata. See the
[dependency-update audit](ci-lockfile-audit.md) and the
[coordinated design](superpowers/specs/2026-10-16-coordinated-ci-audits.md).
