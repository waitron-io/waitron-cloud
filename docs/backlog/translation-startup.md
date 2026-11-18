# Translation startup failure evidence (D574)

The [4 November translation job](https://github.com/waitron-io/waitron-cloud/actions/runs/41869210294/job/126711566104)
failed while starting the packaged worker. Compose returned 255 after about
20.3 seconds, with bootstrap still waiting. The log did not retain the child
process error or signal. You cannot tell from this evidence whether the
20-second command deadline fired or Compose exited for another reason.

The two-week failure inventory covers 1,998 workflow runs and eight failed
translation jobs. This is the only matching bootstrap exit-255 occurrence in
that inventory. Another failure in the same fixture was a Docker image download
connection reset before startup; the other six failures concern different checks.
These observations establish neither a recurring bootstrap defect nor its cause.

For normal lifecycle commands, the fixture now reports `compose-result` on
failure. You get the command
arguments, exit status, signal, process error code and measured elapsed time.
Before cleanup, a separate two-second state read uses the same unique Compose
project and retains only bootstrap, database, migration and translation-worker
service names, states, health and exit codes. Its captured output is limited to
16 KiB. Refused, timed-out or malformed state reads remain diagnostic evidence;
they never turn the original command failure into success. Container configuration
and private service logs are excluded from this additional state evidence.
The result and original command output are printed before the assertion, so a
cleanup failure or expired test deadline cannot erase the startup evidence.
The state read kills its direct child with SIGKILL on timeout, including a
child that ignores SIGTERM. Cleanup of an arbitrary descendant that outlives
that process is not established by these controls.

The existing 20-second command and 30-second test limits remain. The migration
digest refusal, worker dispatch and local provider environment assertions remain.
Eleven controls exercise exit 255, an actual command timeout, refused and timed-out
state reads, ignored SIGTERM, failed and delayed cleanup, malformed and oversized
state output, both supported JSON forms and private values in lifecycle fields.
A stricter two-second inner test deadline proves evidence survives delayed
cleanup; it does not change the runtime fixture's normal thirty-second deadline.
Each control retains the failing startup and attempts the original project
cleanup. The deliberate invalid-schema run retains its separate exit-one and
fixed-message assertions rather than entering the success-only helper.
These controls do not reproduce the
historical runner or establish its cause. Retain the new result and service states
if CI fails again, then investigate the reported process or bootstrap boundary.

On 17 November, [PR #1282's translation job](https://github.com/waitron-io/waitron-cloud/actions/runs/44182558014/job/134390665850)
reported startup exit 255 with `ETIMEDOUT`: the twenty-second Compose command
returned after 135,848 ms, its state read returned an empty service list, and the
thirty-second Node case was cancelled. No service output identified the blocked
boundary. The same launcher passed in 12,156 ms on the preceding PR head; only
three remote-access test files changed between those heads. The unchanged case
also passed once in 9,418 ms through the authorised Mac Docker wrapper; that ARM
run does not qualify the Linux runner or explain its delay. Preserve the command,
test and migration-refusal checks. The startup cause remains open; another green
CI execution qualifies that candidate without fixing this failure.


On 18 November, [PR #1298's translation job](https://github.com/waitron-io/waitron-cloud/actions/runs/44284215135/job/134733197758)
reported the same command ending with exit 255 and `ETIMEDOUT` after 20,007 ms.
Bootstrap had exited successfully. PostgreSQL was still starting, and the
migration and translation containers were still in the created state. The
launcher and Compose inputs match the base revision. This occurrence happened
before the migration container started. The startup cause remains open.
