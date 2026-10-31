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

### Monitoring command shutdown with real database scheduling (D537)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/monitor-worker-shutdown.test.ts` to check the actual monitoring
command under SIGINT and SIGTERM. Each signal stops idle polling normally and
closes the command's database connections. When an owned installations-table
lock blocks startup scheduling, the command retains its connection during a
one-second hold after the signal and exits normally after lock release.
The empty tables prevent observations and alert mail.

These checks protect orderly command shutdown while database work finishes.
They do not prove cancellation of an active query or distinguish waiting in the
worker loop from waiting in pool cleanup. Active monitoring, other commands,
database failures and production deployment retain separate qualification gates.

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
