# Retrospective Cloud reviews (D535)

## Child exit signals in local command failures

When a local replay child stops before worker admission, you need its exit signal
to distinguish interruption from a crash. The failure report retains signal names
known to Node on the current operating system, including `SIGHUP`, `SIGABRT`,
`SIGSEGV` and `SIGBUS`. Unknown values remain `null`; requested interruptions stay
restricted to `SIGINT`, `SIGTERM` and `SIGKILL`. Raw child output and private journal
fields remain excluded. The report checks and publishes one captured signal value.

Run `node --test scripts/cloud-cost/local-command-diagnostics.test.mjs scripts/cloud-cost/replay-ownership-diagnostics.test.mjs` for the native checks.
They include a real child stopped by `SIGHUP`, four known-signal cases and the
original checks for bounded output and preservation of the original failure.
These checks qualify the report. They do not reproduce the historical Linux
worker-admission failure or qualify the Docker-backed integration.

## Joint fixture setup reporting

A blocking source command can consume the setup budget while deferring its
reporting timer. Before entering another stage, the fixture now reports the
operation that crossed the budget. Initial temporary-directory refusal also
passes through the bounded reporter and preserves its original error. Reports
keep the same fixed labels and numeric fields. No setup operation is cancelled
by this observation.

Run `node --test packages/account-http/test/fiscal-waitron-setup-diagnostics.test.ts packages/account-http/test/fiscal-waitron-setup-boundaries.test.ts` for the native checks.
They retain the original privacy, cleanup, pinned-source and command-budget
assertions and add real hook and filesystem refusals plus controlled error and
clock boundaries. See [the setup investigation](joint-fiscal-fixture-setup.md)
for the historical cause and remaining timing limits.

## Interrupted LIST evidence

The pre-acknowledgement interruption control leaves the storage observer's LIST
response unfinished. You can use it to check the producer's interruption and
the refusal, but it does not qualify the historical pairing of producer
interruption and observer success. The test title states that narrower scope.

Run `node --test scripts/cloud-cost/litestream-held-list-evidence.test.mjs` for
the five native controls. The other cases cover settlement of both counters,
stop ordering, invalid replies, truncation and capture before cleanup. They do
not establish the historical Linux cause or qualify the official writer.

## Registry refusal qualification

The image launcher's immediate refusal of client errors has a limit: a message
containing both HTTP 403 and `unexpected EOF` follows the existing network-retry
path. A controlled parent/current comparison reproduces that behavior in both
versions. Keep that distinction when investigating registry failures; the bounded
5xx retry change does not establish unconditional refusal of mixed messages.
Different synthetic server-error wording also remains unrecognized, without
evidence that current CI emits it. Reproduce an actual recurrence before adding
another retry classification.

## Optional cache saves and job deadlines

A separate, optional cache save has its own one-minute deadline, but it still
shares the enclosing job's deadline. If mandatory checks leave less than a minute,
a slow save can exhaust the job budget. Keep that limit distinct from an upload
stall. The remaining job-budget investigation belongs to D530; neither a passing
save nor a later green run establishes its repair. Native parsed-workflow probes
qualify the cache wiring, while real save cancellation and child cleanup need
their own runner evidence.

## Venue-refresh handler observation

The missing-counter control wraps its configured two-second observation in a
three-second race. You can use it to detect an observation that outlasts that
outer bound. It does not independently assert the exact two-second deadline:
removing the explicit timeout uses Node's shorter default and still passes.
A five-second observation fails the control with a missing-rejection error.

Run `pnpm --dir apps/portal exec node --test test/fiscal-venue-read-failure-browser.test.ts`
for the 54 browser checks, including subtests. Normal and delayed refresh journeys
cover both languages, themes and widths. The separate Retry-After and
pending/uncertain-write cases remain in both languages at width 390. Every
original assertion and deadline remains unchanged. These checks use stubbed
HTTP; real server authority and the historical Linux cause remain unqualified.

## Open browser-fixture boundaries

A delay on every passkey-options request can hide a duplicate until after the
last count assertion. The fixture now delays only the first request, so you can
observe a second request with the existing assertions before the journey ends.
A disposable controller injects a real browser request on the second Enter.
The English, light, 390-pixel ordinary and delayed controls both reject it;
duplicate faults in the other matrix combinations remain unqualified. Removing
only the first-request condition makes the delayed control pass despite that
duplicate. After restoring
the controller, all 39 cases pass with every original assertion and deadline.
Run `pnpm --dir apps/portal exec node --test test/passkey-enter-browser.test.ts`
to check the fixture. These stubbed HTTP journeys leave real server authority
and the historical Linux failure cause unqualified.

A delay on every authenticator setup request can also hide a duplicate while
setup is pending. This fixture delays only the first recorded setup request.
A disposable controller issues a real extra browser request when Enter reaches
the disabled password field. The English, light, 390-pixel ordinary and delayed
controls reject it with the original assertions. Removing the first-record
condition lets the delayed control pass despite that duplicate. Other duplicate
fault combinations remain unqualified. After restoring the controller, run
`pnpm --dir apps/portal exec node --test test/authenticator-setup-enter-browser.test.ts`
for all 39 checks. The missing-record control bounds its configured four-second
wait through a five-second race; it does not independently assert the exact
four-second value. Stubbed HTTP leaves real account authority and the historical
Linux failure cause unqualified.

Removing the session-list controller's pending-load guard exposes an older
harness weakness. The duplicate read blocks in the browser evaluation while its
reply waits for the test's cleanup. A controlled 30-second test timeout reports
failure but leaves the process alive. The same experiment on the parent commit
needs an external stop at 45 seconds. Make this regression fail and clean up
within its existing bounds without weakening duplicate-read assertions. The
ordinary suite passes; this is a limit of its failure path.
