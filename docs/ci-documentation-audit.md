# Documentation-only CI

A prose change should not need the database and browser suites. A pull request
that changes only regular Markdown under `docs/` (outside `docs/receipts/`) or at
the repository root can run `changes`, `documentation` and `summary` alone.
The document check reads both exact Git revisions, validates UTF-8, rejects NUL
characters and requires a final newline. It accepts deleted regular documents.
The standard main-push policy still runs all package, receipt and compiler
checks, including an equal-tree merge of a green documentation-only pull request.
The [nightly full backstop](ci-nightly.md) adds independent full coverage; D571
part 5 owns the later change to merge checks.

## Independent evidence for each input

Routine code PRs used to renew the same four whole-tree hashes. Independent PRs
then conflicted on the shared policy even when their source files did not overlap.
With v2, you review and renew a separate record for each changed input. Two PRs
that change different readers change different documentation records.

`scripts/ci-input-audit-v2.json` selects v2. The records live under
`scripts/ci-input-audit.d/<mode>/`, with filenames derived from the source path.
Each current record identifies an exact Git file, a lock-mode manifest projection,
or a reviewed removal. The frozen `scripts/ci-input-audit.json` remains valid v1
evidence for historical revisions; v2 does not rewrite or trust its old digests.
Malformed v2 evidence never falls back to v1. A later commit cannot remove all
v2 metadata and renew historical v1 evidence. The original v1 policy blob stays
fixed after activation.

The documentation mode excludes only regular root and `docs/` Markdown. Package
Markdown, receipt data, executable Markdown, links and submodules remain pinned.
The entire `docs/waitron-integration-contract.md` is pinned because translation
checks its published vectors. The generated `docs/cloud-cost-model.md` is pinned
for artifact verification. Any edit to either needs review and renewal.

Each mode independently enumerates its current inputs. Every included file needs
an exact matching record. An addition, rename, changed mode or changed content
fails until you review it. Removing an input needs a removal record that names an
ancestor with matching evidence. The writer chooses an ancestor already shared
with the target branch, so squash and rebase keep that proof valid. It repairs an
invalid previous reference when a matching target ancestor exists. A file added
and removed only within your branch has no such anchor: consolidate that
unlanded history before renewal instead of publishing a dangling proof.
You cannot hide a removal by deleting its record:
the checker retains every record name introduced in the reachable v2 history,
including merged branches and Git-detected renames. Invalid noncanonical junk
is refused while present, but its removal does not create a permanent obligation.
Full Git history is required; shallow reads refuse
shortcuts and fail the required documentation freshness check.

V2 review composes independently reviewed input changes. It does not establish
that every combination of readers is correct. Before the second landing, inspect
the combined readers against the prose exemptions even when source paths differ.
A new reader of exempt prose needs a policy and behavioral-test change before
renewal. Keep the normal whole-branch review and full main CI.

## Renew documentation evidence before pushing code

Trace changed imports, directory scans, generated programs, file reads, child
commands, installation hooks and their effects on the prose exemptions. Then
stage the complete reviewed source and generate documentation records:

```sh
node scripts/ci-input-audit.mjs --write-staged
git diff -- scripts/ci-input-audit.d/docs
git add -- scripts/ci-input-audit.d/docs
node scripts/ci-input-audit.mjs --write-staged
git diff --exit-code -- scripts/ci-input-audit.d/docs
git commit -s
node scripts/ci-docs.mjs --audit "$(git rev-parse HEAD)"
```

Generation reads only the index. It never stages outputs or reads unstaged source
as evidence. Inspect new records with `git status` as well as the diff. The second
generation must leave identical bytes and filenames. Linked directories, linked
files, hard-linked outputs and unexpected metadata files are refused before any
output is changed. Known read-only output failures are checked in the same
preflight. Unexpected I/O failures can leave incomplete live output; immutable
checks refuse it, and generation never stages it. Keep reader-review notes in your PR, so a routine renewal does
not create another shared-file conflict in this guide.

`--write-staged --mode docs` is the same operation. Neither form renews identity,
gateway or lock records. Those modes pin ordinary prose too, so a combined backlog
edit can correctly leave them stale. A passing documentation check still permits
the normal full test run. A matching record documents your review boundary; it
does not establish that the review was correct.

The required root check verifies documentation freshness on shard 1; a selected
root-script job verifies it too. Stale documentation evidence fails its own PR
while the planner retains full work. Both revisions must qualify for a prose-only
shortcut. A fresh head cannot repair an unaudited base, whether it uses v1 or v2.

## Optional peer renewal

Identity excludes only its checker and owning test. Gateway excludes only its
receipt verifier and owning test, while keeping its generator caller pinned.
Lock mode excludes lockfile bytes and projects workspace manifests by removing
only the four validated dependency maps. Other manifest metadata and the root
manifest stay pinned. Both immutable revisions must qualify for a shortcut.

Renew a peer only after reviewing its excluded programs and consumers. For example:

```sh
node scripts/ci-input-audit.mjs --write-staged --mode identity
```

Use `--mode all` only after reviewing all four modes. To check their currency:

```sh
node scripts/ci-input-audit.mjs --check "$(git rev-parse HEAD)"
node scripts/ci-input-audit.mjs --check-mode docs "$(git rev-parse HEAD)"
```

The first command returns nonzero if any mode is stale. The second can pass while
peers remain stale. Do not regenerate peers merely to recover a shortcut after
another PR changes prose; accept full work instead.

For mixed prose and code, removing accompanying evidence from the package scope
still requires both documentation audits and all four current head modes. Stale
base peers alone are tolerated. Stale head peers, unknown metadata and unmapped
inputs keep full work. Prose plus evidence alone cannot produce an empty successful
package plan. Existing unresolved package readers can also retain all packages.

Cloud cost and venue proof workflows use the same two-revision check through
`node scripts/ci-docs.mjs --plan`. Mixed changes, pinned prose and stale evidence
retain their tests. Their existing main policies remain unchanged.

## Historical evidence and migration

The [D577 measurement](backlog/ci-audit-conflicts.md) records 21 audit-only conflicts
among 30 repeated-head transitions. The [implementation plan](superpowers/plans/2026-11-05-independent-ci-audit-evidence.md)
defines the two-PR sequential-merge proof and its limits. Historical v1 review
receipts remain in [the guide before migration](https://github.com/waitron-io/waitron-cloud/blob/9e99af4f0cfde602653fedaa4fe3db87dd93f28f/docs/ci-documentation-audit.md).

One-time activation uses `--init-v2-staged` after complete reader review. It writes
the descriptor and all four initial record inventories, leaving v1 bytes intact.
Repeating before staging succeeds only with an identical complete output set;
partial output or collisions refuse. Once you stage activation, use the ordinary
writer. Saved v1 fixture inventories and their behavioral assertions stay v1.

## Nightly full work

An explicit full call bypasses the documentation shortcut in standard, cost and
venue workflows. A documentation-only PR rehearsal therefore still executes all
packages and receipts when the nightly parent asks for full work. Ordinary
documentation PRs keep their audited narrow path.
