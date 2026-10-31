# Worker scheduling qualification

## Worker shutdown during polling and error reporting (D459)

Run `node --test packages/registration/test/worker-loop-shutdown.test.ts` to
check that shutdown interrupts real idle and error-retry timers and lets native
worker processes exit. Pending scheduling and claim error reports finish before
the loop returns, without further claims or waits. Production shutdown and real
database failures remain separate qualification gates.

Run `node --test packages/registration/test/worker-loop-schedule-shutdown.test.ts`
to check pending startup and recurring schedules that finish or reject after
shutdown. Scheduling and any error report finish before the loop returns,
without new claims or waits. Schedule and reporting failures keep their original
errors. Real database scheduling and production shutdown retain separate gates.

Run `node --test packages/registration/test/worker-loop-poll-shutdown.test.ts`
to check pending idle and retry waits that finish or refuse after shutdown. The
loop waits for polling and any late error report, preserves the original failure
and starts no further work. A retry refusal stops without repeated reporting.
Real database cancellation and production shutdown remain separate gates.

### Email command shutdown with real database claims (D536)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/email-worker-shutdown.test.ts` to check the actual email worker
command under SIGINT and SIGTERM. Each signal stops an idle command normally and
closes its database connections. With four claims blocked by an owned table lock,
the command retains all four connections during a one-second hold after the
signal, then exits normally after lock release with no connections left.
The queue stays empty, so these checks send no mail.

Other worker commands, active mail delivery, database failure during shutdown and
production deployment still need separate qualification. These checks do not
claim that shutdown cancels an active database query or that awaiting the worker
loop, rather than pool cleanup, keeps those connections open.

### Email command shutdown during local SMTP delivery (D539)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/email-worker-delivery-shutdown.test.ts` to check shutdown while
the local SMTP server holds its acknowledgement of a complete message. Under
SIGINT and SIGTERM, the command stays live for a one-second hold and keeps the
message processing. After acknowledgement, it records one sent message, clears
its payload and claim, and exits with code zero and no database sessions remaining.
Mail queued during the hold stays pending without a delivery attempt, so shutdown
does not start another batch after the accepted delivery finishes.

These checks use a loopback SMTP server and test addresses. Real provider failure,
delivery timeout, waits longer than one second, natural exit, explicit pool cleanup
and production deployment still need separate qualification. A forced successful
exit after acknowledgement also passes these checks.

### Email command shutdown after a local SMTP refusal (D540)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/email-worker-refusal-shutdown.test.ts` to check SIGINT and
SIGTERM while a loopback SMTP server holds a complete message for one second,
then refuses it. The command stays live during the hold. After refusal, it records
one failed attempt, retains the encrypted payload, releases the claim and schedules
the first retry 30 seconds later. Mail queued during the hold stays untouched.
The command exits with code zero, empty output and no remaining database sessions.
The local transport records the fixed `delivery_failed` code rather than the
server's recipient-bearing reply.

These checks qualify the local transport's retry state during shutdown. Production
SMTP classification, delivery timeouts, waits longer than one second, natural exit,
explicit pool cleanup and production shutdown remain open. A forced successful
exit after recording the retry can also satisfy these checks.

### Monitoring command shutdown with real database scheduling (D537)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/monitor-worker-shutdown.test.ts` to check the actual monitoring
command under SIGINT and SIGTERM. Each signal stops idle polling normally,
with no database sessions remaining after exit. When an owned installations-table
lock blocks startup scheduling, the command retains its connection during a
one-second hold after the signal and exits normally after lock release.
The empty tables prevent observations and alert mail.

These checks protect orderly command shutdown while database work finishes.
They do not prove explicit pool cleanup or cancellation of an active query,
or distinguish waiting in the
worker loop from waiting in pool cleanup. Active monitoring, other commands,
database failures and production deployment retain separate qualification gates.

### Monitoring command shutdown after database query cancellation (D541)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/monitor-worker-cancellation-shutdown.test.ts` to check a real
PostgreSQL scheduling failure during command shutdown. SIGINT and SIGTERM each
leave startup scheduling blocked on an owned table lock for one second. Cancelling
only that command's observed query then produces one fixed observation-failure
diagnostic, empty standard output and code-zero exit with no remaining database
sessions. The table stays locked until exit, so scheduling cannot silently retry
to completion. A no-signal control requires another scheduling query after the
first cancellation, then stops it with SIGTERM and a second cancellation. This
distinguishes signal-driven shutdown from quitting after every database error.

The fixed diagnostic says retrying because it also serves the running worker;
these checks observe shutdown after the failure. They do not prove natural exit
or explicit pool cleanup, since an explicit successful process exit after reporting
can also satisfy them. Connection loss, statement timeouts, active observations,
other database failures, longer waits and production shutdown remain open.

### Translation command shutdown with blocked database cleanup (D538)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec
node --test test/worker-shutdown.test.ts` to check the actual translation command
under SIGINT and SIGTERM while startup retention waits for an owned table lock.
Each signal leaves the command and its blocked connection alive during a
one-second hold. After lock release, the command exits normally with no database
sessions remaining. Empty job, body and usage tables stay empty, and the local
provider receives no request.

These checks observe the blocked connection and command exit. They do not prove
explicit pool cleanup: a process exit can close its sockets too. They also do not
distinguish waiting in the worker loop from waiting in pool cleanup.
Retention that changes stored jobs, query cancellation, database failures and
production deployment retain separate qualification gates. Existing idle and
active-provider signal checks stay in `packages/translation/test/worker-cli.test.ts`.

### Translation command shutdown after database query cancellation (D542)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec
node --test test/worker-cancellation-shutdown.test.ts` to check a real retention
query failure during translation-command shutdown. SIGINT and SIGTERM each leave
the query blocked on an owned table lock for one second. Cancelling only that
command's observed query then produces one fixed cleanup-failure diagnostic,
empty standard output and code-zero exit with no remaining database sessions.
The table stays locked through exit, so another cleanup query cannot complete.

