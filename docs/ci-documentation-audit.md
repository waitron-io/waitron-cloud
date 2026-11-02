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
The entire `docs/waitron-integration-contract.md` is now pinned because the
translation package checks its published vectors. The generated
`docs/cloud-cost-model.md` remains pinned for artifact verification. Any edit to
either file, including prose, keeps full CI and invalidates the documentation
inventory for later pull requests until you review and renew it.
Both immutable trees must match the selected inventory. Mixed changes, unknown
paths or missing or stale evidence retain full work. A fresh head cannot qualify
an unaudited base.

The planner checks its committed checkout on every run and emits a GitHub warning
when the documentation inventory is stale, including for code changes. A matching
hash records your review boundary; it does not prove that the review was correct.

## Contract reader and renewal

With commit
`b1a8d7cee1056a0aac14adba53e03f270ac4263c` checked out, you can reproduce the refusal:

```sh
node scripts/ci-input-audit.mjs --check b1a8d7cee1056a0aac14adba53e03f270ac4263c
```

The recorded documentation inventory starts `ccd8dc95`; the actual inventory
starts `8d0f7fda`. The policy at that revision was last renewed in #210 (`33eef7c8`). The first
later inventoried change was #212 (`eb21d579`), which changed verifier and test
inputs without renewing the policy. A changed inventoried input deliberately
invalidates this certificate.

There is also an existing reader gap. The unchanged test in
`packages/translation/test/submit-proof.test.ts` reads the published JSON vectors
in `docs/waitron-integration-contract.md` and compares them with the committed
fixture. The reader was introduced in #183 (`48227c7e`), before #210, but the
contract qualified as unread Markdown when the old selection rule had a current inventory.

A controlled experiment on the above commit uses a disposable clone with its own
locked dependency installation. The original contract-vector test passes. After
renewing the clone's staged inventory and committing that baseline, changing
only the published JSON's `issuerKeyId` to `controlled-mismatch` produces these
results:

| Operation | Observed result |
| --- | --- |
| Real pull-request planner | Documentation only; zero packages and receipts, no compiler check |
| Document checker | Passes the changed contract |
| Original contract-vector test | Fails on the altered issuer key ID |
| Same test after restoring the contract | Passes |

You can run the unchanged package check without a database:

```sh
node --test --test-name-pattern='the contract publishes exactly the committed vectors' packages/translation/test/submit-proof.test.ts
```

The selection rule now excludes exactly this contract from unread prose. Its
changes retain full work, including the translation package. The additive
regression renews a complete disposable candidate, alters the published issuer
key ID, runs the real planner, and requires the package whose original vector
check fails. It also runs that original check before the edit and after restoring
the contract. Every earlier assertion and every other exemption remains intact.

The renewal review inventories all 1,131 non-prose paths changed since #210,
including removed inputs, and searches current tests, scripts, embedded fixture
programs, manifests, installation hooks and workflow wiring for document readers.
The only newly excluded Cloud Markdown is this contract. Other relevant references
are already pinned or refer to another checkout:

| Reference | Review boundary |
| --- | --- |
| Cost publication and browser calculator | The generated model is already excluded from unread prose; HTML and JSON inputs never qualify as prose. Inventory links name documents without reading their contents. |
| Identity source map | `packages/identity/SOURCE.md` is package Markdown, already pinned. |
| UI release notices | The release helper reads `LICENSE-GRANTS.md` from the separately pinned Waitron checkout and its packed distribution, not this repository. |
| CI fixture documents | Test helpers create their own documents inside disposable repositories. |
| Directory scans and source copies | Workspace discovery filters source extensions; cost code copies filter executable sources and manifests; private resource scans inspect their owned scratch roots. |

The four inventories are renewed from the reviewed staged candidate using the
procedure below. This is a review boundary for those inputs, not proof that an
arbitrary future program cannot read Markdown. Any later inventoried change
invalidates the relevant certificate and retains conservative work until review.
The separate receipt certificates and historical fixture evidence stay unchanged.

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
