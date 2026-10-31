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