A no-signal control stays live with an idle database connection for one second
after cancellation and reports the failure once. SIGTERM then ends the command
within six seconds with the current 60-second cleanup retry wait. With that
long wait, this catches ignoring shutdown during retry. A shortened wait that
ignores shutdown but expires within six seconds can pass. The control also catches
quitting after every cleanup error and immediately starting another retention
query. It does not observe the full retry interval or its eventual expiry.

The job, body and usage tables start and end empty, and the loopback provider
receives no requests. These are fixture boundaries, not proof about retention
that changes stored jobs. Natural exit, explicit pool cleanup, longer waits,
statement timeouts, connection loss and production shutdown remain open. A forced
successful exit after error reporting can also satisfy the signalled cases.

### Idle email and monitoring commands drain naturally (D543)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/worker-command-natural-exit.test.ts` to check idle email and
monitoring shutdown under SIGINT and SIGTERM. Each command first reaches four
idle connections after real empty-queue claims. A wrapper observes Node's
`beforeExit` event, which runs when its work drains and is bypassed by a forced
exit. Shutdown must reach that event with code zero within six seconds and leave
no database sessions. The bound catches an omitted pool close before the default
ten-second idle connection expiry can mask it.

The wrapper observes the actual commands without replacing database or worker
methods. These checks cover empty queues only. Natural drain during active work,
database failures, translation shutdown and production remain open. They do not
identify which cleanup method released the connections.

## Worker scheduling deadlines and polling failures (D468)

Run `node --test packages/registration/test/worker-loop-callback-refusals.test.ts`
to check immediate scheduling and polling throws at two and 32 slots. Pending
reporting prevents claims and retry waits; successful reporting still waits before
retrying. A rejected reporter terminates with its original error while the worker
signal remains live. Without a reporter, the original callback error propagates.
Real database failures and production shutdown remain separate gates.

Run `node --test packages/registration/test/worker-loop-timing.test.ts` to
check that scheduling starts its next interval after completion and polling meets
the next deadline. Polling failures retain their original cause, report before
retrying and stop if the retry timer fails. Production scheduling and real database
failures remain separate qualification gates.

Run `node --test packages/registration/test/worker-loop-recurring-recovery.test.ts`
to check overdue recurring schedules that fail after a successful startup. At two
and 32 slots, busy and idle batches wait for reporting and the retry delay before
new claims. Successful recovery starts the next interval after scheduling finishes;
idle polling still meets that deadline. Real database scheduling and production
recovery remain separate gates.

## Worker failure and reporting boundaries (D467)

Run `node --test packages/registration/test/worker-loop-failures.test.ts` to
check that failed scheduling delays retries and prevents claims, busy claims keep
the scheduling cadence, and error reporting waits for every active claim. A failed
error report stops the loop. Production scheduling and real database failures
remain separate qualification gates.

Run `node --test packages/registration/test/worker-loop-isolation.test.ts` to
check two independent workers at two and 32 slots. One worker's pending error
report permits the other to schedule, claim and poll. Stopping either worker first
preserves the other's pending work and cancellation signal; reporting still finishes
before shutdown or retry. Real database failures and production process isolation
remain separate qualification gates.

Run `node --test packages/registration/test/worker-loop-config.test.ts` to
check that invalid capacity and timer settings refuse before scheduling, claims
or error recovery, even at stopped startup. Valid minimum timers and the supported
capacity boundaries still run. These checks protect startup configuration; real
database work and production capacity retain their separate gates.

Run `node --test packages/registration/test/worker-loop-timer-limit.test.ts` to
check that polling delays above 2,147,483,647 milliseconds refuse before callbacks.
Node turns larger delays into one-millisecond waits, which would repeatedly poll
instead of pausing. The maximum supported delay still reaches polling unchanged
and lets native idle and retry processes stop cleanly. Longer scheduling cadences
remain valid because their polling waits stay bounded.

Run `node --test packages/registration/test/worker-loop-mixed-batches.test.ts`
to check that mixed busy and idle claims finish the whole active batch before
refilling slots. One busy claim prevents an idle pause at two and 32 slots,
whether it finishes first or last; shutdown still waits for every active claim.
Real database concurrency and production capacity remain separate gates.

Run `node --test packages/registration/test/worker-loop-overlapping-failures.test.ts`
to check two failed claims in either completion order at two and 32 active slots.
Every active claim finishes before one original failure is reported or propagated.
A pending report prevents retry waiting and new claims; shutdown waits for that
report, and a reporting failure stops the loop. A successful report keeps the
existing polling delay and scheduling deadline. Real database failures and
production shutdown remain separate qualification gates.

Run `node --test packages/registration/test/worker-loop-synchronous-recovery.test.ts`
to check an immediate callback throw in the first or last slot of two and 32 claims.
The remaining claims finish before reporting. A pending report prevents new claims
and retry waits, shutdown waits for the report, and an immediate reporter throw
stops the loop with its original error. Successful reporting waits before retrying
and preserves the scheduling deadline. Real database failures and production
shutdown remain separate qualification gates.
