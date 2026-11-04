# Joint fiscal fixture setup

## D413 — Locate a failed joint fiscal fixture setup

**Historical reference.** Cloud retired this joint fixture and its diagnostic
tests in [PR #711](https://github.com/waitron-io/waitron-cloud/pull/711).
The notes below describe that removed setup path. The historical timeout
remains unexplained; removing its caller does not identify or repair its cause.

If the pinned PostgreSQL/Waitron integration fails during setup, you get the
active operation and elapsed timings before cleanup, including a refusal to
create the temporary directory. A reporting timer observes the existing
120-second hook budget. Blocking commands defer timers, so each stage transition
also checks the elapsed budget before replacing the operation label. You can
therefore identify the operation that crossed the budget even when it finishes
before the timer runs. Reporting observes the budget; it does not stop setup or
extend a deadline. Setup that finishes within budget stays silent. A command
that throws before the next stage still reports `failure`, with its operation
and elapsed time, even if it has also exceeded the budget.

Reports contain only fixed labels and timings, without caught errors, commands,
credentials or receipt contents. Native controlled-boundary checks cover failed
operations, original error identity, reporting failure, cleanup, a completed
blocking overrun and the real hook's asynchronous timeout path. The blocking
hook check uses a 50-millisecond budget and a 200-millisecond controlled command;
it does not establish full-duration timing. The unreferenced timer alone cannot
keep a stalled process alive, so reporting after a hook timeout with no remaining
referenced handle is still unqualified.

Git, install, bridge and hook deadlines, the pinned commit, fiscal assertions and
allocation behaviour retain their existing checks. The operation behind D412's
historical setup timeout remains unknown; use a failing instrumented run to
identify it before proposing a repair. The PostgreSQL qualification described
here belongs to the retired fixture. Current retained-schema and missing-route
checks use separate fixtures.
