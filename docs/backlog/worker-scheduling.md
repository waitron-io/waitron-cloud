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
its payload and claim, and drains naturally with code zero and no database sessions
remaining. The observation wrapper prints one `beforeExit` marker; the command
stays quiet. Mail queued during the hold stays pending without a delivery attempt, so shutdown
does not start another batch after the accepted delivery finishes.

The natural-drain observation (D545) catches a forced successful exit after
acknowledgement. Keeping the default referenced pool open also fails within the
existing ten-second command deadline. These checks do not identify which cleanup
method releases connections, and an unreferenced connection closed during exit
can pass the session check.

These checks use a loopback SMTP server and test addresses. Real provider failure,
delivery timeout, waits longer than one second, explicit pool cleanup and
production deployment still need separate qualification.

### Email command shutdown after a local SMTP refusal (D540)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/email-worker-refusal-shutdown.test.ts` to check SIGINT and
SIGTERM while a loopback SMTP server holds a complete message for one second,
then refuses it. The command stays live during the hold. After refusal, it records
one failed attempt, retains the encrypted payload, releases the claim and schedules
the first retry 30 seconds later. Mail queued during the hold stays untouched.
The command drains naturally with code zero and no remaining database sessions.
The observation wrapper prints one `beforeExit` marker; the command stays quiet.
The local transport records the fixed `delivery_failed` code rather than the
server's recipient-bearing reply.

The natural-drain observation (D545) catches a forced successful exit after retry
recording. Keeping the default referenced pool open also fails within the existing
ten-second command deadline. As with the acceptance checks, the session observation
does not identify explicit cleanup or distinguish unreferenced sockets closed by exit.

These checks qualify the local transport's retry state during shutdown. Production
SMTP classification, delivery timeouts, waits longer than one second, explicit pool
cleanup and production shutdown remain open.

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
diagnostic and natural code-zero exit with no remaining database sessions.
The observation wrapper prints one `beforeExit` marker; the command adds no
standard output. The table stays locked until exit, so scheduling cannot silently retry
to completion. A no-signal control requires another scheduling query after the
first cancellation, then stops it with SIGTERM and a second cancellation. This
distinguishes signal-driven shutdown from quitting after every database error.

The fixed diagnostic says retrying because it also serves the running worker;
these checks observe shutdown after the failure. The natural-drain observation
(D547) rejects forced successful exit after reporting in both signalled cases and
the retry control. It does not prove explicit pool cleanup: omitting the pool-close
call also passes these cancelled-query cases. Connection loss, statement timeouts,
active observations, other database failures, longer waits and production shutdown
remain open.

### Translation command shutdown with blocked database cleanup (D538)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec
node --test test/worker-shutdown.test.ts` to check the actual translation command
under SIGINT and SIGTERM while startup retention waits for an owned table lock.
Each signal leaves the command and its blocked connection alive during a
one-second hold. After lock release, the command drains naturally with code zero
and no database sessions remaining. A wrapper prints one `beforeExit` marker,
which a forced successful exit bypasses; the command stays quiet. Empty job,
body and usage tables stay empty, and the local provider receives no request.

The natural-drain observation (D549) catches forced successful exit after lock
release. Removing only that observation check lets the same fault pass again.
These checks do not prove explicit pool cleanup: an unreferenced connection
closed during process exit can pass the session check. They also do not
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
natural code-zero exit with no remaining database sessions. The observation wrapper
prints exactly `{"drained":true,"code":0}` only when Node reaches `beforeExit`,
which observes that no work keeps its event loop running. The table stays locked
through exit, so another cleanup query cannot complete.

A no-signal control stays live with an idle database connection for one second
after cancellation and reports the failure once. SIGTERM then ends the command
within six seconds with the current 60-second cleanup retry wait. With that
long wait, this catches ignoring shutdown during retry. A shortened wait that
ignores shutdown but expires within six seconds can pass. The control also catches
quitting after every cleanup error and immediately starting another retention
query. It does not observe the full retry interval or its eventual expiry.

The job, body and usage tables start and end empty, and the loopback provider
receives no requests. These are fixture boundaries, not proof about retention
that changes stored jobs. The natural-drain observation (D548) catches a forced
successful exit after error reporting in all three cases. Removing only the drain
assertion lets that fault pass again; removing the signal handlers fails all three
cases. Omitting the pool-close call also fails all three cases: the default idle
connection keeps Node alive beyond the six-second deadline. This does not identify
the cleanup path: allowing exit with idle connections can still pass without that
call. Longer waits, statement timeouts, connection loss and production shutdown
remain open.

### Idle email and monitoring commands drain naturally (D543)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/worker-command-natural-exit.test.ts` to check idle email and
monitoring shutdown under SIGINT and SIGTERM. Each command first reaches four
idle connections after real empty-queue claims. A wrapper observes Node's
`beforeExit` event, which runs when its work drains and is bypassed by a forced
exit. Shutdown must reach that event with code zero within six seconds and leave
no database sessions. While idle connections keep Node alive under the default
pool settings, the bound catches an omitted pool close before the ten-second
idle connection expiry can mask it. Allowing exit with idle connections would
let an omitted close pass; the session check cannot distinguish that case.

