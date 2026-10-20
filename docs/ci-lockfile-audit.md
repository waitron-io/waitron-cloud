# Dependency-update CI

A resolved dependency update can affect one package without changing its manifest.
When your pull request changes `pnpm-lock.yaml`, alone or alongside workspace
manifest dependency fields, CI can run the affected packages and the packages that
read them, including through shared test helpers. All compiler checks and all five
receipt suites still run. Every push to `main` runs the full suite independently.

The reader compares complete resolved dependency graphs in both saved revisions.
It follows indirect, optional and workspace-linked dependencies and retains peer
variants and package metadata. A root dependency change, changed workspace
membership, a formatting-only lock edit or unproved evidence keeps full work.
An unresolved directory input in a reachable saved source also keeps full work;
the package planner names that source, while lockfile planning uses its existing
full-work diagnostic. Ordinary resolved reads can still select their consumers.
Other mixed changes also keep full work. A changed manifest runs its own package
and consumers even if it does not alter the resolved graph.

The shared policy in `scripts/ci-input-audit.json` has a separate lock inventory
and a `manifests` map for the complete current workspace. Each manifest digest
removes only `dependencies`, `devDependencies`, `optionalDependencies` and
`peerDependencies`, after validating their string-valued maps. It retains every
other field, including licence, scripts, identity, exports and installation policy.
The root manifest and all other tracked inputs remain pinned in the lock inventory.
Both revisions must match. A new head policy cannot qualify an unaudited base.

## Renew after reviewing readers

Trace imports, shared helpers, file reads, module resolution, child commands,
installation configuration and lifecycle hooks before renewing. Keep full work if
a new reader cannot be represented by the source-and-manifest graph. Update its
behavioural controls first; never refresh a digest automatically in CI.

Stage the complete reviewed candidate, then generate and inspect all four mode
inventories together:

```sh
node scripts/ci-input-audit.mjs --write-staged
git diff -- scripts/ci-input-audit.json
git add -- scripts/ci-input-audit.json
node scripts/ci-input-audit.mjs --write-staged
git diff --exit-code -- scripts/ci-input-audit.json
git commit -s
node scripts/ci-input-audit.mjs --check "$(git rev-parse HEAD)"
```

The second generation must be stable. Discovery reads the staged or committed
workspace layout and manifests, validates regular inputs, unique package names,
nonempty test commands and dependency maps, and never trusts historical fixture
membership. A frozen install must still accept your resolved update.

The immutable test-only `scripts/fixtures/ci-historical-manifests.json` preserves
nine older manifest hashes for saved receipt fixtures. Those fixtures lack today's
translation package and licence metadata. Their exact membership and metadata
checks remain independent of current production evidence. Do not refresh them to
agree with the candidate or use them as production authority. The
[documentation audit guide](ci-documentation-audit.md) explains the shared policy,
reader review and conservative fallback.
