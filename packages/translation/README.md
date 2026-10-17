# Menu translation

Use this package to suggest missing customer-facing menu names without publishing them.
Cloud accepts signed background jobs, checks the venue owner's current consent, translates
and reviews batches, and retains the results for the venue to collect. Your Waitron caller
must save every page before releasing the job. The
[wire contract](../../docs/waitron-integration-contract.md#translate-all-version-1)
defines signatures, request limits, cursor paging and refusals.

Translation stays off until the remaining quality trials, joint Waitron paging proof and
[launch decisions](../../docs/launch-evidence.md) are complete. Local fake-provider tests
establish protocol behavior, not translation quality or permission to send real menus.

## Run the worker locally

Apply the registration migrations to your local `DATABASE_URL`, supply
`CLOUD_OPENAI_API_KEY` through your ignored environment, then run:

```sh
pnpm translation:worker --once
pnpm translation:worker
```

`--once` sweeps old menus, processes at most one available job and exits. Continuous mode
runs two jobs at once, with up to four batches per job. `DATABASE_URL` and a nonempty
`CLOUD_OPENAI_API_KEY` are required. `CLOUD_OPENAI_BASE_URL` is optional and defaults to
`https://api.openai.com/v1`; only use an override for your local fake server. It accepts
HTTPS, or HTTP on `127.0.0.1` or `localhost`. Inside a container, loopback means that
container; a fake server in another Compose service needs HTTPS. Redirects are refused and each provider call has a 120-second deadline.

To run the worker in the [local Compose stack](../../docs/local-deployment.md), build
and migrate that stack first, export your local provider settings in the shell, then run:

```sh
docker compose --env-file deploy/local-stack/local.env --profile translation up -d translation-worker
```

The worker waits for migrations, restarts unless stopped, and has fifteen seconds to stop.
It is absent from the default stack. The Compose account service receives
`CLOUD_TRANSLATION`, default `0`; the worker alone receives the provider key and base URL.
The runtime passes only the database and those explicit provider settings to the worker.
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
before activation. Retained-history scan growth and dispatch age between sweeps still need
[qualification](../../docs/backlog.md#translate-all-approved-design-implementation-still-open).

Operational errors use fixed messages so menu names, generated text, keys and authorization
headers do not enter diagnostics:

- `Translation worker failed; check database, migrations and provider configuration`
- `Translation worker pass failed; retrying`
- `Translation worker cleanup failed; retrying`

A fatal database-client error exits with the first message alone; interrupted cleanup
does not announce another retry. Database connection errors use the first message too. The enabled account server reports
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
integration belong to that experiment. The new trial runner and grading page remain Task 21.
Fresh quality measurements, owner Tasks 22–24, require the real key and owner grading after
2 November 2026. They remain release gates; rescoring old results does not satisfy them.
