# Documentation-only CI

A prose edit should not need the database and browser suites. When you change
only regular Markdown at the root or under `docs/`, CI selects the document
formatting job. It reads the exact Git blobs, checks UTF-8, rejects NUL characters
and requires a final newline. A deleted document is accepted if it was regular
in the earlier revision. Links and executable files do not qualify.

Two documents are inputs to real checks: `docs/waitron-integration-contract.md`
and the generated `docs/cloud-cost-model.md`. Their changes keep product checks.
Package Markdown and everything under `docs/receipts/` also keep their owners.

CI compares both saved revisions. Ordinary prose can accompany package changes
without widening their selection. Unknown inputs keep full work. Main pushes
independently verify merge evidence or select their actual changed range; the
[nightly full run](ci-nightly.md) remains a separate backstop.

## Review readers instead of renewing records

You review actual readers instead of generating review records. The old record
folders, JSON metadata and their writers have been removed. Their former paths
have no exemption. Former record paths and other unknown JSON at the repository
root or under `scripts/` retain full standard work and the venue proof when
changed alone or alongside prose, scripts or registered root tests. Cost selectors
retain these inputs for historical evidence; cost now runs manually and nightly.

The owner accepted removing the automatic pause before changed readers inherit
an exemption. Review imports, directory scans, file reads, generated programs,
child commands and installation hooks in the pull request. If a program starts
reading exempt prose, update its ownership and behavioral checks with that
change. Do the same for root scripts and lockfile readers. A full nightly does
not establish that a new narrow exemption has the right owners.

Run the relevant controls with:

```sh
node --test scripts/ci-docs.test.mjs scripts/ci-record-retirement.test.mjs
```

[Root ownership](ci-root-input-ownership.md), [dependency selection](ci-lockfile-audit.md)
and [proof inputs](ci-proof-selection.md) explain the other boundaries. Receipt
pins and directory-reader declarations keep their existing checks. Merge source
plans, decision readback and the strict required-job summary also remain; follow
the [merge evidence checklist](ci-merge-evidence.md) before counting skipped jobs.
