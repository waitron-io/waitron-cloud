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

The planner checks its committed checkout on every run and emits a prominent
GitHub warning when the certificate is unavailable or stale, including for code
paths that never enter the document selector. It keeps the existing safe fallback.

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

Commit with your sign-off, run `node --test scripts/ci-docs.test.mjs`, and verify
the actual committed certificate with this direct production check:

```sh
node --input-type=module - <<'JAVASCRIPT'
import {execFileSync} from 'node:child_process';
import {auditDocumentation} from './scripts/ci-docs.mjs';
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
auditDocumentation(git('rev-parse', 'HEAD').trim(), git);
console.log('Committed documentation audit is current');
JAVASCRIPT
```

The check reads committed Git objects. An uncommitted renewal cannot satisfy it;
a staged breakage also remains invisible until committed. CI checks the exact
candidate checkout. After any further non-document change, review and renew again
before pushing. Keep the full package and dependent-package checks for your change.

The documentation and root-script certificates currently fingerprint each other.
Renewing either invalidates the other. The lockfile certificate also pins the
documentation certificate. For that reason the planner warns rather than requiring
all these certificates to remain current simultaneously. Each selector still
requires its own valid evidence in both saved trees. Restoring all shortcuts
together needs a coordinated audit design in the wider precise-selection work;
do not remove a pinned input merely to make their hashes agree.

## The reviewed tree for this repair

The previous certificate last matched `ef2e67fa820f6c13f75759542b81867f5e028df4`
(#142). The next commit, `a7325e0b40e8516389089c7625a1fb9832c61f9a` (#144),
changed the workflow, planner, receipt runner and summary without renewal.
Its new receipt runner invokes named package commands and reads `CI_PLAN`;
it does not consume exempt prose. Fixture-only documentation tests still
passed because they created their own valid certificates. No test checked
whether the real repository certificate was current.

Renewal for this repair covers the tracked changes from that reviewed tree
through `9ae64c55ce9b42e72d3a7d06deb4fcc5f51fa94d` and the unconditional planner
warning. Build contexts can copy prose, but the inspected build steps do not
execute or validate it.
The later CI readers consume Git inventories, source modules, manifests,
lockfiles and saved JSON fixtures. Package source discovery reads JavaScript
and TypeScript, not Markdown. The address evaluation reads JSON corpora and
local request journals; its files under `docs/evaluations/` remain pinned.
The backup startup change reads container state, and the registration changes
are tests. Source inspection found no new exempt Markdown reader. This is not a
runtime proof for every possible external command or environment.

The existing identity tool reads `packages/identity/SOURCE.md`, which remains
outside the exemption. The release helper reads notices from the separate
Waitron checkout and its staged package, not Cloud prose. Gateway checks read
`docs/receipts/` JSON, which also remains pinned. The repair adds diagnostics without
changing any planner exemption, immutable-tree comparison, fallback, job requirement
or product behavior.

Run the fixture checks for altered, missing and malformed evidence, mixed
code/document changes and linked Markdown, as well as the planner warning checks.
A local temporary revision with only a prose change should select documentation;
a mixed revision must retain full work. These local proofs need no extra PR.

The certificate does not exempt package Markdown or receipt data. Selected root
scripts and receipt suites have separate input audits. A lockfile-only change has
its own [bounded package-selection audit](ci-lockfile-audit.md). Wider path
selection and measured job grouping remain open in the precise-selection plan.
The existing equal-tree merge reuse remains in place.

When a documentation-only pull request passes and its merge has the identical
tree, the main run reuses that result and also skips package suites. This proves
the same documented selection, rather than rerunning previously unchanged code.
It does not establish that an unrelated failing or intermittent test has recovered.
