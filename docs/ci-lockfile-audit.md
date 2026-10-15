# Lockfile-only CI

A resolved dependency update can affect one package without changing its
manifest. When your pull request changes only `pnpm-lock.yaml`, CI can run the
affected packages and the packages that read them, including through shared test
helpers. All compiler checks and all five receipt suites still run.

This route compares complete resolved dependency graphs in both saved revisions.
It follows indirect, optional and workspace-linked dependencies and retains peer
variants and package metadata. A root dependency change, changed workspace
membership, a formatting-only lock edit or unproved evidence keeps full work.
Mixed changes, including an accompanying manifest edit, also keep full work.

The reader audit in `scripts/ci-lock-selection-audit.json` pins every other
tracked file. Any other file change invalidates it, including a documentation
typo. Both saved revisions must match their audit. A new certificate in the head
cannot qualify an unaudited base. This deliberate limitation keeps new readers
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
python3 - <<'PY'
from pathlib import Path
import hashlib, json, subprocess

tree = subprocess.check_output(['git', 'write-tree'], text=True).strip()
entries = subprocess.check_output(['git', 'ls-tree', '-rz', '--full-tree', tree])
assert entries.endswith(b'\0')
policy = 'scripts/ci-lock-selection-audit.json'
inputs = []
for entry in entries.split(b'\0')[:-1]:
    path = entry.split(b'\t', 1)[1]
    if path not in [b'pnpm-lock.yaml', policy.encode()]:
        inputs.append(entry + b'\0')
Path(policy).write_text(json.dumps({
    'version': 1,
    'inputSha256': hashlib.sha256(b''.join(inputs)).hexdigest(),
}, indent=2) + '\n')
PY
git add scripts/ci-lock-selection-audit.json
```

The digest retains complete NUL-terminated Git records in their original order,
omitting only the lockfile and this certificate. Commit it with the reviewed
inputs. A frozen install must still accept the resolved update. The package
runner, summary checks and equal-tree merge reuse keep their existing rules.
