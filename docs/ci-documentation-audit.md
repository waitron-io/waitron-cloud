# Documentation-only CI

A prose change should not need the database and browser suites. A pull request
that changes only regular Markdown under `docs/` (outside `docs/receipts/`) or at
the repository root can run `changes`, `documentation` and `summary` alone.
The document check reads the exact git revisions, validates UTF-8, rejects NUL
characters and requires a final newline. It accepts deleted regular documents.

This exemption depends on the reader audit recorded in
`scripts/ci-docs-audit.json`. Its SHA-256 value identifies every other tracked
input, including executable files, configuration, package Markdown, JSON receipts
and symbolic links. Both the old and new trees must match that inventory.
Adding, changing or removing any of those inputs restores the full fallback for
documentation-only changes. Package-only changes keep their existing package
selection. Mixed documentation and code changes keep the full fallback.

## Renew the audit after changing code

Read the executable and build inputs before renewing the certificate. Search for
document paths, Markdown references, directory enumeration, file reads and child
commands, including their callers. Do not renew a stale digest automatically.
If a reader can consume the exempt prose, keep the certificate stale or narrow
the exemption and test that reader before renewing it.

The first audit uses `rg -n --glob '!*.md' --glob '!pnpm-lock.yaml'
'docs/|\.md\b|README' scripts packages apps deploy .github`, the corresponding
file-read and directory-enumeration inventory, and the reviewed precise-selection
design's consumer matrix. The real document readers are the identity source map
in `packages/identity/SOURCE.md` and the gateway JSON receipt under `docs/receipts/`.
Both remain outside the exemption. The release notice reader uses the separate
Waitron checkout. The new CI document checker reads only its selected immutable
Markdown blobs. Build contexts can copy prose, but the inspected build steps do
not execute or validate that prose. This audit is a source inspection, not a
runtime proof for every possible external command or environment.

After you review the readers and run their regression checks, stage the complete
candidate. Calculate the digest from `git ls-tree -rz --full-tree
$(git write-tree)`: omit regular `100644 blob` entries in the exempt Markdown set
and the certificate itself, retain every other complete NUL-terminated record in
git's order, then hash their concatenation with SHA-256. Set `version` to `1` and
`inputSha256` to that digest. Commit the certificate with the reviewed code.

The certificate does not exempt package Markdown or receipt data. Root scripts,
lockfile changes, finer receipt selection and measured job grouping remain later
parts of the precise-selection plan. The existing equal-tree merge reuse remains
in place.

When a documentation-only pull request passes and its merge has the identical
tree, the main run reuses that result and also skips package suites. This proves
the same documented selection, rather than rerunning previously unchanged code.
It does not establish that an unrelated failing or intermittent test has recovered.

Scratch selection proof, not for merging.
