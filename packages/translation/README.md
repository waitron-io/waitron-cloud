# Menu translation

Use this package to suggest missing customer-facing menu names without publishing them.
Cloud accepts signed background jobs, checks the venue owner's current consent, translates
and reviews batches, and retains the results for the venue to collect. Your Waitron caller
must save every page before releasing the job. The
[wire contract](../../docs/waitron-integration-contract.md#translate-all-version-1)
defines signatures, request limits, cursor paging and refusals.

Outbound AI is denied until a separate privacy-reviewed input rule and supplier/location
evidence receive owner acceptance. This includes apparently harmless menu text.
`createOpenAiClient(...).respond(...)` always refuses without sending a request, reading
the input or charging tokens. A regional URL or enable flag cannot change that.
Translation also stays off until the remaining quality trials, joint Waitron paging proof and
[launch decisions](../../docs/launch-evidence.md) are complete. Local fake-provider tests
establish protocol behavior, not translation quality or permission to send real menus.

## Run the worker locally

Apply the registration migrations to your local `DATABASE_URL`. With ordinary settings,
the worker settles queued jobs as `provider_unavailable` without calling AI. For synthetic
proof only, start a fake server on literal HTTP `127.0.0.1` with an explicit port, and set:

```sh
export CLOUD_TRANSLATION_LOCAL_PROOF=1
export CLOUD_OPENAI_BASE_URL=http://127.0.0.1:4010/v1
export CLOUD_OPENAI_API_KEY=synthetic-local-proof-key
```

Then run:

```sh
pnpm translation:worker --once
pnpm translation:worker
```

`--once` sweeps old menus, processes at most one available job and exits. Continuous mode
runs two jobs at once, with up to four batches per job. `DATABASE_URL` and a nonempty
`CLOUD_OPENAI_API_KEY` are required. Only the explicit proof flag together with a strict
loopback URL selects `createLoopbackOpenAiClient`. Missing ports, HTTPS, `localhost`,
alternate numeric spellings, credentials, queries and fragments are refused. Inside a
container, the fake server must run in that same container. Redirects are refused and
each local provider call retains its 120-second deadline. This test transport approves
neither content eligibility nor production processing.

To run the worker in the [local Compose stack](../../docs/local-deployment.md), build
and migrate that stack first, export your local provider settings in the shell, then run:

```sh
docker compose --env-file deploy/local-stack/local.env --profile translation up -d translation-worker
```

The worker waits for migrations, restarts unless stopped, and has fifteen seconds to stop.
It is absent from the default stack. The Compose account service receives
`CLOUD_TRANSLATION`, default `0`; the worker alone receives the provider key and base URL.
The runtime passes only the database, explicit proof flag and provider settings to the
worker. Other roles receive no proof flag. Test-cloud translation remains unavailable.
To test the API locally, set `CLOUD_TRANSLATION=1` in the shell and recreate `account`
with the same `--env-file`. The direct account command also needs
`CLOUD_INSTALLATION_ISSUER_KEY`; Compose supplies its persisted local issuer.
The switch does not record owner consent or grant a caller installation authority.
Stop the optional worker with the same Compose prefix and `stop translation-worker`.

## Spending and retained text

The approved safety cap is US$5 per venue per UTC calendar month. It gates new submissions
and provider calls using recorded model prices. Batches already sent when the cap is reached
can finish and overshoot it; this is not a strict payment ceiling or a billing policy.
Up to four batches per job may be in flight. Retries and review calls also count.

Release deletes the menu and results. Otherwise, bounded sweeps delete finished menus
24 hours after completion and abandoned menus 24 hours after submission, preserving job
accounting and usage events. The worker sweeps at startup and every minute. The account
server also sweeps when `CLOUD_TRANSLATION=1`, even without a worker. A pass handles at
most 100 jobs by default, so a backlog needs further passes. Cleanup failure pauses new
worker jobs and retries after a minute. Enabled account startup cleanup failure refuses
listening; scheduled failure retries while it keeps serving. Review that availability policy
before activation. While waiting for cleanup, jobs submitted at least 24 hours ago cannot
receive a new work lease, so other venues' younger jobs can run. That venue still sees its
old job as queued or running and cannot submit another until the sweep expires it and
deletes its body. Retained-history scan growth and jobs aging after lease admission need
[qualification](../../docs/backlog.md#translate-all-approved-design-implementation-still-open).

Operational errors use fixed messages so menu names, generated text, keys and authorization
headers do not enter diagnostics:

- `Translation worker failed; check database, migrations and provider configuration`
- `Translation worker pass failed; retrying`
- `Translation worker cleanup failed; retrying`

After a fatal database-client error, interrupted cleanup adds no retry message.
Database connection errors use the first message too. The enabled account server reports
scheduled cleanup failure as `Account server translation cleanup failed`. Inspect configuration, migrations
and local service availability without logging request or provider response bodies.

## Verify behavior

Run the full package suite against disposable PostgreSQL and local fake providers:

```sh
node scripts/test-postgres.mjs --filter @waitron-cloud/translation test
```

CI selects this package through workspace discovery and source consumers. Its ordinary test
command includes the offline scorer tests in `quality/`; these never call a provider.

## Score the recorded trial

You can reproduce the owner's 14 October grades without a key. From `packages/translation`, run:

```sh
pnpm quality:test
pnpm quality:score --set tuning quality/data/trial-results/tuning/*.json
pnpm quality:score --set blind quality/data/trial-results/blind/*.json
```

The total rows are `| total | 252 | 2% | 4% | 6% | 0 |` for tuning and
`| total | 243 | 2% | 2% | 5% | 0 |` for blind. Columns show written names, needs work,
wrong, their combined marked share, and ungraded names. Given names kept unchanged do
not count. An unmarked name counts as accepted only when the owner was shown that exact
product, language and text. A new name is listed as ungraded so a prompt change cannot
appear to improve quality merely by producing unseen text.

Result files contain a JSON object with a `names` map keyed by product id. The scorer trims
written text and compares only Catalan, Spanish and English, matching these recorded sets.
It prints menu text locally for grading; it is not a production worker diagnostic.
The command refuses errored runs, reported failures, wrong-set ids, non-text names,
empty scores and repeated files. It validates every file before printing a table.
For partial results it names the missing products and languages on standard error;
percentages still cover only the names actually written. They do not establish complete
coverage or a release-quality pass. Whole-number percentages round exact halves up,
as the approved port specifies; the original Python formatter rounded ties to even.
Keep new results under the ignored `quality/results/` directory.

`quality/original/` and `quality/grading.template.html` preserve the experiment verbatim;
do not run the archived Python scripts. Their paths, provider calls and grading-store
integration belong to that experiment. The maintained runner uses the same parser and two-pass logic with the explicit local
transport; the page builder uses a separate page template.
Fresh quality measurements, owner Tasks 22–24, require the real key and owner grading after
2 November 2026. They remain release gates; rescoring old results does not satisfy them.


## Quality harness

Before you ship a prompt, model or batching change, score it against both recorded sets
and include the results in your pull request. You need new owner grades for unseen names;
an empty ungraded count from old results does not qualify a new prompt.

`quality/trial.ts` runs the production parser, batches, prompts, reply checks and two-pass
client against the selected set. `quality/build-grading.ts` creates a page containing only
new names, sorted within each product and language, with the model hidden. Its maintained
`page.template.html` offers English and Spanish and follows your light or dark theme.
The copied `grading.template.html`, `original/` and all recorded data remain unchanged.

Real quality trials remain blocked after 2 November until the separate privacy and
supplier gates are accepted and a reviewed enabling change lands. For synthetic proof
only, use the local settings above and run from `packages/translation`:

```sh
pnpm quality:trial --set tuning --runs 3
pnpm quality:score --set tuning quality/results/tuning-*.json
pnpm quality:grading --set tuning --round r2 quality/results/tuning-*.json
```

Repeat with `blind`. The trial accepts 1–10 repeats and an optional `--out <directory>`.
It refuses ordinary settings before creating output. Explicit local proof uses a fake
provider and synthetic key; it supplies no translation-quality measurement. Each output file records the set, prompt version,
model, repeat, names, failed items, usage and estimated cost at the recorded model prices.
Files have unique names and private permissions. The trial has no production venue budget;
keep these manual runs small. It prints file paths, and exits unsuccessfully if a first pass
or review failed. A failed review retains its first-pass names for diagnosis but cannot
qualify a complete two-pass quality result.

The page command writes `quality/grading-<set>.html` and its `-keys.json` companion. These
are ignored local outputs. It rejects malformed, failed, wrong-set or repeated input files
before replacing either output. Failed trials retain their partial output for diagnosis; both commands refuse them.
The scorer reports missing coverage for partial files without reported failures,
including older manually assembled inputs. Given names, placeholders, previously shown names
and previously marked names are excluded from the choices. Spelling corrections are
retained in result files but this page grades customer-facing names only. In manually edited
or older files, the scorer can count an altered given name or text on a placeholder that
the page excludes. Regenerate these inputs through the production trial instead of treating
an absent grading choice as accepted. If either output write fails, correct the output path
and regenerate both files before using them; the pair is not written as one transaction.

To save marks, open the page with its grading database through the existing
`window.claude.use("db")` bridge. Without it, you can read the page but its mark buttons
stay disabled. The local browser test uses a controlled store; it does not verify that
external bridge or publish a grading page. A failed save leaves the last confirmed mark
and asks you to retry. The owner's existing export process writes one mark per file with
`pid`, `lang`, `text` and `verdict`; merge the companion keys into the matching shown file
only after grading, then rescore. Use a new `--round` value for a new reading round;
reusing it keeps that round's stored done markers. Never treat a newly displayed, unread page as accepted.

Owner Tasks 22–24 in the [approved plan](../../docs/superpowers/plans/2026-10-14-translate-all.md#task-22-owner-involved-needs-the-real-key-score-the-templated-prompt-against-both-graded-sets)
retain their commands and release criteria. They cover both-set quality, house-style
measurement and variants, option labels and menu sections. They remain owner-only after
2 November; this harness does not run or satisfy those measurements.
