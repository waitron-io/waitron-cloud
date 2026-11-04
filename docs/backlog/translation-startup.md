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

The fixture now reports `compose-result` on a failed command. You get the command
arguments, exit status, signal, process error code and measured elapsed time.
Before cleanup, a separate two-second state read uses the same unique Compose
project and retains only bootstrap, database, migration and translation-worker
service names, states, health and exit codes. Its captured output is limited to
16 KiB. Refused, timed-out or malformed state reads remain diagnostic evidence;
they never turn the original command failure into success. Container configuration
and private service logs are excluded from this additional state evidence.

The existing 20-second command and 30-second test limits remain. The migration
digest refusal, worker dispatch and local provider environment assertions remain.
Controlled Docker commands exercise exit 255, an actual command timeout, a refused
state read and a timed-out state read. Each must retain the failing startup and
attempt the original project cleanup. These controls do not reproduce the
historical runner or establish its cause. Retain the new result and service states
if CI fails again, then investigate the reported process or bootstrap boundary.
