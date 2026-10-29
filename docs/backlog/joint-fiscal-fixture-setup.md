# Joint fiscal fixture setup

## D413 — Locate a failed joint fiscal fixture setup

If the pinned PostgreSQL/Waitron integration fails during setup, you now get the
active operation and elapsed timings before cleanup. A reporting timer also names
the active operation when the existing 120-second hook budget elapses. Successful
setup stays silent; reports contain fixed labels and timings, without caught
errors, commands, credentials or receipt contents. Native controlled-boundary
checks cover failed operations, reporting failure, cleanup and the real hook's
timeout path. Git, install, bridge and hook deadlines, the pinned commit, fiscal
assertions and allocation behaviour are unchanged. The operation behind D412's
historical setup timeout remains unknown; use a failing instrumented run to
identify it before proposing a repair. Real PostgreSQL qualification runs in CI
while local Docker is unavailable.
