# D599: ordinary-user runners and measured slots

Follow the [design](../specs/2026-11-06-disposable-test-server-design.md) and [existing plan](2026-11-06-disposable-test-server.md). Authority: Lane I questions.md, WATCHER 2026-11-07 17:10: “Run the runner as an ordinary user inside the guest”; “Include one browser shard and test-heavy”. WATCHER 17:17: “with today's 16 GiB guests and the 16 GiB host reserve, step 4 then 6, no overcommit”. WATCHER 17:56 requires `/home/runner/work` for mixed coverage. Claude reads before build; D592 automatic pickup is separate.

### 1. Land the ordinary-user profile first

- [ ] In `runner-tools.sh` and `guest-exec.py`, provision `runner`, its home, Docker and passwordless sudo. Give it the runner tree after checksum recording, its own environment and only inherited locale settings. Change only the fixed listener child’s groups/GID/UID. Keep provisioning, supervision, completion, cleanup and before/after checks privileged. JIT input stays in stdin/environment, never Mac/shared-host files, argv or logs. Decoded guest credentials may remain until destruction; the VM is the boundary.
- [ ] TDD identity/environment cases in `ci-session.test.py`; rerun existing completion/executor controls. Fresh-guest probes verify ordinary UID, writable work, Docker/sudo, status/nonce and cancellation/deadlines. Preserve assertions; update only additive case counts in `session.test.mjs`. Publish matching frozen host/controller/config through the gated installer with new state/hostGeneration. Waitron’s three unreadable-file cases at `apps/server/src/handover-destination-api.test.ts:779` must execute.
- [ ] In `ci-canary.mjs`, request JIT `work_folder=/home/runner/work`, retaining the executable path. TDD the payload. After F’s selected-head fix, run a selected trial, restore hosted mode, prove matching checkouts and successful mixed coverage, then tell F. If GitHub refuses the absolute value, relative `../../home/runner/work` resolves identically.

### 2. Land several slots afterwards

- [ ] Extend existing controller/lease/transport modules: short locked ledger updates; slot ownership before reservation through cleanup; recover only unowned slots. Put existing CI intent/temporary directories per slot. Turn identity becomes `ci-RUN-ATTEMPT-JOB`; serialize run-level fallback. Keep the ledger maximum; budget selects capacity.
- [ ] Extend existing host/session/startup/guest consumers: validate slots, port `22000+slot`, UID `62000+slot`, reserved accounts and existing active record per slot. Preserve tombstones, independent absence, quarantine and runner-removal retries. Drain before coupled publication/new bootstrap; enable several slots only with matching host support.

### Prove and measure

- [ ] TDD portable/real-process collision, stale-release, neighbor-survival, death/reboot cases; retain one-slot checks. Run `node --test scripts/ci-disposable-local.test.mjs`; read counts and update README/backlog. No permanent mutation tests.
- [ ] Host/startup requires slots×18 GiB+16 GiB ≤ host RAM; slots×4+8 ≤ online logical threads, reserving every sibling of four physical cores; 20% disk reserve including guest maxima/quarantines. Measure four then six overlapping jobs from F, including browser/heavy; never edit Waitron. Preserve counts/deadlines, zero OOM and 120-second cleanup. Record per-guest queue/run/peak/MemAvailable and host minimum available memory/maximum load. Recommend smaller guests only. Reject unsafe admission; report each step in one watcher line. No new record type or protocol.
