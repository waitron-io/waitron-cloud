# Package reader declarations

A directory scan does not always discover source code. The installed-dependency
copier reads `node_modules`; gateway workers read certificates and runtime JSON;
backup tests inspect their own scratch directories. Treating every scan as an
unknown source loader makes even a portal change run every package.

The saved package graph uses the exact reader versions in
[`scripts/ci-package-readers.mjs`](../scripts/ci-package-readers.mjs). Each
entry records its Git mode, object type and blob identifier, which identifies
its complete bytes. When the graph visits a declaration, both saved revisions must match independently.
In the current graph, an edit to any of the 40 declared readers also fails the required real-graph
root check until you review the changed reader and renew its identifier. The
planner keeps full package work while that check is red.

The declarations distinguish directory operations from source inputs. `nonSourceDirectoryReads` identifies
reviewed directory operations on installed dependencies, runtime data or owned
fixtures. `directoryReferences` lists exact quoted values that do not enumerate
source helpers. For example, a path-validation check for `.` and `..` must not
load every deployment script. A declaration that only excludes quoted values
cannot exclude a value that its admitted URL reader actually scans, including
readers with options. That conflict refuses narrowing. `sourceReferences` records known computed
helper paths and package inputs explicitly, so the graph does not rely on an
unrelated import continuing to provide the same edge.

File references, sibling package imports and helper chains remain visible.
Directory exclusions leave direct files, extension resolution and index modules
available. A visited set bounds helper cycles. Unrecognised readers keep the
existing source-discovery checks, including computed and indirect calls, escaped
names, glob readers and unsupported directory options. This is reviewed evidence
for specific programs, not a complete JavaScript parser.

## What the declared versions read

| Reader group | Directory use |
| --- | --- |
| Installed-dependency copier | The installed root graph and workspace `node_modules`; relative links resolve inside the candidate. |
| Gateway CLI | PEM certificates under `/input/public-certs`. |
| Gateway traffic runtime, collector and spool | Private runtime journals and signed JSON reports; the tests inspect their owned fixtures and child-process state. |
| Backup verification child | Compiled Waitron migration-journal presence, outside the Cloud workspace. |
| Backup verifier, transfer and claim tests | Owned temporary download, restore and staging directories. |
| Translation scorer and tests | Grade JSON, archived byte inventories and generated results within the translation package. |
| Translation launcher test | Generated child discovery under `/proc` in its owned container. |
| Capacity and storage fixtures | Temporary object-store, extraction and download state. |
| Guard probes and deployment wrappers | Inert path-validation values, known mutation targets and fixture roots; literal helper/source files remain graph inputs. |

The declaration file lists all 40 exact versions. These declarations leave every runtime reader and package
test unchanged. The new controls execute a real helper consumer,
retain a base-only consumer through a helper cycle and dirty live files, and
reject changed reader bytes, executable/link modes and unknown readers. The live
fallback test inserts a genuine unresolved reader into its disposable clone,
keeping every original refusal and package-selection assertion.

## Measure selection before claiming savings

The local D571 part-2 measurement uses the same immutable base and head,
`4ee15a61828cc3e6844bb9cdb11fd1339de2cc12`, and the candidate selector. It is a
selection measurement, not a GitHub runtime measurement.

| Changed package | Selected packages | Package job groups |
| --- | ---: | ---: |
| portal | 1 | 6 |
| ui-smoke | 1 | 1 |
| identity | 9 | 28 |
| account-http, backups, operations, registration, remote-access or translation | 8 | 28 |

Those historical counts use the full dependency closure. The current
[direct-consumer policy](ci-package-selection.md) also preserves saved source
and helper inputs. A local replay after integration with current main uses
synthetic source paths against both identical immutable graphs and selects:

| Changed package | Selected packages | Package job groups |
| --- | ---: | ---: |
| portal | 1 | 6 |
| ui-smoke | 1 | 1 |
| account-http, registration or remote-access | 7 | 28 |
| backups or translation | 6 | 24 |
| identity | 5 | 23 |
| operations | 2 | 7 |

These are graph selections, not executed package checks or duration savings.
Real imports, shared fixtures and explicitly declared generated inputs remain
consumers; a smaller result needs evidence for removing an edge.
These counts describe package jobs only. Type checking and root checks keep
their existing rules. Whenever these declarations qualify narrower package
work, all six existing receipt suites remain selected. Package precision does
not prove that an independent receipt can be omitted. Receipt reductions need
separate evidence, including Cloud-cost consumers of portal or UI build tools.
If any package reader refuses validation, the planner keeps all package work
and uses the independent receipt audits. Visiting an approved reader before
that refusal cannot override those audits. The historical local-stack fixture
supplies an explicit unknown reader so this fallback remains exercised as more
real readers gain declarations.

## Review and renew a declaration

Read the whole changed reader, its generated programs and the directories it
actually visits. Account for any source loader and every helper it runs.
Quoted generated programs can hide inner paths from the broad quote scanner;
record every embedded or computed Cloud helper and package input explicitly in
`sourceReferences`. Do not infer completeness from a matching identifier. Keep an
uncertain operation unresolved. Then record the reviewed bytes with
`git hash-object <reader-path>` and update its exact declaration. Never renew
these identifiers automatically.

Run the controls explicitly:

```sh
node --test scripts/ci-installed-reader.test.mjs scripts/ci-package-reader-boundaries.test.mjs
node --test scripts/ci-package-revisions.test.mjs scripts/ci-scope.test.mjs
```

The real immutable portal control also makes a newly stale declaration fail its
own root checks. If a new genuine consumer changes the measured graph, preserve
that consumer and resolve the changed acceptance check through the campaign's
changed-check rule. Do not remove an edge to recover an old job count.

Review the combined readers again after a rebase. [Ordinary reader review](ci-documentation-audit.md)
replaces generated review records. The directory declarations above retain their
separate checks. The current direct-consumer policy keeps its dependency-depth and test-file
selection rules. Separate root-input, proof-workflow, merge-reuse and nightly
checks retain their own evidence.
