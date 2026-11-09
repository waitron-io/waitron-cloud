# A1440 guest-preparation download retries

**Authority — watcher, Lane I `questions.md`, 2026-11-09 09:23:**

> DEVIATION approved: write the small plan for retrying the guest-preparation downloads and naming the one that failed (that is the 08:48 idle-server cause). Same shape as lane C’s A1462 for Waitron’s own scripts: bounded attempts, 5xx and network errors only, never a 4xx. Claude read, then PLAN FOR APPROVAL.

This approves writing the plan only; watcher approval is required before building. Execute inline.

**Outcome and smallest design.** Retry brief failures in the Node, pnpm and Actions runner downloads; name a tool whose download or integrity check fails. Put the same short Bash function in both independently transported scripts; add no shared helper or transport change.

Allow three attempts with one-second delays, inside total per-download budgets of **60/30/120 seconds**, including delays. Read Bash `SECONDS`, stop when remaining time is `<=0`, and pass only positive remaining time to curl. Whole-second accounting can overrun by under a second; existing `session.py:245,252` stage/session deadlines remain authoritative and unchanged. A first attempt that exhausts its budget gets no retry.

Capture curl exit status and `%{http_code}`. Refuse every HTTP 4xx first, including 408/429; retry HTTP 500–599 with exit22, or network exits6/7/18/28/52/55/56. Other exits refuse. Retain HTTPS-only redirects, pinned URLs/digests, ten-second connect bounds and size limits. Never use curl retry flags. Remove partial output before each attempt; verify integrity outside the retry loop, before extraction. Name Node/runner checksum failures too. Attempt details go to stdout; final failure alone goes to stderr with tool, numeric status and reason, without raw curl errors, URLs or response bodies.

**Five changed files; zero generated files.**

- `deploy/disposable-tests/guest-tools.sh` and `runner-tools.sh`: **40–60 added code lines**, removing nine existing curl lines.
- `scripts/disposable-tests/dependencies.test.mjs`: **70–100 added test lines**, retaining existing assertions.
- `deploy/disposable-tests/README.md` and `docs/backlog.md`: **10–20 documentation lines** describing policy and remaining qualification.

**Test-first acceptance.** Extract the function between explicit markers and run it under Bash with controlled curl answers, temporary output, no-op sleep and small budget arguments. Assert the two copies match; check all three call sites’ pins/options and checksum-before-extraction order. Execute failing checksum sections on corrupt temporary bytes to check named refusals.

First observe 503→success fail against the single-attempt download section, then implement and pass. Cover network recovery; three-attempt exhaustion; 401/404/408/429; TLS/permanent errors; fresh overwrite; safe final diagnostics; zero-budget/no-curl and positive-timeout checks. Use at most one real 1–2-second budget case. Run `node --test scripts/disposable-tests/dependencies.test.mjs` and Bash syntax checks. Existing root imports select these tests in CI. Leave session tests unchanged. `guest-tools.test.py:53` keeps its360second limit and does not test runner tools.

**Finish line.** After approval: focused TDD, Claude run-it, current-head CI, finish and land. Existing hosts retain their frozen recipe until authorised publication. Then qualify one cold CI guest through both script delivery modes and cleanup, recording guest `curl --version`. A healthy guest normally exercises attempt1 only; controlled tests cover retries/refusals. This does not promise protection from the ongoing GitHub incident.

Exclude apt, host images, controller/routing, sizing, credentials and capacity changes. GitHub-first routing remains parked.
