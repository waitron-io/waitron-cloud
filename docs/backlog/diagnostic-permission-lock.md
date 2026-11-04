# Diagnostic permission test lock observation (D198)

The diagnostic ownership fixture must commit a revocation while its incident
read is paused, then refuse the request with HTTP 403. Its former 100 ms sleep
observed completion of a JavaScript promise, which also includes connection,
commit and callback delays. A controlled Linux run delayed update submission
by 200 ms: the old assertion failed at 100.434 ms before any membership update
was submitted, then the update completed at 203.205 ms. Eight ordinary controls
completed in 2.94–3.17 ms. The historical failure in
[run 40089088819](https://github.com/waitron-io/waitron-cloud/actions/runs/40089088819/job/120857966430)
did not record those stages, so its exact delay remains unknown.

The fixture now applies PostgreSQL's same 100 ms allowance specifically to
lock waits and awaits the successful update and commit before releasing the
incident read. It identifies that read by its actual blocker and checks that
exactly one membership changed. A five-second statement limit bounds other
database execution; the original five-second observation and 30-second test
limits remain. Ordinary and delayed submissions retain the final 403 check.
Production permission code is unchanged. Deliberately retaining the membership
lock or removing the final ownership refusal must still fail these cases.

## Current Linux qualification

On 4 November 2026, all six cases in `diagnostics.test.ts` pass against real
PostgreSQL on Linux, including ordinary and delayed revocation submission. The
fixture matches main at `a9a9476d050323b8b6fb9a317ccfaad605eca4e9`. This recheck
neither reproduces the historical delay nor establishes its cause. The historical
job log reports the failed promise-completion assertion but no update-submission,
database-completion or commit times.

Run the focused cases with:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/diagnostics.test.ts
```

For a recurrence, record connection acquisition, update submission, update
completion, commit completion and incident-read release separately. Record the
blocked backend's query start, wait event and actual blocker alongside those
stages. A slow JavaScript promise alone does not show a database lock wait.
Retain the 100 ms lock-wait limit, successful one-row revocation and commit
before releasing the incident read, and final HTTP 403 refusal. The five-second
observation and 30-second test limits stay unchanged. Those staged timings are
still needed before attributing another delay; this recheck does not supply them.
