# Dependency-update CI

A resolved dependency update can affect one package without changing its manifest.
When your pull request changes `pnpm-lock.yaml`, alone or alongside workspace
manifest dependency fields, the lock reader identifies the affected packages and
the packages that read them, including through shared test helpers. All compiler checks and all six
receipt suites still run. Every push to `main` runs the full suite independently.

The required documentation freshness check applies to lockfile and manifest
changes too. Review readers and renew documentation records before pushing.
Routine v2 renewal changes docs records only; stale peer records keep full work.
A narrower lock shortcut remains independently checked and cannot override the
required freshness gate. See the [renewal procedure](ci-documentation-audit.md).

The reader compares complete resolved dependency graphs in both saved revisions.
It follows indirect, optional and workspace-linked dependencies and retains peer
variants and package metadata. A root dependency change, changed workspace
membership, a formatting-only lock edit or unproved evidence keeps full work.
An unresolved directory input in a reachable saved source also keeps full work;
the package planner names that source, while lockfile planning uses its existing
full-work diagnostic. Ordinary resolved reads can still select their consumers.
Other mixed changes also keep full work. A changed manifest runs its own package
and consumers even if it does not alter the resolved graph.

V2 lock records cover the complete current workspace. A manifest record removes
only `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies`,
after validating their string-valued maps. Every other field remains, including
licence, scripts, identity, exports and installation policy. The root manifest and
all other tracked inputs remain pinned. Both saved revisions must match; a fresh
head cannot qualify an unaudited base. Historical v1 trees keep their shared policy
and manifest-map checks.

## Renew after reviewing readers

Trace imports, shared helpers, file reads, module resolution, child commands,
installation configuration and lifecycle hooks before renewing. Keep full work if
a new reader cannot be represented by the source-and-manifest graph. Update its
behavioral controls first; never refresh evidence automatically in CI.

Stage the complete reviewed candidate and use the routine documentation renewal
from the linked guide. Renew lock records separately only when their shortcut is
useful and you have reviewed its complete reader boundary:

```sh
node scripts/ci-input-audit.mjs --write-staged --mode lock
git add -- scripts/ci-input-audit.d/lock
node scripts/ci-input-audit.mjs --write-staged --mode lock
git diff --exit-code -- scripts/ci-input-audit.d/lock
git commit -s
node scripts/ci-input-audit.mjs --check-mode lock "$(git rev-parse HEAD)"
```

The second generation must be stable. Discovery reads the staged or committed
workspace layout and manifests, validates regular inputs, unique package names,
nonempty test commands and dependency maps, and never trusts historical fixture
membership. A frozen install must still accept your resolved update. Ordinary
prose changes can make lock records stale without invalidating docs records;
accept full work rather than routinely renewing this peer mode.

The immutable test-only `scripts/fixtures/ci-historical-manifests.json` preserves
nine older manifest hashes for saved receipt fixtures. Those fixtures lack today's
translation package and licence metadata. Their exact membership and metadata
checks remain independent of current production evidence. Do not refresh them to
agree with the candidate or use them as production authority. The
[documentation audit guide](ci-documentation-audit.md) explains the shared policy,
reader review and conservative fallback.
