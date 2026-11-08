# Verify a merge's CI evidence

A squash commit can contain exactly the files already checked on its pull
request. Standard CI and AWS infrastructure
can reuse that workflow's successful PR attempt when the Git trees match.
The main run still executes a planner and a strict summary. Neither a green
label nor a skipped product job proves reuse by itself.

Cost has no PR trigger, and cost and venue have no main-push trigger. Venue PRs
select their own proof inputs; manual and nightly runs execute both complete
proofs. AWS starts only for its infrastructure and bootstrap paths; Kubernetes
prerequisites start only for their proof paths on PRs and main pushes. Record an
absent workflow as excluded only after checking its actual trigger against the
changed paths. An excluded workflow supplies no inherited tests. Historical download-diagnostic
records keep the same expected fields. Hosted readback still requires an active
workflow (`scripts/ci-decision.mjs:79`); if GitHub reports the deleted workflow as
inactive, readback refuses those older records.

## Read the decision before counting tests

For every triggered workflow, save the exact merge SHA, tree, run ID and attempt,
then read all final jobs and their logs. The run retains one main artifact
named `ci-decision-v1-<workflow-key>-<run-id>-<attempt>`. It contains only
`plan.json`. The step summary links any inherited PR and source attempt.
The possible decisions are:

| Mode | What must be proved |
| --- | --- |
| `reused` | Its own complete, successful PR attempt checked the same tree. The current planner and summary pass; product jobs are skipped. |
| `selected` | The selection matches the literal main `before..after` range, including every pushed commit. All selected jobs pass. |
| `full` | The complete current inventory runs because the invocation requires full work or evidence could not justify less. |
| `unselected` | A native proof has a verified nonempty range with no relevant inputs. Its planner and summary pass and its known proof jobs are skipped. |

Download that run's decision and independently check it from an exact merge
checkout with complete Git history:

```sh
gh run download <run-id> --name ci-decision-v1-ci-<run-id>-<attempt> --dir <new-directory>
git checkout --detach <merge-sha>
node scripts/ci-evidence.mjs --readback <new-directory>/plan.json
```

For AWS, use its workflow key. The reader needs
GitHub API read access through `gh`. It binds the local decision to the hosted
artifact and exact main run, reconstructs selected or full work, and requires
every final native job. For reuse, it rechecks the source independently. Save
its output with the raw logs and test counts. A pending, failed, cancelled,
missing or contradictory result keeps the merge check open.

If the planner cannot read its own workflow identity, it runs full work without
publishing reusable source evidence. A successful main summary can complete the
full decision after API access returns. It still verifies every current job and
binds the decision to the actual checkout. A full decision preserves an invalid
original push range for inspection; that range cannot authorize selected or
inherited work. If the API remains unavailable, the summary fails.

Count inherited source passes separately from checks newly executed on main.
A reuse-only merge executes zero new product checks. Its planner and summary
are fresh work; its source test counts are inherited evidence.

## What qualifies a source

Each eligible same-repository PR planner retains its own
`ci-plan-v1-<workflow-key>-<run-id>-<attempt>` artifact with the original event,
exact checkout and tree, workflow identity and selection digest. Evidence from
another workflow cannot fill a gap. The verifier requires one merged PR in this
repository, matching trees, the latest exact-head PR run and its exact latest
attempt, complete paginated job evidence, and the original source artifact.
It reconstructs the selection from immutable Git data using the reviewed
selector. Missing PR objects are fetched only by verified immutable commit hash under the
same bounds, without moving the checkout or branch references. It never executes
downloaded or historical code.

The source and execution workflow definitions must match the reviewed files.
Every selected job must succeed and every unselected job must have its known
skipped identity. The verifier rereads the source before granting reuse; the
current strict summary requalifies it again after main's jobs finish. Newer red
or unfinished attempts defeat older green evidence. Reads have bounded request,
page and time budgets. Missing or uncertain evidence retains full work. The bounded native,
source and readback readers use 30 jobs per page, a 500-record ceiling,
30 requests per verification, 30 seconds overall and five seconds per command.
Readback shares its request budget across main jobs, inherited jobs and source
requalification, so it can refuse before reaching the record ceiling.
Incomplete pages, duplicate IDs and changing totals refuse that evidence.
Numeric links must match an independently read repository ID and name; requests
keep using the named endpoint. The ordinary strict summary also requests
30 jobs per page, through its existing reader and bounded retry sequence. Before
checking job names and results, it requires a stable declared total matching all
delivered records and unique positive job IDs, including skipped and sibling
jobs. Missing pages and contradictory lists fail immediately. Its existing
lookup budgets remain separate from the native verification budgets above.
Both summary types retain their 60-second publication
deadline.

A proven different tree uses the actual push range. Direct and multi-commit
pushes also use that complete range. Forced, deleted, newly created, malformed,
missing, unrelated or empty ranges retain full work. Manual, scheduled and
reusable invocations always run full. A present `full` call input still identifies
a reusable invocation when its value is false. No PR-shaped event can narrow it.

## Keep the nightly backstop separate

The [nightly run](ci-nightly.md) executes standard CI, cost, venue and all four
AWS cells at the same revision, even on an unchanged tree. Its parent requires
all four workflow families and its separate mutation-check job. Check its actual scheduled or manual main execution and final
summary separately; a PR rehearsal does not qualify a successful night.