The wrapper observes the actual commands without replacing database or worker
methods. These checks cover empty queues only. Natural drain during active work,
database failures and production remain open. They do not
identify which cleanup method released the connections.

### Idle translation commands drain naturally (D544)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec
node --test test/worker-natural-exit.test.ts` to check idle translation shutdown
under SIGINT and SIGTERM. The command first reaches two idle connections after
real empty-queue claims and stays live for three seconds before the signal. This
catches a worker that stops on its own during that observation period. A wrapper
observes Node's `beforeExit` event, which runs
when work drains and is bypassed by forced exit. Shutdown must reach that event
with code zero within six seconds and leave no database sessions after exit. The job, body
and usage tables stay empty, and the loopback provider receives no requests.

While default idle connections keep Node alive, the six-second bound catches
omitted pool cleanup before their ten-second idle expiry. Allowing exit with idle
connections would let that omission pass. The wrapper leaves database and worker
methods intact; it does not identify which cleanup method released connections.
The session check cannot distinguish explicit cleanup from sockets closed by
process exit, or detect an unreferenced connection closed during exit. A worker
that stops on its own after the three-second live period can still pass.
The [active translation checks](#active-translation-commands-drain-naturally-d550)
require natural drain in three provider-call cases. Other active-work combinations,
database failures and production shutdown remain separate qualification gates.
Longer idle periods and pre-signal live observation for the email and monitoring
commands remain unqualified.

### Active translation commands drain naturally (D550)

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec
node --test test/worker-cli.test.ts` to check natural command exit after SIGTERM
during the first provider call, SIGINT during review, and SIGTERM with two active
jobs and a third queued. An observation-only preload prints exactly
`{"drained":true,"code":0}` at Node's `beforeExit` event. A forced successful exit
after cleanup bypasses that event and fails all three checks; reverting only the
new output expectation lets the same fault pass again. The command stays quiet.

The original checks still require the interrupted jobs to retain no partial batch
and release their leases for another attempt. The two-job case leaves the third
job queued and makes no further provider request. All existing signal, state,
usage, privacy and deadline checks remain. The provider is a loopback fixture;
these tests send no request to an outside service.

These checks require natural exit within the existing twenty-second command
deadline. They do not prove explicit pool cleanup or that every pending operation
was awaited. Other signal and provider-phase combinations, provider timeouts,
connection loss and production shutdown remain open.

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

## Additional shutdown and timer qualification

