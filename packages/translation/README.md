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
container. Redirects are refused and each provider call has a 120-second deadline.

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

Database connection errors use the first message too. Inspect configuration, migrations
and local service availability without logging request or provider response bodies.

## Verify behavior

Run the full package suite against disposable PostgreSQL and local fake providers:

```sh
node scripts/test-postgres.mjs --filter @waitron-cloud/translation test
```

CI selects this package through workspace discovery and source consumers. Quality trials
are separate from `test/*.test.ts`; owner Tasks 22–24 require the real key and remain
owner-run after 2 November 2026.
