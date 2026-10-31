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
