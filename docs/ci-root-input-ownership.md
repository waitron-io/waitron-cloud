# Review checks outside workspace packages

A change to a small test outside a package can otherwise select every package
and receipt. You can give a reviewed test its existing execution owner while
keeping full checks for inputs whose readers are unknown.

The registry in `scripts/ci-root-inputs.json` admits two tests:

| Changed input | Required checks |
| --- | --- |
| `scripts/ci-root-shards.test.mjs` | All eight root partitions |
| `deploy/local-stack/operations-health.test.mjs` | The entire `test:local-stack` receipt command |

Package changes still select their package work and compiler checks. When you
combine them with a registered test, CI adds that test's owners to the package
plan. Shared configuration, workflows, checkout attributes at any depth and
unregistered root inputs retain full work. The capacity verifier test remains
unregistered: a root selector test copies its live bytes, so its proposed
receipt-only owner would miss a real consumer.

## Review changed inputs before renewing their records

Every tracked input has a separate record under `scripts/ci-root-review.d/`.
Each record identifies the exact Git object you reviewed and its relationship
to both registered tests. This includes inputs that do not execute either test.
Regular unread Markdown and the existing audit metadata have their own
documentation authority and are excluded only when that authority verifies.

For each changed input, trace imports, file reads, directory scans, generated
programs and child commands through their callers. Inspect commands as well as
imports: copying a whole checkout can expose a test to a later runner. Distinguish
live input from historical fixture bytes. Search results help find readers;
they do not prove that every reader is accounted for.

If you introduce a reader outside an existing recorded boundary, update the
registry's site ledger and review every input against the changed contract.
That change runs full CI. Renewing one input's record cannot authorize an
undeclared execution owner.

After reviewing and staging the source, name each reviewed input explicitly:

```sh
git add -- scripts/ci-root-shards.test.mjs
node scripts/ci-root-review.mjs --write-staged \
  --input scripts/ci-root-shards.test.mjs \
  --reviewer 'Your name' \
  --reference 'Your PR review and its reader boundaries'
git diff -- scripts/ci-root-review.d
git status --short
git add -- scripts/ci-root-review.d
```

The writer reads staged source and leaves its outputs unstaged. Inspect new
files as well as the diff, then repeat the same command and require identical
output. Name multiple reviewed inputs with repeated `--input` options. For a
removal, name the old path; its retained record must identify a previously
reviewed ancestor shared with main.
The pull-request checks also require that ancestor in the original PR base.
Squashing keeps main's history and discards intermediate feature commits, so
a record anchored only in your unmerged work cannot qualify for publication.
If you add and remove an input before its first landing, consolidate those
unlanded edits before renewal. There is no reviewed main ancestor to retain.

Then [renew documentation evidence](ci-documentation-audit.md#renew-documentation-evidence-before-pushing-code)
for the source and its new root records. Commit the complete result with sign-off:

```sh
node scripts/ci-input-audit.mjs --write-staged --mode docs
git add -- scripts/ci-input-audit.d/docs
git commit -s
node scripts/ci-root-review.mjs --check "$(git rev-parse HEAD)"
node scripts/ci-docs.mjs --audit "$(git rev-parse HEAD)"
```

## Freshness is required even for full work

The mandatory summary verifies the complete current head after activation.
Missing, stale or removed review records fail that check even when all package
jobs ran. Removing the registry and every record cannot disable the check:
activation is retained in Git history. Fetch complete history before checking.
Rebase code branches opened before activation before landing them. After any
registry change, renew inputs against the new registry before combining older
branches; an earlier green head does not qualify the combined tree.

When main reuses verified pull-request checks, its summary still checks the
complete merged input review. It then verifies the source run again before
accepting skipped work. A different-tree merge derives ownership from the
literal pushed range. Source reconstruction uses the same saved reviews and
keeps root partitions independent of compiler checks in its job evidence.

Narrow selection additionally requires complete current reviews in both saved
trees and the same registry in each. Activation cannot grant its own shortcut.
Forced full and nightly runs keep all their existing work. Exclusive identity,
gateway and lock shortcuts keep their original rules; accompanying root records
can make those changes run in full.
Workspace-policy changes and files outside known workspace members retain full
work. Large changed-path ownership markers also retain full work, keeping the
plan passed to each job bounded.

Valid root-record renewal does not by itself select either separate proof
matrix. Both saved root reviews and documentation authorities must qualify
first, and every real proof input still follows the
[proof workflow rules](ci-proof-selection.md). Bootstrap, registry and checker
changes retain complete proof work.

## Initial reader review

The root workflow discovers the partition-contract test through the immediate
`scripts/ci-*.test.mjs` wildcard. That test reads the workflow and executes its
extracted command against six generated files in its own temporary directory.
The selected owners remain all eight root partitions.

The health test imports `operations-health.mjs` and creates temporary loopback
HTTP servers. Its owner is the complete root `test:local-stack` command, whose
wildcard discovers immediate local-stack tests. Other local-stack programs
import the production transport rather than its test. The receipt-selector
fixtures reconstruct historical health-test bytes before running their checks;
those saved bytes do not execute the current test. Future changes to those
boundaries need another review before renewal.
