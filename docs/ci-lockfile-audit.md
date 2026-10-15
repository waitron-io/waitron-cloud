# Dependency-update CI

A resolved dependency update can affect one package without changing its
manifest. When your pull request changes `pnpm-lock.yaml`, alone or alongside
workspace manifest dependency fields, CI can run the affected packages and the
packages that read them, including through shared test helpers. All compiler checks and all five receipt suites still run.

This route compares complete resolved dependency graphs in both saved revisions.
It follows indirect, optional and workspace-linked dependencies and retains peer
variants and package metadata. A root dependency change, changed workspace
membership, a formatting-only lock edit or unproved evidence keeps full work.
Other mixed changes also keep full work. A changed manifest runs its own package
and consumers even if that manifest does not alter the resolved graph.

The reader audit in `scripts/ci-lock-selection-audit.json` pins every other
tracked file except dependency declarations in workspace manifests. Version 2
stores a separate digest for each manifest after removing `dependencies`,
`devDependencies`, `optionalDependencies` and `peerDependencies`. It retains every
other field, including scripts, package identity, exports and installation policy.
Any other file change invalidates it, including a documentation typo. Both saved
revisions must match their audit. Version 1 still pins complete manifests and
supports lockfile-only updates. A new certificate in the head cannot qualify an
unaudited base. This deliberate limitation keeps new readers
from silently omitting package tests; wider input selection remains open.

## Renew the audit after reviewing readers

Review package and shared-helper dependency readers before renewing the audit.
The current boundary uses isolated pnpm packages, root compiler dependencies and
the immutable old/new source-and-manifest graph. Trace imports, file reads,
module resolution, child commands, installation configuration and lifecycle
hooks. Keep full work if a new reader cannot be represented by that graph.
Run its behavioral controls before renewing; never refresh the digest automatically.

Stage the complete reviewed candidate, then run this from the repository root:

```sh
node --input-type=module <<'JS'
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
const tree = git('write-tree').trim();
const policy = 'scripts/ci-lock-selection-audit.json';
const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const inputs = [], manifests = {};
const hash = text => createHash('sha256').update(text).digest('hex');
const entries = git('ls-tree', '-rz', '--full-tree', tree).split('\0');
if (entries.pop() !== '') throw Error('Incomplete inventory');
for (const entry of entries) {
  const path = entry.slice(entry.indexOf('\t') + 1);
  if (/^(packages|apps)\/[^/]+\/package\.json$/.test(path)) {
    const manifest = JSON.parse(git('show', `${tree}:${path}`));
    for (const field of fields) delete manifest[field];
    const projected = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en')));
    manifests[path] = hash(JSON.stringify(projected));
  } else if (!['pnpm-lock.yaml', policy].includes(path)) inputs.push(entry + '\0');
}
writeFileSync(policy, JSON.stringify({version: 2, inputSha256: hash(inputs.join('')), manifests}, null, 2) + '\n');
JS
git add scripts/ci-lock-selection-audit.json
```

The digest retains complete NUL-terminated Git records in their original order,
omitting the lockfile, this certificate and the separately checked workspace
manifests. Commit it with the reviewed
inputs. A frozen install must still accept the resolved update. The package
runner, summary checks and equal-tree merge reuse keep their existing rules.
