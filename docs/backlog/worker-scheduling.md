# Worker scheduling qualification

## Worker shutdown during polling and error reporting (D459)

Local checks cover shutdown of the worker loop, the email, monitoring and translation
commands (idle, blocked on a lock, during a held or lost SMTP reply, after query
cancellation, statement timeout and a lost connection), and the loop's timers, failures and
clock corrections. They are `packages/registration/test/worker-loop-*.test.ts`,
`packages/registration/test/{email,monitor}-worker-*shutdown.test.ts`,
`packages/registration/test/worker-command-natural-exit.test.ts` and
`packages/translation/test/worker-*.test.ts`.

In one Linux run the account mail command in production SMTP mode exited 14.903 seconds after
SIGTERM with the send already in progress; the test allows 22. The SMTP code has a 15-second
deadline and the worker a separate 20-second one. Stop allowances differ: the
[Compose mail worker](../../compose.yaml#L118-L128) has 10 seconds, the
[local capture pod](../../deploy/kubernetes/local-checks.yaml#L15-L19) 15, and the
[services pod](../../deploy/kubernetes/services.mjs#L32-L35) the platform's 30.

**Open:** measure shutdown inside the actual deployment, including a stop during a database
claim, when a send can begin after the signal; explicit pool cleanup (session checks cannot
tell it from sockets closed at exit); other SMTP stages and a real relay, where a lost
acknowledgement may duplicate delivery; a database-wide outage or network interruption;
other command modes, longer waits, retention that changes stored jobs, alert recipients and
real database scheduling and recovery. The cancellation and timeout controls compare against
the first observation's start; their stronger post-failure ordering is unqualified.

[PR #1320's registration shard 1](https://github.com/waitron-io/waitron-cloud/actions/runs/44513881789/job/135525039524)
had a fixture query cancelled (`57014`) during the SMTP hold in the SIGINT case. The cause is
open; keep the statement deadline and capture the database wait if it recurs.

#### Migration setup timeout remains unexplained (D530)

[Registration shard 1's original failure](https://github.com/waitron-io/waitron-cloud/actions/runs/42051650100/job/127329749507)
is in the shared setup hook: migration ordinal 13 hit `57014` under its 3,000 ms cap, before
GitHub's published Actions incident that day. [PR #1042's merge](https://github.com/waitron-io/waitron-cloud/actions/runs/42315045019/job/128228431661)
later failed migrations 035 (5,000 ms) and 024 (10,000 ms) on shard 3 and killed a
blocked-transaction shutdown case with SIGKILL. Nothing joins these, and passing reruns and
Debian runs repair none of them.

Keep every cap and exit assertion. On recurrence, read the `cloud-test-setup-waits` report
beside the migration stage (exercise it with
`node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/setup-wait-diagnostics.test.ts`),
and capture runner health separately. Lock contention, slow storage and runner scheduling are
unproved explanations.
