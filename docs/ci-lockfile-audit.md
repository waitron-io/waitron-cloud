# Dependency-update CI

A resolved dependency update can affect one package without changing its
manifest. When you change `pnpm-lock.yaml`, alone or with workspace manifest
dependency fields, CI selects affected packages and their saved consumers,
including shared test helpers. All compiler checks and all six receipts remain.

The reader compares resolved graphs in both revisions. It follows indirect,
optional and workspace-linked dependencies, peer variants and package metadata.
A root dependency change, changed workspace membership, formatting-only lock
edit or unresolved reader retains full work. Other mixed product changes do too.
A changed manifest selects its own package and consumers even when the resolved
graph is unchanged.

Both saved locks and manifests must be regular files. Manifest dependency maps
must contain string values. The reader compares every other manifest field
between base and head, including scripts, identity, exports and installation
policy. A change to those fields retains full work.

## Review without generating records

You no longer renew lock or documentation records. Stale, missing and malformed
retired records do not affect selection. Review changed imports, helper chains,
file reads, resolution, commands and installation hooks in the PR. Add a real
consumer to the ownership checks when its reader changes; keep full work when
that consumer cannot be represented. The [documentation guide](ci-documentation-audit.md)
explains the accepted loss of the automatic renewal pause.

Run the controls with:

```sh
node --test scripts/ci-lock-selection.test.mjs scripts/ci-manifest-lock.test.mjs
```

The historical manifest fixture remains separate from current workspace
selection. Do not refresh its saved hashes to match the candidate. Main reuse
and selected-range checks follow the [merge evidence checklist](ci-merge-evidence.md);
the [nightly run](ci-nightly.md) always runs complete work.
