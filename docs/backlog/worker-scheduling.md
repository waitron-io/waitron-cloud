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

The [27 November main run](https://github.com/waitron-io/waitron-cloud/actions/runs/45979089526/job/140438311840)
hit `57014` in migrations 035, 045 and 016 on shard 5. Two reports sampled repeated
`WALWrite` waits. A [disk-pressure run](https://github.com/waitron-io/waitron-cloud/actions/runs/45987713054/job/140467459086)
passed all 346 cases. The waiting process was observed, and the writer and its storage latency are still unknown.
Each registration shard job starts its own PostgreSQL server. The disk-pressure
run observed three file workers sharing that server, with `fsync`,
`synchronous_commit` and `full_page_writes` on and `wal_sync_method=fdatasync`.

On recurrence, read `cloud-test-setup-waits` beside the migration stage. Its `database`
snapshot records when it was taken, up to 24 live processes and the total that
matched. It follows cancellation, so use the earlier `samples` to see what the
timed-out process was waiting for. If the new snapshot shows contention, compare
the active sessions and their wait events with those earlier samples. You can
exercise both
with `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/setup-wait-diagnostics.test.ts`.
