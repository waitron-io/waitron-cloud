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
inventory immediately. Its own required CI fails until you review and renew it.
Both immutable trees must match the selected inventory. Unknown paths or missing
or stale evidence retain full work. A fresh head cannot qualify an unaudited
base.

When you change package code alongside audited prose, the prose no longer widens
the package selection. The planner removes regular prose after both saved
documentation audits verify, including added and deleted documents. It then
selects package owners and their saved consumers. A document
that becomes a link or an executable file keeps conservative work. The published
translation contract, generated cost model, package Markdown and receipt data
remain inputs to their existing checks.

Your code change also needs an audit renewal. The planner treats the accompanying
`scripts/ci-input-audit.json` as evidence only when all four inventories verify in
the saved head. The base still needs a current documentation audit. A prose-only
base normally has stale peer inventories because those modes pin prose too;
requiring them would send the next code PR back to full work. A malformed policy
or even one stale head peer digest keeps full work. Every other root path retains
its existing selection. Prose and an audit edit alone cannot produce an empty
successful package plan. Main pushes and the
separate proof workflows keep their existing policies.

This removes the prose barrier; it does not establish that every package reader
can be resolved. On the D571 part 1 candidate, a real immutable portal edit plus
prose and renewed audits still selects 28 package jobs. The saved-source scanner
reports `Unresolved directory input at scripts/ci-audit-fixture-dependencies.mjs`.
Keep that fallback until the reader can be bounded and its real consumers proved.
A controlled identity `SOURCE.md` edit likewise keeps all nine packages. D571
part 2 owns dependency precision; part 1 claims no measured job saving.

Every change to a documentation-inventory input, including pinned prose, must
keep that inventory current in its own pull request. The required root check verifies it on shard 1; a selected root-script
check verifies it too. The documentation check already verifies both revisions.
A stale inventory therefore fails the required CI summary while the planner
keeps its conservative full-work fallback. Before you push code, review the
changed readers and renew the staged inventories with the procedure below.
A matching hash records your review boundary; it does not prove that the review
was correct.

This makes review and renewal part of every inventoried edit. Parallel code PRs
can conflict on the policy even when their source changes are independent. Rebase,
review the combined reader changes and regenerate from the merged staged tree;
keep completed branch review approval when its implementation is unchanged.
The required failure catches lost evidence in the PR that invalidates it instead
of silently sending later prose PRs through the full suite. Renewal remains a
human review step; a matching hash alone cannot establish that review happened.

Venue service proof and Cloud cost conformance use the same `documentationPlan`
check through `node scripts/ci-docs.mjs --plan`. They skip their test jobs only
when both revisions qualify as regular unread prose. Missing revisions, mixed
changes, pinned documents and stale evidence retain those tests. The cost
workflow keeps its existing main-push path filter; the standard main workflow
still runs every package and receipt, and the venue workflow still runs both
proofs, even after a documentation-only pull request.

## Renewal after #869

You can locate the first stale revision after the last renewal with:

```sh
node scripts/ci-input-audit.mjs --check 95fbb4c5372699e44192048ea661c70e8bc3627a
node scripts/ci-input-audit.mjs --check 3937c66bb73ae2da0cf31bc2937f393472846664
```

The first command passes all four inventories. The second refuses documentation:
#870 changed `scripts/cloud-cost/conformance-archive-idle.test.mjs` without
renewing the policy. Its actual documentation digest starts `079b8c59`, while the
recorded digest still starts `17b6b293`. Later code changes kept it stale; a
warning did not make the failure part of the required CI result.

The renewed review covers programs and tests changed since #869, including
removed paths, package Markdown, manifests and all execution wiring. Existing
readers of the translation contract and generated cost model remain pinned.
New traffic journals, storage-control scans and verifier cleanup read owned
runtime or scratch directories. Cost release preparation reads separately pinned
Waitron sources, JavaScript, JSON and font assets. Installed-dependency copying
scans only workspace dependency directories. The new non-UTF-8 patch control
writes its own Markdown bytes before reading its disposable candidate. It does
not depend on the original document's content. CI fixtures continue to create
their own documents. No additional Cloud prose exemption is added. The later #914 test-cloud changes
are included too: its Cloud source inventory excludes Markdown explicitly,
volume scans read private runtime roots, and the complete Waitron source
inventory reads the separately pinned Waitron checkout. A real Git control adds
and commits Cloud prose: its commit and tree change, while the Cloud runtime
file inventory stays byte-for-byte equal.

The renewal also includes the later recovery-session browser and container
resource-diagnostic test changes on `main` through #921. The browser test reads
application source and styles and writes captures to its configured receipt
directory. The container controls read their own temporary state and the existing
entry and verifier programs. Neither adds a Cloud prose reader. Review these
combined inputs before renewal even when their source files do not overlap your
branch: the old audit rejects the merged tree because it inventories both files.

You can check the documentation inventory alone without installing packages:

```sh
node scripts/ci-docs.mjs --audit "$(git rev-parse HEAD)"
```

A stale result exits with status 1 and points you to the reader review and staged
renewal procedure. It checks immutable Git blobs, so unstaged files cannot stand
in for the reviewed tree.

The separate proof review follows `scripts/fixtures/service-proof.ts` into the
seven legacy and nine venue suites listed in `scripts/test-cloud-free-services.mjs`.
Its receipt checker reads Git candidate identity and generated JSON output. The
selected tests and helpers read source programs, local certificates, JSON state,
owned scratch and database fixtures. The cost launcher selects JavaScript fixture
files and prepares pinned source releases and synthetic runtime data. Its
publication reader still uses the pinned generated cost model. These existing
proof consumers introduce no additional unread Cloud prose exemption.

## Review of the other three inventories

The receipt-authentication renewal adds only an existing package-token binding
to the grouped receipt step and extends its loopback-registry test to that
entry point. That control executes the actual runner, pnpm script and descendant
installer against a synthetic registry. The test reads the CI workflow and creates
its own package, script, lockfile, registry and private store; it adds no prose reader.
The token retains the workflow's existing read access to contents, packages,
Actions and pull requests. No permission or write access is added.
Identity and gateway programs, lock inputs, permissions and installation hooks
remain unchanged. All four inventories are renewed from this reviewed candidate.

The staged generator renews identity, gateway and lock inventories together with
documentation. Their excluded programs and their consumers need review too.
Since #869, the identity and gateway target programs, owning tests, script-mode
checker, lock parser and saved-package reader are unchanged. The changed CI wiring
still invokes those exact owning tests. The identity checker reads the pinned
package source map and the separately selected Waitron checkout. The gateway
checker reads its explicit JSON receipt; its existing generator remains the
syntax-checked caller. New test-cloud and cost preparation do not execute these root scripts. The new
Cloud source inventory does read their bytes, as well as the lockfile. Its
expected hashes come from the same candidate; controls accept the current
measured files and reject older or altered file hashes. Volume readers use
private runtime inputs, and the complete Waitron reader uses a separate checkout.

The lock review includes the root manifest, all nine workspace manifests,
installation configuration, frozen installs, cache wiring and source consumers.
The new Cloud image build installs the complete frozen graph. Its Cloud source
inventory includes the lockfile and manifests and binds the measured files to
the same candidate; it does not compare them with a fixed older lock hash. The
complete Waitron inventory reads a different checkout. New test installs use
owned disposable source trees. Compiler checks and all six receipt suites remain
required for dependency changes. Existing manifest, graph and unknown-reader
behavioural assertions are retained.

Real Git controls edit each root-script family and the lock integrity metadata.
Both root-script changes still qualify for their existing narrow script plan,
but the new documentation freshness check rejects each with status 1. The lock
control keeps 28 package jobs and six receipt suites and is rejected too. After
reviewed staged renewal, all four modes are current and each control selects
28 package jobs, six receipt suites and compiler work because the policy is a
mixed root input. Re-enabling a peer certificate therefore does not by itself
qualify a stale-documentation PR to land. This review leaves the separate receipt
certificates and their historical fixtures untouched.

## Admin fixture reader review (D506)

The admin-port controls read their own generated `mini.options`, native
`store.log`, temporary storage roots and numeric port-claim links. The new
paused-child test launches the existing JavaScript cases with a literal file
list and observes their controlled output. Its cleanup helper scans the shared
claim directory but removes only links targeting roots that invocation captured.
The storage fixture reads pinned archives, generated certificates, JSON setup
and workspace manifests. These readers do not add a consumer of exempt Cloud
prose; no Markdown exemption changes.

The port-selection changes retain those same inputs and every original
assertion. Their embedded programs contain fixed test paths and runtime roots;
they do not discover Cloud document content. The added backlog observations are
ordinary prose. Identity and gateway targets, dependency manifests, installation
hooks and the lockfile remain unchanged by D506.

This renewal includes the reviewed shared selectors and required freshness
gates from #922. Their event JSON, immutable Git trees and policy checks keep
the existing document boundaries. Review the merged staged tree before renewing
all four inventories; an old branch's matching hash does not qualify these
combined readers. The generated policy records that boundary without extending
any allowlist or proving behaviour outside the exercised controls.

## Translation startup diagnostic reader review (D574)

The translation fixture adds a bounded, project-scoped Compose state read on
command failure. Its controls run that exact test file against a temporary Docker
command, record command arguments and inspect its output. The ignored-signal
control records and, if necessary, stops only its own fake child process. All
nested scratch files live inside that control's temporary directory. They read no exempt
Cloud Markdown. The additional state evidence selects service lifecycle fields
without reading container configuration or private logs. No workflow, manifest,
installation hook, identity or gateway target changes. Generate all four
inventories from this complete staged candidate after reviewing these readers.

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
invalidates the relevant certificate and retains conservative work. A stale
documentation inventory also fails its own required CI until review and renewal.
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