The [idle command drain checks](worker-scheduling.md#idle-email-and-monitoring-commands-drain-naturally-d543)
require email and monitoring commands to drain naturally after SIGINT and SIGTERM,
with no remaining database sessions. They catch forced successful exit and, while
idle connections keep Node alive under the default pool settings, omitted pool
cleanup. Natural drain during active work beyond the local SMTP acceptance and
refusal checks, database failures and production shutdown remain open.

The [idle translation drain checks](worker-scheduling.md#idle-translation-commands-drain-naturally-d544)
observe three seconds of live idle polling before SIGINT or SIGTERM, then require
natural event-loop drain. No database sessions remain after exit, and the loopback
provider receives no requests. They catch forced successful exit and omitted pool
cleanup while default idle connections keep Node alive. Active work, database
failures and production shutdown remain open.

The [email command signal checks](worker-scheduling.md#email-command-shutdown-with-real-database-claims-d536)
cover idle shutdown and a one-second hold of four blocked PostgreSQL connections
under SIGINT and SIGTERM, followed by normal exit after lock release.
Other worker commands, active delivery and production shutdown remain open.

The [email delivery shutdown checks](worker-scheduling.md#email-command-shutdown-during-local-smtp-delivery-d539)
hold a local SMTP acknowledgement for one second under SIGINT and SIGTERM.
During that hold the message stays processing. After acknowledgement, the command
records it as sent, leaves later mail pending and drains naturally with code zero
and no database sessions remaining. The wrapper's `beforeExit` observation (D545)
catches a forced successful exit after delivery. Provider failures,
delivery timeouts and production shutdown remain open.

The [email refusal shutdown checks](worker-scheduling.md#email-command-shutdown-after-a-local-smtp-refusal-d540)
hold a local SMTP reply for one second, then refuse it under SIGINT and SIGTERM.
The command records a delayed retry, retains the encrypted payload, releases the
claim and leaves later mail untouched before draining naturally. The wrapper's
`beforeExit` observation (D545) catches a forced successful exit after retry recording.
Production SMTP classification, delivery timeouts and production shutdown remain
open.

The [monitoring command signal checks](worker-scheduling.md#monitoring-command-shutdown-with-real-database-scheduling-d537)
cover idle shutdown and a one-second hold of blocked startup scheduling under
SIGINT and SIGTERM, followed by normal exit with no remaining database sessions.
Active monitoring, database failure and production shutdown remain open.

The [monitoring cancellation shutdown checks](worker-scheduling.md#monitoring-command-shutdown-after-database-query-cancellation-d541)
cover SIGINT and SIGTERM while startup scheduling waits on a PostgreSQL table lock.
After a one-second hold, cancelling that query produces one fixed diagnostic and
natural code-zero exit with no database sessions remaining, even while the table
stays locked. Without a signal, the command retries the cancelled schedule.
The wrapper's `beforeExit` marker (D547) rejects forced successful exit in all three
cases. Explicit pool cleanup, other database failures, active observations and
production shutdown remain open.

The [translation command signal checks](worker-scheduling.md#translation-command-shutdown-with-blocked-database-cleanup-d538)
cover a one-second hold of blocked startup retention under SIGINT and SIGTERM,
followed by natural event-loop drain with no database sessions remaining. The
wrapper's `beforeExit` observation (D549) catches forced successful exit after
lock release. Job, body and usage tables end empty, and the local provider
receives no request. Explicit pool cleanup remains open.
Active retention changes, database failure and production shutdown remain open.

The [translation cancellation shutdown checks](worker-scheduling.md#translation-command-shutdown-after-database-query-cancellation-d542)
cover SIGINT and SIGTERM while startup retention waits on a PostgreSQL table lock.
After a one-second hold, cancelling that query produces one fixed diagnostic and
natural code-zero exit with no remaining database sessions. The wrapper's drain
marker is required in all three cases, including shutdown during retry. Without a
signal, the command stays live for one second after cancellation; shutdown then ends the current
60-second retry wait within six seconds. A shortened wait that ignores shutdown
can pass. Forced exit fails the drain check, and omitting pool cleanup with default
referenced idle connections fails the deadline. Allowing exit with idle connections
can pass without that cleanup. Actual retry expiry, active retention changes,
cleanup identity, other database failures and production shutdown remain open.

Run `node --test packages/registration/test/worker-loop-schedule-timer.test.ts`
to check that startup and recurring scheduling failures enter a real retry timer
before shutdown. At two and 32 slots, reporting keeps the original error and
failed schedules admit no new claims; cancellation releases the native timer and
lets the process exit. Production signals and real database failures remain open.

Run `node --test packages/registration/test/worker-loop-native-isolation.test.ts`
to check two workers using real idle and failure-retry timers at two and 32 slots.
Stopping either worker releases its timer while the other keeps waiting with its
own signal. Claim and schedule failures report their original error once; the
surviving worker exits after its own shutdown. Production signals and real
database failures remain separate gates.

Run `node --test packages/registration/test/worker-loop-native-recovery.test.ts`
to check that idle and failure-retry timers actually expire before work resumes
at two and 32 slots. Claims and startup or recurring schedules recover after
one native timer, keep the original refusal and exit after shutdown. Production
signals and real database recovery remain separate gates.

Run `node --test packages/registration/test/worker-loop-native-cadence.test.ts`
to check real timer expiry against the next scheduling deadline at two and 32
slots. The interval starts after scheduling completes; idle polling shortens
either its only wait or its final wait to meet that deadline. Every active claim
finishes before polling, and shutdown prevents further claims. Production
scheduling and real database failures remain separate gates.

Run `node --test packages/registration/test/worker-loop-native-reporting.test.ts`
to check pending startup and claim error reports at two and 32 slots. Native retry
timers start only after reporting completes, then expire before work resumes.
Shutdown waits for reporting without a retry timer; a refused report keeps its
original error and stops a live worker. Real database failures and production
shutdown remain separate gates.

Run `node --test packages/registration/test/worker-loop-native-recurring.test.ts`
to check a recurring schedule failure after busy or idle batches at two and 32
slots. Pending reporting preserves the original error and prevents retry timer
creation. Recovery follows real timer expiry, starts its next interval after
scheduling completes and shortens idle polling to the next deadline. Shutdown
after that interval admits no further claims. Real database recovery and
production signals remain separate gates.

Run `node --test packages/registration/test/worker-loop-native-recurring-stop.test.ts`
to check shutdown and reporter rejection during a pending recurring schedule
error report. After busy or idle batches at two and 32 slots, cleanup finishes
before return, original errors survive, and no new claims, schedules or retry
timers start. Real database failures and production signals remain separate gates.

Run `node --test packages/registration/test/worker-loop-native-cancellation.test.ts`
to check shutdown while two or 32 active claims wait on real Node timers.
Cancellation releases every timer; the loop waits for the last claim's cleanup
and any pending error report before returning. Unreported claim failures and
reporting failures keep their original errors, and shutdown starts no new claims
or timers. Each child exits naturally. Real database cancellation and production
signals remain separate qualification gates.

## Cancellation and empty failure values

Run `node --test packages/registration/test/worker-loop-cancellation.test.ts` to
check claims that finish or reject when shutdown cancels them. At two and 32 active
slots, shutdown waits for every claim's cleanup and any pending error report,
without scheduling, polling or retrying. Cancellation and reporting failures keep
their original errors. Real database cancellation and production shutdown remain
separate qualification gates.

Run `node --test packages/registration/test/worker-loop-empty-failures.test.ts`
to check rejection with undefined, null, false, zero or an empty string. Scheduling,
claim and polling failures keep their original values through reporting or
propagation; failed claims wait for sibling cleanup and pending reports. Empty
reporter failures remain rejections. Real database errors and production shutdown
remain separate qualification gates.

## Recurring intervals across clock corrections

Recurring worker intervals now use elapsed time, so system-clock corrections cannot
delay or accelerate the next scheduling pass. Run `node --test
packages/registration/test/worker-loop-clock.test.ts` to check forward and backward
clock changes with busy and idle batches at two and 32 slots. Scheduling still
starts its next interval after completion, and idle polling meets that deadline.
Fractional waits round up before reaching native timers to avoid an extra idle
batch caused by truncation.
Real database scheduling and production shutdown remain separate gates.
