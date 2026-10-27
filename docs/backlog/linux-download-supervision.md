# Linux download-supervision fixture timing (D126)

PR312 run39944688693 failed the stale-process Linux fixture after both 0.3-second
installer attempts exceeded their deadlines. That run did not capture the stalled
phase. The fixture now records process IDs, elapsed times and each installer or
cleanup step before removing its temporary directory.

A controlled Linux run with eight workers sharing one CPU failed all 32 cases:
installer entry alone took 0.20–0.25 seconds, and the first attempt ended before
its detached child reached the lock checkpoint. With a one-second fixture attempt,
all 32 cases passed their original assertions. The holder became ready in
0.36–0.53 seconds, then cleanup removed it and preserved the unrelated process
and its lock. This proves the setup-budget failure under that workload; the
historical run's exact phase remains unknown.

The fixture budgets two 0.4-second Python starts and a 0.2-second holder handshake.
Its unchanged five-second outer limit covers
`2 × (0.2 + 1.0 + 0.4) + 0.01 + 1.5 = 4.71` seconds: lock wait, attempt and cleanup
for each attempt, retry, then supervisor startup, scheduling and file operations.
The unchanged 15-second Node case also covers fixture and unrelated-child setup,
verification and the final two-second cleanup. All 16 Python assertion conditions,
original Node checks and production download limits remain unchanged.

The bounded Linux diagnostic retains each case's outcome and fails if any case
fails, including when output passes through `tee`. The progress and shell-failure
checks were observed failing before their implementations. Current-head CI and
the required code review still gate landing. Docker remains unavailable locally.

One broader macOS workflow check also exhausted its separate one-second attempts;
subsequent exact-main and feature single-case checks passed. Its cause remains
unattributed. If it recurs, capture its process and step timings before changing
that separate fixture's bound; this change claims no macOS supervisor fix.

