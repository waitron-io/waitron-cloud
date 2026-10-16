# Keep the documentation CI audit current

A documentation-only pull request needs no package tests only while the tracked
programs cannot use the changed prose. The certificate in
`scripts/ci-docs-audit.json` records the reviewed input tree. Both the base and
head must match their own certificates. A stale certificate keeps full CI;
the real-checkout test in `scripts/ci-docs.test.mjs` also fails full CI so you
cannot silently lose the shortcut on the next code change.

## Review before renewal

Compare your candidate with the last reviewed tree. Inspect added, changed and
removed programs, tests, installation inputs and execution wiring for readers
of root Markdown or `docs/**/*.md`. Check generated programs, directory scans,
and command arguments as well as direct file reads. Receipt Markdown under
`docs/receipts/`, package Markdown, links, executable Markdown and non-Markdown
files are outside the exemption and stay in the inventory.

If a new reader consumes exempt prose, change the selection policy and its
behavioral tests before renewing. A matching hash records your review; it
does not establish that the review was correct. Never renew merely to pass CI.

Stage the complete reviewed candidate with `git add`, then calculate its
certificate from the staged tree. This command changes only the certificate;
review its diff and stage it afterwards:

```sh
python3 - <<'PYTHON'
import hashlib, json, re, subprocess
from pathlib import Path

tree = subprocess.check_output(['git', 'write-tree']).strip().decode()
entries = subprocess.check_output(['git', 'ls-tree', '-rz', '--full-tree', tree])
inputs = []
for entry in entries.split(b'\0')[:-1]:
    metadata, path = entry.split(b'\t', 1)
    prose = re.fullmatch(rb'(?:docs/(?!receipts/)(?:[^/]+/)*[^/]+\.md|[^/]+\.md)', path)
    normal = all(part not in (b'.', b'..') and b'\\' not in part for part in path.split(b'/'))
    if path == b'scripts/ci-docs-audit.json':
        continue
    if metadata.startswith(b'100644 blob ') and prose and normal:
        continue
    inputs.append(entry + b'\0')
audit = {'version': 1, 'inputSha256': hashlib.sha256(b''.join(inputs)).hexdigest()}
Path('scripts/ci-docs-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
PYTHON
```

Commit with your sign-off before running `node --test scripts/ci-docs.test.mjs`.
The real-checkout check reads committed Git objects, so staged or unstaged
renewals cannot satisfy it. CI runs the same check on the exact candidate head.
After any additional non-document change, review and renew again before pushing.
Keep the full package and dependent-package checks required for your change.

## The reviewed tree for this repair

The previous certificate last matched `ef2e67fa820f6c13f75759542b81867f5e028df4`
(#142). The next commit, `a7325e0b40e8516389089c7625a1fb9832c61f9a` (#144),
changed the workflow, planner, receipt runner and summary without renewal.
Its new receipt runner invokes named package commands and reads `CI_PLAN`;
it does not consume exempt prose. Fixture-only documentation tests still
passed because they created their own valid certificates. No test checked
whether the real repository certificate was current.

Renewal for this repair covers the tracked changes from that reviewed tree
through `9ae64c55ce9b42e72d3a7d06deb4fcc5f51fa94d` and the new checkout check.
The later CI readers consume Git inventories, source modules, manifests,
lockfiles and saved JSON fixtures. Package source discovery reads JavaScript
and TypeScript, not Markdown. The address evaluation reads JSON corpora and
local request journals; its files under `docs/evaluations/` remain pinned.
The backup startup change reads container state, and the registration changes
are tests. None adds an exempt Markdown reader.

The existing identity tool reads `packages/identity/SOURCE.md`, which remains
outside the exemption. The release helper reads notices from the separate
Waitron checkout and its staged package, not Cloud prose. Gateway checks read
`docs/receipts/` JSON, which also remains pinned. The repair changes no planner
exemption, immutable-tree check, fallback, job requirement or product behavior.

Run the fixture checks for altered, missing and malformed evidence, mixed
code/document changes and linked Markdown, as well as the real-checkout check.
A local temporary revision with only a prose change should select documentation;
a mixed revision must retain full work. These local proofs need no extra PR.
