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

## Stale-draft and script-recovery wait boundaries

The stale-draft delayed journeys pause the first gated installation read in each
of eight language, theme and width combinations. Their later twelve reads run
without that pause. All 130 historical checks and 64 parent checks pass; removing
the observation still passes the disabled-control assertions because the page
already marks the read pending before the handler enters. These runs qualify the
fixture observation, not delayed handling of every later read. The full historical
file took about 150 seconds against 57 seconds for its parent during review on a
shared machine; those measurements are not a general performance bound.

The stale-draft missing-signal control wraps its configured 30-second observation
in a 31-second race. It catches the old unresolved wait, but removing the explicit
timeout uses Node's shorter default and still passes. The script-fallback control
similarly checks its configured four-second observation through a five-second
race. Its 50 historical checks and 25 parent checks pass. Omitting observation
fails eight delayed-script journeys; sixteen reload journeys pass because reload
already establishes ordering. All 24 screenshot pairs from the historical and
parent runs are byte-identical, before recovery or handler variation.

Keep these boundaries when using the receipts. Every original assertion, expected
value and deadline remains. Real account or fiscal authority, supported browsers,
production networks and the historical Linux causes remain unqualified.

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
setup is pending. Setup handlers pause only while no request has been recorded.
A disposable controller issues a real extra browser request when Enter reaches
the disabled password field. The English, light, 390-pixel ordinary and delayed
controls reject it at the final recount after the setup reply is released, using
the original assertions. Removing the record-count condition lets the delayed
control pass despite that duplicate. Arbitrarily late arrivals and other duplicate
fault combinations remain unqualified. D535 still needs to qualify later arrivals
without weakening the current bounds. After restoring the controller, run
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

## Public browser-check waits and screenshots

The JavaScript-disabled fixture now keeps all 24 screenshots from its ordinary
and delayed journeys. Its 16 historical filenames stay the same; the eight
delayed captures add `-delayed`. Before this change, those captures overwrote
ordinary screenshots. A real browser run first passed all 25 checks, while a
separate review check of 24 expected files failed with only 16 images. After the
filename change, the browser run and review check pass, and the 16 original images
remain byte-identical. Every existing assertion,
clock and deadline stays unchanged.

Historical PR614, PR613 and PR612 pass 25, 66 and 41 browser checks respectively;
their parents pass 16, 32 and 24. The current three-file run passes all 132 checks.
The 48 captured head/parent image pairs are byte-identical, covering only the
states where these fixtures take screenshots. Other browser engines and real
networks remain unqualified.

All three missing-signal controls wrap a configured four-second observation in
a five-second race. They reject an observation that exceeds the outer bound,
but removing the explicit timeout uses Node's shorter default and still passes.
Do not treat these controls as independent proof of the exact four-second value.
Deleting the normal observation also leaves the JavaScript-disabled and reload
journeys green; the running-failure fixture's restarted observation has an
intermittent request-count failure when omitted. Delayed journeys repeat their
product checks without proving every observation necessary. A changed challenge
URL does expose the bounded refusal in the JavaScript-disabled and reload
fixtures; the parent controls need external stops. Hiding or redirecting the
running-failure fixture's reload link fails its original product checks.

The PR613 running-failure reload fixture now retains 17 captures: eight ordinary,
eight delayed and the reachable English/light/390 missing-next case. The eight
historical filenames stay unchanged. Before the repair, all 66 browser checks
passed while the separate 17-file review check failed with only eight images.
After the filename change, both checks pass. The eight original image bytes match
in the driver's compared runs; the review also observes byte differences between
repeated runs of unchanged code. Byte equality is a run-specific observation.
The missing-first control returns before capture. The wait comment
now describes the missing-signal helper's five-second outer race; it does not claim
that omitting either normal observation must fail. Every behavioral assertion,
clock and deadline remains unchanged.

The PR612 script-failure reload fixture now retains 41 captures: 24 ordinary,
16 delayed and the reachable English/light/390 missing-signal case after a 503.
The 24 historical filenames stay unchanged. Before the repair, all 41 browser
checks passed while a separate 41-file review check failed with only 24 images.
After the filename change, both checks pass. Unique paths retain each capture;
they do not promise different pixels. The missing-signal comment describes the
five-second outer race rather than claiming that omitting the normal observation
must fail. Every behavioral assertion, expected value, clock and deadline remains.
The PR613 proof-count fault and fresh-restart product fault, disabled-script
product faults in PR612, other failure-state images and real authority remain
unverified. These are qualification limits, not claims of production repairs.

Run `pnpm --dir apps/portal exec node --test test/public-challenge-noscript-browser.test.ts test/public-challenge-failure-reload-browser.test.ts test/public-challenge-reload-browser.test.ts`
for the three local browser files. Set `PUBLIC_CHALLENGE_RECEIPT_DIR` to a fresh
directory when checking the JavaScript-disabled fixture's 24 retained images or
the running-failure reload fixture's 17 retained images, or the script-failure
reload fixture's 41 retained images.
Use separate directories for the three files, because their historical filename
schemes do not promise uniqueness across files.

## Public browser-check live-status captures

The PR611 live-status fixture now retains sixteen challenge-failure screenshots:
eight ordinary and eight delayed. The eight historical names stay unchanged;
delayed captures add `-delayed`. Before the repair, all 33 browser checks passed
while a separate sixteen-path review check failed with only eight images. After
the filename change, both checks pass. Every behavioral assertion, expected
value, clock and deadline remains unchanged. Separate names preserve captures;
they do not promise different pixels. Seven of eight historical image pairs
match byte-for-byte in the driver's compared runs; general byte stability is
unqualified.

Run `pnpm --dir apps/portal exec node --test test/public-challenge-status-browser.test.ts`
with `PUBLIC_CHALLENGE_RECEIPT_DIR` set to a fresh directory. Use a separate
directory from other public browser-check fixtures, whose filenames can overlap.
The missing-signal control returns before capture; worker failures are checked
without screenshots. Its configured four-second observation sits inside a
five-second race. The control does not independently prove the exact four-second
value or that ordinary observations are necessary. Other engines, real networks
and authority remain unqualified.
