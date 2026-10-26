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
