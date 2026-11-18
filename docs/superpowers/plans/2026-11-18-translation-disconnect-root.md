# Find why the translation disconnect test fails on CI

A failed run should identify the disconnect check that failed and show the
PostgreSQL connections it selected and whether each termination succeeded.
Use that evidence to reproduce the cause and repair it without adding retries.
The watcher queued this work in Lane G as TRANSLATION-DISCONNECT-ROOT at
13:32 on 18 November 2026. Codex wrote this plan for Claude review and watcher clearance.

## What the two runs show

[Main job 128479291385](https://github.com/waitron-io/waitron-cloud/actions/runs/42395447647/job/128479291385)
records 684 passes and one failure at line 192 of its checkout. The test found
at least one connection for which PostgreSQL returned false from the termination
call. The diagnostic begins after this assertion.

[PR #1299 job 134794387767, attempt 1](https://github.com/waitron-io/waitron-cloud/actions/runs/44302084131/job/134794387767)
records 1,852 passes, one failure and 30 skips in the local-stack suite. The
outer test could not find the diagnostic. The inner error identifies the case's
opening line and gives the generic assertion code. Its exact assertion and any
shared cause are unknown. The focused Linux pass did not reproduce the failure.

## Work and checks

1. In `deploy/test-cloud/translation-disconnect-binding.test.mjs`, use the
   existing nested runner and real PostgreSQL worker to force a false
   termination result into the tested assertion. Verify that evidence is
   missing before the change. Keep the binding checks for the existing
   fixed-output diagnostic.
2. In `packages/translation/test/worker-cli.test.ts`, attach the failed check's
   identity and the existing iteration, process IDs and boolean termination
   results to the pre-exit assertion error. Preserve the existing assertions.
   In `scripts/test-cloud-free-services.mjs`, carry these bounded facts through
   the existing failure reporter and receipt reader without requiring a worker
   output tuple. Keep the current fixed-message allowlist, numeric limits,
   ordinary failure row and refusal. Use
   `scripts/translation-disconnect-diagnostics.test.mjs` for reader, forwarding
   and redaction checks. The binding test owns the real subprocess evidence.
3. With diagnostics on in a scratch Linux checkout, test whether the first
   termination makes the worker close other selected connections before
   PostgreSQL can signal them. This is a hypothesis. Use the observed ordering
   to write a failing regression and fix the proven cause in the fixture or,
   if the evidence points there, `packages/translation/src/worker-cli.ts`.
   Keep the fixed exit output, current deadlines and the proof's pass rules.
   If the cause remains unknown, take the retained evidence to the watcher.
4. Keep both exact job links in `docs/backlog/translation.md`. Update the
   diagnostic pointer in `docs/backlog.md` to match what the checks show.

Run `node --test scripts/translation-disconnect-diagnostics.test.mjs`,
`node scripts/test-postgres.mjs exec node --test deploy/test-cloud/translation-disconnect-binding.test.mjs`
and the named disconnect case in `worker-cli.test.ts` through the same database
wrapper. GitHub runs the selected suites. Expect 40–90 lines in the reporter or
worker and 90–160 lines in tests and test support. The finish line is a retained
failure, a reproduced cause and a passing regression for its repair.
