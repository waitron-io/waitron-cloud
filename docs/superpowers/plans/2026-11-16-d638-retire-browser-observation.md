# D638: Retire the qualified browser observation

You no longer need a separate observation job once both Linux groups qualify the
pinned lifecycle repair. Lane G's `queue.md`, item D638 (16 November), asks to
read the retained summaries first, retire only observation-owned code on success,
and preserve historical unknowns, original browser waits and apt-only setup.
Codex wrote this plan; Claude reviews it and the watcher clears execution.

## Qualification already read

[Run 42296821904](https://github.com/waitron-io/waitron-cloud/actions/runs/42296821904)
checks out `5bb3a2828d67f35d3953378b9941c0d3c30abdaf`. Both `application` and
`application-one-cpu` jobs are successful. Each retained `summary.json` contains
24 consecutive zero-exit samples and `controlsExit: 0`. Each controls log reports
eight passes, including all six original faults: extra config, missing cookie,
missing bundle, late asset error, page error and outside request. Logs name
Waitron `99c265981ba98f1afd0e5fc822624a9a91822ad2`, the current browser pin.
Artifacts 13542797059/13542927043 and their small extracted records are retained
outside the checkout in Lane G's `receipts/d638/`. No historical reset cause is
inferred from this passing sample, and no new run is required by the item.

## One small removal

Delete `.github/workflows/browser-reconnect-diagnostic.yml` and the eight files
under `scripts/cloud-cost/diagnostics/` after confirming no retained caller imports
them. Remove only this workflow's entries from `scripts/ci-pnpm-diagnostics.test.mjs`
and `scripts/ci-cache-location.test.mjs`; preserve every retained workflow assertion.
This intentionally deletes an observation check and its private instrumentation
tests. List those deletions under **Changed test checks** in the pull request;
name the lost 24-sample repetition, single-CPU coverage and automatic browser-edit
trigger, plus the retained conformance journey/eight faults and readiness checks.
The queue explicitly says: "Deleting the job deletes a check, so under THE RULE's
changed-test-checks clause the plan names it, the watcher's plan read is the
go-ahead, and the PR lists it under 'Changed test checks'." Execution waits for
the watcher's explicit clearance of this named removal.

Reduce `docs/backlog/browser-reconnect.md` to its open historical reset attribution,
retained waits/accounting/privacy rules and links to active readiness checks.
Keep the refusing runs 40920925400, 40922185069, 40988995366, 40990548906,
41023281681 and 41028304505 with their sample/route categories, and the distinct
historical replay pin `fbadd15785464e59747e697c11048bfbc6e4938f`. This scoped
pruning supersedes the older replay-design instruction to leave that prose intact.
Review also retained the explained drain-failure run 40926773548.
Remove the dead navigation-evidence test command. Delete the reconnect-retirement
sentence in `docs/backlog.md`, preserving apt-only qualification, and change its
earlier claim that the observation groups are still kept to historical wording.
Correct present-tense observation references in
`docs/backlog/ci-cache-saving.md` and annotate the historical workflow row in
`docs/superpowers/specs/2026-11-06-disposable-test-server-design.md` as retired.
Leave the real browser, its fixtures, pin, fault controls and APT setup unchanged.

## Verification and size

Run the two changed root test files, `scripts/cloud-cost/browser-readiness.test.mjs`,
and `scripts/ci-docs.test.mjs`; check changed local links and `git diff --check`.
Search all tracked files, including `.github`, for remaining executable references.
Finish with Claude's whole-branch review, exact-head CI and merge evidence.
Expected: about 900 removed lines, fewer than 100 added (including this plan);
production instrumentation about 250 removed, tests about 260 removed plus two
list entries, workflow about 120 removed, documentation about 250 removed.
No new helper, test suite, workflow, deployment, provider access or timing change.

Review measured 123 added and 913 removed before wording fixes: the added-line
estimate was exceeded, while total change stayed below the 1.5× stop.
