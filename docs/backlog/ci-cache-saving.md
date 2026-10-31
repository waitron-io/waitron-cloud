# CI dependency-cache saving

## Dependency-cache save stalls (D507)

Cost conformance, the password diagnostic, the shared UI build and the browser
reconnect diagnostic use a stable pnpm store path across runners, restore it
separately and limit optional cache saves to
one minute after successful mandatory steps. A save timeout stays visible without changing the test
result. Keep saving last so the runner promptly cleans up its child processes. The
password diagnostic retains its password snapshot, deliberate-fault and artifact checks.
The UI build keeps its source-lockfile cache key, package checks, publication dry run
and artifacts; actual publishing still requires its separate manual invocation.
The reconnect diagnostic preserves both CPU groups, first-refusal sampling,
deliberate-fault controls and diagnostic artifacts.

**Open.** Attribute the historical upload stall; the controlled archive-creation stall
proves the save deadline, not that transport cause. The other five setup-node cache
consumers retain their existing behaviour and need separate qualification before changing.
